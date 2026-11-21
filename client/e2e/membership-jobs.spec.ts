import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const user = { id: 'accountfixture', name: 'Account fixture', email: 'account@example.test', collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
const summary = {
  balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 870, purchasedRemaining: 250, remaining: 1120, reserved: 0, debt: 0, usagePending: false, nextReset: '2026-11-01T00:00:00Z' },
  pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '2' },
  purchase: { available: true, packs: [{ id: 'fixture-pack', credits: 250, usd: '2.50' }] },
  membership: { active: true, name: 'Creator fixture', until: '2026-11-25T12:00:00Z' },
  memberships: { available: true, renewal: 'manual', plans: [
    { id: 'creator', name: 'Creator fixture', days: 30, credits: 0, usd: '10.00' },
    { id: 'studio', name: 'Studio fixture', days: 90, credits: 500, usd: '25.00' },
  ] },
}
const project = { id: 'default', name: 'Main project', sessionId: 'u_accountfixture', version: 0, createdAt: '', updatedAt: '' }
const secondProject = { ...project, id: 'p_second', sessionId: 'p_second', name: 'Second project' }
const running = { id: 'a'.repeat(32), kind: 'automation-render', status: 'running', progress: 0.5,
  createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:01:00Z', message: 'Rendering video', timing: { approximate: true, basis: 'progress', remainingSeconds: 120 } }
const completed = { ...running, id: 'b'.repeat(32), status: 'completed', progress: 1, filename: 'render_fixture.mp4', message: '', timing: undefined }

async function authenticate(page: Page) {
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
    localStorage.setItem('scrub-project-session-id', 'u_accountfixture')
  }, { user, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
  await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
  await page.route('**/billing/credits', route => route.fulfill({ json: summary }))
  await page.route('**/billing/orders', route => route.fulfill({ json: [] }))
}

test('membership selection creates only a server-priced pass checkout', async ({ page }) => {
  await authenticate(page)
  await page.route('**/billing/membership/orders', route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    expect(route.request().postDataJSON()).toEqual({ planId: 'studio' })
    return route.fulfill({ status: 201, json: { approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123' } })
  })
  await page.route('https://www.sandbox.paypal.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Sandbox fixture</h1>' }))
  await page.goto('/membership')
  const checkout = page.locator('.membership').getByRole('button', { name: 'Continue to PayPal' })
  await expect(checkout).toBeDisabled()
  await page.getByRole('radio', { name: /Studio fixture/ }).check()
  await checkout.click()
  await expect(page).toHaveURL('https://www.sandbox.paypal.com/checkoutnow?token=ORDER123')
})

test('refund requests are explicit, retryable merchant reviews, not automatic payouts', async ({ page }) => {
  await authenticate(page)
  let requested = false
  await page.route('**/billing/orders', route => route.fulfill({ json: [{ id: 'ORDER123', planName: 'Creator fixture', credits: 0, membershipDays: 30, usd: '10.00', createdAt: '2026-10-26T12:00:00Z', status: 'completed', refundRequestedAt: requested ? '2026-10-26T13:00:00Z' : null }] }))
  await page.route('**/billing/paypal/orders/ORDER123/refund-request', route => {
    expect(route.request().postDataJSON()).toEqual({ reason: 'Please review my accidental purchase' })
    requested = true
    return route.fulfill({ status: 202, json: { status: 'requested' } })
  })
  await page.goto('/membership')
  await page.getByRole('button', { name: 'Request refund', exact: true }).click()
  const submit = page.getByRole('button', { name: 'Send refund request' })
  await expect(submit).toBeDisabled()
  await page.getByRole('textbox', { name: 'Why are you requesting a refund?' }).fill('Please review my accidental purchase')
  await submit.click()
  await expect(page.getByRole('status').filter({ hasText: 'Refund request saved for review' })).toBeVisible()
  await expect(page.getByText('Refund requested', { exact: true })).toBeVisible()
})

test('jobs stay project-scoped and links are renewed without submitting another render', async ({ page }) => {
  await authenticate(page)
  await page.route('**/projects', route => route.fulfill({ json: [project, secondProject] }))
  await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
  await page.route('**/projects/p_second', route => route.fulfill({ json: { ...secondProject, state: null } }))
  await page.route('**/jobs?view=summary', route => {
    const session = route.request().headers()['x-session-id']
    expect(['u_accountfixture', 'p_second']).toContain(session)
    return route.fulfill({ json: session === 'p_second' ? [] : [completed, running] })
  })
  let downloads = 0
  await page.route(`**/jobs/${completed.id}/download`, route => {
    downloads++
    expect(route.request().headers()['x-session-id']).toBe('u_accountfixture')
    return route.fulfill({ json: { url: `https://storage.example.test/video?signature=fixture-${downloads}`, expiresAt: '2099-01-01T12:00:00Z' } })
  })
  await page.goto('/jobs')
  await expect(page.getByText('About 2 min remaining')).toBeVisible()
  await page.getByRole('button', { name: 'Get download link' }).click()
  await expect(page.getByRole('link', { name: 'Download from S3' })).toHaveAttribute('href', /fixture-1/)
  await page.getByRole('button', { name: 'Renew download link' }).click()
  await expect(page.getByRole('link', { name: 'Download from S3' })).toHaveAttribute('href', /fixture-2/)
  await page.getByLabel('Project', { exact: true }).selectOption('p_second')
  await expect(page.getByRole('heading', { name: 'No server jobs yet' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('scrub-project-session-id'))).toBe('u_accountfixture')
  expect(downloads).toBe(2)
})

test('cancellation requires confirmation and refresh never repeats paid work', async ({ page }) => {
  await authenticate(page)
  await page.route('**/projects', route => route.fulfill({ json: [project] }))
  await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
  let cancelled = false
  await page.route('**/jobs?view=summary', route => route.fulfill({ json: [{ ...running, status: cancelled ? 'cancelled' : 'running' }] }))
  await page.route(`**/jobs/${running.id}`, route => {
    expect(route.request().method()).toBe('DELETE')
    cancelled = true
    return route.fulfill({ status: 204 })
  })
  await page.goto('/jobs')
  await page.getByRole('button', { name: 'Cancel job' }).click()
  expect(cancelled).toBe(false)
  await page.getByRole('button', { name: 'Keep running' }).click()
  await page.getByRole('button', { name: 'Cancel job' }).click()
  await page.getByRole('button', { name: 'Confirm cancellation' }).click()
  await expect(page.locator('.status')).toHaveText('cancelled')
})

test('membership return preserves login recovery and verifies the existing order once', async ({ page }) => {
  await page.goto('/membership?paypal=approved&token=ORDER123')
  await expect(page).toHaveURL(/login\?next=%2Fmembership%3Fpaypal%3Dapproved%26token%3DORDER123/)
  await authenticate(page)
  let captures = 0
  await page.route('**/billing/paypal/orders/ORDER123/capture', route => { captures++; return route.fulfill({ json: { status: 'completed' } }) })
  await page.goto('/membership?paypal=approved&token=ORDER123')
  await expect(page.getByText('Payment confirmed. Your account has been updated.')).toBeVisible()
  await expect(page).toHaveURL(/\/membership$/)
  expect(captures).toBe(1)
})

test('completion notifications are opt-in and refresh failures preserve last known jobs', async ({ page }) => {
  await authenticate(page)
  await page.addInitScript(() => {
    const notices: string[] = []
    Object.assign(window, { accountNotices: notices })
    Object.defineProperty(window, 'Notification', { value: class {
      static async requestPermission() { return 'granted' }
      constructor(title: string) { notices.push(title) }
    } })
  })
  await page.route('**/projects', route => route.fulfill({ json: [project] }))
  await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
  let done = false
  let unavailable = false
  await page.route('**/jobs?view=summary', route => unavailable ? route.fulfill({ status: 503 }) : route.fulfill({ json: [done ? { ...completed, id: running.id } : running] }))
  await page.goto('/jobs')
  await expect(page.getByText('About 2 min remaining')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { accountNotices: string[] }).accountNotices)).toEqual([])
  await page.getByRole('button', { name: 'Notify me when ready' }).click()
  done = true
  await page.getByRole('button', { name: 'Refresh jobs' }).click()
  await expect(page.getByRole('button', { name: 'Get download link' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { accountNotices: string[] }).accountNotices)).toEqual(['Your video is ready'])
  unavailable = true
  await page.getByRole('button', { name: 'Refresh jobs' }).click()
  await expect(page.getByRole('alert')).toContainText('last known status')
  await expect(page.getByRole('button', { name: 'Get download link' })).toBeVisible()
})

test('unconfigured membership checkout does not display invented plans or prices', async ({ page }) => {
  await authenticate(page)
  await page.route('**/billing/credits', route => route.fulfill({ json: { ...summary,
    membership: { active: false }, memberships: { available: false, plans: [], renewal: 'manual' },
    purchase: { available: false, packs: [] },
  } }))
  await page.goto('/membership')
  await expect(page.getByText('Membership checkout is not available yet.', { exact: false })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue to PayPal' })).toHaveCount(0)
})

test('failed top-up checkout keeps visible feedback beside the initiating mobile form', async ({ page }, testInfo) => {
  await authenticate(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.addInitScript(() => localStorage.setItem('scrub-theme', 'light'))
  await page.route('**/billing/paypal/orders', route => route.fulfill({ status: 503, body: 'PayPal checkout is temporarily unavailable. Retry shortly.' }))
  await page.goto('/membership')
  await page.getByRole('button', { name: 'Buy more credits', exact: true }).click()
  const purchase = page.locator('.purchase')
  await purchase.getByRole('button', { name: 'Continue to PayPal' }).click()
  await expect(purchase.getByRole('alert')).toContainText('temporarily unavailable')
  await expect(purchase.getByRole('alert')).toBeInViewport()
  await expect(page.locator('.membership').getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('account-topup-error-390-light.png'), animations: 'disabled' })
})

test('failed refund submission preserves the exact reason and supports retry', async ({ page }) => {
  await authenticate(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.addInitScript(() => localStorage.setItem('scrub-theme', 'light'))
  let attempts = 0
  const reason = 'Am cumpărat din greșeală acest pachet de test.'
  await page.route('**/billing/orders', route => route.fulfill({ json: [{ id: 'ORDER123', planName: 'Creator fixture', credits: 0, membershipDays: 30, usd: '10.00', createdAt: '2026-10-26T12:00:00Z', status: 'completed', refundRequestedAt: attempts > 1 ? '2026-10-26T13:00:00Z' : null }] }))
  await page.route('**/billing/paypal/orders/ORDER123/refund-request', route => {
    expect(route.request().postDataJSON()).toEqual({ reason })
    return ++attempts === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ status: 202, json: { status: 'requested' } })
  })
  await page.goto('/membership')
  await page.getByRole('button', { name: 'Request refund', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Why are you requesting a refund?' })
  await input.fill(reason)
  await page.getByRole('button', { name: 'Send refund request' }).click()
  await expect(page.locator('.history').getByRole('alert')).toContainText('Could not save')
  await expect(input).toHaveValue(reason)
  await page.locator('.history form').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.resolve('../.impeccable/review/account-refund-error-390-light.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Retry refund request' }).click()
  await expect(page.getByText('Refund requested', { exact: true })).toBeVisible()
  await expect(input).toHaveCount(0)
  expect(attempts).toBe(2)
})

test('an expired download is removed and renewed without rendering again', async ({ page }) => {
  await authenticate(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.addInitScript(() => localStorage.setItem('scrub-theme', 'light'))
  await page.route('**/projects', route => route.fulfill({ json: [project] }))
  await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
  await page.route('**/jobs?view=summary', route => route.fulfill({ json: [completed] }))
  let downloads = 0
  await page.route(`**/jobs/${completed.id}/download`, route => {
    downloads++
    return route.fulfill({ json: { url: `https://storage.example.test/video?signature=fixture-${downloads}`, expiresAt: new Date(Date.now() + (downloads === 1 ? 1500 : 900_000)).toISOString() } })
  })
  await page.goto('/jobs')
  await page.getByRole('button', { name: 'Get download link' }).click()
  await expect(page.getByRole('link', { name: 'Download from S3' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Download link expired.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download from S3' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Renew download link' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.resolve('../.impeccable/review/account-download-expired-390-light.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Renew download link' }).click()
  await expect(page.getByRole('link', { name: 'Download from S3' })).toHaveAttribute('href', /fixture-2/)
  expect(downloads).toBe(2)
})

test('account pages visual matrix preserves desktop, mobile and both themes', async ({ page }) => {
  await authenticate(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/billing/orders', route => route.fulfill({ json: [{ id: 'ORDER123', planName: 'Creator fixture', credits: 0, membershipDays: 30, usd: '10.00', createdAt: '2026-10-26T12:00:00Z', status: 'completed' }] }))
  await page.route('**/projects', route => route.fulfill({ json: [project] }))
  await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
  await page.route('**/jobs?view=summary', route => route.fulfill({ json: [running, completed,
    { ...running, id: 'c'.repeat(32), kind: 'ai-scene', status: 'queued', progress: 0, message: 'Waiting for a worker', timing: { approximate: true, basis: 'unknown' } },
  ] }))
  await page.route(`**/jobs/${completed.id}/download`, route => route.fulfill({ json: { url: 'https://storage.example.test/fixture.mp4?signature=fixture', expiresAt: '2099-01-01T12:00:00Z' } }))
  for (const destination of ['membership', 'jobs']) {
    await page.goto(`/${destination}`)
    if (destination === 'membership') {
      await expect(page.getByRole('radio', { name: /Studio fixture/ })).toBeVisible()
      await page.getByRole('radio', { name: /Studio fixture/ }).check()
    } else await expect(page.getByText('About 2 min remaining')).toBeVisible()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
        await page.locator('main.product-page').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }))
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: path.resolve(`../.impeccable/review/account-${destination}-${width}-${theme}.png`), animations: 'disabled' })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        expect(await page.locator('main.product-page').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
      await page.evaluate(() => document.documentElement.dataset.theme = 'light')
      if (destination === 'membership') {
        await page.getByRole('button', { name: 'Request refund', exact: true }).click()
        await page.getByRole('textbox', { name: 'Why are you requesting a refund?' }).fill('Please review this synthetic fixture purchase')
        await page.locator('.history').scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.resolve(`../.impeccable/review/account-refund-${width}-light.png`), animations: 'disabled' })
        await page.getByRole('button', { name: 'Keep payment' }).click()
      } else {
        await page.getByRole('button', { name: /Get download link|Renew download link/ }).click()
        await page.getByRole('link', { name: 'Download from S3' }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.resolve(`../.impeccable/review/account-download-${width}-light.png`), animations: 'disabled' })
      }
    }
  }
  expect(errors).toEqual([])
})
