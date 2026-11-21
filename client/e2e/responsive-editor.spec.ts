import { expect, test } from './helpers/fixtures'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function expectEditorInsideViewport(page: import('@playwright/test').Page) {
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
  }))

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight)
  await expect(page.locator('.preview')).toBeVisible()
  await expect(page.locator('.tl')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Render' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split at playhead' })).toBeVisible()

  const toolbar = await page.locator('.tl-toolbar').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth)
}

test('keeps the editor usable in portrait and landscape mobile layouts', async ({ page }) => {
  await page.route('**/list', (route) => route.fulfill({ status: 200, body: '' }))
  await page.goto('/editor')

  await expect(page.locator('#media-bin-panel')).toHaveCount(0)
  await expect(page.locator('#transitions-panel')).toHaveCount(0)
  await expectEditorInsideViewport(page)

  const timeline = page.locator('.bottom')
  const initialTimelineHeight = (await timeline.boundingBox())!.height
  const resizer = page.getByRole('slider', { name: 'Resize timeline' })
  await resizer.press('ArrowUp')
  expect((await timeline.boundingBox())!.height).toBeGreaterThan(initialTimelineHeight)

  await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'Media Bin' }).click()
  const mediaPanel = page.locator('#media-bin-panel')
  await expect(mediaPanel).toBeVisible()
  const mediaBox = await mediaPanel.boundingBox()
  expect(mediaBox).not.toBeNull()
  expect(mediaBox!.x).toBeGreaterThanOrEqual(0)
  expect(Math.round(mediaBox!.width)).toBeLessThanOrEqual(390)

  const filterTrigger = mediaPanel.getByRole('button', { name: 'Filter media', exact: true })
  await filterTrigger.click()
  const filters = page.getByRole('group', { name: 'Filter media', exact: true })
  await filters.getByRole('button', { name: /^Renders/ }).click()
  await expect(filterTrigger).toHaveText(/Renders/)
  await expectEditorInsideViewport(page)

  await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'Effects' }).click()
  await expect(mediaPanel).toHaveCount(0)
  await expect(page.locator('#effects-panel')).toBeVisible()

  const trackToggle = page.getByRole('button', { name: 'Hide tracks' })
  await expect(trackToggle).toBeVisible()
  await trackToggle.click()
  await expect(page.getByRole('button', { name: 'Show tracks' })).toBeVisible()
  await expect(page.locator('#timeline-track-headers')).toBeHidden()
  await page.getByRole('button', { name: 'Show tracks' }).click()
  await expect(page.locator('#timeline-track-headers')).toBeVisible()

  await page.setViewportSize({ width: 844, height: 390 })
  await expectEditorInsideViewport(page)
  const editorSections = await page.locator('.top, .bottom').evaluateAll((sections) =>
    sections.map((section) => section.getBoundingClientRect().height),
  )
  expect(editorSections.every((height) => height >= 100)).toBe(true)
  await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'Media Bin' }).click()
  await mediaPanel.getByRole('button', { name: 'Filter media', exact: true }).click()
  const menu = mediaPanel.getByRole('group', { name: 'Filter media', exact: true })
  const menuBox = (await menu.boundingBox())!
  expect(menuBox.y).toBeGreaterThanOrEqual(0)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '../.impeccable/review/media-bin-compact-844-categories.png', fullPage: true, animations: 'disabled' })
  await menu.getByRole('button', { name: /^All files/ }).press('Escape')
  await page.getByRole('button', { name: 'Close tool panel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play preview', exact: true })).toBeInViewport()
  expect((await page.locator('.preview .stage').boundingBox())!.height).toBeGreaterThan(32)
  await page.screenshot({ path: '../.impeccable/review/media-bin-compact-844-landscape.png', fullPage: true, animations: 'disabled' })
})
