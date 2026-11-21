import { expect, test, type Page } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

test.use({ reducedMotion: 'reduce' })

const workspace = [
  ['Membership & billing', '/membership'],
  ['Jobs & downloads', '/jobs'],
  ['API keys & credits', '/api-keys'],
  ['Account', '/account'],
] as const

async function mockWorkspaceAccount(page: Page) {
  await mockPaidAuth(page)
  await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
  await page.route('**/billing/credits', route => route.fulfill({ json: {
    balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 870, purchasedRemaining: 250, remaining: 1120, reserved: 0, debt: 0, usagePending: false },
    pricing: { configured: false }, purchase: { available: false, packs: [] },
  } }))
}

async function capture(page: Page, name: string) {
  if (process.env.PUBLIC_NAV_CAPTURE !== '1') return
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.screenshot({ path: `../.impeccable/review/modern-navigation-${name}.png`, fullPage: true, animations: 'disabled' })
}

async function expectWithinViewport(page: Page) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('header, main, nav:popover-open')]
    .some(element => element.getBoundingClientRect().right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1))
  expect(overflow).toBe(false)
}

test('compact product and developer groups retain all destinations with direct Pricing access', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Product navigation', exact: true })
  await nav.getByRole('button', { name: 'Product', exact: true }).click()
  await expect(nav.locator('a[href="/toolkit"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await nav.getByRole('button', { name: 'Developers', exact: true }).click()
  for (const href of ['/api', '/mcp']) await expect(nav.locator(`a[href="${href}"]`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(nav.getByRole('link', { name: 'Pricing', exact: true })).toHaveAttribute('href', '/pricing')
  await expect(page.getByRole('navigation', { name: 'Your workspace', exact: true })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Pricing', exact: true }).click()
  await expect(page).toHaveURL(/\/pricing$/)
  await expect(nav.getByRole('link', { name: 'Pricing', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Browser editor', exact: true })).toBeVisible()
  await page.getByText('Does a prepaid pass renew automatically?', { exact: true }).click()
  await expect(page.getByText('No. Prepaid passes are one-time payments', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'View membership options', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?next=%2Fmembership$/)
  await page.goto('/pricing')
  await page.getByRole('link', { name: 'View API credits & rates', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?next=%2Fapi-keys$/)
  await page.goto('/mcp')
  await expect(nav.getByRole('button', { name: 'Developers', exact: true })).toHaveClass(/active/)
  await nav.getByRole('button', { name: 'Developers', exact: true }).click()
  await expect(nav.locator('a[href="/mcp"]')).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
  await expect(page.locator('.install-command')).toContainText('npx @machinal/mcp setup --client codex')
  await expect(page.getByRole('link', { name: 'Read the setup guide' })).toHaveAttribute('href', /docs\/MCP.md#guided-setup-with-npx$/)
})

test('desktop disclosures support keyboard, outside dismissal and real fragment destinations', async ({ page }) => {
  await page.goto('/pricing')
  const product = page.getByRole('button', { name: 'Product', exact: true })
  await product.focus()
  await page.keyboard.press('Enter')
  await expect(product).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('link', { name: /Svelte scenes Animated/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(product).toBeFocused()
  await expect(product).toHaveAttribute('aria-expanded', 'false')
  await product.click()
  await page.getByRole('button', { name: 'Resources', exact: true }).click()
  await expect(product).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('link', { name: /About A closer/ })).toHaveAttribute('href', '/about')
  await page.getByRole('heading', { name: /Pricing\./ }).click()
  await expect(page.getByRole('button', { name: 'Resources', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await product.click()
  await page.getByRole('link', { name: /Features Timeline/ }).click()
  await expect(page).toHaveURL(/\/#features$/)
  await expect(page.getByRole('heading', { name: 'The tools are real. The possibilities are yours.' })).toBeInViewport()
  await product.click()
  await page.getByRole('link', { name: /Svelte scenes Animated/ }).click()
  await expect(page.locator('#scenes')).toBeInViewport()
  await expect(page).toHaveURL(/\/#scenes$/)
  await page.goto('/pricing')
  await page.goto('/#scenes')
  await expect(page.locator('#scenes')).toBeInViewport()
})

test('workspace destinations live in the main navbar Account menu and editor stays separate', async ({ page }) => {
  await mockWorkspaceAccount(page)
  for (const route of ['/', '/pricing', '/mcp', '/about']) {
    await page.goto(route)
    const header = page.locator('.product-nav')
    await expect(page.getByRole('navigation', { name: 'Your workspace', exact: true })).toHaveCount(0)
    expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(80)
    const trigger = header.getByRole('button', { name: 'Account settings', exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const account = header.getByRole('region', { name: 'Account and preferences', exact: true })
    for (const [, href] of workspace) await expect(account.locator(`a[href="${href}"]`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
  await page.route('**/list', route => route.fulfill({ status: 200, body: '' }))
  await page.goto('/editor')
  await expect(page.locator('.product-nav')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Your workspace', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const editorSettings = page.getByRole('region', { name: 'Account and preferences', exact: true })
  await expect(editorSettings).toBeVisible()
  await expect(page.locator('.session-menu.command')).not.toHaveClass(/navigation/)
  expect((await editorSettings.boundingBox())!.width).toBe(288)
})

test('main Account menu navigates between account pages and marks the active destination without subtabs', async ({ page }) => {
  await mockWorkspaceAccount(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => localStorage.setItem('scrub-theme', 'light'))
  await page.route('**/projects', route => route.fulfill({ json: [] }))
  await page.route('**/billing/orders', route => route.fulfill({ json: [] }))
  await page.route('**/api-keys', route => route.request().resourceType() === 'document' ? route.fallback() : route.fulfill({ json: [] }))
  await page.goto('/pricing')
  const header = page.locator('.product-nav')
  const trigger = header.getByRole('button', { name: 'Account settings', exact: true })
  const account = header.getByRole('region', { name: 'Account and preferences', exact: true })
  for (const [, href] of workspace) {
    await trigger.click()
    await account.locator(`a[href="${href}"]`).click()
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toHaveClass(/active/)
    await expect(page.getByRole('navigation', { name: 'Account pages', exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Your workspace', exact: true })).toHaveCount(0)
    await trigger.click()
    await expect(account.locator('a[aria-current="page"]')).toHaveCount(1)
    await expect(account.locator(`a[href="${href}"]`)).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Escape')
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`navigation and public pages reflow in ${theme} with guest and member access`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
    for (const width of [1440, 1280, 1101, 1024, 768, 680, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/pricing')
      await expect(page.getByRole('heading', { name: /Pricing\./ })).toBeVisible()
      await expectWithinViewport(page)
      if (width === 1440 || width === 390) await capture(page, `base-${width}-${theme}`)
      if (width <= 1024) {
        const trigger = page.getByRole('button', { name: 'Open navigation', exact: true })
        await trigger.click()
        const mobile = page.getByRole('navigation', { name: 'Mobile navigation', exact: true })
        await expect(mobile).toBeVisible()
        await expect(mobile.getByRole('link', { name: 'Pricing', exact: true })).toBeVisible()
        if (width === 390) await capture(page, `menu-guest-${width}-${theme}`)
        await mobile.locator('summary').filter({ hasText: /^Product$/ }).click()
        await expect(mobile.getByRole('link', { name: 'Toolkit', exact: true })).toBeVisible()
        await mobile.locator('summary').filter({ hasText: /^Developers$/ }).click()
        await expect(mobile.getByRole('link', { name: 'Toolkit', exact: true })).toBeHidden()
        await expect(mobile.getByRole('link', { name: 'MCP', exact: true })).toBeVisible()
        await expect(mobile.getByRole('link', { name: 'Open editor', exact: true })).toBeVisible()
        await expectWithinViewport(page)
        if (width === 390) await capture(page, `mobile-developers-${width}-${theme}`)
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/mcp')
    await page.setViewportSize({ width: 390, height: 900 })
    await expectWithinViewport(page)
    await mockWorkspaceAccount(page)
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    const mobile = page.getByRole('navigation', { name: 'Mobile navigation', exact: true })
    await expect(mobile.getByRole('link', { name: 'Open editor', exact: true })).toBeVisible()
    for (const [, href] of workspace) await expect(mobile.locator(`a[href="${href}"]`)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const width of [1440, 1280, 1101, 1024, 768, 680, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      const trigger = page.getByRole('button', { name: 'Account settings', exact: true })
      await trigger.click()
      const account = page.getByRole('region', { name: 'Account and preferences', exact: true })
      for (const [, href] of workspace) await expect(account.locator(`a[href="${href}"]`)).toBeInViewport()
      const linksLeadBalance = await account.evaluate(panel => {
        const link = panel.querySelector('a[href="/jobs"]')!
        const balance = panel.querySelector('.account-balance')!
        return Boolean(link.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING)
      })
      expect(linksLeadBalance).toBe(true)
      await expectWithinViewport(page)
      if (width === 1440 || width === 390) await capture(page, `account-menu-${width}-${theme}`)
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Product', exact: true }).click()
    await capture(page, `product-dropdown-1440-${theme}`)
    await page.getByRole('button', { name: 'Developers', exact: true }).click()
    await capture(page, `developers-dropdown-1440-${theme}`)
    expect(errors).toEqual([])
  })
}

test('mobile selection closes the menu and short viewports retain all links', async ({ page }) => {
  await mockWorkspaceAccount(page)
  await page.setViewportSize({ width: 390, height: 480 })
  await page.goto('/pricing')
  await page.getByRole('button', { name: 'Account settings', exact: true }).click()
  const account = page.getByRole('region', { name: 'Account and preferences', exact: true })
  await account.locator('a[href="/api-keys"]').scrollIntoViewIfNeeded()
  await expect(account.locator('a[href="/api-keys"]')).toBeInViewport()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  const mobile = page.getByRole('navigation', { name: 'Mobile navigation', exact: true })
  await mobile.locator('summary').filter({ hasText: /^Developers$/ }).click()
  await expectWithinViewport(page)
  await mobile.getByRole('link', { name: 'MCP', exact: true }).click()
  await expect(page).toHaveURL(/\/mcp$/)
  await expect(mobile).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(mobile).toBeHidden()
})
