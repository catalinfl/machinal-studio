import { expect, test } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

const packs = [500, 1000, 2500, 5000, 10000].map(credits => ({ id: `credits-${credits}`, credits, usd: (credits / 100).toFixed(2) }))
const catalog = {
  pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '10' },
  purchase: { available: true, packs },
  payments: { mode: 'sandbox' },
  memberships: { available: true, renewal: 'manual', includedCredits: 1000, allowanceDays: 30,
    plans: [{ id: 'pro-30', name: 'Pro · 30 days', days: 30, credits: 0, usd: '10.00' }] },
}

test('anonymous pricing uses the checkout catalog and explains all five top-ups', async ({ page }) => {
  await page.route('**/billing/catalog', route => route.fulfill({ json: catalog }))
  await page.goto('/pricing')
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(6)
  await expect(page.getByRole('cell', { name: '$100.00', exact: true })).toBeVisible()
  await expect(page.locator('.pricing-options').getByText('$10.00', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('test purchases')
  await page.getByText('How do included credits and top-ups work?', { exact: true }).click()
  await expect(page.getByText('They do not reset again at a calendar-month boundary.', { exact: false })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/20%|budgetPercent|supplier|upstream/i)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await page.locator('.topups').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `../.impeccable/review/billing-pricing-${width}-${theme}.png`, animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  }
})

test('pack selection updates the checkout total and sends only the chosen server pack ID', async ({ page }, testInfo) => {
  await mockPaidAuth(page)
  await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
  await page.route('**/billing/credits', route => route.fulfill({ json: { ...catalog,
    balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 800, purchasedRemaining: 0, remaining: 800,
      reserved: 0, debt: 0, usagePending: false, allowancePeriod: 'prepaid-30-day', nextReset: '2026-12-04T12:00:00Z' },
  } }))
  await page.route('**/api-keys', route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: [] }))
  await page.route('**/billing/paypal/orders', route => {
    expect(route.request().postDataJSON()).toEqual({ packId: 'credits-5000' })
    return route.fulfill({ status: 503, body: 'Synthetic checkout stopped before any PayPal request.' })
  })
  await page.goto('/api-keys')
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await page.getByRole('button', { name: 'Buy more credits', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Buy more credits' })).toBeVisible()
  await page.getByRole('radio', { name: /5,000 credits/ }).check()
  await expect(page.locator('.total')).toHaveText('You’ll receive 5,000 credits for $50.00. All prices are in USD.')
  await page.getByRole('button', { name: 'Continue to PayPal' }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic checkout stopped')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await page.locator('.purchase').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`billing-packs-${width}-${theme}.png`), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  }
})
