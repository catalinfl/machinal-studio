import { expect, test } from './helpers/fixtures'

test('opens the media library wide and reflows catalogs as the deck is resized', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.route('**/list', (route) => route.fulfill({ status: 200, body: '' }))
  await page.goto('/editor')

  const deck = page.locator('.tool-deck')
  const resizer = page.getByRole('slider', { name: 'Resize tool deck' })
  const columns = async (selector: string) => page.locator(selector).first().evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length,
  )

  await expect(page.locator('#media-bin-panel')).toBeVisible()
  await expect(resizer).toHaveAttribute('aria-valuenow', '560')
  expect((await deck.boundingBox())!.width).toBe(560)
  expect((await page.locator('.preview').boundingBox())!.width).toBeGreaterThanOrEqual(340)
  expect(await columns('#media-bin-list')).toBe(1)
  await page.getByRole('button', { name: 'Media bin options' }).click()
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  expect(await columns('#media-bin-list')).toBe(3)

  const tools = page.getByRole('navigation', { name: 'Editor tools' })
  await tools.getByRole('button', { name: 'Styles' }).click()
  expect(await columns('.look-grid')).toBe(3)
  await tools.getByRole('button', { name: 'Transitions' }).click()
  expect(await columns('.card-grid')).toBe(3)

  for (let step = 0; step < 13; step++) await resizer.press('ArrowLeft')
  await expect(resizer).toHaveAttribute('aria-valuenow', '272')
  expect(await columns('.card-grid')).toBe(1)

  await tools.getByRole('button', { name: 'Media Bin' }).click()
  expect(await columns('#media-bin-list')).toBe(1)
  for (let step = 0; step < 7; step++) await resizer.press('ArrowRight')
  expect(await columns('#media-bin-list')).toBe(2)
})

test('fills the available preview area without growing past its fixed maximum', async ({ page }) => {
  await page.route('**/list', (route) => route.fulfill({ status: 200, body: '' }))
  await page.setViewportSize({ width: 1674, height: 900 })
  await page.goto('/editor')

  const preview = page.locator('.preview')
  const monitor = preview.locator('.monitor')
  const resizer = page.getByRole('slider', { name: 'Resize tool deck' })
  const previewBox = (await preview.boundingBox())!
  const monitorBox = (await monitor.boundingBox())!
  expect(monitorBox.width).toBeGreaterThan(900)
  expect(monitorBox.x).toBeGreaterThanOrEqual(previewBox.x)
  expect(monitorBox.x + monitorBox.width).toBeLessThanOrEqual(previewBox.x + previewBox.width)

  await page.setViewportSize({ width: 1900, height: 1100 })
  await expect.poll(async () => (await monitor.boundingBox())!.width).toBe(1000)
  const cappedHeight = (await monitor.boundingBox())!.height
  expect(cappedHeight).toBe(540)

  for (let step = 0; step < 13; step++) await resizer.press('ArrowLeft')
  expect((await monitor.boundingBox())!.width).toBe(1000)
  expect((await monitor.boundingBox())!.height).toBe(cappedHeight)
})
