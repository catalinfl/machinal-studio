import { expect, test, type Page } from '@playwright/test'
import { dropEffect, track } from './helpers/timeline'

async function previewPixel(page: Page): Promise<number[]> {
  const image = await page.getByLabel('Video preview canvas').locator('canvas').screenshot()
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data).slice(0, 3)
  }, Array.from(image))
}

for (const size of ['320x180', '3840x2160']) {
  test(`updates effects and styles on cut ${size} server video while decoding is pending`, async ({ page }) => {
    test.setTimeout(180_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && /shader|webgl|glsl|pixi|preview/i.test(message.text())) errors.push(message.text())
    })
    await page.route('**/list*', (route) => route.fulfill({ json: [] }))
    await page.goto('/editor')
    const bytes = await page.evaluate(async (frameSize) => {
      const { createFFmpeg } = await import('/src/lib/wasm.ts')
      const ffmpeg = await createFFmpeg()
      try {
        const code = await ffmpeg.exec([
          '-f', 'lavfi', '-i', `color=c=0xe03020:size=${frameSize}:rate=2:duration=180`,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '2', '-pix_fmt', 'yuv420p', '-y', 'preview-long.mp4',
        ])
        if (code !== 0) throw new Error(`Fixture encode failed: ${code}`)
        return Array.from(await ffmpeg.readFile('preview-long.mp4') as Uint8Array)
      } finally {
        ffmpeg.terminate()
      }
    }, size)
    const videoBytes = Buffer.from(bytes)
    await page.route('**/download?*', async (route) => {
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1
      await route.fulfill({
        status: range ? 206 : 200,
        contentType: 'video/mp4',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}` } : {}),
        },
        body: videoBytes.subarray(start, end + 1),
      })
    })
    const source = await page.evaluate(async () => {
      const moduleURL = performance.getEntriesByType('resource').map((entry) => entry.name)
        .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
      const { editor } = await import(moduleURL ?? '/src/stores/editor.svelte.ts')
      const { mediaSourceUrl } = await import('/src/lib/api.ts')
      editor.clearTimeline()
      editor.setPixelsPerSecond(40)
      const channel = editor.channels.find((candidate: { type: string }) => candidate.type === 'video')
      const url = mediaSourceUrl('preview-long.mp4')
      editor.addClip(channel.id, {
        fileName: 'preview-long.mp4', scrubBlobUrl: url, mediaKind: 'video', sourceMode: 'proxy',
        sourceDuration: 180, inPoint: 0, outPoint: 180, start: 0,
      })
      editor.setCurrentTime(1)
      return new URL(url, location.href).href
    })
    await expect.poll(async () => (await previewPixel(page))[0]).toBeGreaterThan(150)
    for (const time of [5, 10, 15, 20, 30, 60, 90, 120, 150]) {
      await page.evaluate(async (cutTime) => {
        const moduleURL = performance.getEntriesByType('resource').map((entry) => entry.name)
          .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
        const { editor } = await import(moduleURL ?? '/src/stores/editor.svelte.ts')
        const channel = editor.channels.find((candidate: { type: string }) => candidate.type === 'video')
        const clip = channel.clips.find((item: { start: number; outPoint: number }) => item.start < cutTime && item.outPoint > cutTime)
        editor.splitClip(clip.id, cutTime)
      }, time)
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    }
    const clipIds = await page.evaluate(async () => {
      const moduleURL = performance.getEntriesByType('resource').map((entry) => entry.name)
        .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
      const { editor } = await import(moduleURL ?? '/src/stores/editor.svelte.ts')
      const channel = editor.channels.find((candidate: { type: string }) => candidate.type === 'video')
      editor.setCurrentTime(7)
      return channel.clips.map((clip: { id: string }) => clip.id)
    })
    await expect.poll(async () => (await previewPixel(page))[0]).toBeGreaterThan(150)
    await page.evaluate((url) => {
      const video = [...document.querySelectorAll('video')].find((element) => element.src === url)!
      Object.defineProperty(video, 'seeking', { configurable: true, value: true })
    }, source)
    const original = await previewPixel(page)
    expect(original[0] - original[1]).toBeGreaterThan(100)
    await page.getByRole('button', { name: 'Effects', exact: true }).click()
    await dropEffect(page, 'grayscale', track(page, 'Video 1'), 7)
    await expect.poll(async () => {
      const [r, g, b] = await previewPixel(page)
      return Math.max(r, g, b) - Math.min(r, g, b)
    }).toBeLessThan(5)
    expect((await previewPixel(page))[0]).toBeGreaterThan(30)

    await page.getByRole('button', { name: 'Play preview', exact: true }).click()
    await expect.poll(async () => {
      const value = await page.getByRole('slider', { name: 'Playhead' }).getAttribute('aria-valuenow')
      return Number(value)
    }).toBeGreaterThan(7.2)
    const playingPixel = await previewPixel(page)
    expect(Math.max(...playingPixel) - Math.min(...playingPixel)).toBeLessThan(5)
    expect(playingPixel[0]).toBeGreaterThan(30)
    await page.getByRole('button', { name: 'Pause preview', exact: true }).click()

    await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
    await expect.poll(async () => {
      const [r, g] = await previewPixel(page)
      return r - g
    }).toBeGreaterThan(100)
    await page.locator(`[data-timeline-clip-id="${clipIds[1]}"]`).click()
    await page.getByRole('button', { name: 'Styles', exact: true }).click()
    await page.locator('[data-look-id="sepia-strobe"]').click()
    await expect.poll(async () => {
      const [r, g] = await previewPixel(page)
      return r - g
    }).toBeLessThan(80)
    expect((await previewPixel(page))[0]).toBeGreaterThan(30)
    await page.evaluate((url) => {
      const video = [...document.querySelectorAll('video')].find((element) => element.src === url)!
      Reflect.deleteProperty(video, 'seeking')
    }, source)
    await expect.poll(async () => page.evaluate(async (url) => {
      const moduleURL = performance.getEntriesByType('resource').map((entry) => entry.name)
        .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
      const { editor } = await import(moduleURL ?? '/src/stores/editor.svelte.ts')
      const video = [...document.querySelectorAll('video')].find((element) => element.src === url)!
      const state = {
        seeking: video.seeking,
        videoTime: video.currentTime,
        timelineTime: editor.currentTime,
        synchronized: Math.abs(video.currentTime - editor.currentTime) < 0.02,
      }
      return !state.seeking && state.synchronized ? 'ready' : JSON.stringify(state)
    }, source)).toBe('ready')
    expect((await previewPixel(page))[0]).toBeGreaterThan(30)
    expect(errors).toEqual([])
  })
}
