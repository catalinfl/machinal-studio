import { expect, test } from '@playwright/test'
import { colorVideoSource } from '../../services/scene-renderer/multimedia-fixture.mjs'

test('local export keeps a split image visible beyond the underlying video', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const result = await page.evaluate(async videoSource => {
    const { compileProjectLocal } = await import('/src/lib/local-render.ts')
    const { DEFAULT_CLIP_TRANSFORM } = await import('/src/lib/clip-transform.ts')
    const bytes = Uint8Array.from(atob(videoSource.split(',')[1]), char => char.charCodeAt(0))
    const source = new Blob([bytes], { type: 'video/mp4' })
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 64
    const context = canvas.getContext('2d')!
    context.fillStyle = '#00ff00'
    context.fillRect(0, 0, 96, 64)
    const image = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)))
    const transform = { ...DEFAULT_CLIP_TRANSFORM, zoomX: 0.5, zoomY: 0.5 }
    const output = await compileProjectLocal({
      resolution: { w: 96, h: 64 }, fps: 30,
      videoChannels: [
        { clips: [
          { file: 'base.mp4', inPoint: 0, outPoint: 1, start: 0, segments: [] },
          { file: 'base.mp4', inPoint: 0, outPoint: 1, start: 1.8, segments: [] },
        ] },
        { clips: [
          { file: 'overlay.png', mediaKind: 'image', inPoint: 0, outPoint: 1, start: 0, transform, segments: [] },
          { file: 'overlay.png', mediaKind: 'image', inPoint: 1, outPoint: 3.8, start: 1.2, transform, segments: [] },
        ] },
      ],
      audioChannels: [],
    }, { resolveSource: async file => file === 'base.mp4' ? source : image })
    const video = document.createElement('video')
    video.muted = true
    const url = URL.createObjectURL(output.blob)
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('Could not decode exported video'))
        video.src = url
      })
      const samples: number[][] = []
      for (const time of [0.5, 1.5, 2.2, 3.5, 3.9]) {
        await new Promise<void>(resolve => {
          video.onseeked = () => resolve()
          video.currentTime = time
        })
        context.drawImage(video, 0, 0)
        samples.push(Array.from(context.getImageData(48, 32, 1, 1).data).slice(0, 3))
      }
      return { duration: video.duration, samples }
    } finally {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, colorVideoSource())

  expect(result.duration).toBeCloseTo(4, 1)
  for (const [red, green, blue] of result.samples) {
    expect(green).toBeGreaterThan(220)
    expect(red).toBeLessThan(30)
    expect(blue).toBeLessThan(30)
  }
})
