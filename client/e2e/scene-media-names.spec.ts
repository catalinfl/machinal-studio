import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const user = { id: 'scenenames', name: 'Scene Creator', email: 'scene-names@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
const fixture = JSON.parse(readFileSync(resolve('../services/scene-renderer/out/live-scene-fixture.json'), 'utf8'))
const file = `ai_scene_${'a'.repeat(32)}_01.scene.json`
const generatedFile = `ai_scene_${'b'.repeat(32)}_02.scene.json`

for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  test(`concise scene names survive reload at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    const now = new Date().toISOString()
    const project: any = { id: 'scene-names', name: 'Scene names', sessionId: 'p_scene_names', version: 1,
      createdAt: now, updatedAt: now, state: null }
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(({ user, token, theme }) => {
      if (window !== window.top) return
      localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
      localStorage.setItem('direction-active-project:scenenames', 'scene-names')
      localStorage.setItem('scrub-theme', theme)
      localStorage.setItem('scrub-media-view', JSON.stringify({ view: 'grid' }))
    }, { user, token, theme })
    await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
    await page.route('**/sessions**', route => route.fulfill({ json: {} }))
    await page.route(url => url.pathname.startsWith('/projects'), route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: new URL(route.request().url()).pathname === '/projects' ? [project] : project })
      const input = route.request().postDataJSON()
      if (input.version !== project.version) return route.fulfill({ status: 409, body: 'conflict' })
      Object.assign(project, input, { version: project.version + 1 })
      const { state, ...summary } = project
      return route.fulfill({ json: summary })
    })
    await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [{ name: file, size: 1000, mediaKind: 'video' }] }))
    await page.route(url => url.pathname === '/download', route => route.fulfill({ json: { ...fixture, title: 'Rădăcini în creștere' } }))
    await page.goto('/editor')
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    const bin = page.locator('#media-bin-panel')
    await expect(bin.getByRole('listitem', { name: 'Clip Rădăcini în creștere', exact: true })).toBeVisible()
    await page.evaluate(({ fixture, generatedFile }) => {
      return import('/src/lib/scene-generation.ts').then(({ registerGeneratedScene }) => registerGeneratedScene({
        id: 'generated', title: 'City at dusk', brief: 'The city lights turn on.', start: 0, end: 1,
        component: fixture.component, source: fixture, manifest: null,
        asset: { id: 'generated', file: generatedFile, version: `sha256:${'c'.repeat(64)}`, kind: 'video',
          duration: 1, width: fixture.config.width, height: fixture.config.height },
      }))
    }, { fixture, generatedFile })
    await expect(bin.getByRole('listitem', { name: 'Clip City at dusk', exact: true })).toBeVisible()
    expect(await bin.locator('.name').allTextContents()).toEqual(['Rădăcini în creștere', 'City at dusk'])
    await page.screenshot({ path: testInfo.outputPath(`scene-names-${width}-${theme}.png`), animations: 'disabled' })
    await expect.poll(() => project.state?.media.map((source: any) => source.displayName)).toEqual(['Rădăcini în creștere', 'City at dusk'])
    expect(project.state.media.map((source: any) => source.name)).toEqual([file, generatedFile])
    await bin.getByRole('button', { name: 'Rename Rădăcini în creștere', exact: true }).click()
    await page.getByRole('textbox', { name: `Project name for ${file}` }).fill('Pădurea mea')
    await page.getByRole('button', { name: 'Save media name', exact: true }).click()
    await expect.poll(() => project.state?.media[0]?.displayName).toBe('Pădurea mea')
    await page.reload()
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(bin.getByRole('listitem', { name: 'Clip Pădurea mea', exact: true })).toBeVisible()
    await expect(bin.getByRole('listitem', { name: 'Clip City at dusk', exact: true })).toBeVisible()
    expect(project.state.media[0].name).toBe(file)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
