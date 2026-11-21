import { expect, test } from './helpers/fixtures'
import { mockPaidAuth } from './helpers/paid-auth'

test('home page renders and links to the editor', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'machinal' })).toBeVisible()
  await page.locator('a.card', { hasText: 'machinal' }).click()
  await expect(page).toHaveURL(/\/editor/)
})

test('about page renders from the nav', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation').getByRole('link', { name: 'About' }).click()
  await expect(page).toHaveURL(/\/about/)
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
})

test('text to speech opens inside the editor', async ({ page }) => {
  await page.route('**/list', (route) => route.fulfill({ status: 200, body: '' }))
  await mockPaidAuth(page)
  await page.goto('/editor')
  const transitionsWidth = (await page.getByLabel('Transitions browser').boundingBox())!.width
  await page.getByRole('navigation', { name: 'Editor panels' }).getByRole('button', { name: 'Text to Speech' }).click()
  await expect(page).toHaveURL(/\/editor/)
  const speechPanel = page.getByLabel('Text to Speech browser')
  await expect(speechPanel).toBeVisible()
  expect((await speechPanel.boundingBox())!.width).toBe(transitionsWidth)
  await expect(page.getByLabel('Model')).toHaveAttribute('data-value', 'fish-audio/s2.1-pro')
})

test('shows panel tabs instead of the mobile panel menu on desktop', async ({ page }) => {
  await page.route('**/list', (route) => route.fulfill({ status: 200, body: '' }))
  await page.goto('/editor')

  await expect(page.getByRole('button', { name: 'Open editor panels' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Media Bin' })).toBeVisible()
})

test('unknown route shows the not-found page', async ({ page }) => {
  await page.goto('/does-not-exist')
  await expect(page.getByText('404', { exact: true })).toBeVisible()
})
