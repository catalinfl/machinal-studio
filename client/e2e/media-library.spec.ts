import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mockPaidAuth } from './helpers/paid-auth'
import { dragToTrack } from './helpers/timeline'

const sceneVideo = readFileSync(resolve('../services/scene-renderer/out/scene-integration-fixture.mp4'))
const emerald = readFileSync(resolve('public/generated/chatgpt-emerald-test.png'))
const emeraldSize = { width: emerald.readUInt32BE(16), height: emerald.readUInt32BE(20) }

async function populateLibrary(page: Page) {
  await page.evaluate(async emeraldSize => {
    const moduleURL = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/lib/media-bin.ts') ?? '/src/lib/media-bin.ts'
    const { registerMediaBinSource } = await import(/* @vite-ignore */ moduleURL)
    const video = document.createElement('video')
    video.src = '/__library-fixture.mp4'
    video.muted = true
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Library video fixture could not load'))
    })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const thumbnail = canvas.toDataURL('image/png')
    for (const source of [
      { id: 'seed-video', name: 'Seed animation.mp4', kind: 'video', duration: 1, sourceMode: 'proxy', previewUrl: '/__library-fixture.mp4', thumbnailUrl: thumbnail, width: 320, height: 180 },
      { id: 'seed-image', name: 'Seed poster.png', kind: 'image', duration: 10, sourceMode: 'wasm', scrubBlobUrl: thumbnail, width: 320, height: 180 },
      { id: 'emerald-local', sourceId: 'emerald-local', name: 'Emerald overlay.png', kind: 'image', duration: 10, sourceMode: 'wasm', scrubBlobUrl: '/generated/chatgpt-emerald-test.png', ...emeraldSize },
      { id: 'narration', name: 'Narration.wav', kind: 'audio', duration: 18, sourceMode: 'proxy', scrubBlobUrl: '/__library-audio.wav' },
      { id: 'emerald-ai', name: 'AI emerald.png', kind: 'image', duration: 10, sourceMode: 'proxy', scrubBlobUrl: '/generated/chatgpt-emerald-test.png', thumbnailUrl: '/generated/chatgpt-emerald-test.png', generated: true, ...emeraldSize },
      { id: 'render', name: 'render_1234.mp4', kind: 'video', duration: 1, sourceMode: 'proxy', previewUrl: '/__library-fixture.mp4', thumbnailUrl: thumbnail, isRender: true, width: 320, height: 180 },
    ]) registerMediaBinSource(source)
  }, emeraldSize)
}

const libraryVariants = [1440, 390].flatMap(width => ['dark', 'light'].map(theme => ({ width, theme })))

for (const { width, theme } of libraryVariants) {
  test.describe(`compact media bin at ${width}px in ${theme}`, () => {
    test.use({ hasTouch: width <= 1024 })
    test(`media library browsing, import, selection and timeline insertion at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockPaidAuth(page)
      await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
      await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
      await page.route('**/__library-fixture.mp4', route => route.fulfill({ contentType: 'video/mp4', body: sceneVideo }))
      await page.route('**/sessions**', route => route.fulfill({ json: {} }))
      await page.goto('/editor')
      if (width <= 1024) await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'Media Bin', exact: true }).click()

      const bin = page.locator('#media-bin-panel')
      const cards = bin.getByRole('listitem')
      const expectUnclippedFilter = async () => {
        const label = bin.getByRole('button', { name: 'Filter media', exact: true }).locator('span')
        expect(await label.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await label.evaluate(element => element.clientWidth))
      }
      const capture = async (state: string) => {
        await page.screenshot({ path: resolve(`../.impeccable/review/media-bin-compact-${width}-${theme}-${state}.png`), fullPage: true, animations: 'disabled' })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(900)
        if (await bin.isVisible()) expect(await bin.locator('.list').evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await bin.locator('.list').evaluate(element => element.clientWidth))
      }
      await expect(bin.getByRole('heading', { name: 'Add your first files' })).toBeVisible()
      await bin.getByRole('button', { name: 'Upload media', exact: true }).hover()
      await expect(bin.getByRole('button', { name: 'Upload media', exact: true })).toHaveCSS('background-color', 'rgb(213, 194, 255)')
      await expect(bin.getByRole('button', { name: 'Upload media', exact: true })).toHaveCSS('color', 'rgb(38, 42, 48)')
      await bin.getByRole('button', { name: 'Choose files', exact: true }).hover()
      await expect(bin.getByRole('button', { name: 'Choose files', exact: true })).toHaveCSS('background-color', 'rgb(213, 194, 255)')
      await page.mouse.move(10, 20)
      await capture('empty')
      await populateLibrary(page)
      await expect(cards).toHaveCount(5)
      await expect(bin.locator('.thumb img').first()).toHaveJSProperty('complete', true)
      await expect(bin.getByRole('searchbox', { name: 'Search media' })).toHaveCount(0)
      await expect(bin.getByRole('button', { name: 'Grid view', exact: true })).toBeHidden()
      const binBox = (await bin.boundingBox())!
      const listBox = (await bin.locator('.list').boundingBox())!
      expect(listBox.y - binBox.y).toBeLessThanOrEqual(width <= 1024 ? 120 : 104)
      await expectUnclippedFilter()
      await capture('populated')
      await bin.getByRole('button', { name: 'Media bin options' }).click()
      await bin.getByRole('heading', { name: 'Media bin', exact: true }).click()
      await expect(bin.getByRole('button', { name: 'Media bin options' })).toHaveAttribute('aria-expanded', 'false')
      await bin.getByRole('button', { name: 'Media bin options' }).click()
      await capture('options')
      const optionsBox = (await bin.getByRole('group', { name: 'Media bin options', exact: true }).boundingBox())!
      expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(binBox.x + binBox.width)
      await bin.getByRole('button', { name: 'Grid view', exact: true }).click()
      await expect(cards).toHaveCount(5)
      await capture('grid')
      await bin.getByRole('button', { name: 'Media bin options' }).click()
      await bin.getByRole('button', { name: 'List view', exact: true }).click()

      const search = bin.getByRole('searchbox', { name: 'Search media' })
      const searchTrigger = bin.getByRole('button', { name: 'Open media search' })
      await searchTrigger.click()
      await expect(search).toBeFocused()
      await search.fill('emerald')
      await expect(cards).toHaveCount(2)
      await search.press('Escape')
      await expect(cards).toHaveCount(5)
      await search.fill('missing footage')
      await expect(bin.getByRole('heading', { name: 'No matching media.' })).toBeVisible()
      await capture('filtered')
      await bin.getByRole('button', { name: 'Clear filters', exact: true }).click()
      await search.press('Escape')
      await expect(search).toHaveCount(0)
      await expect(searchTrigger).toBeFocused()

      await bin.getByRole('button', { name: 'Preview Emerald overlay.png', exact: true }).click()
      const preview = page.getByRole('dialog', { name: 'Preview Emerald overlay.png', exact: true })
      await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', emeraldSize.width)
      await expect(preview.getByRole('button', { name: 'Next media', exact: true })).toBeDisabled()
      await preview.getByRole('button', { name: 'Previous media', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Preview Seed poster.png', exact: true }).locator('img')).toHaveJSProperty('naturalWidth', 320)
      await page.getByRole('button', { name: 'Close media preview', exact: true }).click()
      await expect(bin.getByRole('button', { name: 'Preview Emerald overlay.png', exact: true })).toBeFocused()

      const filterTrigger = bin.getByRole('button', { name: 'Filter media', exact: true })
      await filterTrigger.click()
      const filters = bin.getByRole('group', { name: 'Filter media', exact: true })
      await expect(filters.getByRole('button')).toHaveCount(6)
      await capture('categories')
      await bin.getByRole('button', { name: /^All files/ }).press('ArrowDown')
      await expect(bin.getByRole('button', { name: /^Video/ })).toBeFocused()
      await bin.getByRole('button', { name: /^Video/ }).press('End')
      await expect(bin.getByRole('button', { name: /^Renders/ })).toBeFocused()
      await bin.getByRole('button', { name: /^Renders/ }).click()
      await expect(cards).toHaveCount(1)
      await expect(cards.first()).toContainText('render_1234.mp4')
      await expect(filterTrigger).toHaveText(/Renders/)
      await expect(filterTrigger).toBeFocused()
      await filterTrigger.click()
      await bin.getByRole('button', { name: /^AI generated/ }).click()
      await expect(cards).toHaveCount(1)
      await expectUnclippedFilter()
      await filterTrigger.click()
      await bin.getByRole('button', { name: /^All files/ }).click()
      await bin.getByRole('button', { name: 'Media bin options' }).click()
      await bin.getByRole('button', { name: 'Select media to delete' }).click()
      await filterTrigger.click()
      await bin.getByRole('button', { name: /^All files/ }).press('Escape')
      await expect(bin.getByRole('button', { name: 'Cancel media selection' })).toBeVisible()
      await expect(filterTrigger).toBeFocused()
      await bin.getByRole('button', { name: 'Select all', exact: true }).click()
      await expect(bin.getByRole('button', { name: /^Deselect/ })).toHaveCount(5)
      await capture('selection')
      await bin.getByRole('button', { name: 'Delete (5)', exact: true }).click()
      const deletion = page.getByRole('alertdialog')
      await expect(deletion).toBeVisible()
      await expect(deletion.getByRole('button', { name: 'Keep files', exact: true })).toBeFocused()
      await deletion.getByRole('button', { name: 'Keep files', exact: true }).click()
      await bin.getByRole('button', { name: 'Cancel media selection' }).click()

      await bin.getByRole('button', { name: 'Append Emerald overlay.png to timeline', exact: true }).click()
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
      await bin.getByRole('button', { name: 'Media bin options' }).click()
      await bin.getByRole('button', { name: 'Select media to delete' }).click()
      await bin.getByRole('button', { name: 'Select Emerald overlay.png for deletion', exact: true }).click()
      await bin.getByRole('button', { name: 'Delete (1)', exact: true }).click()
      await expect(bin.getByRole('alert')).toContainText('is used on the timeline')
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await bin.getByRole('button', { name: 'Cancel media selection' }).click()
      await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Redo last edit', exact: true }).click()
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
      await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)

      await bin.getByRole('button', { name: 'Media bin options' }).click()
      await bin.getByRole('button', { name: 'Use local scrub' }).click()
      await bin.locator('input[type=file]').setInputFiles({ name: 'Imported emerald.png', mimeType: 'image/png', buffer: emerald })
      await expect(bin.getByRole('listitem', { name: 'Clip Imported emerald.png', exact: true })).toBeVisible()
      await dragToTrack(page, bin.getByRole('listitem', { name: 'Clip Imported emerald.png', exact: true }), page.getByRole('application', { name: 'Drop zone: Video 1' }), { timeSec: 0 })
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
      await expect(page.locator('.preview-onboarding')).toHaveCount(0)
      if (width <= 1024) await page.getByRole('button', { name: 'Close tool panel', exact: true }).click()
      await capture('composition')
    })
  })
}
