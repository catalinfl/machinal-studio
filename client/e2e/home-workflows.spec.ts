import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`offers browser, local, API and MCP creation at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(value => localStorage.setItem('scrub-theme', value), theme)
      await page.goto('/')
      await page.evaluate(() => document.fonts.ready)

      const section = page.getByRole('region', { name: 'Choose how you create.' })
      await expect(section.locator('article')).toHaveCount(4)
      await expect(section.getByRole('link', { name: 'Open editor' })).toHaveAttribute('href', '/editor')
      await expect(section.getByRole('link', { name: 'Explore local options' })).toHaveAttribute('href', '/docs#local-headless')
      await expect(section.getByRole('link', { name: 'Explore the API' })).toHaveAttribute('href', '/api')
      await expect(section.getByRole('link', { name: 'Explore MCP' })).toHaveAttribute('href', '/mcp')
      await expect(page.getByText('From an idea')).toHaveCount(0)

      await section.getByRole('link', { name: 'Open editor' }).focus()
      await expect(section.getByRole('link', { name: 'Open editor' })).toBeFocused()
      expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      for (const article of await section.locator('article').all()) {
        const box = (await article.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }

      if (width === 390) await page.setViewportSize({ width, height: 1400 })
      await section.evaluate(node => node.scrollIntoView({ block: 'start' }))
      const output = resolve('..', '.impeccable', 'review', 'home-workflows')
      await mkdir(output, { recursive: true })
      await section.screenshot({ path: `${output}/workflows-${width}-${theme}.png` })

      await section.getByRole('link', { name: 'Explore local options' }).click()
      await expect(page).toHaveURL(/\/docs#local-headless$/)
      await expect(page.getByRole('heading', { name: 'Local Docker and edit CLI' })).toBeInViewport()
    })
  }
}
