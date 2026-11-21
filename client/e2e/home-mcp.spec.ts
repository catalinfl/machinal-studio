import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test.use({ reducedMotion: 'reduce' })

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`introduces MCP without running work at ${width}px in ${theme}`, async ({ page }) => {
      const writes: string[] = []
      page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()) })
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(value => localStorage.setItem('scrub-theme', value), theme)
      await page.goto('/')
      await page.getByRole('button', { name: 'Got it', exact: true }).click()
      await page.evaluate(() => document.fonts.ready)

      const hero = page.locator('.hero')
      await expect(hero.locator('.hero-description')).toContainText('MCP')
      const output = resolve('..', '.impeccable', 'review', 'home-mcp')
      await mkdir(output, { recursive: true })
      await page.screenshot({ path: `${output}/hero-${width}-${theme}.png` })

      const workflows = page.getByRole('region', { name: 'Choose how you create.' })
      await expect(workflows.locator('article')).toHaveCount(4)
      await expect(workflows.getByRole('link', { name: 'Explore MCP' })).toHaveAttribute('href', '/mcp')

      const conveyor = page.locator('.video-conveyor')
      await conveyor.evaluate(node => node.setAttribute('data-continuity-check', 'retained'))
      await hero.getByRole('link', { name: 'MCP agents' }).click()
      await expect(page).toHaveURL(/\/#mcp$/)
      const mcp = page.getByRole('region', { name: 'Direct your video. Through MCP.' })
      await expect(mcp.getByRole('heading', { level: 2 })).toBeInViewport()
      await expect(conveyor).toHaveAttribute('data-continuity-check', 'retained')
      await expect(mcp).toContainText('MCP (Model Context Protocol)')
      await expect(mcp).toContainText('Approve media access separately from paid generation and rendering.')
      await expect(mcp.getByRole('link', { name: 'Connect your coding agent' })).toHaveAttribute('href', '/mcp')
      await expect(mcp.locator('.installer')).toHaveCount(0)
      expect(await page.locator('main.home').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      expect(await mcp.evaluate(node => [...node.querySelectorAll('*')].every(child => {
        const bounds = child.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth + 1
      }))).toBe(true)
      if (width === 390) await page.setViewportSize({ width, height: 1500 })
      await mcp.screenshot({ path: `${output}/mcp-${width}-${theme}.png` })
      await workflows.screenshot({ path: `${output}/workflows-${width}-${theme}.png` })
      await page.setViewportSize({ width, height: 900 })

      const connect = mcp.getByRole('link', { name: 'Connect your coding agent' })
      await connect.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(connect).toBeFocused()
      expect(await connect.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid')
      expect(writes).toEqual([])
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/mcp$/)
      await expect(page.getByRole('region', { name: 'MCP installer' })).toBeVisible()

      await page.goto('/#mcp')
      await expect(page.getByRole('heading', { name: 'Direct your video. Through MCP.' })).toBeInViewport()
    })
  }
}
