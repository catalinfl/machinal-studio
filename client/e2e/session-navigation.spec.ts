import { test, expect, type Page } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

async function inspectPreferences(page: Page, triggerName: string, capture: string) {
  const trigger = page.getByRole('button', { name: triggerName, exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('region', { name: 'Account and preferences' })
  await expect(panel).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const bounds = (await panel.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: `Use ${theme} theme`, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByRole('button', { name: `Use ${theme} theme` })).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.screenshot({ path: `.impeccable/review/${capture}-${theme}.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 440 } })
  }
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
}

for (const width of [1440, 768, 390]) {
  test.describe(`shared session navigation at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })

    test('guest preferences stay consistent on home, login and account', async ({ page }) => {
      for (const [route, name] of [['/', 'home'], ['/login', 'login'], ['/account', 'account']]) {
        await page.goto(route)
        await inspectPreferences(page, 'Preferences', `nav-${name}-guest-${width}`)
        await expect(page.locator('.product-nav .login-link')).toHaveAttribute('href', '/login')
      }
    })

    test('signed-in account menu links and logout work', async ({ page }) => {
      await mockPaidAuth(page)
      await page.addInitScript(() => {
        if (location.pathname === '/login') localStorage.removeItem('pocketbase_auth')
      })
      await page.goto('/')
      await inspectPreferences(page, 'Account settings', `nav-home-member-${width}`)
      await page.goto('/account')
      await inspectPreferences(page, 'Account settings', `nav-account-member-${width}`)
      await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
      await page.goto('/editor')
      await inspectPreferences(page, 'Open settings', `nav-editor-member-${width}`)
      await page.goto('/')
      await page.getByRole('button', { name: 'Account settings' }).click()
      await expect(page.getByRole('link', { name: 'Manage account' })).toHaveAttribute('href', '/account')
      await page.getByRole('button', { name: 'Log out', exact: true }).click()
      await expect(page).toHaveURL(/\/login$/)
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pocketbase_auth') || '{}').token || '')).toBe('')
    })

    test('editor uses the shared menu and closes on outside click', async ({ page }) => {
      await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
      await page.goto('/editor')
      await inspectPreferences(page, 'Open settings', `nav-editor-guest-${width}`)
      await page.getByRole('button', { name: 'Open settings' }).click()
      await expect(page.getByRole('region', { name: 'Account and preferences' }).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
      await page.locator('.topbar .brand').click()
      await expect(page.getByRole('region', { name: 'Account and preferences' })).toBeHidden()
      await expect(page.getByRole('button', { name: 'Open settings' })).toHaveAttribute('aria-expanded', 'false')
    })
  })
}
