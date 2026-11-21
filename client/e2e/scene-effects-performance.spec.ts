import { expect, test, type Page } from '@playwright/test'
import { compileComponent } from '../../services/scene-renderer/render.mjs'

const config = { width: 1280, height: 720, fps: 30, durationInFrames: 240 }

async function installScene(page: Page, transition: boolean, native: boolean) {
  const components = ['#0000ff', '#ff0000'].map(background => `<script>
import { useScene, SceneCanvas } from '@direction/scene-svelte';
const scene = useScene();
const particles = Array.from({length:120}, (_, i) => i);
</script>
<SceneCanvas background="${background}">
<h1 style="color:white;font-size:60px;transform:translateX({scene.time * 40}px)">Scene effects</h1>
{#each particles as i}<span style="position:absolute;color:#bd89ec;left:{i * 10}px;top:{400 + Math.sin(scene.time + i) * 80}px">•</span>{/each}
</SceneCanvas>`)
  const sources = await Promise.all(components.map(async component => ({
    version: 1, component, config, ...(await compileComponent({ component, config })),
  })))
  await page.route('**/list*', route => route.fulfill({ json: [] }))
  await page.route('**/download?*', route => {
    const file = new URL(route.request().url()).searchParams.get('file') ?? ''
    return route.fulfill({ json: sources[file.includes('_02.') ? 1 : 0] })
  })
  await page.addInitScript(() => {
    Object.assign(window, { capturedFrames: [] })
    window.addEventListener('message', event => {
      if (event.data?.type === 'live-scene:response' && event.data.bitmap) {
        ;(window as unknown as { capturedFrames: number[] }).capturedFrames.push(performance.now())
      }
    })
  })
  await page.goto('/editor')
  await expect(page.locator('.stage > canvas')).toBeVisible()
  await page.evaluate(async ({ sources, transition, native }) => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const { rememberLiveScene } = await import('/src/lib/live-scene.ts')
    editor.clearTimeline()
    const channel = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    for (const [index, source] of sources.entries()) {
      if (index && !transition) break
      const file = `ai_scene_${'f'.repeat(32)}_0${index + 1}.scene.json`
      rememberLiveScene(file, source)
      editor.addClip(channel.id, { fileName: file, scrubBlobUrl: null, sourceDuration: 8, inPoint: 0, outPoint: 8, start: index ? 4 : 0 })
    }
    if (!transition) editor.addEffectBlock(channel.id, native ? 'grayscale' : 'film-grain', 0, 8)
    else if (!native) editor.addTransition(channel.id, channel.clips[0].id, channel.clips[1].id, 'wipe-left', 4)
    editor.setCurrentTime(transition ? 4.2 : 0)
  }, { sources, transition, native })
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(transition ? 2 : 1)
  for (const iframe of await page.locator('iframe[title="Live generated scene"]').all()) {
    await expect(iframe.contentFrame().getByRole('heading', { name: 'Scene effects' })).toBeAttached()
  }
  if (!native) await expect.poll(() => page.evaluate(() => (window as unknown as { capturedFrames: number[] }).capturedFrames.length)).toBeGreaterThan(0)
  return sources[0]
}

async function previewPixel(page: Page, x: number, y: number) {
  const bytes = await page.locator('.stage').screenshot()
  return page.evaluate(async ({ bytes, x, y }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    const stage = document.querySelector('.stage')!.getBoundingClientRect()
    const preview = document.querySelector('.stage > canvas')!.getBoundingClientRect()
    return Array.from(context.getImageData(Math.round(preview.left - stage.left + preview.width * x), Math.round(preview.top - stage.top + preview.height * y), 1, 1).data).slice(0, 3)
  }, { bytes: Array.from(bytes), x, y })
}

for (const { transition, native } of [
  { transition: false, native: true },
  { transition: true, native: true },
  { transition: false, native: false },
  { transition: true, native: false },
]) {
  test(`${transition ? 'overlapping scenes' : 'scene with an effect'} use ${native ? 'direct composition' : 'fast snapshots'} during playback`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await installScene(page, transition, native)
    await page.getByRole('button', { name: 'Play preview', exact: true }).click()
    const timing = await page.evaluate(() => new Promise<{ frames: number; averageMs: number; captures: number }>(resolve => {
      const intervals: number[] = []
      const captures = (window as unknown as { capturedFrames: number[] }).capturedFrames
      const before = captures.length
      let start = 0, previous = 0
      function sample(now: number) {
        if (!start) start = now
        if (previous) intervals.push(now - previous)
        previous = now
        if (now - start < 1500) requestAnimationFrame(sample)
        else resolve({ frames: intervals.length, averageMs: (now - start) / intervals.length, captures: captures.length - before })
      }
      requestAnimationFrame(sample)
    }))
    await page.getByRole('button', { name: 'Pause preview', exact: true }).click()
    console.info('Scene effect capture performance', { transition, native, ...timing })
    await testInfo.attach('scene-effect-performance', { body: JSON.stringify(timing), contentType: 'application/json' })
    if (native) {
      expect(timing.captures).toBe(0)
      expect(timing.frames).toBeGreaterThan(40)
    } else expect(timing.captures).toBeGreaterThan(10)
    if (transition) {
      await page.evaluate(async () => {
        const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
          .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
        ;(await import(storeURL ?? '/src/stores/editor.svelte.ts')).editor.setCurrentTime(6)
      })
    }
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(async () => {
        const pixel = await previewPixel(page, 0.85, 0.25)
        const expected = transition ? native ? [128, 0, 128] : [255, 0, 0] : native ? [29, 29, 29] : [0, 0, 255]
        return pixel.every((value, index) => Math.abs(value - expected[index]) < (native ? 3 : 20))
      }).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`scene-effects-${width}.png`) })
    }
    expect(errors).toEqual([])
  })
}
