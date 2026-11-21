import { expect, test, type Locator, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { mockPaidAuth } from './helpers/paid-auth'

async function seedLandscapeImage(page: Page) {
  await page.evaluate(async () => {
    const moduleURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    const { editor } = await import(/* @vite-ignore */ moduleURL)
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const context = canvas.getContext('2d')!
    for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
      context.fillStyle = color
      context.fillRect(index * 320 / 3, 0, 320 / 3, 180)
    }
    editor.addClip(editor.channels.find((channel: { type: string }) => channel.type === 'video').id, {
      fileName: 'framing-fixture.png', mediaKind: 'image', scrubBlobUrl: canvas.toDataURL(),
      sourceDuration: 5, inPoint: 0, outPoint: 5, start: 0,
    })
    editor.setProjectAspect('portrait')
    editor.clearHistory()
  })
}

async function samplePreview(page: Page, canvas: Locator, x: number, y: number) {
  const screenshot = await canvas.screenshot()
  return page.evaluate(async ({ data, x, y }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return [...context.getImageData(Math.floor(image.width * x), Math.floor(image.height * y), 1, 1).data].slice(0, 3)
  }, { data: screenshot.toString('base64'), x, y })
}

for (const width of [1440, 390]) {
  for (const theme of ['dark', 'light']) {
    test(`portrait fit and fill framing at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockPaidAuth(page)
      let savedFit: string | undefined
      const project = { id: 'framing-project', name: 'Framing test', sessionId: 'pr_framing', version: 1, createdAt: '', updatedAt: '' }
      await page.route('**/projects**', async route => {
        if (route.request().method() === 'POST') {
          savedFit = route.request().postDataJSON()?.state?.timeline?.videoFit
          project.version++
          await route.fulfill({ json: project })
        } else {
          await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/projects') ? [project] : { ...project, state: null } })
        }
      })
      await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
      await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
      await page.route('**/sessions**', route => route.fulfill({ json: {} }))
      await page.goto('/editor')
      await expect(page.locator('.stage > canvas')).toBeVisible()
      await seedLandscapeImage(page)

      const framing = page.getByRole('combobox', { name: 'Video framing' })
      const canvas = page.locator('.stage > canvas')
      await expect(framing).toHaveValue('contain')
      await expect.poll(() => samplePreview(page, canvas, 0.1, 0.5)).toEqual([255, 0, 0])
      expect(await samplePreview(page, canvas, 0.5, 0.1)).toEqual([0, 0, 0])
      await page.screenshot({ path: resolve(`../.impeccable/review/video-framing-${width}-${theme}-fit.png`), animations: 'disabled' })

      await framing.selectOption('cover')
      await expect.poll(() => samplePreview(page, canvas, 0.5, 0.1)).toEqual([0, 255, 0])
      expect(await samplePreview(page, canvas, 0.1, 0.5)).toEqual([0, 255, 0])
      await page.screenshot({ path: resolve(`../.impeccable/review/video-framing-${width}-${theme}-fill.png`), animations: 'disabled' })
      const bounds = await framing.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

      await page.getByRole('button', { name: 'Undo last edit', exact: true }).filter({ visible: true }).first().click()
      await expect(framing).toHaveValue('contain')
      await page.getByRole('button', { name: 'Redo last edit', exact: true }).filter({ visible: true }).first().click()
      await expect(framing).toHaveValue('cover')
      await expect.poll(() => savedFit).toBe('cover')
    })
  }
}

test('local FFmpeg export encodes a centered portrait crop instead of letterboxing', async ({ page }) => {
  await page.goto('/editor')
  await expect(page.locator('.stage > canvas')).toBeVisible()
  const pixels = await page.evaluate(async () => {
    const { compileProjectLocal } = await import('/src/lib/local-render.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 180
    const context = canvas.getContext('2d')!
    for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
      context.fillStyle = color
      context.fillRect(index * 320 / 3, 0, 320 / 3, 180)
    }
    const source = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    const result = await compileProjectLocal({
      fit: 'cover', resolution: { w: 90, h: 160 }, fps: 10,
      videoChannels: [{ clips: [{ file: 'bands.png', mediaKind: 'image', inPoint: 0, outPoint: 0.3, start: 0, segments: [] }] }],
      audioChannels: [],
    }, { resolveSource: async () => source })
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(result.blob)
    try {
      video.src = url
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('The local export could not be decoded'))
      })
      const presented = new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()))
      await video.play()
      await presented
      video.pause()
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      context.drawImage(video, 0, 0)
      return { width: canvas.width, height: canvas.height, top: [...context.getImageData(45, 16, 1, 1).data], center: [...context.getImageData(45, 80, 1, 1).data] }
    } finally {
      URL.revokeObjectURL(url)
    }
  })
  expect(pixels.width).toBe(90)
  expect(pixels.height).toBe(160)
  expect(pixels.top[0]).toBeLessThan(10)
  expect(pixels.top[1], JSON.stringify(pixels)).toBeGreaterThan(240)
  expect(pixels.top[2]).toBeLessThan(10)
})
