import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const user = { id: 'suitecreator123', name: 'Editor Creator', email: 'editor@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`

for (const width of [1440, 390]) {
  test(`editor suite tools, advanced settings and task dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(({ user, token }) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
      localStorage.setItem('scrub-project-session-id', `u_${user.id}`)
      localStorage.setItem('scrub-theme', 'dark')
    }, { user, token })
    await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
    await page.route('**/sessions**', route => route.fulfill({ json: { id: `u_${user.id}` } }))
    await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
    await page.goto('/editor')

    const capture = async (name: string) => {
      await page.screenshot({ path: resolve(`../.impeccable/review/editor-purple-${width}-${name}.png`), fullPage: true, animations: 'disabled' })
      const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
      expect(bounds.width).toBeLessThanOrEqual(width)
      expect(bounds.height).toBeLessThanOrEqual(900)
    }
    const tools = page.getByRole('navigation', { name: width > 1024 ? 'Editor tools' : 'Editor panels' })
    await capture('workspace')
    if (width <= 1024) await tools.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await capture('media')
    for (const label of ['Effects', 'Styles', 'Transitions', 'Text']) {
      await tools.getByRole('button', { name: label, exact: true }).click()
      await capture(label.toLowerCase())
    }
    if (width <= 1024) {
      await page.getByRole('button', { name: 'Close tool panel' }).click()
      await expect(page.locator('.tool-deck')).toBeHidden()
    }
    await tools.getByRole('button', { name: width > 1024 ? 'Speech' : 'Text to Speech', exact: true }).click()
    const speech = page.locator('#text-to-speech-panel')
    await expect(speech).toBeVisible()
    await expect(speech.getByLabel('Script', { exact: true })).toHaveAttribute('rows', '2')
    await expect(speech.getByLabel('Model', { exact: true })).toBeHidden()
    await page.screenshot({ path: resolve(`../.impeccable/review/compact-tools-${width}-speech.png`), fullPage: true, animations: 'disabled' })
    await speech.locator('summary').filter({ hasText: 'Generation model' }).click()
    await expect(speech.getByLabel('Model', { exact: true })).toBeVisible()
    await capture('speech')
    await speech.locator('summary').filter({ hasText: 'Voice ·' }).click()
    await expect(speech.getByRole('button', { name: 'Clone a voice', exact: true })).toBeVisible()
    const speechWidth = (await speech.boundingBox())!.width
    await speech.getByRole('button', { name: 'Close Text to Speech', exact: true }).click()
    await tools.getByRole('button', { name: 'Image', exact: true }).click()
    const image = page.locator('#image-panel')
    await expect(image).toBeVisible()
    expect((await image.boundingBox())!.width).toBeCloseTo(speechWidth, 0)
    await image.getByRole('button', { name: 'Close Image', exact: true }).click()
    await page.getByRole('button', { name: 'Generate scenes', exact: true }).click()
    const scenes = page.getByRole('dialog', { name: 'Generate scenes', exact: true })
    await expect(scenes).toBeVisible()
    await scenes.getByRole('button', { name: 'From a voice' }).click()
    await scenes.getByText('Advanced settings', { exact: true }).click()
    await expect(scenes.getByLabel('Spoken language')).toBeVisible()
    await capture('scenes')
    await scenes.getByRole('button', { name: 'Close Generate scenes', exact: true }).click()
    await page.getByRole('button', { name: 'Render', exact: true }).click()
    await capture('export')
  })
}
