/**
 * Compares the whole native HyperFrames library against its upstream pages.
 *
 * 1. The upstream page is rendered from the reference HTML with the same GSAP
 *    build the port imports. Primitives that document their timeline in a
 *    commented recipe get that same recipe injected, exactly as a host would.
 * 2. The port is rendered by native-port.html, which mounts the Svelte scene
 *    1:1 at the artboard size (no gallery chrome, no fit scaling).
 * 3. Both are seeked through the same frame history and their whole composition
 *    subtree is compared: element geometry, opacity, visibility, display and own
 *    text, plus sampled screenshots.
 */

import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { nativeBrowserOptions } from './native-browser.mjs'

const devServer = process.env.NATIVE_GALLERY_URL ?? 'http://127.0.0.1:5175'
const output = new URL('../../.impeccable/review/native-library/', import.meta.url)
const reference = '../../packages/mcp-installer/library/hyperframes-library/registry/'
const manifestURL = new URL('manifest.json', output)
const fps = 30

const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const keepPixels = !process.argv.includes('--no-pixels')
const savePixels = process.argv.includes('--save-pixels')
const manifest = JSON.parse(await readFile(manifestURL, 'utf8'))
const selected = manifest.ports.filter(port => !only.length || only.includes(port.id))
if (!selected.length) throw new Error('No ports selected')

const gsapSource = await readFile(new URL('../node_modules/gsap/dist/gsap.min.js', import.meta.url), 'utf8')
await mkdir(output, { recursive: true })

function snapshot({ selectors, child }) {
  let host
  for (const selector of selectors) {
    host = document.querySelector(selector)
    if (host) break
  }
  const root = child ? host?.firstElementChild : host
  if (!root) return { missingRoot: selectors.join(', ') }
  const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : value
  const origin = root.getBoundingClientRect()
  const scopeClass = /^s-[A-Za-z0-9_-]+$/
  // Non-rendered elements never take part in the composition, and the source
  // may keep its <style>/<script> inside the root that the port hoists away.
  // Document shells are skipped too: some pages declare their composition on
  // <html>, whose subtree then also contains <head> and <body>.
  const structural = new Set(['script', 'style', 'link', 'meta', 'template', 'title', 'html', 'head', 'body'])
  const elements = []
  for (const element of root.querySelectorAll('*')) {
    if (structural.has(element.tagName.toLowerCase())) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const ownText = [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    const classes = (typeof element.className === 'string' ? element.className : element.className?.baseVal ?? '')
      .split(/\s+/)
      .filter(name => name && !scopeClass.test(name))
      .join(' ')
    elements.push({
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      class: classes,
      x: round(rect.x - origin.x),
      y: round(rect.y - origin.y),
      width: round(rect.width),
      height: round(rect.height),
      opacity: round(Number(style.opacity)),
      visibility: style.visibility,
      display: style.display,
      text: ownText.slice(0, 160),
    })
  }
  return { root: { x: round(origin.x), y: round(origin.y), width: round(origin.width), height: round(origin.height) }, elements }
}

function buildOriginal(html, port) {
  let source = html
  // The HyperFrames host owns the timeline registry; a raw page opened alone
  // therefore has no `window.__timelines` to publish into.
  const host = '<script>window.__timelines = window.__timelines || {};</script>'
  let injected = false
  source = source.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*gsap[^"']*["'][^>]*><\/script>/i, () => {
    injected = true
    return `${host}<script>${gsapSource}</script>`
  })
  if (!injected) source = source.replace(/<head[^>]*>/i, match => `${match}${host}<script>${gsapSource}</script>`)
  if (!/<head[^>]*>/i.test(source)) source = `${host}<script>${gsapSource}</script>${source}`
  // A reference page is a document; a composition is mounted into a host. The
  // user-agent body margin would otherwise shrink every fragment by 16px on
  // the source side only, so it is normalised away on both sides.
  const reset = '<style>html,body{margin:0;padding:0}</style>'
  source = /<head[^>]*>/i.test(source)
    ? source.replace(/<head[^>]*>/i, match => `${match}${reset}`)
    : `${reset}${source}`
  if (port.mount === 'template') {
    // A host clones the <template> into the clip before the script runs.
    source = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<template[^>]*>([\s\S]*?)<\/template>/i, (_, inner) => inner)
  }
  if (port.timeline === 'documented-recipe') {
    const bootstrap = `<script>window.__timelines = window.__timelines || {}; window.__timelines.preview = (function () { var tl = gsap.timeline({ paused: true }); var startTime = 0; ${port.recipe} return tl; })();</script>`
    source = /<\/body>/i.test(source) ? source.replace(/<\/body>/i, `${bootstrap}</body>`) : `${source}${bootstrap}`
  }
  return source
}

const browser = await chromium.launch(nativeBrowserOptions)
const results = []
let failures = 0

for (const port of selected) {
  const label = `${port.id}`
  const started = Date.now()
  const sourceURL = new URL(`${reference}${port.category}/${port.upstreamName}/${port.sourceFile}`, import.meta.url)
  const html = await readFile(sourceURL, 'utf8')
  const sourceHTML = await inlineKnownVerificationAssets(html, port)
  const viewport = { width: Math.max(320, port.artboard[0]), height: Math.max(240, port.artboard[1]) }
  const aspect = port.artboard[0] >= port.artboard[1] ? 'landscape' : 'portrait'
  const original = await browser.newPage({ viewport })
  const ported = await browser.newPage({ viewport })
  const errors = []
  ported.on('pageerror', error => errors.push(error.message))
  ported.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  original.on('pageerror', error => errors.push(`source: ${error.message}`))

  try {
    await original.setContent(buildOriginal(sourceHTML, port), { waitUntil: 'domcontentloaded' })
    await original.waitForFunction(() => !!window.__timelines, null, { timeout: 30000 })
    await original.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map(image => image.complete
        ? undefined
        : new Promise(resolve => { image.onload = resolve; image.onerror = resolve })))
    })

    await ported.goto(`${devServer}/native-port.html?id=${port.id}&aspect=${aspect}&width=${port.artboard[0]}&height=${port.artboard[1]}&time=0&includePending=true`, { waitUntil: 'domcontentloaded' })
    await ported.waitForFunction(() => document.documentElement.dataset.ready === 'true' || document.documentElement.dataset.error, null, { timeout: 90000 })
    const mountFailure = await ported.evaluate(() => document.documentElement.dataset.error)
    if (mountFailure) throw new Error(`mount: ${mountFailure}`)

    const duration = await original.evaluate(() => Math.max(...Object.values(window.__timelines).map(timeline => timeline.duration())))
    // The verifier drives both compositions by seeking. Freeze upstream pages
    // that normally autoplay so the source and port share the same clock.
    await original.evaluate(() => Object.values(window.__timelines).forEach(timeline => timeline.pause(0)))
    const lastFrame = Math.max(1, Math.floor(duration * fps))
    const frames = [...new Set([0, Math.round(lastFrame * 0.2), Math.round(lastFrame * 0.4), Math.round(lastFrame * 0.6), Math.round(lastFrame * 0.8), lastFrame])]
    // Three upstream shapes exist: a full page whose composition root carries
    // `data-composition-id` (sometimes on <html>), a `<template>` mount, and a
    // bare paste-in fragment. The port nests the same markup inside `.hf-port`,
    // but whether the source wrapper survives is not knowable from the file, so
    // the matching level is resolved by aligning the first element signatures.
    const sourceScope = await alignScope(original, ported)
    const portScope = { selectors: ['.hf-port'], child: sourceScope.portChild }
    const differences = []
    const pixels = []
    let alignmentEvidence

    // Both sides walk the same seek history: mount frame, then each sample.
    await original.evaluate(() => { Object.values(window.__timelines)[0].seek(0, false) })

    for (const [index, frame] of frames.entries()) {
      const time = frame / fps
      await ported.evaluate(async value => { await window.__nativePortSeek(value) }, time)
      await original.evaluate(value => { Object.values(window.__timelines)[0].seek(value, false) }, time)
      await original.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

      const sourceSnapshot = await original.evaluate(snapshot, sourceScope)
      const portSnapshot = await ported.evaluate(snapshot, portScope)
      if (index === 0) {
        alignmentEvidence = {
          sourceScope,
          portScope,
          sourceRoot: sourceSnapshot.root,
          portRoot: portSnapshot.root,
        }
      }
      differences.push(...compareSnapshots(sourceSnapshot, portSnapshot, time))

      if (keepPixels && (index === 2 || index === frames.length - 1)) {
        const clip = { x: 0, y: 0, width: port.artboard[0], height: port.artboard[1] }
        const originalPNG = await original.screenshot({ clip })
        const portedPNG = await ported.screenshot({ clip })
        const identical = await ported.evaluate(async ([originalBase64, portedBase64]) => {
          async function decodePixels(base64) {
            const image = new Image()
            image.src = `data:image/png;base64,${base64}`
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (!context) throw new Error('Could not create a canvas context for PNG comparison')
            context.drawImage(image, 0, 0)
            return context.getImageData(0, 0, canvas.width, canvas.height).data
          }

          const [originalPixels, portedPixels] = await Promise.all([
            decodePixels(originalBase64),
            decodePixels(portedBase64),
          ])
          if (originalPixels.length !== portedPixels.length) return false
          for (let index = 0; index < originalPixels.length; index += 1) {
            if (originalPixels[index] !== portedPixels[index]) return false
          }
          return true
        }, [originalPNG.toString('base64'), portedPNG.toString('base64')])
        pixels.push({ time, identical, originalBytes: originalPNG.length, portedBytes: portedPNG.length })
        if (savePixels || !identical) {
          await writeFile(new URL(`${port.id}-${time}-original.png`, output), originalPNG)
          await writeFile(new URL(`${port.id}-${time}-port.png`, output), portedPNG)
        }
      }
    }

    const ok = !differences.length && !errors.length && pixels.every(pixel => pixel.identical)
    if (!ok) failures += 1
    results.push({ id: port.id, ok, duration, frames, alignment: alignmentEvidence, differences: differences.slice(0, 40), pixels, errors: errors.slice(0, 6) })
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} (${differences.length} diff, ${pixels.filter(pixel => !pixel.identical).length} px, ${errors.length} err, ${((Date.now() - started) / 1000).toFixed(1)}s)`)
    if (!ok) {
      for (const difference of differences.slice(0, 5)) console.log('     ', JSON.stringify(difference))
      for (const error of errors.slice(0, 3)) console.log('      error:', error.slice(0, 200))
    }
  } catch (error) {
    failures += 1
    results.push({ id: port.id, ok: false, failure: error instanceof Error ? error.message.split('\n')[0] : String(error), errors })
    console.log(`FAIL ${label}: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
  } finally {
    await original.close()
    await ported.close()
  }
}

async function inlineKnownVerificationAssets(html, port) {
  if (port.id !== 'blocks-extruded-logo') return html
  const assetURL = new URL(
    `${reference}${port.category}/${port.upstreamName}/assets/fonts/Geist-Bold.typeface.json`,
    import.meta.url,
  )
  const asset = await readFile(assetURL)
  const dataURL = `data:application/json;base64,${asset.toString('base64')}`
  return html.replace(/assets\/fonts\/Geist-Bold\.typeface\.json/g, dataURL)
}

await browser.close()

function signature(element) {
  return `${element.tag}${element.id ? `#${element.id}` : ''}${element.class ? `.${element.class.split(/\s+/).join('.')}` : ''}`
}

/**
 * Picks the source anchor and port level whose first elements line up.
 *
 * A fragment is its own root, a page may declare its composition on <html>, a
 * `<template>` mount may or may not keep the `#root` wrapper the host provides,
 * so the pair with the longest matching element prefix is used.
 */
async function alignScope(original, ported) {
  // Prefer the explicit mount root over document-level metadata. Some pages
  // put data-composition-id on <html> as well as #root; the document shell can
  // contribute one extra matching element and otherwise win by prefix length.
  const selector = await original.locator('#root').count()
    ? '#root'
    : await original.locator('[data-composition-id]').count()
      ? '[data-composition-id]'
      : 'body'
  const candidates = [{ selectors: [selector], child: false }, { selectors: [selector], child: true }]
  const portScopes = [false, true].map(child => ({ selectors: ['.hf-port'], child }))
  const portSnapshots = []
  for (const scope of portScopes) portSnapshots.push(await ported.evaluate(snapshot, scope))

  let best = null
  for (const scope of candidates) {
    const source = await original.evaluate(snapshot, scope)
    if (source.missingRoot || !source.elements.length) continue
    for (const [index, portSnapshot] of portSnapshots.entries()) {
      if (portSnapshot.missingRoot || !portSnapshot.elements.length) continue
      let score = 0
      while (score < source.elements.length && score < portSnapshot.elements.length
        && signature(source.elements[score]) === signature(portSnapshot.elements[score])) score += 1
      if (!best || score > best.score) best = { score, sourceScope: scope, portChild: portScopes[index].child }
    }
  }
  if (!best || best.score < 1) return { selectors: ['body'], child: false, portChild: false }
  return { ...best.sourceScope, portChild: best.portChild }
}

function compareSnapshots(source, ported, time) {
  if (source.missingRoot || ported.missingRoot) {
    return [{ time, key: 'missingRoot', source: source.missingRoot ?? 'present', port: ported.missingRoot ?? 'present' }]
  }
  const differences = []
  // The composition frame itself must cover the same box on both sides; an
  // inset root shows up as a border of differing pixels even when every child
  // keeps its relative position.
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Math.abs(source.root[key] - ported.root[key]) > 0.7) {
      differences.push({ time, key: `root.${key}`, source: source.root[key], port: ported.root[key] })
    }
  }
  if (source.elements.length !== ported.elements.length) {
    const length = Math.min(source.elements.length, ported.elements.length)
    let split = length
    for (let index = 0; index < length; index += 1) {
      if (signature(source.elements[index]) !== signature(ported.elements[index])) { split = index; break }
    }
    differences.push({
      time,
      key: 'elementCount',
      source: source.elements.length,
      port: ported.elements.length,
      split,
      sourceAtSplit: source.elements.slice(Math.max(0, split - 1), split + 3).map(signature),
      portAtSplit: ported.elements.slice(Math.max(0, split - 1), split + 3).map(signature),
    })
  }
  const length = Math.min(source.elements.length, ported.elements.length)
  for (let index = 0; index < length; index += 1) {
    const expected = source.elements[index]
    const actual = ported.elements[index]
    const selector = signature(expected)
    for (const key of Object.keys(expected)) {
      const difference = typeof expected[key] === 'number'
        ? Math.abs(expected[key] - actual[key]) > (key === 'opacity' ? 0.01 : 0.7)
        : expected[key] !== actual[key]
      if (difference) differences.push({ time, selector, key, source: expected[key], port: actual[key] })
      if (differences.length >= 60) return differences
    }
  }
  return differences
}

const report = {
  total: selected.length,
  passed: selected.length - failures,
  failed: failures,
  automatedEquivalence: true,
  visualInspection: false,
  results,
}
await writeFile(new URL('comparison.json', output), JSON.stringify(report, null, 1))
console.log(`\n${selected.length - failures}/${selected.length} ports match their source (${keepPixels ? 'geometry, text and sampled pixels' : 'geometry and text'})`)
if (failures) process.exitCode = 1
