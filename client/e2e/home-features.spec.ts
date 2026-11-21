import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`promotes the catalog and Svelte scenes at ${width}px in ${theme}`, async ({ page }) => {
      const errors: string[] = []
      const writes: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()) })
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(value => localStorage.setItem('scrub-theme', value), theme)
      await page.goto('/')
      await page.evaluate(() => document.fonts.ready)

      const features = page.locator('#features')
      for (const name of ['60 reusable styles', '84 effects', '76 transitions']) {
        await expect(features.getByRole('heading', { name })).toBeAttached()
      }
      expect(await features.locator('.catalog-count').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(72)
      const scenes = page.getByRole('region', { name: 'Create scenes. Built with Svelte.' })
      await expect(scenes.getByRole('link', { name: 'Create a scene' })).toHaveAttribute('href', '/editor?ai=scenes')
      await page.getByRole('link', { name: 'Svelte scenes' }).click()
      await expect(page).toHaveURL(/\/#scenes$/)
      await expect(scenes.getByRole('heading', { level: 2 })).toBeInViewport()

      const time = scenes.getByRole('slider', { name: 'Svelte example time' })
      await time.focus()
      await page.keyboard.press('Home')
      await expect(scenes.locator('.scene-copy')).toHaveAttribute('opacity', '0')
      await page.keyboard.press('End')
      await expect(scenes.locator('.scene-copy')).toHaveAttribute('opacity', '1')
      await expect(time).toHaveValue('4')
      await time.evaluate(node => {
        (node as HTMLInputElement).value = '2.4'
        node.dispatchEvent(new Event('input', { bubbles: true }))
      })

      for (const surface of [features, scenes]) {
        expect(await surface.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
        for (const element of await surface.locator('h2, h3, p, button, input, pre').all()) {
          const box = await element.boundingBox()
          if (!box) continue
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
        }
      }

      const output = resolve('..', '.impeccable', 'review', 'home-features')
      await mkdir(output, { recursive: true })
      await page.setViewportSize({ width, height: 2200 })
      for (const [name, surface] of [['catalog', features], ['scenes', scenes]] as const) {
        await surface.evaluate(node => node.scrollIntoView({ block: 'start' }))
        await surface.screenshot({ path: `${output}/${name}-${width}-${theme}.png` })
      }

      await scenes.getByRole('button', { name: 'Transparent overlay' }).click()
      await expect(scenes.locator('.example-stage')).toHaveAttribute('data-mode', 'overlay')
      await expect(scenes.getByRole('button', { name: 'Transparent overlay' })).toHaveAttribute('aria-pressed', 'true')
      await scenes.getByText('See the Svelte idea').click()
      await expect(scenes.locator('pre')).toBeVisible()
      if ((width === 1440 && theme === 'light') || (width === 390 && theme === 'dark')) {
        await scenes.locator('.svelte-example').screenshot({ path: `${output}/overlay-${width}-${theme}.png` })
      }
      expect(writes).toEqual([])
      expect(errors).toEqual([])
      await page.getByRole('link', { name: /AI credits included/ }).click()
      await expect(page.locator('#ai')).toBeInViewport()
      await expect(scenes).toBeAttached()
      await scenes.getByRole('link', { name: 'How scenes work' }).click()
      await expect(page).toHaveURL(/\/docs#ai-guide$/)
      await expect(page.getByRole('heading', { name: 'AI tools, scenes and overlays' })).toBeInViewport()
    })
  }
}
