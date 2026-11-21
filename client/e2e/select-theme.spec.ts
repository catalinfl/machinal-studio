import { expect, test } from '@playwright/test'

const user = { id: 'selectcreator', name: 'Select Creator', email: 'select@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`

for (const destination of ['/api', '/toolkit', '/api-keys', '/editor']) {
  test(`native select popups use purple at ${destination}`, async ({ page }) => {
    await page.addInitScript(({ user, token }) => localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token })), { user, token })
    await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
    await page.route('**/sessions**', route => route.fulfill({ json: {} }))
    await page.route(url => ['/projects', '/list', '/api-keys'].includes(url.pathname) && url.port !== '5173', route => route.fulfill({ json: [] }))
    const project = { id: 'default', name: 'Select fixture', sessionId: 'u_selectcreator', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: null }
    await page.route(url => url.pathname.startsWith('/projects'), route => route.fulfill({ json: new URL(route.request().url()).pathname === '/projects' ? [project] : project }))
    await page.route('**/billing/credits', route => route.fulfill({ json: {
      balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 870, purchasedRemaining: 250, remaining: 1120, reserved: 0, debt: 0, usagePending: false, nextReset: '2026-11-01T00:00:00Z' },
      pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '2' },
      purchase: { available: true, packs: [{ id: 'small', credits: 250, usd: '2.50' }, { id: 'large', credits: 500, usd: '5.00' }] },
    } }))
    await page.goto(destination)
    if (destination === '/editor') await page.getByRole('button', { name: 'Generate scenes', exact: true }).click()
    const select = destination === '/api' ? page.getByRole('combobox', { name: 'Execution mode' })
      : destination === '/toolkit' ? page.getByRole('combobox', { name: 'Filter toolkit category' })
      : destination === '/api-keys' ? page.getByLabel('Credit pack')
      : page.locator('#scene-output')
    await expect(select).toBeVisible()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
        await select.click()
        await expect(select).toHaveCSS('appearance', 'base-select')
        const option = select.locator('option').nth(1)
        await option.hover()
        const colors = await option.evaluate(element => {
          const style = getComputedStyle(element)
          const probe = document.createElement('span')
          probe.style.color = 'var(--primary)'
          element.parentElement!.append(probe)
          const primary = getComputedStyle(probe).color
          probe.remove()
          return { background: style.backgroundColor, primary }
        })
        expect(colors.background).toBe(colors.primary)
        await expect(option).toHaveCSS('min-height', '36px')
        await page.screenshot({ path: `../.impeccable/review/select-${destination.slice(1)}-${width}-${theme}.png`, animations: 'disabled' })
        await page.keyboard.press('Escape')
      }
    }
    await select.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(select).toBeFocused()
  })
}
