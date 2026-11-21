import { expect, test } from '@playwright/test'
import { compileComponent } from '../../services/scene-renderer/render.mjs'
import { colorVideoSource } from '../../services/scene-renderer/multimedia-fixture.mjs'

test('long waveforms stay sharp and scene playback stays local to the playhead with 1,000 recordings', async ({ page }, testInfo) => {
  const config = { width: 1280, height: 720, fps: 30, durationInFrames: 180 }
  const component = `<script>
import { useScene, SceneCanvas, SceneVideo } from '@direction/scene-svelte';
let { videos = {} } = $props();
const scene = useScene();
const particles = Array.from({length:120}, (_, i) => i);
</script>
<SceneCanvas background="#24132f">
  <h1 style="color:white;font-size:60px;transform:translateX({scene.time * 40}px)">Smooth scene</h1>
  <SceneVideo src={videos.video_1} width={320} height={180} loop />
  {#each particles as i}<span style="position:absolute;color:#bd89ec;left:{i * 10}px;top:{400 + Math.sin(scene.time + i) * 80}px">•</span>{/each}
</SceneCanvas>`
  const { javascript } = await compileComponent({ component, config })
  const source = { version: 1, component, javascript, config, videos: { video_1: colorVideoSource() } }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/list*', route => route.fulfill({ json: [] }))
  await page.route('**/download?*', route => route.fulfill({ json: source }))
  await page.route('**/waveform?*', route => route.fulfill({ json: {
    sampleRate: 8000, length: 3480 * 8000, binSamples: 400,
    min: Array.from({ length: 69600 }, (_, i) => -0.2 - (i % 8) / 20),
    max: Array.from({ length: 69600 }, (_, i) => 0.2 + (i % 8) / 20),
  } }))
  await page.addInitScript(() => {
    const commands: Array<{ capture: boolean; frame: number; playing: boolean }> = []
    Object.assign(window, { sceneCommands: commands })
    window.addEventListener('message', event => {
      if (event.data?.type === 'live-scene:command') commands.push(event.data)
    })
  })
  await page.goto('/editor')
  await expect(page.locator('.stage > canvas')).toBeVisible()
  await page.evaluate(async source => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const { rememberLiveScene } = await import('/src/lib/live-scene.ts')
    editor.clearTimeline()
    editor.setPixelsPerSecond(40)
    const file = `ai_scene_${'d'.repeat(32)}_01.scene.json`
    rememberLiveScene(file, source)
    const video = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    const audio = editor.channels.find((channel: { type: string }) => channel.type === 'audio')
    editor.addClip(video.id, { fileName: file, scrubBlobUrl: null, sourceDuration: 6, inPoint: 0, outPoint: 6, start: 0 })
    for (let i = 0; i < 1000; i++) {
      video.clips.push({ id: `recording-${i}`, fileName: `recording-${i}.mp4`, scrubBlobUrl: source.videos.video_1, sourceDuration: 1, inPoint: 0, outPoint: 1, start: 100 + i * 3 })
    }
    editor.addClip(audio.id, { fileName: 'long-audio.wav', sourceMode: 'proxy', scrubBlobUrl: source.videos.video_1, sourceDuration: 3480, inPoint: 0, outPoint: 3480, start: 0 })
  }, source)
  const frame = page.frameLocator('iframe[title="Live generated scene"]')
  await expect(frame.getByRole('heading', { name: 'Smooth scene' })).toBeVisible()
  expect(await page.locator('video').count()).toBe(1)
  expect(await page.locator('.clip').count()).toBeLessThan(15)
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('.tl-track-scroll').evaluate(element => { element.scrollLeft = 100000 })
    await expect.poll(() => page.locator('.waveform').first().evaluate(canvas => Number.parseFloat((canvas as HTMLElement).style.left))).toBeGreaterThan(99000)
    const tiles = await page.locator('canvas.waveform').evaluateAll(canvases => canvases.map(element => {
      const canvas = element as HTMLCanvasElement
      const bounds = canvas.getBoundingClientRect()
      return { width: bounds.width, pixels: canvas.width, ink: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value > 0) }
    }))
    expect(tiles.length).toBeLessThan(6)
    expect(tiles.every(tile => tile.width <= 1024 && tile.pixels >= tile.width && tile.ink)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`waveform-chunks-${width}.png`) })
  }
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.getByRole('button', { name: 'Play preview', exact: true }).click()
  await expect.poll(() => page.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow').then(Number)).toBeGreaterThan(0.5)
  await expect.poll(() => frame.getByLabel('Scene video', { exact: true }).evaluate(video => !(video as HTMLVideoElement).paused)).toBe(true)
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click()
  await expect.poll(() => frame.getByLabel('Scene video', { exact: true }).evaluate(video => (video as HTMLVideoElement).paused)).toBe(true)
  const commands = await frame.locator('body').evaluate(() => (window as unknown as { sceneCommands: Array<{ capture: boolean; frame: number }> }).sceneCommands)
  expect(commands.length).toBeGreaterThan(10)
  expect(commands.every(command => !command.capture)).toBe(true)
  expect(errors).toEqual([])
  const timing = await page.evaluate(async source => {
    const { LiveScenePlayer } = await import('/src/lib/live-scene.ts')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-100000px;top:0'
    document.body.appendChild(host)
    const player = new LiveScenePlayer(source, host)
    try {
      await player.ready()
      const captureStarted = performance.now()
      for (let i = 0; i < 8; i++) (await player.seek(i / 30, true))!.close()
      const captureMs = performance.now() - captureStarted
      const liveStarted = performance.now()
      for (let i = 0; i < 8; i++) await player.present((8 + i) / 30, true)
      return { captureMs, directMs: performance.now() - liveStarted }
    } finally { player.dispose(); host.remove() }
  }, source)
  console.info('Scene preview: 8 captured frames vs 8 direct frames', timing)
  expect(timing.directMs).toBeLessThan(timing.captureMs)

  const effectId = await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const video = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    return editor.addEffectBlock(video.id, 'grayscale', 0, 6).id
  })
  const canvas = page.locator('.stage > canvas')
  await expect(canvas).toHaveCSS('visibility', 'hidden')
  await expect.poll(() => frame.locator('body').evaluate(() =>
    (window as unknown as { sceneCommands: Array<{ capture: boolean }> }).sceneCommands.every(command => !command.capture),
  )).toBe(true)
  await page.locator('.stage').screenshot({ path: testInfo.outputPath('scene-grayscale.png') })
  await expect.poll(async () => {
    const screenshot = await page.locator('.stage').screenshot()
    return page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0); image.close()
      const stage = document.querySelector('.stage')!.getBoundingClientRect()
      const preview = document.querySelector('.stage > canvas')!.getBoundingClientRect()
      const [r, g, b] = context.getImageData(Math.floor(preview.left - stage.left + preview.width * 0.1), Math.floor(preview.top - stage.top + preview.height * 0.28), 1, 1).data
      return r > 20 && Math.max(r, g, b) - Math.min(r, g, b) < 3
    }, Array.from(screenshot))
  }).toBe(true)
  await page.evaluate(async effectId => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    ;(await import(storeURL ?? '/src/stores/editor.svelte.ts')).editor.removeEffectBlock(effectId)
  }, effectId)
  await expect(frame.getByRole('heading', { name: 'Smooth scene' })).toBeVisible()
  await expect(canvas).toHaveCSS('visibility', 'hidden')
  await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const video = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    editor.addClip(video.id, { fileName: `ai_scene_${'d'.repeat(32)}_02.scene.json`, scrubBlobUrl: null, sourceDuration: 6, inPoint: 0, outPoint: 6, start: 6 })
    editor.setCurrentTime(5.5)
  })
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(2)
  const upcoming = page.locator('iframe[title="Live generated scene"]').nth(1).contentFrame()
  await expect(upcoming.getByRole('heading', { name: 'Smooth scene' })).toBeAttached()
  const prewarmCommands = await upcoming.locator('body').evaluate(() =>
    (window as unknown as { sceneCommands: Array<{ capture: boolean }> }).sceneCommands,
  )
  expect(prewarmCommands.every(command => !command.capture)).toBe(true)
  await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    ;(await import(storeURL ?? '/src/stores/editor.svelte.ts')).editor.setCurrentTime(6.2)
  })
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(1)
  await expect(frame.getByRole('heading', { name: 'Smooth scene' })).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 8, 0)')
  const initialized = await frame.locator('body').evaluate(() =>
    (window as unknown as { sceneCommands: Array<{ method: string }> }).sceneCommands.filter(command => command.method === 'init').length,
  )
  expect(initialized).toBe(1)
  expect(errors).toEqual([])
})
