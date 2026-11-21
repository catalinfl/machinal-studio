import { expect, test, type Page } from '@playwright/test'
import { dropEffect, track } from './helpers/timeline'

async function effectState(page: Page, effectId: string) {
  return page.evaluate(async (id) => {
    const moduleURL = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(moduleURL ?? '/src/stores/editor.svelte.ts')
    const block = editor.effectBlocks.find((candidate: { effectId: string }) => candidate.effectId === id)
    return { start: block.start, duration: block.duration, ownerClipId: block.ownerClipId ?? null }
  }, effectId)
}

test('effects cover their dropped clip and remain draggable and resizable across clips and lanes', async ({ page }, testInfo) => {
  await page.route('**/list*', (route) => route.fulfill({ json: [] }))
  await page.goto('/editor')
  const clips = await page.evaluate(async () => {
    const moduleURL = performance.getEntriesByType('resource').map((entry) => entry.name)
      .findLast((name) => new URL(name).pathname === '/src/stores/editor.svelte.ts')
    const { editor } = await import(moduleURL ?? '/src/stores/editor.svelte.ts')
    editor.clearTimeline()
    editor.setPixelsPerSecond(40)
    const channel = editor.channels.find((candidate: { type: string }) => candidate.type === 'video')
    return [0, 5].map((start) => editor.addClip(channel.id, {
      fileName: `video-${start}.mp4`, scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start,
    }).id)
  })
  const video = track(page, 'Video 1')
  await page.getByRole('button', { name: 'Effects', exact: true }).click()
  await dropEffect(page, 'grayscale', video, 3)
  await dropEffect(page, 'sepia', video, 7)
  expect(await effectState(page, 'grayscale')).toEqual({ start: 0, duration: 5, ownerClipId: clips[0] })
  expect(await effectState(page, 'sepia')).toEqual({ start: 5, duration: 5, ownerClipId: clips[1] })

  const sepia = video.locator('[data-timeline-effect-id]', { has: page.locator('.fx-name', { hasText: 'Sepia' }) })
  const box = await sepia.boundingBox()
  if (!box) throw new Error('Missing effect geometry')
  const x = box.x + 40
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 120, y, { steps: 12 })
  await expect(sepia).toHaveClass(/move/)
  expect(await effectState(page, 'sepia')).toEqual({ start: 2, duration: 5, ownerClipId: null })
  await page.mouse.up()
  await expect(sepia).toHaveCSS('left', '80px')
  await expect(sepia).toHaveCSS('width', '200px')

  await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
  expect(await effectState(page, 'sepia')).toEqual({ start: 5, duration: 5, ownerClipId: clips[1] })

  const handleBox = await sepia.getByLabel('Resize effect start').boundingBox()
  if (!handleBox) throw new Error('Missing effect resize geometry')
  const handleX = handleBox.x + handleBox.width / 2
  const handleY = handleBox.y + handleBox.height / 2
  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX - 120, handleY, { steps: 12 })
  await page.mouse.up()
  expect(await effectState(page, 'sepia')).toEqual({ start: 2, duration: 8, ownerClipId: null })
  await expect(sepia).toHaveCSS('width', '320px')

  const rightBox = await sepia.getByLabel('Resize effect range').boundingBox()
  if (!rightBox) throw new Error('Missing effect range geometry')
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rightBox.x + rightBox.width / 2 + 40, rightBox.y + rightBox.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(await effectState(page, 'sepia')).toEqual({ start: 2, duration: 9, ownerClipId: null })

  const movedBox = await sepia.boundingBox()
  if (!movedBox) throw new Error('Missing moved effect geometry')
  await page.mouse.move(movedBox.x + 40, movedBox.y + movedBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(movedBox.x + 80, movedBox.y + movedBox.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(await effectState(page, 'sepia')).toEqual({ start: 3, duration: 9, ownerClipId: null })

  await page.screenshot({ path: testInfo.outputPath('effects-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('effects-mobile.png') })
})
