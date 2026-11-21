import { expect, test, type Page } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

const notice = (page: Page) => page.getByRole('complementary', { name: 'Cookies & local storage', exact: true })

async function mockExternalServices(page: Page) {
  await page.route('**/api/collections/**', route => route.fulfill({ status: 401, json: { message: 'Not authenticated' } }))
  await page.route('**/list', route => route.fulfill({ body: '' }))
}

async function assertNoOverflow(page: Page) {
  const overflowing = await page.evaluate(() => [...document.querySelectorAll('main, article, .storage-notice, .site-footer')]
    .filter(element => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > innerWidth + 1)
    .map(element => element.className))
  expect(overflowing).toEqual([])
}

async function capture(page: Page, name: string) {
  if (process.env.LEGAL_CAPTURE !== '1') return
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `../.impeccable/review/legal-${name}.png`, animations: 'disabled' })
  if (!/^(about|privacy|terms|cookies)-\d/.test(name)) return
  const styles = await page.evaluate(() => {
    const elements = [document.documentElement, document.body, document.getElementById('app')!, document.querySelector('main.home')!] as HTMLElement[]
    const styles = elements.map(element => element.getAttribute('style'))
    const main = elements[3]
    main.scrollTop = 0
    elements[2].style.height = `${main.scrollHeight + (document.querySelector('.shared-nav')?.clientHeight ?? 0)}px`
    for (const element of elements) element.style.overflow = 'visible'
    elements[0].style.height = 'auto'
    elements[1].style.height = 'auto'
    window.scrollTo(0, 0)
    return styles
  })
  await page.screenshot({ path: `../.impeccable/review/legal-${name}-full.png`, fullPage: true, animations: 'disabled' })
  await page.evaluate(styles => {
    const elements = [document.documentElement, document.body, document.getElementById('app')!, document.querySelector('main.home')!]
    elements.forEach((element, index) => styles[index] === null ? element.removeAttribute('style') : element.setAttribute('style', styles[index]!))
  }, styles)
}

test.beforeEach(async ({ page }) => {
  await mockExternalServices(page)
})

test('notice is informative, persists dismissal and reopens through footer and preferences', async ({ page }) => {
  await page.goto('/about')
  await expect(notice(page)).toBeVisible()
  await expect(notice(page).getByRole('button', { name: /accept all|reject/i })).toHaveCount(0)
  await notice(page).getByRole('button', { name: 'View details' }).click()
  await expect(notice(page)).toContainText('Closing this notice is not consent to tracking')
  await expect(notice(page).getByRole('heading')).toBeFocused()
  await notice(page).getByRole('button', { name: 'Close notice' }).click()
  await expect(notice(page)).toHaveCount(0)
  await page.reload()
  await expect(notice(page)).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Legal and privacy', exact: true }).getByRole('button', { name: 'Cookies & storage' }).click()
  await expect(notice(page)).toBeVisible()
  await notice(page).getByRole('button', { name: 'Close notice' }).click()
  await page.getByRole('button', { name: 'Preferences', exact: true }).click()
  await page.getByRole('region', { name: 'Account and preferences', exact: true }).getByRole('button', { name: 'Cookies & storage' }).click()
  await expect(notice(page)).toBeVisible()
})

test('legal routes have real contents anchors, explicit draft state and no tracking scripts', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  for (const [route, title] of [['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service'], ['/cookies', 'Cookies & storage']]) {
    await page.goto(route)
    if (await notice(page).count()) await notice(page).getByRole('button', { name: 'Got it' }).click()
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible()
    await expect(page.getByText('Draft for review', { exact: true })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    const links = page.getByRole('navigation', { name: 'On this page', exact: true }).locator('a[href^="#"]')
    for (const link of await links.all()) {
      const target = await link.getAttribute('href')
      expect(await page.locator(target!).count()).toBe(1)
    }
    const lastTarget = (await links.last().getAttribute('href'))!
    await links.last().click()
    await expect(page.locator(lastTarget)).toBeInViewport()
    await expect(page.locator('h1')).toHaveText(title)
  }
  expect(requests.filter(url => /google-analytics|googletagmanager|facebook\.net|doubleclick|hotjar|posthog|plausible/i.test(url))).toEqual([])
  expect(await page.evaluate(() => document.cookie)).toBe('')
})

test('About explains all three processing workflows and signup has legal links', async ({ page }) => {
  await page.goto('/about')
  await notice(page).getByRole('button', { name: 'Got it' }).click()
  await page.getByRole('button', { name: 'Hosted tools', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Send only what the task needs.' })).toBeVisible()
  await page.getByRole('button', { name: 'API & MCP', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Explore the MCP workflow' })).toHaveAttribute('href', '/mcp')
  await page.goto('/login')
  await expect(page.getByRole('link', { name: 'Terms of Service', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Privacy Policy', exact: true })).toBeVisible()
})

test('notice remains accessible in editor preferences without introducing a page footer', async ({ page }) => {
  await page.goto('/editor')
  await notice(page).getByRole('button', { name: 'Got it' }).click()
  await expect(page.locator('.site-footer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Account and preferences', exact: true })
  await expect(settings.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  await settings.getByRole('button', { name: 'Cookies & storage' }).click()
  await expect(notice(page)).toBeVisible()
})

for (const width of [1440, 390]) {
  test(`legal contents transfer keyboard focus into the article at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => localStorage.setItem('scrub-theme', 'light'))
    await page.goto('/privacy')
    await notice(page).getByRole('button', { name: 'Got it' }).click()
    const contents = page.getByRole('navigation', { name: 'On this page', exact: true })
    await contents.getByRole('link', { name: 'Your privacy rights', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#rights > h2')).toBeFocused()
    await expect(page.locator('#rights > h2')).toBeInViewport()
    await capture(page, `keyboard-heading-${width}-light`)
    await page.keyboard.press('Tab')
    const articleLink = page.locator('#rights a[href="#responsibility"]')
    await expect(articleLink).toBeFocused()
    await expect(articleLink).toBeInViewport()
    await capture(page, `keyboard-next-${width}-light`)
    await page.keyboard.press('Enter')
    await expect(page.locator('#responsibility > h2')).toBeFocused()
    await expect(page.locator('#responsibility > h2')).toBeInViewport()
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`public information and notice reflow in ${theme}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      if (page.url() !== 'about:blank') await page.evaluate(() => localStorage.removeItem('direction-storage-notice'))
      await page.goto('/about')
      if (await notice(page).count()) {
        await assertNoOverflow(page)
        if (width !== 320) await capture(page, `notice-${width}-${theme}`)
        await notice(page).getByRole('button', { name: 'Got it' }).click()
      }
      for (const route of ['about', 'privacy', 'terms', 'cookies']) {
        await page.goto(`/${route}`)
        await expect(page.locator('h1')).toBeVisible()
        await assertNoOverflow(page)
        if (width !== 320) await capture(page, `${route}-${width}-${theme}`)
        if (route !== 'about') {
          const firstSection = page.locator('article section').first()
          await firstSection.scrollIntoViewIfNeeded()
          if (width !== 320) await capture(page, `${route}-article-${width}-${theme}`)
        }
      }
      await page.getByRole('navigation', { name: 'Legal and privacy', exact: true }).getByRole('button', { name: 'Cookies & storage' }).click()
      await expect(notice(page)).toBeVisible()
      await assertNoOverflow(page)
      if (width !== 320) await capture(page, `storage-details-${width}-${theme}`)
      await notice(page).getByRole('button', { name: 'Close notice' }).click()
    }
    expect(errors).toEqual([])
  })
}
