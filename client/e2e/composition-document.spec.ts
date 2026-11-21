import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import path from 'node:path'

const compilerURL = process.env.COMPOSITION_TEST_API
const compilerCLI = process.env.COMPOSITION_TEST_CLI

declare global {
  interface Window {
    compositionTestEditor: () => Promise<typeof import('../src/stores/editor.svelte').editor>
  }
}

test.beforeEach(async ({ page, request }) => {
  test.skip(!compilerURL && !compilerCLI, 'Set COMPOSITION_TEST_API or COMPOSITION_TEST_CLI for Go/editor parity')
  await page.addInitScript(() => {
    window.compositionTestEditor = async () => {
      // Reusing a Vite server can leave timestamped module URLs after HMR.
      const url = performance.getEntriesByType('resource').map((entry) => entry.name)
        .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
      return (await import(url ?? '/src/stores/editor.svelte.ts')).editor
    }
  })
  await page.route('**/list*', (route) => route.fulfill({ json: [] }))
  await page.route(/\/compositions\/compile(?:\?.*)?$/, async (route) => {
    if (compilerCLI) {
      const result = spawnSync(compilerCLI, ['-stdin'], { input: route.request().postData() ?? '', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      await route.fulfill({ status: result.status === 0 ? 200 : 422, contentType: 'application/json', body: result.stdout || JSON.stringify({ diagnostics: [{ path: 'document', message: result.stderr }], requirements: [] }) })
      return
    }
    const result = await request.post(`${compilerURL}/compositions/compile${new URL(route.request().url()).search}`, { data: route.request().postDataJSON() })
    await route.fulfill({ response: result })
  })
})

test('the Go composition applies exactly, reconciles a manual trim, and supports undo', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/editor')
  await page.evaluate(async () => {
    const media = await import('/src/lib/media-bin.ts')
    for (const [index, color] of ['#b34747', '#478b57', '#4776a3'].entries()) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/></svg>`
      media.registerMediaBinSource({ id: `shot${index}`, name: `shot${index}.svg`, kind: 'image', duration: 1, sourceMode: 'wasm', scrubBlobUrl: `data:image/svg+xml,${encodeURIComponent(svg)}` })
    }
  })
  await page.getByRole('button', { name: 'Recipe', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Video recipe' })
  await dialog.getByRole('tab', { name: 'Code DSL' }).click()
  await dialog.getByLabel('Recipe', { exact: true }).fill(`document:
  version: 1
  mode: assemble
  inputs:
    shots: {kind: image, multiple: true}
  sequence:
    use: shots
    each:
      take: {from: 0s, duration: 5s}
      source_audio: remove
      look: raw-story
    between: {preset: cross-dissolve, duration: 1s}
bindings:
  shots: [shot0, shot1, shot2]
assets:
  - {id: shot0, file: shot0.svg, kind: image, version: unresolved:shot0, local: true}
  - {id: shot1, file: shot1.svg, kind: image, version: unresolved:shot1, local: true}
  - {id: shot2, file: shot2.svg, kind: image, version: unresolved:shot2, local: true}
`)
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save YAML', exact: true }).click()
  const stream = await (await downloaded).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const saved = parse(Buffer.concat(chunks).toString('utf8'))
  expect(saved.document.sequence.each.take.duration).toBe(5)
  expect(saved.document.sequence.each.look).toBe('raw-story')
  expect(saved.bindings.shots).toEqual(['shot0', 'shot1', 'shot2'])
  await dialog.getByRole('button', { name: 'Compile and apply' }).click()
  await expect(dialog.getByRole('status')).toContainText('13s')
  const planned = await page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    return { starts: editor.channels[0].clips.map((clip) => clip.start), duration: editor.totalDuration, state: editor.documentSession?.kind }
  })
  expect(planned).toEqual({ starts: [0, 4, 8], duration: 13, state: 'ready' })
  await page.screenshot({ path: testInfo.outputPath('composition-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('composition-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1600, height: 900 })
  await dialog.getByRole('button', { name: 'Close video recipe' }).click()
  await page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    editor.withHistoryTransaction(() => editor.trimClip(editor.channels[0].clips[2].id, 'right', -1))
  })
  await expect.poll(async () => page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    return editor.documentSession?.kind
  })).toBe('ready')
  const revised = await page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    return { duration: editor.totalDuration, compiled: editor.documentSession?.composition.duration, sequence: !!editor.documentSession?.document.sequence }
  })
  expect(revised).toEqual({ duration: 12, compiled: 12, sequence: true })
  await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
  await expect.poll(async () => page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    return editor.totalDuration
  })).toBe(13)
})

test('timeline YAML restores styled text and renders after the browser closes', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  test.skip(!compilerCLI || spawnSync('ffmpeg', ['-version']).status !== 0, 'Requires COMPOSITION_TEST_CLI and FFmpeg on PATH')
  await page.goto('/editor')
  await page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    editor.clearTimeline()
    editor.setResolution('480p')
    editor.addTextItem(0, {
      text: 'Salut: lume!\nDiacritice: ăâîșț', duration: 3, fontFamily: 'montserrat', fontSize: 80, fontWeight: 700,
      color: '#ffffff', strokeWidth: 3, backgroundColor: '#102030', backgroundOpacity: 0.8, rotation: 8,
      x: 960, y: 400,
    })
    editor.addTextItem(1, {
      text: 'Salut lume', duration: 2, fontFamily: 'roboto', fontSize: 64, x: 960, y: 760,
      isCaption: true, highlightMode: 'word', highlightAnimation: 'pop', animation: 'rise',
      words: [{ text: 'Salut', start: 0, end: 0.8 }, { text: 'lume', start: 1, end: 2 }],
    })
  })
  await page.getByRole('button', { name: 'Recipe', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Video recipe' })
  await dialog.getByRole('tab', { name: 'Code DSL' }).click()
  expect(await dialog.getByLabel('Recipe', { exact: true }).inputValue()).toContain('Diacritice: ăâîșț')
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Save YAML', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('composition.edit.yaml')
  const savedPath = testInfo.outputPath('composition.edit.yaml')
  await download.saveAs(savedPath)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const yaml = Buffer.concat(chunks).toString('utf8')
  const saved = parse(yaml)
  expect(saved.document.texts[0]).toMatchObject({ rotation: 8, fontFamily: 'montserrat', backgroundOpacity: 0.8 })
  expect(saved.document.texts[1].words).toEqual([{ text: 'Salut', start: 0, end: 0.8 }, { text: 'lume', start: 1, end: 2 }])
  expect(saved.preparedText.overlays).toHaveLength(6)
  for (const overlay of saved.preparedText.overlays) {
    expect(Buffer.from(overlay.image, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  }

  await page.reload()
  await page.getByRole('button', { name: 'Recipe', exact: true }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'composition.edit.yaml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) })
  await dialog.getByRole('tab', { name: 'Code DSL' }).click()
  await dialog.getByRole('button', { name: 'Compile and apply' }).click()
  await expect(dialog.getByRole('status')).toContainText('2 text items')
  const restored = await page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    return JSON.parse(JSON.stringify(editor.textItems))
  })
  expect(restored).toEqual(saved.document.texts)
  await dialog.getByRole('button', { name: 'Close video recipe' }).click()
  await page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    editor.withHistoryTransaction(() => editor.updateTextItem(editor.textItems[0].id, { text: 'Text modificat' }))
  })
  await expect.poll(() => page.evaluate(async () => {
    const editor = await window.compositionTestEditor()
    return editor.documentSession?.kind
  })).toBe('ready')
  const revised = await page.evaluate(async () => {
    const { currentProject, prepareProjectFile } = await import('/src/lib/compositions.ts')
    return prepareProjectFile(currentProject())
  })
  const changed = parse(revised)
  expect(changed.preparedText.key).not.toBe(saved.preparedText.key)
  expect(changed.preparedText.overlays[0].image).not.toBe(saved.preparedText.overlays[0].image)
  await page.close()

  const result = spawnSync(compilerCLI!, ['-document', savedPath, '-root', testInfo.outputDir, '-render'], { encoding: 'utf8', timeout: 60_000 })
  expect(result.status, result.stderr).toBe(0)
  const output = path.join(testInfo.outputDir, JSON.parse(result.stdout).filename)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', output], { encoding: 'utf8' })
  expect(probe.status, probe.stderr).toBe(0)
  const metadata = JSON.parse(probe.stdout)
  expect(Number(metadata.format.duration)).toBeCloseTo(3, 1)
  expect(metadata.streams[0]).toMatchObject({ width: 854, height: 480 })
  const frame = spawnSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 8 * 1024 * 1024 })
  expect(frame.status, frame.stderr.toString()).toBe(0)
  let whitePixels = 0
  for (let offset = 0; offset < frame.stdout.length; offset += 3) {
    if (frame.stdout[offset] > 220 && frame.stdout[offset + 1] > 220 && frame.stdout[offset + 2] > 220) whitePixels++
  }
  expect(whitePixels).toBeGreaterThan(100)
})
