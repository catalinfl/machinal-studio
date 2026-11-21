import { expect, test } from '@playwright/test'
import { mockPaidAuth } from './helpers/paid-auth'

for (const width of [1440, 390]) {
  test(`hosted editor tools explain shared credit charges before any paid request at ${width}px`, async ({ page }) => {
    await mockPaidAuth(page)
    await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
    await page.route('**/sessions**', route => route.fulfill({ json: { id: 'u_paiduser1234' } }))
    const project = { id: 'default', name: 'Main project', sessionId: 'u_paiduser1234', version: 0, createdAt: '', updatedAt: '' }
    await page.route('**/projects', route => route.fulfill({ json: [project] }))
    await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
    await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
    let generationRequests = 0
    page.on('request', request => {
      if (request.method() === 'POST' && /\/ai\//.test(request.url())) generationRequests++
    })
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/editor')
    await page.getByRole('button', { name: 'Got it', exact: true }).click()
    const tools = page.getByRole('navigation', { name: width > 1024 ? 'Editor tools' : 'Editor panels' })
    for (const [button, dialog, close] of [
      [width > 1024 ? 'Speech' : 'Text to Speech', '#text-to-speech-panel', 'Close Text to Speech'],
      ['Image', '#image-panel', 'Close Image'],
    ]) {
      await tools.getByRole('button', { name: button, exact: true }).click()
      await expect(page.locator(dialog).getByText('Hosted AI and server rendering use your shared credits.', { exact: false })).toBeVisible()
      await expect(page.locator(dialog).getByRole('link', { name: 'Balance & rates' })).toHaveAttribute('href', '/api-keys#credits')
      await page.locator(dialog).getByRole('button', { name: close, exact: true }).click()
    }
    await page.getByRole('button', { name: 'Generate scenes', exact: true }).click()
    const scenes = page.getByRole('dialog', { name: 'Generate scenes', exact: true })
    await expect(scenes.getByRole('link', { name: 'Balance & rates' })).toBeVisible()
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      await page.screenshot({ path: `../.impeccable/review/billing-editor-${width}-${theme}.png`, animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    await scenes.getByRole('button', { name: 'Close Generate scenes', exact: true }).click()
    await page.getByRole('button', { name: 'Render', exact: true }).click()
    const render = page.getByRole('dialog', { name: 'Render project' })
    await expect(render.getByText('Hosted AI and server rendering use your shared credits.', { exact: false })).toBeVisible()
    await expect(render.getByRole('button', { name: /Local/ })).toContainText('no credits')
    expect(generationRequests).toBe(0)
  })
}
