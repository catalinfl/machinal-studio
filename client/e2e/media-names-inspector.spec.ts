import { expect, test, type Page } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const user = { id: 'medianames', name: 'Media Creator', email: 'media@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`

async function documentStatus(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
    return (await import(url)).editor.documentSession?.kind
  })
}

for (const width of [1440, 390]) {
  test(`project media names persist without changing originals at ${width}px`, async ({ page }, testInfo) => {
    const now = new Date().toISOString()
    const records = new Map<string, any>([
      ['first', { id: 'first', name: 'First film', sessionId: 'p_first', version: 1, createdAt: now, updatedAt: now, state: null }],
      ['second', { id: 'second', name: 'Second film', sessionId: 'p_second', version: 1, createdAt: now, updatedAt: now, state: null }],
    ])
    const mediaMutations: string[] = []
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(({ user, token }) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
      if (!localStorage.getItem('direction-active-project:medianames')) localStorage.setItem('direction-active-project:medianames', 'first')
      localStorage.setItem('scrub-theme', 'dark')
      localStorage.setItem('scrub-media-view', JSON.stringify({ view: 'grid' }))
    }, { user, token })
    await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
    await page.route('**/sessions**', route => route.fulfill({ json: {} }))
    await page.route(url => url.pathname.startsWith('/projects'), async route => {
      const request = route.request()
      const id = new URL(request.url()).pathname.split('/')[2]
      if (request.method() === 'GET') return route.fulfill({ json: id ? records.get(id) : [...records.values()].map(({ state, ...summary }) => summary) })
      const project = records.get(id)!
      const body = request.postDataJSON()
      if (project.version !== body.version) return route.fulfill({ status: 409, body: 'conflict' })
      Object.assign(project, body, { version: project.version + 1 })
      const { state, ...summary } = project
      return route.fulfill({ json: summary })
    })
    await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [{ name: 'poster.png', size: png.length, mediaKind: 'image' }] }))
    await page.route('**/media-metadata?**', route => route.fulfill({ json: { duration: 10, width: 2, height: 2 } }))
    await page.route(url => ['/download', '/thumbnail'].includes(url.pathname), route => route.fulfill({ contentType: 'image/png', body: png }))
    page.on('request', request => {
      if (['/upload', '/delete', '/bulk-delete'].includes(new URL(request.url()).pathname)) mediaMutations.push(request.url())
    })

    await page.goto('/editor')
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await page.getByRole('button', { name: 'Rename poster.png', exact: true }).click()
    const renameDialog = page.getByRole('dialog', { name: 'Rename media', exact: true })
    await expect(renameDialog).toBeVisible()
    const name = page.getByRole('textbox', { name: 'Project name for poster.png' })
    await expect(name).toBeFocused()
    const inputBox = (await name.boundingBox())!
    expect(inputBox.width).toBeGreaterThan(width === 390 ? 300 : 400)
    expect(inputBox.height).toBeGreaterThanOrEqual(44)
    const saveBox = (await renameDialog.getByRole('button', { name: 'Save media name' }).boundingBox())!
    expect(saveBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height)
    await name.fill('Opening title — a longer name to edit comfortably')
    await page.screenshot({ path: testInfo.outputPath(`media-rename-${width}.png`), animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.screenshot({ path: testInfo.outputPath(`media-rename-${width}-light.png`), animations: 'disabled' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await name.fill('Opening title')
    await name.press('Enter')
    await expect(renameDialog).toHaveCount(0)
    const renameButton = page.getByRole('button', { name: 'Rename Opening title', exact: true })
    await expect(renameButton).toBeFocused()
    for (const cancelWithEscape of [true, false]) {
      await renameButton.click()
      await expect(name).toHaveValue('Opening title')
      await name.fill('')
      await expect(renameDialog.getByRole('button', { name: 'Save media name' })).toBeDisabled()
      await name.fill('Do not save')
      if (cancelWithEscape) await name.press('Escape')
      else await renameDialog.getByRole('button', { name: 'Cancel media rename' }).click()
      await expect(renameDialog).toHaveCount(0)
      await expect(renameButton).toBeFocused()
    }
    await expect.poll(() => records.get('first').state?.media[0]?.displayName).toBe('Opening title')
    expect(records.get('first').state.media[0].name).toBe('poster.png')
    await page.getByRole('button', { name: 'Append Opening title to timeline', exact: true }).click()
    await expect(page.locator('.clip-name')).toHaveText('Opening title')
    await expect.poll(() => records.get('first').state?.timeline.channels.flatMap((channel: any) => channel.clips).length).toBe(1)
    expect(records.get('first').state.timeline.channels.flatMap((channel: any) => channel.clips)[0].fileName).toBe('poster.png')

    await page.reload()
    await expect(page.locator('.clip-name')).toHaveText('Opening title')
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview Opening title', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('dialog', { name: 'Projects', exact: true }).getByRole('button', { name: /Second film/ }).click()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)
    if (width === 390) await page.getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Preview poster.png', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('dialog', { name: 'Projects', exact: true }).getByRole('button', { name: /First film/ }).click()
    await expect(page.locator('.clip-name')).toHaveText('Opening title')
    expect(mediaMutations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })

  test(`inspector survives switch and slider synchronization at ${width}px`, async ({ page }) => {
    let compilations = 0
    await page.setViewportSize({ width, height: 900 })
    await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
    await page.route(url => ['/download', '/thumbnail'].includes(url.pathname), route => route.fulfill({ contentType: 'image/png', body: png }))
    await page.route('**/compositions/compile**', route => {
      compilations++
      const input = route.request().postDataJSON()
      const snapshot = input.snapshot
      return route.fulfill({ json: {
        document: input.document, expectedRevision: snapshot.revision, diagnostics: [], requirements: [], summary: '',
        composition: { id: `compiled-${compilations}`, documentRevision: 'document', compilerVersion: '1', catalogVersion: '1',
          duration: 5, textRenderKey: 'text', output: input.document.output, assets: input.assets,
          tracks: snapshot.tracks, effects: snapshot.effects, transitions: snapshot.transitions, textItems: snapshot.textItems, segments: {} },
      } })
    })
    await page.goto('/editor')
    await expect(page.getByRole('application', { name: 'Timeline clip selection area' })).toBeVisible()
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name)
        .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
      const { editor } = await import(url)
      const { compositionTimeline } = await import('/src/lib/composition-adapter.ts')
      const { DEFAULT_CLIP_TRANSFORM } = await import('/src/lib/clip-transform.ts')
      const { API_BASE } = await import('/src/lib/api.ts')
      const composition = {
        id: 'compiled', documentRevision: 'document', compilerVersion: '1', catalogVersion: '1', duration: 5, textRenderKey: 'text',
        output: { aspect: 'landscape', resolution: '1080p', fps: 30, format: 'mp4', quality: 'normal' },
        assets: [{ id: 'source', file: 'poster.png', version: 'v1', kind: 'image', duration: 10, width: 2, height: 2 }],
        tracks: [{ id: 'v1', name: 'Video', type: 'video', muted: false, hidden: false, locked: false,
          clips: [{ id: 'clip', assetId: 'source', start: 0, inPoint: 0, outPoint: 5, playbackRate: 1, volume: 100,
            opacity: 1, fadeIn: 0, fadeOut: 0, transform: { ...DEFAULT_CLIP_TRANSFORM }, transformKeyframes: [] }] }],
        effects: [], transitions: [], textItems: [], segments: {},
      }
      editor.applyCompiledTimeline(compositionTimeline(composition as any, () => `${API_BASE}/download?file=poster.png`), {
        kind: 'ready', composition, assets: composition.assets, bindings: {},
        document: { version: 1, mode: 'assemble', tracks: composition.tracks, output: composition.output },
      } as any, editor.stateRevision)
    })
    await page.locator('[data-timeline-clip-id="clip"]').dblclick()
    const inspector = page.getByLabel('Clip inspector', { exact: true })
    const flip = inspector.getByRole('checkbox', { name: 'Flip horizontal' })
    await flip.check()
    await expect.poll(() => compilations).toBe(1)
    await expect.poll(() => documentStatus(page)).toBe('ready')
    await expect(flip).toBeChecked()
    await expect(inspector).toBeVisible()
    await inspector.getByText('Advanced · compositing & motion', { exact: true }).click()
    const opacity = inspector.getByRole('slider', { name: 'Clip layer opacity' })
    await opacity.focus()
    await opacity.press('ArrowLeft')
    await opacity.blur()
    await expect.poll(() => compilations).toBe(2)
    await expect.poll(() => documentStatus(page)).toBe('ready')
    await expect(inspector).toBeVisible()
    await expect(opacity).toHaveValue('0.99')
    await page.getByRole('button', { name: 'Close inspector' }).click()
    await expect(inspector).toHaveCount(0)
  })
}
