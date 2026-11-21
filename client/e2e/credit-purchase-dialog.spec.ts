import { expect, test } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

const summary = {
  balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 800, purchasedRemaining: 0, remaining: 800,
    reserved: 0, debt: 0, usagePending: false, allowancePeriod: 'prepaid-30-day', nextReset: '2026-12-04T12:00:00Z' },
  pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '10' },
  purchase: { available: true, packs: [500, 1000, 2500, 5000, 10000].map(credits => ({ id: `credits-${credits}`, credits, usd: (credits / 100).toFixed(2) })) },
  payments: { mode: 'sandbox' },
  memberships: { available: true, renewal: 'manual', plans: [{ id: 'pro-30', name: 'Pro · 30 days', days: 30, credits: 0, usd: '10.00' }] },
}

test.beforeEach(async ({ page }) => {
  await mockPaidAuth(page)
  await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
  await page.route('**/billing/credits', route => route.fulfill({ json: summary }))
  await page.route('**/billing/orders', route => route.fulfill({ json: [] }))
  await page.route('**/api-keys', route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: [] }))
})

for (const destination of ['api-keys', 'membership']) {
  test(`credit purchase is immediately accessible at ${destination} on desktop and mobile in both themes`, async ({ page }, testInfo) => {
    let checkouts = 0
    await page.route('**/billing/paypal/orders', route => { checkouts++; return route.fulfill({ status: 503 }) })
    await page.goto(`/${destination}`)
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    const trigger = page.getByRole('button', { name: 'Buy more credits', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Buy more credits', exact: true })
    const surface = page.locator('main.product-page')

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
        await surface.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }))
        await expect(trigger).toBeInViewport({ ratio: 1 })
        await expect(dialog).not.toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`${destination}-${width}-${theme}-page.png`), animations: 'disabled' })
        await trigger.focus()
        await page.keyboard.press('Enter')
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('radio')).toHaveCount(5)
        await dialog.getByRole('radio', { name: /^1,000 credits/ }).check()
        await expect(dialog.locator('.total')).toContainText('1,000 credits for $10.00')
        await page.screenshot({ path: testInfo.outputPath(`${destination}-${width}-${theme}-dialog.png`), animations: 'disabled' })
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        await page.keyboard.press('Escape')
        await expect(dialog).not.toBeVisible()
        await expect(trigger).toBeFocused()
        expect(await surface.evaluate(element => element.scrollTop)).toBe(0)
        await trigger.click()
        await expect(dialog.getByRole('radio', { name: /^1,000 credits/ })).toBeChecked()
        await dialog.getByRole('button', { name: 'Close credit purchase' }).click()
        await expect(trigger).toBeFocused()
        expect(await surface.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
    }
    expect(checkouts).toBe(0)
  })
}

test('credit pack loading failures can be retried directly in the dialog', async ({ page }) => {
  let calls = 0
  await page.route('**/billing/credits', route => ++calls === 1
    ? route.fulfill({ status: 503, body: 'Credit packs are temporarily unavailable.' })
    : route.fulfill({ json: summary }))
  await page.goto('/api-keys')
  await page.getByRole('button', { name: 'Buy more credits', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Buy more credits' })
  await expect(dialog.getByRole('alert')).toContainText('temporarily unavailable')
  await dialog.getByRole('button', { name: 'Retry credit packs' }).click()
  await expect(dialog.getByRole('radio')).toHaveCount(5)
  await expect(dialog.getByRole('button', { name: 'Continue to PayPal' })).toBeEnabled()
  expect(calls).toBe(2)
})

test('a cancelled PayPal return opens credit feedback without a new checkout', async ({ page }) => {
  await page.goto('/api-keys?paypal=cancelled')
  const dialog = page.getByRole('dialog', { name: 'Buy more credits' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status').filter({ hasText: 'checkout was cancelled' })).toBeVisible()
  await expect(page).toHaveURL(/\/api-keys$/)
})
