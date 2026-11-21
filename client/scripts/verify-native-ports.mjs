/**
 * Compares every ported scene against its upstream HyperFrames page.
 *
 * 1. The upstream page is rendered from the reference HTML with the same GSAP
 *    build the port imports.
 * 2. The port is rendered by native-port.html, which mounts the Svelte scene
 *    1:1 at the artboard size (no gallery chrome, no fit scaling).
 * 3. Both are seeked to the same times and their element geometry, opacity,
 *    text and pixels are compared.
 * 4. The dev gallery is exercised separately to prove every port mounts and
 *    scrubs there too.
 */

import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const devServer = process.env.NATIVE_GALLERY_URL ?? 'http://127.0.0.1:5175'
const output = new URL('../../.impeccable/review/native-first-ten/', import.meta.url)
const reference = '../../packages/mcp-installer/library/hyperframes-library/registry/'

const ports = [
  {
    id: 'transitions-3d', group: 'blocks', artboard: [1920, 1080], aspect: 'landscape',
    root: '#composition', times: [0, 1.5, 3.5, 5.5, 7.5, 9.5, 11],
    selectors: ['#title-card', '#scene1', '#s1', '.big-text', '#info-bar', '#outro-card'],
  },
  {
    id: 'ui-3d-reveal', group: 'blocks', artboard: [1920, 1080], aspect: 'landscape',
    root: '[data-composition-id="ui-3d-reveal"]', times: [0, 1, 2.5, 5, 8, 11, 13],
    selectors: ['[data-composition-id="ui-3d-reveal"]', '.card-wrapper', '.scene'],
  },
  {
    id: 'agent-cursor', group: 'components', artboard: [1920, 1080], aspect: 'landscape', mount: 'template',
    root: '#root', times: [0, 0.7, 1.4, 2.2, 3, 4, 4.8],
    selectors: ['#ag-tag', '#ag-actor', '#ag-ring', '#ag-name', '#ag-status', '#ag-check'],
  },
  {
    id: 'ai-answer-rank', group: 'blocks', artboard: [1080, 1080], aspect: 'landscape',
    root: '#aar-root', times: [0, 1, 3, 5, 7, 8.5],
    selectors: ['#aar-card', '#aar-bubble', '#aar-typed', '#aar-answer', '#aar-row-a', '#aar-row-brand', '#aar-check'],
  },
  {
    id: 'ai-chat-reveal', group: 'blocks', artboard: [1080, 1920], aspect: 'portrait',
    root: '#acr-root', times: [0, 0.5, 2, 5, 10, 16.3, 18], logo: true,
    selectors: ['#acr-composer', '#acr-keyboard', '#acr-bubble', '#acr-dot', '#acr-ctext', '#acr-endcard-inner'],
  },
  {
    id: 'vfx-anamorphic-flare', group: 'blocks', artboard: [1920, 1080], aspect: 'landscape',
    root: '#af-root', times: [0, 1.5, 3, 5, 7, 9, 10],
    selectors: ['#af-root', '#af-canvas'],
  },
  {
    id: 'animated-bar-chart', group: 'components', artboard: [1920, 1080], aspect: 'landscape', sourceFile: 'demo.html',
    root: '#demo', times: [0, 0.25, 0.6, 1, 1.7, 5],
    selectors: ['.hf-catalog-animated-bar-chart', '.hf-catalog-animated-bar-chart header strong', '.bars', '.bar:nth-child(4)', '.chart-footer path'],
  },
  {
    id: 'cursor-annotate', group: 'components', artboard: [1920, 1080], aspect: 'landscape', mount: 'template',
    root: '#root', times: [0, 0.5, 1, 1.6, 2.2, 2.95],
    selectors: ['#root', '#ca-ink', '#ca-pen', '#ca-pen-body'],
  },
  {
    id: 'app-showcase', group: 'blocks', artboard: [1920, 1080], aspect: 'landscape',
    root: '[data-composition-id="app-showcase"]', times: [0, 0.8, 2, 3.4, 4.6, 5.5],
    selectors: ['#s3Bg', '#s3Stage', '#s3PhoneLeft', '#s3GraphLine', '#s3PhoneRight'],
  },
  {
    id: 'apple-money-count', group: 'blocks', artboard: [1920, 1080], aspect: 'landscape',
    root: '#root', times: [0, 0.5, 1.5, 3, 3.6, 4.4, 5],
    selectors: ['#amount', '#greenFlash', '#moneyBurst', '.money-icon'],
  },
]

const only = process.argv.slice(2)
const selected = ports.filter(port => !only.length || only.includes(port.id))
const gsapSource = await readFile(new URL('../node_modules/gsap/dist/gsap.min.js', import.meta.url), 'utf8')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const rows = []
const pixelRows = []

function measure({ root, artboard, selectors }) {
  const round = (value, digits = 1) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value
  const origin = document.querySelector(root)?.getBoundingClientRect()
  if (!origin) return { missingRoot: true }
  return selectors.map(selector => {
    const element = document.querySelector(selector)
    if (!element) return { selector, missing: true }
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      selector,
      x: round(rect.x - origin.x),
      y: round(rect.y - origin.y),
      width: round(rect.width),
      height: round(rect.height),
      opacity: round(Number(style.opacity), 3),
      visibility: style.visibility,
      display: style.display,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }
  })
}

function rootClip({ artboard }) {
  return { x: 0, y: 0, width: artboard[0], height: artboard[1] }
}

try {
  for (const port of selected) {
    const sourcePath = `${reference}${port.group}/${port.id}/${port.sourceFile ?? `${port.id}.html`}`
    let html = await readFile(new URL(sourcePath, import.meta.url), 'utf8')
    let gsapInjected = false
    html = html.replace(/<script src="[^"]*gsap[^"]*"><\/script>/, () => {
      gsapInjected = true
      return `<script>${gsapSource}</script>`
    })
    // Component pages expect the host to provide GSAP; the reference HTML only
    // loads it when it is a standalone block page.
    if (!gsapInjected) html = html.replace(/<head[^>]*>/i, match => `${match}<script>${gsapSource}</script>`)
    if (port.logo) {
      const logo = await readFile(new URL(`${reference}blocks/ai-chat-reveal/assets/hyperframes-logo-white.svg`, import.meta.url))
      html = html.replace('src="assets/hyperframes-logo-white.svg"', `src="data:image/svg+xml;base64,${logo.toString('base64')}"`)
    }
    if (port.mount === 'template') {
      // A host clones the <template> into the clip before the script runs; the
      // standalone reference file never renders it on its own. The upstream
      // documentation comment contains the literal "<template>", so comments
      // are dropped before locating the element.
      html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<template[^>]*>([\s\S]*?)<\/template>/i, (_, inner) => inner)
    }

    const viewport = { width: port.artboard[0], height: port.artboard[1] }
    const original = await browser.newPage({ viewport })
    const ported = await browser.newPage({ viewport })
    const errors = []
    ported.on('pageerror', error => errors.push(error.message))
    ported.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })

    await original.setContent(html, { waitUntil: 'domcontentloaded' })
    await original.waitForFunction(() => !!window.__timelines)
    await original.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map(image => image.complete
        ? undefined
        : new Promise(resolve => { image.onload = resolve; image.onerror = resolve })))
    })
    // The port renders frame 0 when it mounts and is then scrubbed to each
    // sampled time. GSAP's output can depend on that seek history (immediate
    // renders and onUpdate side effects), so the reference walks the same path.
    await original.evaluate(() => { Object.values(window.__timelines)[0].seek(0, false) })

    await ported.goto(`${devServer}/native-port.html?id=${port.group}-${port.id}&aspect=${port.aspect}&time=0`, { waitUntil: 'domcontentloaded' })
    await ported.waitForFunction(() => document.documentElement.dataset.ready === 'true' || document.documentElement.dataset.error, null, { timeout: 90000 })
    const mountFailure = await ported.evaluate(() => document.documentElement.dataset.error)
    if (mountFailure) throw new Error(`${port.id}: ${mountFailure}`)

    for (const time of port.times) {
      console.log(`… ${port.id} ${time}s`)
      await ported.evaluate(async value => { await window.__nativePortSeek(value) }, time)

      await original.evaluate(({ time }) => { Object.values(window.__timelines)[0].seek(time, false) }, { time })
      await original.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

      const source = await original.evaluate(measure, port)
      const mounted = await ported.evaluate(measure, port)
      rows.push({ id: port.id, time, source, ported: mounted, errors: [...errors] })

      if (time === port.times[Math.floor(port.times.length / 2)] || time === port.times.at(-1)) {
        const clip = { x: 0, y: 0, width: port.artboard[0], height: port.artboard[1] }
        const originalPNG = await original.screenshot({ clip })
        const portedPNG = await ported.screenshot({ clip })
        pixelRows.push({ id: port.id, time, originalPNG, portedPNG })
        await writeFile(new URL(`${port.id}-${time}-original.png`, output), originalPNG)
        await writeFile(new URL(`${port.id}-${time}-port.png`, output), portedPNG)
      }
    }

    await original.close()
    await ported.close()
  }
} finally {
  await browser.close()
}

await writeFile(new URL('comparison.json', output), JSON.stringify(rows, null, 2))

let failed = false
for (const row of rows) {
  if (row.source.missingRoot || row.ported.missingRoot) {
    console.log(`${row.id} ${row.time}s: MISSING ROOT`, JSON.stringify({ source: row.source, ported: row.ported }))
    failed = true
    continue
  }
  const differences = row.source.flatMap((expected, index) => {
    const actual = row.ported[index]
    if (expected.missing || actual.missing) return [{ selector: expected.selector, key: 'missing', source: expected.missing ?? 'present', port: actual.missing ?? 'present' }]
    return Object.keys(expected).filter(key => typeof expected[key] === 'number'
      ? Math.abs(expected[key] - actual[key]) > (key === 'opacity' ? 0.01 : 0.7)
      : expected[key] !== actual[key]).map(key => ({ selector: expected.selector, key, source: expected[key], port: actual[key] }))
  })
  if (differences.length || row.errors.length) {
    failed = true
    console.log(`\n${row.id} ${row.time}s: ${differences.length} difference(s)${row.errors.length ? `, ${row.errors.length} console error(s)` : ''}`)
    for (const difference of differences.slice(0, 12)) console.log('   ', JSON.stringify(difference))
    for (const error of row.errors.slice(0, 4)) console.log('    error:', error.slice(0, 200))
  }
}

for (const row of pixelRows) {
  const identical = row.originalPNG.equals(row.portedPNG)
  console.log(`${row.id} ${row.time}s: ${identical ? 'identical PNG' : `PNG differs (${row.originalPNG.length} vs ${row.portedPNG.length} bytes)`}`)
}

// The gallery is the real consumer of these ports, so every port is mounted and
// scrubbed through its own UI to prove the dev page keeps working.
const galleryFailures = await smokeGallery(selected)
failed ||= galleryFailures > 0

console.log(failed ? '\nFAILED: differences found' : '\nOK: every sampled frame matches')
if (failed) process.exitCode = 1

async function smokeGallery(entries) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const problems = []
  page.on('pageerror', error => problems.push(error.message))
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`) })
  let failures = 0

  try {
    await page.goto(`${devServer}/native-gallery.html`, { waitUntil: 'domcontentloaded' })
    for (const port of entries) {
      const ledgerId = `${port.group}-${port.id}`
      problems.length = 0
      try {
        await page.getByLabel('Find a port').fill(ledgerId)
        await page.locator('.ng-port-row').first().click()
        await page.waitForFunction(() => {
          const slider = document.querySelector('.ng-scrubber input[type="range"]')
          return slider instanceof HTMLInputElement && !slider.disabled
        }, null, { timeout: 60000 })
        for (const time of [0, port.times[Math.floor(port.times.length / 2)], port.times.at(-1)]) {
          const slider = page.locator('.ng-scrubber input[type="range"]')
          const max = Number(await slider.getAttribute('max'))
          await slider.evaluate((input, value) => {
            input.value = String(value)
            input.dispatchEvent(new Event('input', { bubbles: true }))
          }, Math.min(time, max))
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        }
        const state = await page.evaluate(expected => {
          const error = document.querySelector('.ng-stage-error')?.textContent?.trim()
          const host = document.querySelector('.ng-scene-host')
          const rendered = host?.querySelector('[data-composition-id], .hf-port')
          const rect = rendered?.getBoundingClientRect()
          const label = document.querySelector('.ng-preview-label')?.textContent?.trim()
          return {
            error,
            rendered: Boolean(rendered),
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
            label,
            expected,
          }
        }, ledgerId)
        const visible = state.rendered && state.width > 0 && state.height > 0
        if (state.error || !visible || problems.length) {
          failures += 1
          console.log(`\n${ledgerId}: gallery smoke FAILED`, JSON.stringify({ ...state, problems: problems.slice(0, 3) }))
        } else {
          console.log(`${ledgerId}: gallery smoke OK (${Math.round(state.width)}×${Math.round(state.height)} mounted)`)
        }
      } catch (error) {
        failures += 1
        console.log(`\n${ledgerId}: gallery smoke FAILED`, error instanceof Error ? error.message.split('\n')[0] : error)
      }
    }
  } finally {
    await browser.close()
  }
  return failures
}
