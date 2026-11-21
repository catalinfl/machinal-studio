import { expect, test } from '@playwright/test'

for (const listed of [false, true]) {
test(`opening a legacy scene project compacts once without server rendering (listed=${listed})`, async ({ page }) => {
  const user = { id: 'memoryfixture', name: 'Memory fixture', email: 'memory@example.test', isPaid: true, collectionName: 'users' }
  const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
  const now = new Date().toISOString()
  const name = 'ai_scene_0123456789abcdef0123456789abcdef_01.scene.json'
  const record = {
    id: 'p_memory', name: 'Legacy scenes', sessionId: 'p_memory', version: 2, createdAt: now, updatedAt: now,
    state: {
      schemaVersion: 1,
      timeline: { channels: [], effectBlocks: [], transitions: [], textItems: [], fps: 30, resolution: '720p',
        projectAspect: null, videoFit: 'contain', documentSession: null, currentTime: 0,
        selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [] },
      media: [{ id: 'scene', sourceId: 'scene', name, kind: 'video', duration: 2, width: 320, height: 180, sourceMode: 'proxy', generated: true, isRender: false,
        displayName: 'Keep this scene', sourceRevision: 'sha256:original', scene: { version: 1, component: '<p>Saved scene</p>',
          javascript: '/* saved browser bundle */', config: { width: 320, height: 180, fps: 30, durationInFrames: 60 } } }],
    },
  }
  const originalTimeline = JSON.stringify(record.state.timeline)
  const scene = record.state.media[0].scene
  const saves: any[] = []
  const processing: string[] = []
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
    localStorage.setItem('scrub:welcome-dismissed', '1')
  }, { user, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
  await page.route('**/billing/access', route => route.fulfill({ json: { paid: true } }))
  await page.route('**/settings/openrouter', route => route.fulfill({ json: { configured: false } }))
  await page.route('**/sessions**', route => route.fulfill({ json: {} }))
  await page.route(url => url.pathname.startsWith('/projects'), route => {
    const id = new URL(route.request().url()).pathname.split('/')[2]
    if (route.request().method() === 'GET') {
      const { state, ...summary } = record
      return route.fulfill({ json: id ? record : [summary] })
    }
    const body = route.request().postDataJSON()
    if (body.version !== record.version) return route.fulfill({ status: 409 })
    saves.push(body)
    Object.assign(record, body, { version: record.version + 1 })
    const { state, ...summary } = record
    return route.fulfill({ json: summary })
  })
  await page.route(url => url.pathname === '/list', route => route.fulfill({ json: listed ? [{ name, size: 1000, s3Key: `p_memory/${name}`, etag: 's3-etag' }] : [] }))
  await page.route(url => url.pathname === '/download', route => route.fulfill({ json: scene }))
  await page.route(url => url.pathname.startsWith('/ai/') || ['/render', '/renders', '/compositions/compile', '/compositions/compile-and-generate'].includes(url.pathname), route => {
    processing.push(route.request().url())
    return route.fulfill({ status: 500, body: 'Opening must not process or render on the server' })
  })

  await page.goto('/editor')
  await expect.poll(() => saves.length).toBe(1)
  expect(saves[0].state.media[0]).not.toHaveProperty('scene')
  expect(saves[0].state.media[0]).toMatchObject({ name, displayName: 'Keep this scene', sourceRevision: 'sha256:original' })
  expect(JSON.stringify(saves[0].state.timeline)).toBe(originalTimeline)
  await page.reload()
  await page.evaluate(async () => {
    const { waitForMediaBinLoads } = await import('/src/lib/media-bin.ts')
    await waitForMediaBinLoads()
  })
  // Allow the 600 ms autosave debounce to fire after preview hydration.
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Projects', exact: true }).getByText('Saved', { exact: true })).toBeVisible()
  expect(saves).toHaveLength(1)
  expect(processing).toEqual([])
})
}
