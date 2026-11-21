import { expect, test } from '@playwright/test'

for (const { width, hasTouch } of [{ width: 1440, hasTouch: false }, { width: 390, hasTouch: true }, { width: 320, hasTouch: true }]) {
  test.describe(`preview controls at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch })

    for (const theme of ['light', 'dark']) {
      test(`framing is centered and aligned in ${theme} mode`, async ({ page }, testInfo) => {
        await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
        await page.route(
          url => ['/list', '/sessions', '/projects'].some(path => url.pathname.startsWith(path)),
          route => route.fulfill({ json: [] }),
        )
        await page.goto('/editor')

        const framing = page.getByRole('combobox', { name: 'Video framing' })
        const frame = page.getByRole('button', { name: 'Toggle horizontal or vertical preview' })
        const play = page.getByRole('button', { name: 'Play preview', exact: true })
        await expect(framing).toBeVisible()
        await page.evaluate(() => document.fonts.ready)

        for (const fit of ['contain', 'cover']) {
          await framing.selectOption(fit)
          const bounds = await framing.boundingBox()
          const frameBounds = await frame.boundingBox()
          const playBounds = await play.boundingBox()
          expect(bounds).not.toBeNull()
          expect(frameBounds).not.toBeNull()
          expect(playBounds).not.toBeNull()
          expect(bounds!.height).toBe(hasTouch ? 44 : 32)
          expect(bounds!.height).toBe(frameBounds!.height)
          expect(bounds!.height).toBe(playBounds!.height)
          expect(Math.abs(bounds!.y - frameBounds!.y)).toBeLessThanOrEqual(0.5)
          expect(Math.abs(bounds!.y - playBounds!.y)).toBeLessThanOrEqual(0.5)
          expect(await framing.evaluate(element => getComputedStyle(element).alignItems)).toBe('center')
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        }

        await framing.press('Space')
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('Enter')
        await expect(framing).toHaveValue('contain')
        await framing.press('Space')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await expect(framing).toHaveValue('cover')
        await expect(framing).toBeFocused()
        await expect(play).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

        await framing.evaluate(element => element.blur())
        await page.locator('.controls-live').screenshot({ path: testInfo.outputPath('framing-alignment.png') })
      })
    }
  })
}
