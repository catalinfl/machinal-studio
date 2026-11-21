import { expect, test } from '@playwright/test'
import path from 'node:path'

const user = { id: 'keycreator', name: 'API Creator', email: 'api@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
const secret = `mach_${'b'.repeat(64)}`

test.beforeEach(async ({ page }) => {
  await page.route('**/billing/credits', route => route.fulfill({ json: {
    balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 1000, purchasedRemaining: 0, remaining: 1000, reserved: 0, debt: 0, usagePending: false, nextReset: '2026-11-01T00:00:00Z' },
    pricing: { configured: false, usdPerCredit: '', renderPerMinute: '' }, purchase: { available: false, packs: [] },
  } }))
})

test('creates one-time application keys, protects revocation and explains cloud/local commands', async ({ page }) => {
  let keys: Array<{ id: string; name: string; prefix: string }> = []
  await page.addInitScript(({ user, token }) => localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token })), { user, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
  await page.route('**/sessions**', route => route.fulfill({ json: {} }))
  await page.route(url => url.pathname.startsWith('/api-keys'), async route => {
    if (route.request().isNavigationRequest()) return route.continue()
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    if (route.request().method() === 'POST') {
      const key = { id: 'key-one', name: route.request().postDataJSON().name, prefix: 'mach_bbbbbbbb' }
      keys = [key]
      return route.fulfill({ status: 201, json: { ...key, key: secret } })
    }
    if (route.request().method() === 'DELETE') { keys = []; return route.fulfill({ status: 204 }) }
    return route.fulfill({ json: keys })
  })
  await page.goto('/api-keys')
  await page.getByLabel('Key name', { exact: true }).fill('Production automation')
  await page.getByRole('button', { name: 'Create API key', exact: true }).click()
  await expect(page.getByLabel('New application API key')).toHaveText(secret)
  await expect(page.locator('.credentials')).not.toContainText(token)
  expect(await page.evaluate(secret => JSON.stringify({ ...localStorage }).includes(secret), secret)).toBe(false)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await page.locator('main.product-page').evaluate(surface => surface.scrollTo({ top: 0, behavior: 'instant' }))
      await expect(page.locator('.keys-intro')).toBeInViewport()
      await expect(page.getByLabel('New application API key')).toBeInViewport()
      await page.screenshot({ path: path.resolve(`../.impeccable/review/application-keys-${width}-${theme}.png`), animations: 'disabled' })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.getByRole('button', { name: 'I saved this key' }).click()
  await expect(page.getByLabel('New application API key')).toHaveCount(0)
  await page.getByRole('button', { name: 'Revoke Production automation' }).click()
  await page.getByRole('button', { name: 'Keep key' }).click()
  expect(keys).toHaveLength(1)
  await page.getByRole('button', { name: 'Revoke Production automation' }).click()
  await page.getByRole('button', { name: 'Confirm revoke' }).click()
  await expect(page.getByText('No active keys.')).toBeVisible()
  await page.goto('/api')
  await page.getByLabel('Execution mode').selectOption('docker')
  await expect(page.locator('.request-guide')).toContainText('without an application key')
  await expect(page.locator('.request-guide')).not.toContainText('Set MACHINAL_API_KEY')
  await expect(page.locator('.request-sheet pre')).not.toContainText('Authorization')
  await expect(page.locator('.request-sheet pre')).toContainText('127.0.0.1:8080/v1/projects/')
  await page.getByLabel('Execution mode').selectOption('cli')
  await expect(page.locator('.request-guide')).toContainText('No application key or project ID is needed.')
  await expect(page.locator('.request-guide')).toContainText('No API job polling is needed.')
  await expect(page.getByRole('group', { name: 'API request examples' }).getByRole('button', { name: 'upload', exact: true })).toHaveCount(0)
  await expect(page.locator('.request-sheet pre')).toContainText('edit render composition.edit.yaml --root /path/to/media')
})

test('a rejected premium check never reveals an application key', async ({ page }) => {
  await page.addInitScript(({ user, token }) => localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token })), { user: { ...user, isPaid: false }, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: { ...user, isPaid: false } } }))
  await page.route('**/sessions**', route => route.fulfill({ json: {} }))
  await page.route(url => url.pathname.startsWith('/api-keys'), route => route.request().isNavigationRequest() ? route.continue() : route.request().method() === 'POST' ? route.fulfill({ status: 402, body: 'paid plan required' }) : route.fulfill({ json: [] }))
  await page.goto('/api-keys')
  await page.getByLabel('Key name', { exact: true }).fill('Free account')
  await page.getByRole('button', { name: 'Create API key', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Premium is required')
  await expect(page.getByLabel('New application API key')).toHaveCount(0)
  await expect(page.getByLabel('Key name', { exact: true })).toHaveValue('Free account')
})
