import { chromium } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const output = new URL('../../.impeccable/review/native-chat-ports/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const gsapSource = await readFile(new URL('../node_modules/gsap/dist/gsap.min.js', import.meta.url), 'utf8')
const report = []
try {
  for (const [id, prefix, height, times, selectors] of [
    ['ai-answer-rank', 'aar', 1080, [0, 1, 3, 5, 7, 8.5], ['#aar-card', '#aar-bubble', '#aar-typed', '#aar-row-a', '#aar-row-brand', '#aar-check']],
    ['ai-chat-reveal', 'acr', 1920, [0, .5, 2, 5, 10, 16.3, 18], ['#acr-composer', '#acr-keyboard', '#acr-bubble', '#acr-dot', '#acr-ctext', '#acr-endcard-inner']],
  ]) {
    let html = await readFile(new URL(`../../packages/mcp-installer/library/hyperframes-library/registry/blocks/${id}/${id}.html`, import.meta.url), 'utf8')
    html = html.replace(/<script src="[^"]+"><\/script>/, () => `<script>${gsapSource}</script>`)
    if (prefix === 'acr') {
      const logo = await readFile(new URL('../../packages/mcp-installer/library/hyperframes-library/registry/blocks/ai-chat-reveal/assets/hyperframes-logo-white.svg', import.meta.url))
      html = html.replace('src="assets/hyperframes-logo-white.svg"', `src="data:image/svg+xml;base64,${logo.toString('base64')}"`)
    }
    const original = await browser.newPage({ viewport: { width: 1080, height } })
    const port = await browser.newPage({ viewport: { width: 1080, height } })
    const errors = []
    port.on('pageerror', error => errors.push(error.message))
    await original.setContent(html, { waitUntil: 'networkidle' })
    await original.waitForFunction(() => !!window.__timelines)
    await port.goto('http://127.0.0.1:5173/native-gallery.html')
    await port.getByLabel('Find a port').fill(id)
    await port.waitForFunction(() => !document.querySelector('.ng-transport-actions button')?.disabled)
    if (prefix === 'acr') {
      await port.getByRole('button', { name: /Portrait/ }).click()
      await port.waitForFunction(() => !document.querySelector('.ng-transport-actions button')?.disabled)
    }
    console.log('Comparing', id)
    await port.addStyleTag({ content: `.ng-scene-host {position:fixed!important;left:0!important;top:0!important;transform:none!important} #${prefix}-root {left:0!important;top:0!important;transform:none!important}` })
    for (const time of times) {
      console.log(id, time)
      await original.evaluate(({ id, time }) => { window.__timelines[id].seek(time) }, { id, time })
      await port.getByRole('slider', { name: 'Scene time' }).evaluate((input, value) => {
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, time)
      await port.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const inspect = selectors => selectors.map(selector => {
        const el = document.querySelector(selector)
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return { selector, text: el.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: Number(style.opacity), font: style.fontFamily, fontSize: style.fontSize }
      })
      const source = await original.evaluate(inspect, selectors)
      const native = await port.evaluate(inspect, selectors)
      report.push({ id, time, source, native, errors })
      if (time === times.at(-1) || time === 5) {
        await original.locator(`#${prefix}-root`).screenshot({ path: new URL(`${id}-${time}-original.png`, output).pathname.replace(/^\/([A-Z]:)/, '$1') })
        await port.locator(`#${prefix}-root`).screenshot({ path: new URL(`${id}-${time}-svelte.png`, output).pathname.replace(/^\/([A-Z]:)/, '$1') })
      }
    }
    await original.close()
    await port.close()
  }
  await writeFile(new URL('comparison.json', output), JSON.stringify(report, null, 2))
  let failed = false
  for (const row of report) {
    const differences = row.source.flatMap((source, i) => {
      const native = row.native[i]
      return Object.keys(source).filter(key => typeof source[key] === 'number'
        ? Math.abs(source[key] - native[key]) > (key === 'opacity' ? .002 : .2)
        : source[key] !== native[key]).map(key => ({ selector: source.selector, key, source: source[key], native: native[key] }))
    })
    console.log(JSON.stringify({ id: row.id, time: row.time, differences, errors: row.errors }))
    if (differences.length || row.errors.length) failed = true
  }
  for (const [id, times] of [['ai-answer-rank', [5, 8.5]], ['ai-chat-reveal', [5, 18]]]) {
    for (const time of times) {
      const original = await readFile(new URL(`${id}-${time}-original.png`, output))
      const native = await readFile(new URL(`${id}-${time}-svelte.png`, output))
      const identical = original.equals(native)
      console.log(`${id} ${time}s: ${identical ? 'identical PNG' : 'PNG mismatch'}`)
      if (!identical) failed = true
    }
  }
  if (failed) process.exitCode = 1
} finally {
  await browser.close()
}
