import { expect, test, type Locator } from '@playwright/test'

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [red, green, blue] = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
      const channel = Number(value) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return red * 0.2126 + green * 0.7152 + blue * 0.0722
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

async function colors(target: Locator) {
  return target.evaluate(element => {
    const style = getComputedStyle(element)
    return { foreground: style.color, background: style.backgroundColor }
  })
}

for (const width of [1440, 1100, 390]) {
  for (const theme of ['dark', 'light']) {
    test(`quiet editor ribbon at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
      await page.route('**/list*', route => route.fulfill({ json: [] }))
      await page.goto('/editor')
      await page.getByRole('button', { name: 'Got it', exact: true }).click()

      const ribbon = page.locator('.editor-tool-ribbon')
      const tools = page.getByRole('navigation', { name: width > 1024 ? 'Editor tools' : 'Editor panels' })
      const media = tools.getByRole('button', { name: 'Media Bin', exact: true })
      const effects = tools.getByRole('button', { name: 'Effects', exact: true })
      const creation = page.getByRole('group', { name: 'Creation tools' })
      const recipe = creation.getByRole('button', { name: 'Recipe', exact: true })

      await expect(ribbon).toBeVisible()
      const ribbonColors = await colors(ribbon)
      expect(ribbonColors.background).toBe((await colors(page.locator('.tool-deck'))).background)
      expect(contrast((await colors(effects)).foreground, ribbonColors.background)).toBeGreaterThanOrEqual(4.5)

      if (width <= 1279) await media.click()
      await expect(media).toHaveClass(/active/)
      const selected = await colors(media)
      expect(selected.background).not.toBe(ribbonColors.background)
      expect(contrast(selected.foreground, selected.background)).toBeGreaterThanOrEqual(4.5)
      const indicator = await media.evaluate(element => {
        const style = getComputedStyle(element, '::after')
        return { height: style.height, color: style.backgroundColor, content: style.content }
      })
      expect(indicator.height).toBe('2px')
      expect(indicator.color).toBe(selected.foreground)
      expect(indicator.content).not.toBe('none')
      await media.evaluate(element => { (element as HTMLButtonElement).disabled = true })
      await media.hover({ force: true })
      expect(await colors(media)).toEqual(selected)
      await media.evaluate(element => { (element as HTMLButtonElement).disabled = false })
      await page.mouse.move(width - 1, 899)
      await page.screenshot({ path: testInfo.outputPath('media-selected.png'), animations: 'disabled' })

      await effects.hover()
      const hovered = await colors(effects)
      expect(hovered.background).not.toBe(ribbonColors.background)
      expect(hovered.background).not.toBe(selected.background)
      expect(contrast(hovered.foreground, hovered.background)).toBeGreaterThanOrEqual(4.5)
      await effects.click()
      await expect(effects).toHaveClass(/active/)
      await expect(media).not.toHaveClass(/active/)
      expect(await colors(effects)).toEqual(selected)

      await effects.press('Tab')
      const focused = tools.getByRole('button', { name: 'Styles', exact: true })
      await expect(focused).toBeFocused()
      await expect(focused).toHaveCSS('outline-style', 'solid')
      await expect(focused).toHaveCSS('outline-width', '2px')
      const focusColor = await focused.evaluate(element => getComputedStyle(element).outlineColor)
      expect(contrast(focusColor, ribbonColors.background)).toBeGreaterThanOrEqual(3)
      await page.screenshot({ path: testInfo.outputPath('effects-and-focus.png'), animations: 'disabled' })

      await recipe.hover()
      expect(await colors(recipe)).toEqual(hovered)
      await recipe.click()
      const dialog = page.getByRole('dialog', { name: 'Video recipe', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Close video recipe', exact: true }).click()
      await expect(recipe).toBeFocused()
      const scenes = creation.getByRole('button', { name: 'Generate scenes', exact: true })
      await scenes.hover()
      expect(await colors(scenes)).toEqual(hovered)

      // Exercise the existing busy appearance without starting a media operation.
      await media.evaluate(element => { (element as HTMLButtonElement).disabled = true })
      await media.hover({ force: true })
      await expect(media).toBeDisabled()
      await expect(media).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      expect(Number(await media.evaluate(element => getComputedStyle(element).opacity))).toBeLessThan(1)
      await media.evaluate(element => { (element as HTMLButtonElement).disabled = false })

      const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
      expect(bounds.width).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeLessThanOrEqual(900)
      expect(errors).toEqual([])
    })
  }
}
