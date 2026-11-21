import { expect, test } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

const transparentPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==',
  'base64',
)

async function mockImageAPI(page: import('@playwright/test').Page) {
  await page.route('**/list', (route) => route.fulfill({ status: 200, body: '' }))
  await page.route('**/ai/images', async (route) => {
    const request = route.request().postDataJSON()
    expect(request).toMatchObject({
      model: 'openai/gpt-image-2.5-sunburst',
      background: 'transparent',
      aspect: '16:9',
    })
    expect(request.prompt).toContain('calendar')
    expect(request.prompt).toContain('genuinely transparent alpha channel')
    expect(request.prompt).toContain('Do not draw a checkerboard')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'generated', name: 'generated.png', mediaType: 'image/png', width: 1920, height: 1080, sourceMode: 'proxy',
      }),
    })
  })
  await page.route('**/download?file=generated.png', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: transparentPNG,
  }))
}

test('generates a transparent overlay and registers it in the Media Bin', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockImageAPI(page)
  await mockPaidAuth(page)
  await page.goto('/editor')

  await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Image', exact: true }).click()
  const panel = page.locator('#image-panel')
  await expect(panel).toBeVisible()
  await page.getByLabel('Describe the image').fill('A calendar cutout')
  await panel.locator('summary').filter({ hasText: 'Image settings' }).click()
  await expect(page.getByLabel('Transparent background')).toBeChecked()
  await expect(page.getByRole('button', { name: 'B-roll' })).toHaveCount(0)
  await panel.locator('summary').filter({ hasText: 'Image settings' }).click()
  await page.screenshot({ path: '../.impeccable/review/compact-tools-1440-image.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Generate overlay' }).click()

  await expect(panel.getByRole('status')).toContainText('Overlay added')
  await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Close Image', exact: true }).click()
  await expect(page.locator('#media-bin-panel').getByText('generated.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
  await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo last edit', exact: true }).click()
  await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
})

test('opens the Image panel as a bounded mobile workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockImageAPI(page)
  await mockPaidAuth(page)
  await page.goto('/editor')

  await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'Image', exact: true }).click()
  const panel = page.locator('#image-panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.width).toBeLessThanOrEqual(390)
  await panel.getByLabel('Image mode', { exact: true }).click()
  await panel.getByRole('option', { name: 'Edit image', exact: true }).click()
  await expect(panel.getByLabel('Describe the changes')).toBeVisible()
  await page.screenshot({ path: '../.impeccable/review/compact-tools-390-image.png', fullPage: true, animations: 'disabled' })
})
