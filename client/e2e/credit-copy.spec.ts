import { expect, test } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

test.use({ reducedMotion: 'reduce' })

const summary = {
  balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 870, purchasedRemaining: 250, remaining: 1120, reserved: 0, debt: 0, usagePending: true, nextReset: '2026-11-01T00:00:00Z' },
  pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '2' },
  purchase: { available: true, packs: [{ id: 'pack', credits: 250, usd: '2.50' }] },
}

for (const theme of ['light', 'dark'] as const) {
  test(`customer credit copy stays supplier-neutral and fits desktop/mobile in ${theme}`, async ({ page }) => {
    await mockPaidAuth(page)
    await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
    await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
    await page.route('**/billing/credits', route => route.fulfill({ json: summary }))
    await page.route('**/api-keys', route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: [] }))
    await page.route('**/projects', route => route.fulfill({ json: [] }))
    await page.route('**/sessions**', route => route.fulfill({ json: {} }))
    await page.route('**/list', route => route.fulfill({ json: [] }))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const route of ['/pricing', '/api', '/docs#pricing', '/api-keys']) {
        await page.goto(route)
        await expect(page.locator('h1').first()).toBeVisible()
        await expect(page.locator('body')).not.toContainText(/openrouter|jev|actual provider (?:cost|usage)|upstream provider|converted at|30%|3\.333/i)
        if (route === '/pricing') {
          await page.getByText('How many credits will an AI task use?', { exact: true }).click()
          await expect(page.getByText('Credit usage depends on the tool and work completed.', { exact: false })).toBeVisible()
          await expect(page.getByRole('link', { name: 'View API credits & rates', exact: true })).toHaveAttribute('href', '/api-keys')
        }
        if (route === '/api-keys') {
          await expect(page.getByLabel('Available credits')).toHaveText('1,120 credits')
          await expect(page.getByText('Rendering: 2 credits per output minute, prorated.', { exact: false })).toBeVisible()
          await expect(page.getByText('Some credit charges are still being finalized.', { exact: false })).toBeVisible()
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        if (process.env.CREDIT_COPY_CAPTURE === '1' && ['/pricing', '/api-keys'].includes(route)) {
          if (route === '/api-keys') await page.locator('#credits').scrollIntoViewIfNeeded()
          await page.screenshot({ path: `../.impeccable/review/credit-copy-${route.slice(1)}-${width}-${theme}.png`, animations: 'disabled' })
        }
      }
    }
    expect(errors).toEqual([])
  })
}
