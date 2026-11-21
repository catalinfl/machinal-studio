import type { Page } from '@playwright/test'

// Paid test account: the session is seeded into localStorage before load, so
// main.ts (which awaits initAuth() before mount) restores it and auth is
// settled before first render. Entitlement comes from a subscriptions row
// whose id IS the user id (by-id 1:1 schema) with a paid plan.
export const paidAccount = {
  id: 'paiduser1234',
  email: 'paid@example.com',
  name: 'Paid User',
  collectionName: 'users',
  collectionId: '_pb_users_auth_',
}

export function paidTestToken(): string {
  return `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`
}

export async function mockPaidAuth(page: Page): Promise<void> {
  const token = paidTestToken()
  await page.route('**/api/collections/users/auth-*', (route) =>
    route.fulfill({ json: { token, record: paidAccount } }),
  )
  await page.route('**/api/collections/subscriptions/records/*', (route) =>
    route.fulfill({ json: { id: paidAccount.id, plan: 'pro' } }),
  )
  await page.addInitScript(
    ({ token, record }) => {
      window.localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record }))
    },
    { token, record: paidAccount },
  )
}
