import { expect, test, type Page } from '@playwright/test'
import { STORAGE_NOTICE_KEY, storageAcknowledgment } from '../src/lib/browser-storage'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

async function fixture(page: Page, offline = false) {
  const user = { id: 'reliabilityuser', name: 'Creator', email: 'reliability@example.test', isPaid: true, collectionName: 'users' }
  const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
  const now = new Date().toISOString()
  const clip = { id: 'offline-clip', fileName: 'poster.png', sourceId: 'offline-original', sourceMode: 'wasm', mediaKind: 'image', sourceDuration: 4, inPoint: 0, outPoint: 4, start: 0, scrubBlobUrl: null }
  const state = { schemaVersion: 1, media: offline ? [{ id: 'offline-original', name: 'poster.png', sourceId: 'offline-original', sourceMode: 'wasm', kind: 'image', duration: 4, width: 1, height: 1 }] : [],
    timeline: { channels: [{ id: 'v', type: 'video', name: 'Video 1', hidden: false, muted: false, locked: false, clips: offline ? [clip] : [] }],
      textItems: [], effectBlocks: [], transitions: [], fps: 30, resolution: '720p', projectAspect: 'landscape', videoFit: 'contain', documentSession: null,
      currentTime: 0, selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [] } }
  const record: any = { id: 'p_reliability', sessionId: 'p_reliability', name: 'Reliable film', version: 2, createdAt: now, updatedAt: now, state }
  const versions: any[] = []
  const snapshots = new Map<string, any>()
  let saves = 0
  const storageNotice = { key: STORAGE_NOTICE_KEY, value: storageAcknowledgment() }
  await page.addInitScript(({ user, token, storageNotice }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
    localStorage.setItem('scrub:welcome-dismissed', '1')
    localStorage.setItem(storageNotice.key, storageNotice.value)
  }, { user, token, storageNotice })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
  await page.route(url => url.pathname.startsWith('/sessions'), route => route.fulfill({ json: {} }))
  await page.route(url => url.pathname === '/billing/access', route => route.fulfill({ json: { paid: true } }))
  await page.route(url => url.pathname === '/billing/credits', route => route.fulfill({ json: { pricing: { configured: true, renderPerMinute: '2', usdPerCredit: '0.01' }, balance: { remaining: 100 } } }))
  await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
  await page.route(url => url.pathname.startsWith('/projects'), async route => {
    const request = route.request()
    const parts = new URL(request.url()).pathname.split('/')
    if (parts[3] === 'versions') {
      if (request.method() === 'GET') return route.fulfill({ json: parts[4] ? snapshots.get(parts[4]) : versions })
      if (request.method() === 'DELETE') { const at = versions.findIndex(item => item.id === parts[4]); if (at >= 0) versions.splice(at, 1); return route.fulfill({ status: 204 }) }
      const body = request.postDataJSON()
      if (body.version !== record.version) return route.fulfill({ status: 409, body: 'conflict' })
      const version = { id: `version-${versions.length}`, name: body.name, projectVersion: record.version, createdAt: now }
      versions.push(version); snapshots.set(version.id, structuredClone(record))
      return route.fulfill({ status: 201, json: version })
    }
    if (request.method() === 'GET') return route.fulfill({ json: parts[2] ? record : [{ ...record, state: undefined }] })
    const body = request.postDataJSON()
    if (body.version !== record.version) return route.fulfill({ status: 409, body: 'conflict' })
    saves++
    Object.assign(record, body, { version: record.version + 1 })
    return route.fulfill({ json: { ...record, state: undefined } })
  })
  return { record, versions, get saves() { return saves } }
}

for (const width of [1440, 390]) {
  test(`offline projects open and relink without changing clip or caption timing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const setup = await fixture(page, true)
    await page.goto('/editor')
    await expect(page.getByRole('region', { name: 'Offline project media' })).toBeVisible()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
    const baseline = structuredClone(setup.record.state.timeline)
    await page.screenshot({ path: info.outputPath(`offline-${width}.png`), fullPage: true })
    const choosing = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Relink file' }).click()
    await (await choosing).setFiles({ name: 'original.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByRole('region', { name: 'Offline project media' })).toHaveCount(0)
    await expect.poll(() => setup.saves).toBeGreaterThan(0)
    const clip = setup.record.state.timeline.channels[0].clips[0]
    expect({ start: clip.start, inPoint: clip.inPoint, outPoint: clip.outPoint }).toEqual({ start: 0, inPoint: 0, outPoint: 4 })
    expect(setup.record.state.timeline.textItems).toEqual(baseline.textItems)
    await page.reload()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Offline project media' })).toHaveCount(0)
  })
}

test('guided starts configure framing without generating assets; versions restore the exact edit', async ({ page }, info) => {
  const setup = await fixture(page)
  await page.goto('/editor')
  await page.getByText('Start with a guided workflow', { exact: true }).click()
  await page.getByRole('button', { name: /Captioned reel/ }).click()
  await expect(page.getByRole('complementary', { name: 'Guided workflow' })).toBeVisible()
  await expect.poll(() => setup.record.state.timeline.projectAspect).toBe('portrait')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByText('Saved versions', { exact: true }).click()
  await page.getByLabel('Version name').fill('Portrait draft')
  await page.getByRole('button', { name: 'Save version', exact: true }).click()
  await expect.poll(() => setup.versions.length).toBe(1)
  await page.evaluate(async () => (await import('/src/stores/editor.svelte.ts')).editor.setFps(24))
  await expect.poll(() => setup.record.state.timeline.fps).toBe(24)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect.poll(() => setup.record.state.timeline.fps).toBe(30)
  expect(setup.versions).toHaveLength(2)
  await page.screenshot({ path: info.outputPath('versions-desktop.png'), fullPage: true })
})

test('server export requires upload consent and shows live rendering rates after relinking', async ({ page }, info) => {
  await fixture(page, true)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/editor')
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Render project', exact: true })
  await expect(dialog.getByRole('button', { name: /^Server/ })).toBeDisabled()
  await expect(dialog.getByText(/local source files are offline/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Close render menu' }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Relink file' }).click()
  await (await choosing).setFiles({ name: 'original.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('region', { name: 'Offline project media' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  await expect(dialog.getByText(/Balance: 100 credits/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Server/ })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /Upload this export/ }).check()
  await expect(dialog.getByRole('button', { name: /^Server/ })).toBeEnabled()
  await expect(dialog.getByText(/local source files are offline/)).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('export-consent-mobile.png'), fullPage: true })
})

test('2,000 captions stay culled and playback survives missing FontFaceSet with throttled CPU', async ({ page, context }, info) => {
  test.setTimeout(120_000)
  const setup = await fixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 })
    Object.defineProperty(document, 'fonts', { configurable: true, value: undefined })
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.goto('/editor')
  await expect(page.locator('.stage > canvas')).toBeVisible()
  await page.evaluate(async () => {
    const { editor } = await import('/src/stores/editor.svelte.ts')
    const item = editor.addTextItem(0, { text: 'Știință și țară!', duration: 1.8, isCaption: true, fontFamily: 'montserrat', fontWeight: 700 })
    const state = editor.captureProjectState()
    state.textItems = Array.from({ length: 2000 }, (_, index) => ({ ...item, id: `caption-${index}`, start: index * 2 }))
    editor.restoreProjectState(state)
    let captures = 0
    const capture = editor.captureProjectState.bind(editor)
    editor.captureProjectState = (...args) => { captures++; return capture(...args) }
    Object.assign(window, { projectCaptures: () => captures })
  })
  await expect(page.locator('[data-timeline-text-id]').first()).toBeVisible()
  expect(await page.locator('.text-block').count()).toBeLessThan(40)
  await page.getByRole('button', { name: 'Play preview', exact: true }).click()
  await expect.poll(() => page.getByRole('slider', { name: 'Playhead', exact: true }).getAttribute('aria-valuenow').then(Number)).toBeGreaterThan(0.5)
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click()
  const captures = await page.evaluate(() => (window as unknown as { projectCaptures: () => number }).projectCaptures())
  expect(captures).toBeLessThan(5)
  expect(setup.record.state.timeline.textItems).toHaveLength(2000)
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('large-caption-timeline.png'), fullPage: true })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
})
