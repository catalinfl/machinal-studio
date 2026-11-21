import { expect, test, type Page } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

const clients = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
] as const

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => [...document.querySelectorAll('main, .installer, .install-command')]
    .every(element => element.scrollWidth <= element.clientWidth + 1
      && element.getBoundingClientRect().right <= innerWidth + 1))).toBe(true)
}

test('npx commands follow the selected client and copy without credentials', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/mcp')
  await expect(page.getByRole('heading', { name: /Install with npx/ })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Codex', exact: true })).toBeChecked()

  for (const client of clients) {
    await page.getByRole('radio', { name: client.label, exact: true }).check()
    const command = `npx @machinal/mcp setup --client ${client.id}`
    await expect(page.locator('.install-command')).toHaveText(command)
    await expect(page.getByRole('heading', { name: `Install for ${client.label}`, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Copy command', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(`${client.label} command copied.`)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command)
  }

  await expect(page.locator('main input:not([type="radio"])')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('bearer_token_env_var')
  await expect(page.getByText('The installer asks for your API key in the terminal.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Get an API key', exact: true })).toHaveAttribute('href', '/api-keys')
  await expect(page.getByRole('link', { name: 'Explore the API', exact: false })).toHaveAttribute('href', '/api')
})

test('native keyboard selection and clipboard failure have usable recovery', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error('Clipboard denied')) },
  }))
  await page.goto('/mcp')
  await page.getByRole('radio', { name: 'Codex', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Claude Code', exact: true })).toBeChecked()
  await expect(page.locator('.install-command')).toHaveText('npx @machinal/mcp setup --client claude')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'OpenCode', exact: true })).toBeChecked()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Copy command', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Clipboard unavailable. Select the text and copy it.')
})

test('unpublished npm dependency is explicit and source commands use the same client', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/mcp')
  await expect(page.locator('.source-install summary')).toHaveText('npm release pending — install from source')
  await page.locator('.source-install summary').click()

  for (const client of clients) {
    await page.getByRole('radio', { name: client.label, exact: true }).check()
    const source = `npm --prefix packages/mcp-installer ci --ignore-scripts\nnpx --yes ./packages/mcp-installer setup --client ${client.id}`
    await expect(page.locator('.source-install pre')).toHaveText(source)
    await page.getByRole('button', { name: 'Copy source commands', exact: true }).click()
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source)
  }
})

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`MCP installation reflows at ${width}px in ${theme}`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/mcp')
      await expect(page.getByRole('heading', { name: /MCP\./ })).toBeVisible()
      await expectNoOverflow(page)

      if (process.env.MCP_CAPTURE === '1') {
        await page.evaluate(() => document.fonts.ready)
        await page.evaluate(() => {
          for (const element of [document.documentElement, document.body, document.getElementById('app')!, document.querySelector<HTMLElement>('main.product-page')!]) {
            element.style.overflow = 'visible'
            element.style.height = 'auto'
          }
          document.querySelector<HTMLElement>('main.product-page')!.style.flex = 'none'
          window.scrollTo(0, 0)
        })
        await page.screenshot({ path: `../.impeccable/review/mcp-${width}-${theme}.png`, fullPage: true, animations: 'disabled' })
      }

      await page.locator('.source-install summary').click()
      await expectNoOverflow(page)
      if (process.env.MCP_CAPTURE === '1') {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: `../.impeccable/review/mcp-${width}-${theme}-source.png`, fullPage: true, animations: 'disabled' })
      }
      for (const client of clients) {
        await page.getByRole('radio', { name: client.label, exact: true }).check()
        await expectNoOverflow(page)
      }
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 640 })
        await expectNoOverflow(page)
      }
      expect(errors).toEqual([])
    })
  }
}
