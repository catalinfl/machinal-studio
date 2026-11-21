import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { storageAcknowledgment, STORAGE_NOTICE_KEY } from '../src/lib/browser-storage'

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_NOTICE_KEY, value: storageAcknowledgment() })
  await page.route('**/list', route => route.fulfill({ json: [] }))
})

test('browser icons use the machinal M source, with valid PNG and multi-resolution ICO fallbacks', async ({ page, request }) => {
  const requested: string[] = []
  page.on('request', request => requested.push(request.url()))
  await page.goto('/login')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/machinal-icon.svg')
  await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveAttribute('href', '/machinal-favicon-32.png')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/machinal-apple-touch-icon.png')
  const svgResponse = await request.get('/machinal-icon.svg')
  expect(svgResponse.ok()).toBe(true)
  expect(svgResponse.headers()['content-type']).toContain('image/svg+xml')
  expect(await svgResponse.text()).toContain('<title>machinal</title>')
  for (const [file, size] of [['machinal-favicon-32.png', 32], ['machinal-apple-touch-icon.png', 180]] as const) {
    const response = await request.get(`/${file}`)
    expect(response.ok()).toBe(true)
    const bytes = await response.body()
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(bytes.readUInt32BE(16)).toBe(size)
    expect(bytes.readUInt32BE(20)).toBe(size)
    expect(bytes.includes(Buffer.from('source: machinal-icon.svg'))).toBe(true)
  }
  const icoResponse = await request.get('/machinal-favicon.ico')
  expect(icoResponse.ok()).toBe(true)
  const ico = await icoResponse.body()
  expect(ico.readUInt16LE(2)).toBe(1)
  expect(ico.readUInt16LE(4)).toBe(3)
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16
    expect(ico[entry]).toBe(size)
    expect(ico[entry + 1]).toBe(size)
    const offset = ico.readUInt32LE(entry + 12)
    expect(ico.readUInt32BE(offset + 16)).toBe(size)
  }
  expect(requested.some(url => url.includes('/vite.svg'))).toBe(false)
  await expect(page.locator('link[href*="vite"]')).toHaveCount(0)
})

for (const destination of ['about', 'editor']) {
  test(`the same M mark stays visible at ${destination} in desktop and compact themes`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/${destination}`)
    const brand = page.locator(destination === 'editor' ? '.topbar .brand' : '.product-brand')
    const mark = brand.locator('img')
    await expect(brand).toHaveAccessibleName('machinal home')
    await expect(brand).toHaveAttribute('href', '/')
    await expect(mark).toHaveAttribute('src', '/machinal-icon.svg')
    await expect(mark).toHaveAttribute('alt', '')
    await expect(brand.locator('svg, .dot')).toHaveCount(0)
    await expect(mark).toBeVisible()
    expect(await mark.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true)
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
        await expect(mark).toBeInViewport({ ratio: 1 })
        if (destination === 'editor') await expect(brand.locator('.brand-name')).toBeInViewport({ ratio: 1 })
        await expect(mark).toHaveCSS('width', `${destination === 'editor' ? (width > 1024 ? 24 : 20) : (width > 600 ? 36 : 32)}px`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`brand-${destination}-${width}-${theme}.png`), animations: 'disabled' })
        if (destination === 'about' && width !== 360) {
          const footer = page.locator('.site-footer')
          await footer.scrollIntoViewIfNeeded()
          await expect(footer.locator('.footer-brand img')).toHaveAttribute('src', '/machinal-icon.svg')
          await expect(footer.locator('.footer-brand svg')).toHaveCount(0)
          await footer.screenshot({ path: testInfo.outputPath(`brand-footer-${width}-${theme}.png`), animations: 'disabled' })
          await page.locator('main.product-page').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }))
        }
      }
    }
    expect(errors).toEqual([])
  })
}

test('M artwork remains legible at icon sizes against both theme backgrounds', async ({ page }, testInfo) => {
  const svg = await readFile(new URL('../public/machinal-icon.svg', import.meta.url), 'utf8')
  await page.setViewportSize({ width: 760, height: 360 })
  await page.setContent(`<html><body style="margin:0;font:14px sans-serif">${['#f3f2ee', '#1d1b24'].map(background => `<section style="height:180px;display:flex;align-items:center;justify-content:space-around;background:${background}">${[16, 24, 32, 48, 96, 144].map(size => svg.replace('<svg ', `<svg width="${size}" height="${size}" `)).join('')}</section>`).join('')}</body></html>`)
  await page.screenshot({ path: testInfo.outputPath('brand-icon-sizes.png'), animations: 'disabled' })
})
