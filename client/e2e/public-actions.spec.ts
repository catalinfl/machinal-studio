import { expect, test } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

test.use({ reducedMotion: 'reduce' })

for (const theme of ['light', 'dark']) {
  test(`public filled actions keep their label and icon ink in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
    for (const route of ['/pricing', '/mcp']) {
      await page.goto(route)
      const action = page.locator('main .product-action.button-solid')
      await expect(action.locator('span')).not.toBeEmpty()
      await expect(action.locator('span')).toHaveCSS('color', 'rgb(38, 42, 48)')
      await expect(action.locator('svg')).toHaveCSS('color', 'rgb(38, 42, 48)')
    }
    await page.setViewportSize({ width: 390, height: 900 })
    for (const member of [false, true]) {
      if (member) await mockPaidAuth(page)
      await page.goto('/pricing')
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      const action = page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('link', { name: 'Open editor', exact: true })
      await action.hover()
      await action.focus()
      await expect(action.locator('span')).toHaveCSS('color', 'rgb(38, 42, 48)')
      await expect(action.locator('svg')).toHaveCSS('color', 'rgb(38, 42, 48)')
    }
  })
}
