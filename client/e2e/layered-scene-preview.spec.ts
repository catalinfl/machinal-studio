import { expect, test, type Page } from '@playwright/test'
import { compileComponent } from '../../services/scene-renderer/render.mjs'
import { colorVideoSource } from '../../services/scene-renderer/multimedia-fixture.mjs'

const config = { width: 640, height: 360, fps: 30, durationInFrames: 240 }

async function installScenes(page: Page, layered: boolean) {
  const components = [
    `<script>import { useScene, SceneCanvas } from '@direction/scene-svelte'; const scene = useScene();</script>
<SceneCanvas background="#0000ff"><h1 style="color:white;transform:translateX({scene.time * 10}px)">Background scene</h1></SceneCanvas>`,
    `<script>import { useScene, SceneCanvas } from '@direction/scene-svelte'; const scene = useScene();</script>
<SceneCanvas><div style="position:absolute;inset:0 auto 0 0;width:50%;background:#ff0000"></div><h2 style="color:white;transform:translateX({scene.time * 10}px)">Overlay scene</h2></SceneCanvas>`,
  ]
  const sources = await Promise.all(components.map(async component => ({
    version: 1, component, config, ...(await compileComponent({ component, config })),
  })))
  await page.route('**/list*', route => route.fulfill({ json: [] }))
  await page.route('**/download?*', route => route.fulfill({ json: sources[new URL(route.request().url()).searchParams.get('file')?.includes('_02.') ? 1 : 0] }))
  await page.addInitScript(() => {
    const commands: Array<{ capture: boolean; method: string; frame: number; playing: boolean }> = []
    Object.assign(window, { sceneCommands: commands })
    window.addEventListener('message', event => {
      if (event.data?.type === 'live-scene:command') commands.push(event.data)
    })
  })
  await page.goto('/editor')
  await expect(page.locator('.stage > canvas')).toBeVisible()
  await page.evaluate(async ({ sources, layered }) => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const { rememberLiveScene } = await import('/src/lib/live-scene.ts')
    editor.clearTimeline()
    const background = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    const addScene = (channel: { id: string }, index: number) => {
      const file = `ai_scene_${'e'.repeat(32)}_0${index + 1}.scene.json`
      rememberLiveScene(file, sources[index])
      editor.addClip(channel.id, { fileName: file, scrubBlobUrl: null, sourceDuration: 8, inPoint: 0, outPoint: 8, start: 0 })
    }
    addScene(background, 0)
    const image = document.createElement('canvas')
    image.width = 640; image.height = 360
    const context = image.getContext('2d')!
    context.fillStyle = 'rgba(0,255,0,0.5)'
    context.fillRect(0, 180, 640, 180)
    const imageChannel = editor.addChannel('video')
    const clip = editor.addClip(imageChannel.id, { fileName: 'overlay.png', mediaKind: 'image', scrubBlobUrl: image.toDataURL(), sourceDuration: 8, inPoint: 0, outPoint: 8, start: 0 })
    editor.selectClip(clip.id)
    if (layered) {
      addScene(editor.addChannel('video'), 1)
      editor.addTextItem(0, { text: 'Caption above all layers', x: 480, y: 270, duration: 8 })
    }
  }, { sources, layered })
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(layered ? 2 : 1)
  for (const iframe of await page.locator('iframe[title="Live generated scene"]').all()) {
    await expect(iframe.contentFrame().getByRole('heading').first()).toBeAttached()
  }
  return sources
}

async function commands(page: Page) {
  return Promise.all(page.frames().slice(1).map(frame => frame.evaluate(() =>
    (window as unknown as { sceneCommands: Array<{ capture: boolean; method: string; playing: boolean }> }).sceneCommands,
  )))
}

async function previewPixels(page: Page, points: Array<[number, number]>) {
  const bytes = await page.locator('.stage').screenshot()
  return page.evaluate(async ({ bytes, points }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    const stage = document.querySelector('.stage')!.getBoundingClientRect()
    const preview = document.querySelector('.stage > canvas')!.getBoundingClientRect()
    return points.map(([x, y]) => Array.from(context.getImageData(
      Math.round(preview.left - stage.left + preview.width * x),
      Math.round(preview.top - stage.top + preview.height * y), 1, 1,
    ).data).slice(0, 3))
  }, { bytes: Array.from(bytes), points })
}

for (const layered of [false, true]) {
  test(`${layered ? 'two scenes with an interleaved image and captions' : 'scene plus image'} play without rasterizing scene frames`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await installScenes(page, layered)
    await page.getByRole('button', { name: 'Play preview', exact: true }).click()
    const timing = await page.evaluate(() => new Promise<{ frames: number; averageMs: number; longestMs: number }>(resolve => {
      const intervals: number[] = []
      let start = 0, previous = 0
      function sample(now: number) {
        if (!start) start = now
        if (previous) intervals.push(now - previous)
        previous = now
        if (now - start < 1500) requestAnimationFrame(sample)
        else resolve({ frames: intervals.length, averageMs: (now - start) / intervals.length, longestMs: Math.max(...intervals) })
      }
      requestAnimationFrame(sample)
    }))
    await page.getByRole('button', { name: 'Pause preview', exact: true }).click()
    const sceneCommands = await commands(page)
    const captures = sceneCommands.flat().filter(command => command.capture).length
    console.info('Layered scene playback', { layered, ...timing, captures })
    await testInfo.attach('playback-performance', { body: JSON.stringify({ ...timing, captures }), contentType: 'application/json' })
    expect(captures).toBe(0)
    expect(sceneCommands.every(commands => commands.some(command => command.playing))).toBe(true)
    await expect(page.locator('.image-selection')).toBeVisible()

    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(async () => {
        const [left, right, top] = await previewPixels(page, [[0.15, 0.75], [0.85, 0.75], [0.85, 0.25]])
        return top[2] > 240 && top[0] < 10 && top[1] < 10
          && right[0] < 10 && right[1] > 110 && right[1] < 140 && right[2] > 110 && right[2] < 140
          && (!layered || (left[0] > 240 && left[1] < 10 && left[2] < 10))
      }).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`layered-preview-${width}.png`) })
    }
    expect((await commands(page)).flat().every(command => !command.capture)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('layered scenes retain transforms, image resizing and Pixi-effect fallback without remounting', async ({ page }) => {
  await installScenes(page, true)
  await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const overlay = editor.channels.filter((channel: { type: string }) => channel.type === 'video').at(-1)
    editor.setClipTransform(overlay.clips[0].id, { positionX: 25, zoomX: 0.5, zoomY: 0.5 })
    editor.setCurrentTime(1)
  })
  await expect.poll(async () => {
    const [red, blue] = await previewPixels(page, [[0.6, 0.4], [0.15, 0.4]])
    return red[0] > 240 && red[1] < 10 && blue[2] > 240 && blue[0] < 10
  }).toBe(true)
  const image = page.locator('[data-direct-preview-layer="image"]')
  const transform = await image.evaluate(element => (element as HTMLElement).style.transform)
  await page.getByRole('slider', { name: 'Resize image from se corner' }).press('ArrowUp')
  await expect.poll(() => image.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(transform)
  expect((await commands(page)).flat().every(command => !command.capture)).toBe(true)

  const effectId = await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const channel = editor.channels.find((channel: { clips: Array<{ mediaKind: string }> }) => channel.clips.some(clip => clip.mediaKind === 'image'))
    return editor.addEffectBlock(channel.id, 'film-grain', 0, 8).id
  })
  await expect.poll(async () => (await commands(page)).every(commands => commands.some(command => command.capture))).toBe(true)
  await expect(page.locator('.stage > canvas')).toBeVisible()
  await expect(page.locator('[data-direct-preview-layer="image"]')).toHaveCount(0)
  await page.evaluate(async effectId => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    editor.removeEffectBlock(effectId)
  }, effectId)
  await expect(image).toBeVisible()
  await expect.poll(async () => (await commands(page)).every(commands => !commands.at(-1)?.capture)).toBe(true)
  expect((await commands(page)).every(commands => commands.filter(command => command.method === 'init').length === 1)).toBe(true)
})

for (const layered of [false, true]) {
test(`${layered ? 'upper' : 'first-channel'} scenes can be selected and resized without capturing frames`, async ({ page }, testInfo) => {
  await installScenes(page, layered)
  const canvas = page.locator('.stage > canvas')
  const bounds = await canvas.boundingBox()
  await page.mouse.click(bounds!.x + bounds!.width * 0.1, bounds!.y + bounds!.height * 0.1)
  const handle = page.getByRole('slider', { name: 'Resize scene from se corner' })
  await expect(handle).toBeVisible()
  const initial = Number(await handle.getAttribute('aria-valuenow'))
  await handle.press('ArrowDown')
  await expect(handle).toHaveAttribute('aria-valuenow', String(initial / 1.05))
  await handle.press('ArrowUp')
  await expect(handle).toHaveAttribute('aria-valuenow', String(initial))
  await handle.press('ArrowDown')
  const corner = await handle.boundingBox()
  const selection = await page.locator('.image-selection').boundingBox()
  const centerX = selection!.x + selection!.width / 2
  const centerY = selection!.y + selection!.height / 2
  const startX = corner!.x + corner!.width / 2
  const startY = corner!.y + corner!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(centerX + (startX - centerX) * 0.6, centerY + (startY - centerY) * 0.6)
  await page.mouse.up()
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThan(initial * 0.7)
  await page.screenshot({ path: testInfo.outputPath('resized-upper-scene.png') })
  expect((await commands(page)).flat().every(command => !command.capture)).toBe(true)
})
}

test('ordinary video remains seekable above direct scenes and images', async ({ page }) => {
  await installScenes(page, false)
  await page.evaluate(async source => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const clip = editor.addClip(editor.addChannel('video').id, { fileName: 'overlay.mp4', scrubBlobUrl: source, sourceDuration: 1, inPoint: 0, outPoint: 1, start: 0 })
    editor.setClipTransform(clip.id, { zoomX: 0.5, zoomY: 0.5, positionX: 25 })
    editor.setCurrentTime(0.2)
  }, colorVideoSource())
  const video = page.locator('video[data-direct-preview-layer="video"]')
  await expect(video).toBeVisible()
  await expect.poll(async () => {
    const [red, blue] = await previewPixels(page, [[0.8, 0.4], [0.15, 0.4]])
    return red[0] > 240 && red[1] < 10 && blue[2] > 240 && blue[0] < 10
  }).toBe(true)
  const previewBounds = await page.locator('.stage > canvas').boundingBox()
  await page.mouse.click(previewBounds!.x + previewBounds!.width * 0.8, previewBounds!.y + previewBounds!.height * 0.4)
  const handle = page.getByRole('slider', { name: 'Resize video from se corner' })
  await expect(handle).toBeVisible()
  await handle.press('ArrowDown')
  await expect(handle).toHaveAttribute('aria-valuenow', String(0.5 / 1.05))
  await handle.press('ArrowUp')
  await expect(handle).toHaveAttribute('aria-valuenow', '0.5')
  await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    ;(await import(storeURL ?? '/src/stores/editor.svelte.ts')).editor.setCurrentTime(0.7)
  })
  await expect.poll(async () => {
    const [blue] = await previewPixels(page, [[0.8, 0.4]])
    return blue[2] > 240 && blue[0] < 10
  }).toBe(true)
  await page.getByRole('button', { name: 'Play preview', exact: true }).click()
  await expect.poll(() => video.evaluate(element => !(element as HTMLVideoElement).paused)).toBe(true)
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true)
  expect((await commands(page)).flat().every(command => !command.capture)).toBe(true)
})

test('an image color effect stays local to its layer without capturing the scene', async ({ page }) => {
  await installScenes(page, false)
  await page.evaluate(async () => {
    const storeURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(storeURL ?? '/src/stores/editor.svelte.ts')
    const channel = editor.channels.find((channel: { clips: Array<{ mediaKind: string }> }) => channel.clips.some(clip => clip.mediaKind === 'image'))
    editor.addEffectBlock(channel.id, 'grayscale', 0, 8)
  })
  await expect.poll(async () => {
    const [bottom, top] = await previewPixels(page, [[0.85, 0.75], [0.85, 0.25]])
    return Math.abs(bottom[0] - 75) < 3 && Math.abs(bottom[1] - 75) < 3 && Math.abs(bottom[2] - 203) < 3
      && top[0] < 3 && top[1] < 3 && top[2] > 252
  }).toBe(true)
  expect((await commands(page)).flat().every(command => !command.capture)).toBe(true)
})
