import { expect, test, type Page } from '@playwright/test'

const user = { id: 'creditcreator', name: 'API Creator', email: 'api@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
const summary = {
  balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 870.25, purchasedRemaining: 250, remaining: 1120.25, reserved: 0, debt: 0, usagePending: false, nextReset: '2026-11-01T00:00:00Z' },
  pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '2' },
  purchase: { available: true, packs: [{ id: 'test-pack', credits: 250, usd: '2.50' }] },
}

async function authenticate(page: Page) {
  await page.addInitScript(({ user, token }) => localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token })), { user, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
  await page.route(url => url.pathname.startsWith('/api-keys'), route => route.request().isNavigationRequest() ? route.fallback() : route.fulfill({ json: [] }))
}

for (const destination of ['/', '/editor', '/account']) {
  test(`credit balance is accessible from Account at ${destination}`, async ({ page }) => {
    await authenticate(page)
    let calls = 0
    let captures = 0
    await page.route('**/billing/credits', route => {
      calls++
      expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
      return route.fulfill({ json: summary })
    })
    await page.route('**/billing/paypal/orders/*/capture', route => {
      captures++
      return route.fulfill({ json: { status: 'completed' } })
    })
    await page.route('**/sessions**', route => route.fulfill({ json: {} }))
    await page.route(url => ['/projects', '/list'].includes(url.pathname), route => route.fulfill({ json: [] }))
    await page.goto(`${destination}?paypal=approved&token=ORDER123`)
    if (destination === '/account') {
      await expect(page.locator('main.account').getByLabel('Available credits')).toHaveText('1,120.25 credits available')
      expect(calls).toBe(1)
    } else {
      expect(calls).toBe(0)
    }
    const trigger = page.getByRole('button', { name: destination === '/editor' ? 'Open settings' : 'Account settings', exact: true })
    await trigger.click()
    const panel = page.locator('.session-panel')
    await expect(panel.getByLabel('Available credits')).toHaveText('1,120.25 credits available')
    await expect(panel.getByText('870.25 / 1,000', { exact: true })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'API Keys & credits' })).toBeVisible()
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(panel.getByLabel('Available credits')).toBeVisible()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(panel).not.toBeVisible()
      await trigger.click()
      await expect(panel.getByLabel('Available credits')).toBeVisible()
      expect(await panel.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width)
    }
    expect(captures).toBe(0)
    await expect(page).toHaveURL(/paypal=approved/)
  })
}

test('dedicated keys page displays real balances and remains usable in both themes and viewport sizes', async ({ page }, testInfo) => {
  await authenticate(page)
  await page.route('**/billing/credits', route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    return route.fulfill({ json: summary })
  })
  await page.goto('/api-keys')
  await expect(page.getByRole('heading', { name: 'API Keys', exact: true })).toBeVisible()
  await expect(page.getByLabel('Available credits')).toHaveText('1,120.25 credits')
  await expect(page.getByText('Purchased credits never expire.', { exact: false })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Product navigation' }).locator('a[href="/api-keys"]')).toHaveCount(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await page.locator('main.product-page').evaluate(surface => surface.scrollTo({ top: 0, behavior: 'instant' }))
      await page.screenshot({ path: testInfo.outputPath(`credit-account-${width}-${theme}.png`), animations: 'disabled' })
      await page.locator('#credits').scrollIntoViewIfNeeded()
      await expect(page.getByLabel('Available credits')).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`credit-account-balance-${width}-${theme}.png`), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  }
  await page.locator('main.product-page').evaluate(surface => surface.scrollTo({ top: 0, behavior: 'instant' }))
  await page.getByRole('button', { name: 'Buy more credits', exact: true }).click()
  await expect(page.getByRole('radio', { name: /250 credits/ })).toBeChecked()
  await page.getByRole('button', { name: 'Close credit purchase' }).click()
  await page.getByRole('button', { name: 'Account settings', exact: true }).click()
  await expect(page.locator('.session-panel').getByRole('link', { name: 'API Keys & credits' })).toBeVisible()
})

test('PayPal receives only a server-created checkout and a selected pack ID', async ({ page }) => {
  await authenticate(page)
  await page.route('**/billing/credits', route => route.fulfill({ json: summary }))
  await page.route('**/billing/paypal/orders', route => {
    expect(route.request().postDataJSON()).toEqual({ packId: 'test-pack' })
    return route.fulfill({ status: 201, json: { id: 'ORDER123', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123' } })
  })
  await page.route('https://www.sandbox.paypal.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>PayPal sandbox checkout fixture</h1>' }))
  await page.goto('/api-keys')
  await page.getByRole('button', { name: 'Buy more credits', exact: true }).click()
  await page.getByRole('button', { name: 'Continue to PayPal' }).click()
  await expect(page).toHaveURL('https://www.sandbox.paypal.com/checkoutnow?token=ORDER123')
})

test('payment return verifies on the server, retries safely, refreshes the balance and clears query markers', async ({ page }) => {
  await authenticate(page)
  let attempts = 0
  await page.route('**/billing/credits', route => route.fulfill({ json: attempts > 1 ? { ...summary, balance: { ...summary.balance, purchasedRemaining: 500, remaining: 1370.25 } } : summary }))
  await page.route('**/billing/paypal/orders/ORDER123/capture', route => ++attempts === 1
    ? route.fulfill({ status: 503, body: 'Payment confirmation is temporarily unavailable.' })
    : route.fulfill({ json: { status: 'completed' } }))
  await page.goto('/api-keys?paypal=approved&token=ORDER123&PayerID=fixture')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await page.getByRole('button', { name: 'Retry payment verification' }).click()
  await expect(page.getByText('Payment confirmed. Your purchased credits have been added.')).toBeVisible()
  await page.getByRole('button', { name: 'Close credit purchase' }).click()
  await expect(page.getByLabel('Available credits')).toHaveText('1,370.25 credits')
  await expect(page).toHaveURL(/\/api-keys$/)
  expect(attempts).toBe(2)
})

test('unconfigured billing does not invent prices and failed balance loading can recover', async ({ page }) => {
  await authenticate(page)
  let calls = 0
  await page.route('**/billing/credits', route => ++calls === 1 ? route.fulfill({ status: 503, body: 'Credit balance is unavailable.' }) : route.fulfill({ json: { ...summary, pricing: { configured: false, usdPerCredit: '', renderPerMinute: '' }, purchase: { available: false, packs: [] } } }))
  await page.goto('/api-keys')
  await expect(page.getByRole('alert')).toContainText('Credit balance is unavailable.')
  await page.getByRole('button', { name: 'Retry balance' }).click()
  await expect(page.getByLabel('Available credits')).toHaveText('1,120.25 credits')
  await expect(page.getByText('API usage pricing has not been configured yet.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to PayPal' })).toHaveCount(0)
})

test('API keys route preserves a PayPal return through the login guard', async ({ page }) => {
  await page.goto('/api-keys?paypal=approved&token=ORDER123')
  await expect(page).toHaveURL(/\/login\?next=%2Fapi-keys%3Fpaypal%3Dapproved%26token%3DORDER123$/)
  await expect(page.locator('.account-workspace')).toHaveCount(0)
})
