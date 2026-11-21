import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const user = { id: 'projectcreator', name: 'Project Creator', email: 'projects@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`

for (const width of [1440, 390]) {
  test(`projects autosave, restore and separate media at ${width}px`, async ({ page }) => {
    const now = new Date().toISOString()
    const records = new Map<string, any>([['default', { id: 'default', name: 'First film', sessionId: 'u_projectcreator', version: 1, createdAt: now, updatedAt: now, state: null }]])
    let next = 0
    let failRename = true
    const media = new Map<string, string[]>()
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(({ user, token }) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
      localStorage.setItem('scrub-theme', 'dark')
    }, { user, token })
    await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
    await page.route('**/sessions**', route => route.fulfill({ json: {} }))
    await page.route(url => url.pathname.startsWith('/projects'), async route => {
      const request = route.request()
      const id = new URL(request.url()).pathname.split('/')[2]
      if (request.method() === 'GET') return route.fulfill({ json: id ? records.get(id) : [...records.values()].map(({ state, ...summary }) => summary) })
      const body = request.postDataJSON()
      if (body.name === 'Retry title' && failRename) { failRename = false; return route.fulfill({ status: 503, body: 'temporary error' }) }
      if (!id) {
        const project = { id: `p_${++next}`, name: body.name, sessionId: `p_${next}`, version: 1, createdAt: now, updatedAt: now, state: null }
        records.set(project.id, project)
        return route.fulfill({ status: 201, json: project })
      }
      const project = records.get(id)!
      if (body.version !== project.version) return route.fulfill({ status: 409, body: 'conflict' })
      Object.assign(project, body, { version: project.version + 1 })
      const { state, ...summary } = project
      return route.fulfill({ json: summary })
    })
    await page.route(url => url.pathname === '/list', route => {
      const session = new URL(route.request().url()).searchParams.get('session') ?? ''
      return route.fulfill({ json: (media.get(session) ?? []).map(name => ({ name, size: 70 })) })
    })
    await page.route(url => url.pathname === '/upload', route => {
      const session = new URL(route.request().url()).searchParams.get('session') ?? ''
      media.set(session, ['poster.png'])
      return route.fulfill({ body: 'poster.png' })
    })
    await page.route('**/media-metadata?**', route => route.fulfill({ json: { duration: 10, width: 2, height: 2 } }))
    await page.route(url => ['/download', '/thumbnail'].includes(url.pathname), route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }))

    await page.goto('/editor')
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await page.locator('#media-bin-panel input[type=file]').setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
    await page.getByRole('button', { name: 'Append poster.png to timeline', exact: true }).click()
    await expect.poll(() => records.get('default').state?.timeline.channels.flatMap((channel: any) => channel.clips).length).toBe(1)
    await page.reload()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Projects', exact: true })
    await expect(panel.getByText('Saved', { exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(`../.impeccable/review/projects-${width}.png`), fullPage: true, animations: 'disabled' })
    await panel.getByLabel('New project name').fill('Second film')
    await panel.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview poster.png', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(panel.getByRole('button', { name: /Second film Current project/ })).toBeVisible()
    await expect(panel.getByText('Saved', { exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const { editor } = await import('/src/stores/editor.svelte.ts')
      editor.setFps(24)
      await new Promise(resolve => setTimeout(resolve, 100))
      editor.undo()
    })
    await expect(panel.getByText('Saved', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Rename current' }).click()
    await panel.getByLabel('Project name', { exact: true }).fill('Renamed film')
    await panel.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(panel.getByRole('button', { name: /Renamed film Current project/ })).toBeVisible()
    if (width === 1440) {
      await panel.getByRole('button', { name: 'Rename current' }).click()
      await panel.getByLabel('Project name', { exact: true }).fill('Retry title')
      await panel.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(panel.getByLabel('Project name', { exact: true })).toHaveValue('Retry title')
      await expect(page.getByRole('button', { name: 'Projects', exact: true })).toHaveClass(/failed/)
      await page.screenshot({ path: resolve('../.impeccable/review/projects-1440-error.png'), fullPage: true, animations: 'disabled' })
      await panel.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(panel.getByRole('button', { name: /Retry title Current project/ })).toBeVisible()
      await expect(panel.getByRole('alert')).toHaveCount(0)
    }
    await panel.getByRole('button', { name: /First film/ }).click()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview poster.png', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Media bin options' }).click()
    await page.getByRole('button', { name: 'Use local scrub' }).click()
    await page.locator('#media-bin-panel input[type=file]').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
    await page.getByRole('button', { name: 'Append local.png to timeline', exact: true }).click()
    await expect.poll(() => records.get('default').state?.timeline.channels.flatMap((channel: any) => channel.clips).length).toBe(2)
    expect(records.get('default').state.media.find((source: any) => source.name === 'local.png').sourceMode).toBe('wasm')
    await page.reload()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(2)
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview local.png', exact: true })).toBeVisible()
    if (width === 1440) {
      records.get('default').version++
      records.get('default').name = 'Edited in another tab'
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await panel.getByRole('button', { name: 'Rename current' }).click()
      await panel.getByLabel('Project name', { exact: true }).fill('Do not overwrite')
      await panel.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(panel.getByRole('alert')).toContainText('changed in another tab')
      expect(records.get('default').name).toBe('Edited in another tab')
      const badState = structuredClone(records.get('default').state)
      badState.media = [{ ...badState.media.find((source: any) => source.sourceMode === 'wasm'), name: 'missing.png', sourceId: 'missing-original' }]
      records.set('p_bad', { ...records.get('default'), id: 'p_bad', name: 'Missing local files', sessionId: 'p_bad', state: badState })
      await panel.getByRole('button', { name: 'Reload project', exact: true }).click()
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(2)
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await panel.getByRole('button', { name: /Missing local files/ }).click()
      await expect(page.getByRole('region', { name: 'Offline project media' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Relink file' })).toBeVisible()
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await expect(panel.getByRole('button', { name: /Retry title/ })).toBeVisible()
      await panel.getByRole('button', { name: /Retry title/ }).click()
      await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
