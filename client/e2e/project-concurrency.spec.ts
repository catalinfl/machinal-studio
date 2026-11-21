import { expect, test, type BrowserContext } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ProjectState } from '../src/lib/project-state'
import type { TextItem } from '../src/lib/editor-types'

async function fixture(context: BrowserContext) {
  const user = { id: 'projectregression', name: 'Regression', email: 'regression@example.test', isPaid: true, collectionName: 'users' }
  const token = (revision: number) => `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, revision })).toString('base64url')}.fixture`
  const now = new Date().toISOString()
  const state: ProjectState = { schemaVersion: 1, media: [], timeline: { channels: [], effectBlocks: [], transitions: [], textItems: [], fps: 30,
    resolution: '720p', projectAspect: null, videoFit: 'contain', documentSession: null, currentTime: 0, selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [] } }
  const record = { id: 'p_regression', name: 'Regression film', sessionId: 'p_regression', version: 2, createdAt: now, updatedAt: now, state }
  const requests: { page: number; method: string; status: number; bytes?: number }[] = []
  const assets = new Map<string, string>()
  let refresh = 0
  await context.addInitScript(({ user, token }) => {
    if (!localStorage.getItem('pocketbase_auth')) localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
    localStorage.setItem('scrub:welcome-dismissed', '1')
  }, { user, token: token(0) })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && url.port === '5173') return route.continue()
    return route.fulfill({ json: {} })
  })
  await context.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token: token(++refresh), record: user } }))
  await context.route(url => url.pathname === '/billing/access', route => route.fulfill({ json: { paid: true } }))
  await context.route(url => url.pathname.startsWith('/sessions'), route => route.fulfill({ json: {} }))
  await context.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
  await context.route(url => url.pathname.startsWith('/projects'), route => {
    const request = route.request()
    const url = new URL(request.url())
    const page = context.pages().indexOf(request.frame().page())
    const [, , projectId, category, assetId] = url.pathname.split('/')
    if (category === 'text-assets') {
      requests.push({ page, method: `${request.method()} asset`, status: 200, bytes: request.postData()?.length })
      if (request.method() === 'GET') return route.fulfill({ body: assets.get(assetId), contentType: 'application/json' })
      const body = request.postData()!
      expect(createHash('sha256').update(body).digest('hex')).toBe(assetId)
      assets.set(assetId, body)
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'GET') {
      requests.push({ page, method: projectId ? 'GET project' : 'GET list', status: 200 })
      const { state, ...summary } = record
      return route.fulfill({ json: projectId ? record : [summary] })
    }
    const body = request.postDataJSON()
    const status = body.version === record.version ? 200 : 409
    requests.push({ page, method: 'POST', status, bytes: request.postData()!.length })
    if (status === 409) return route.fulfill({ status, body: 'conflict' })
    Object.assign(record, body, { version: record.version + 1 })
    const { state, ...summary } = record
    return route.fulfill({ json: summary })
  })
  return { requests, record, assets }
}

test('same-owner auth refresh does not reload the project or reset an unsaved edit', async ({ context, page }) => {
  const { requests } = await fixture(context)
  await page.goto('/editor')
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  await page.evaluate(async () => {
    const { pb } = await import('/src/lib/pocketbase.ts')
    const { editor } = await import('/src/stores/editor.svelte.ts')
    editor.setFps(24)
    pb.authStore.save(pb.authStore.token, { ...pb.authStore.record! })
  })
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  await expect.poll(() => requests.filter(item => item.method === 'POST').length).toBe(1)
  expect(requests.filter(item => item.method === 'GET project')).toHaveLength(1)
  expect(await page.evaluate(async () => (await import('/src/stores/editor.svelte.ts')).editor.fps)).toBe(24)
})

test('a conflicting tab stops all retries and can download its exact unsaved draft', async ({ context, page }) => {
  const { requests, record } = await fixture(context)
  await page.goto('/editor')
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  const second = await context.newPage()
  await second.goto('/editor')
  await expect(second.locator('.save-feedback')).toHaveText('Saved')
  expect(requests.filter(item => item.method === 'GET project')).toHaveLength(2)
  await page.evaluate(async () => (await import('/src/stores/editor.svelte.ts')).editor.setFps(24))
  await expect.poll(() => record.version).toBe(3)
  await second.evaluate(async () => (await import('/src/stores/editor.svelte.ts')).editor.setFps(25))
  await expect(second.locator('.save-feedback')).toHaveText('Not saved')
  await second.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(second.getByRole('alert')).toContainText('changed in another tab')
  await expect(second.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await second.evaluate(async () => {
    (await import('/src/stores/editor.svelte.ts')).editor.setFps(26)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  // Cover both the 600 ms autosave debounce and the visibility flush after a conflict.
  await second.waitForTimeout(1100)
  expect(requests.filter(item => item.method === 'POST' && item.status === 409)).toHaveLength(1)
  expect(record.state.timeline.fps).toBe(24)
  for (const width of [1440, 390]) {
    await second.setViewportSize({ width, height: 900 })
    await expect(second.getByRole('alert')).toBeVisible()
    await expect(second.getByRole('button', { name: 'Download unsaved draft' })).toBeVisible()
    expect(await second.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await second.screenshot({ path: test.info().outputPath(`project-conflict-${width}.png`), fullPage: true })
  }
  const downloading = second.waitForEvent('download')
  await second.getByRole('button', { name: 'Download unsaved draft' }).click()
  const download = await downloading
  const draft = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(draft.state.timeline.fps).toBe(26)
})

test('large caption rasters upload once and do not return in autosaves after reopening', async ({ context, page }) => {
  const { requests, record, assets } = await fixture(context)
  const caption = { id: 'caption', text: '  Știință\nși țară! ', start: 0, duration: 1, fontFamily: 'montserrat', fontWeight: 700,
    isCaption: true, highlightMode: 'none', highlightColor: '#fff36d', highlightBackgroundColor: '#000000', highlightBackgroundOpacity: 0, highlightAnimation: 'pop',
    words: [{ text: ' Știință', start: 0, end: 0.4 }, { text: 'și țară! ', start: 0.4, end: 1 }] } as TextItem
  const prepared = { key: 'fixture-caption-key', overlays: [{ start: 0, duration: 1, x: 0, y: 100, image: 'x'.repeat(4_000_000) }] }
  record.state.timeline.textItems = [caption]
  record.state.timeline.documentSession = {
    kind: 'ready', assets: [], bindings: {}, document: { version: 1, mode: 'assemble', texts: [caption], jobs: [{ id: 'captions', type: 'captions.generate', resultTextIds: ['caption'] }] }, preparedText: prepared,
    composition: { id: 'fixture', compilerVersion: '1', catalogVersion: '1', documentRevision: 'revision', duration: 1,
      output: { aspect: 'landscape', resolution: '720p', fps: 30, format: 'mp4', quality: 'normal' },
      assets: [], tracks: [], effects: [], transitions: [], textItems: [caption], textRenderKey: prepared.key, preparedText: structuredClone(prepared), segments: {} },
  }
  record.state.preparedCompositionId = 'fixture'
  await page.goto('/')
  record.state.preparedStateFingerprint = await page.evaluate(async state => (await import('/src/lib/project-presentation.ts')).projectStateFingerprint(state), record.state)
  const baseline = JSON.stringify(record.state.timeline.textItems)
  await page.goto('/editor')
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  await expect.poll(() => record.version).toBe(3)
  await page.reload()
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  await page.waitForTimeout(800)
  expect(record.version).toBe(3)
  await page.evaluate(async () => {
    const { registerMediaBinSource } = await import('/src/lib/media-bin.ts')
    registerMediaBinSource({ id: 'poster', name: 'poster.png', kind: 'image', duration: 5, sourceRevision: 'pinned' })
  })
  await expect.poll(() => record.version).toBeGreaterThanOrEqual(4)
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  expect(assets.size).toBe(1)
  expect(requests.filter(item => item.method === 'POST asset')).toHaveLength(1)
  expect(requests.filter(item => item.method === 'POST').every(item => item.bytes! < 20_000)).toBe(true)
  expect(JSON.stringify(record.state.timeline.textItems)).toBe(baseline)
  expect(record.state.timeline.documentSession!.document.jobs![0].resultTextIds).toEqual(['caption'])
  expect(record.state.timeline.documentSession!.preparedText).toBeUndefined()
  await page.reload()
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  expect(requests.filter(item => item.method === 'GET asset')).toHaveLength(2)
  const restored = await page.evaluate(async () => (await import('/src/stores/editor.svelte.ts')).editor.documentSession!.preparedText!.overlays[0].image.length)
  expect(restored).toBe(4_000_000)
  await page.evaluate(async () => (await import('/src/lib/media-bin.ts')).renameMediaBinSource('poster.png', 'My poster'))
  await expect(page.locator('.save-feedback')).toHaveText('Saved')
  await expect.poll(() => record.state.media[0]?.displayName).toBe('My poster')
  expect(requests.filter(item => item.method === 'POST asset')).toHaveLength(1)
  expect(requests.filter(item => item.method === 'POST').every(item => item.bytes! < 20_000)).toBe(true)
})
