import { test, expect, type Page } from '@playwright/test'

const USER = { id: 'demo-user', email: 'creator@example.test', name: 'Demo Creator', collectionName: 'users', isPaid: true }
const TOKEN = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`
const JOB_ID = 'a'.repeat(32)

async function mockServices(page: Page) {
  let polls = 0
  let assets: Array<Record<string, unknown>> = []
  let keys: Array<Record<string, unknown>> = []
  await page.route(url => url.pathname.startsWith('/api-keys'), async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${TOKEN}`)
    if (route.request().method() === 'POST') {
      const key = { id: 'key-fixture', name: route.request().postDataJSON().name, prefix: 'mach_aaaaaaaa', created: new Date().toISOString() }
      keys = [key, ...keys]
      return route.fulfill({ status: 201, json: { ...key, key: `mach_${'a'.repeat(64)}` } })
    }
    if (route.request().method() === 'DELETE') { keys = []; return route.fulfill({ status: 204 }) }
    return route.fulfill({ json: keys })
  })
  await page.route(url => /\/api\/collections\/users\/(auth-refresh|auth-with-password|records)$/.test(url.pathname), async route => {
    if (route.request().url().endsWith('/records')) return route.fulfill({ json: USER })
    return route.fulfill({ json: { token: TOKEN, record: USER } })
  })
  await page.route(url => /^\/(upload|compositions\/.*|renders(?:\/.*)?|download|sessions(?:\/.*)?)$/.test(url.pathname), async route => {
    const path = new URL(route.request().url()).pathname
    expect(route.request().headers().authorization).toBe(`Bearer ${TOKEN}`)
    if (path.startsWith('/sessions')) return route.fulfill({ json: { id: `u_${USER.id}` } })
    expect(route.request().headers()['x-session-id']).toBe(`u_${USER.id}`)
    if (path === '/upload') {
      const filename = route.request().postDataBuffer()?.toString().match(/filename="([^"]+)"/)?.[1]
      expect(filename).toBeTruthy()
      return route.fulfill({ body: `Upload successful: /data/u_${USER.id}/${filename} (446355 bytes)\n` })
    }
    if (path === '/compositions/assets') {
      const input = route.request().postDataJSON()
      if (input.files.some((file: { file: string }) => /[/\\:]/.test(file.file))) return route.fulfill({ status: 400, body: "invalid parameter 'file'" })
      assets = input.files.map((file: { id: string; file: string }) => ({ ...file, kind: file.file.endsWith('.png') ? 'image' : 'video', duration: 8, width: 1920, height: 1080, hasAudio: !file.file.endsWith('.png'), version: `sha256:${'b'.repeat(64)}` }))
      return route.fulfill({ json: assets })
    }
    if (path === '/compositions/validate') return route.fulfill({ json: { diagnostics: [], requirements: [], summary: 'Recipe is valid.' } })
    if (path.startsWith('/compositions/compile')) {
      const input = route.request().postDataJSON()
      if (String(input.document).includes('invalid:')) return route.fulfill({ status: 422, json: { diagnostics: [{ code: 'unknown-field', path: 'invalid', severity: 'error', message: 'Unknown document field.' }], requirements: [] } })
      const kind = String(input.document).includes('kind: image') ? 'image' : 'video'
      expect(input.bindings.shots).toEqual(input.assets.filter((asset: { kind: string }) => asset.kind === kind).map((asset: { id: string }) => asset.id))
      return route.fulfill({ json: { document: { version: 1, mode: 'assemble' }, diagnostics: [], requirements: [], summary: 'Composition is ready.', composition: { id: 'demo-composition', duration: 4, output: { format: 'mp4', aspect: 'landscape', resolution: '1080p', fps: 30 }, assets: input.assets, tracks: [], textItems: [], textRenderKey: 'demo-text' } } })
    }
    if (path === '/renders') return route.fulfill({ status: 202, json: { id: JOB_ID, status: 'queued', progress: 0 } })
    if (path === `/renders/${JOB_ID}`) return route.fulfill({ json: ++polls === 1 ? { id: JOB_ID, status: 'running', progress: .65, message: 'Rendering your composition.' } : { id: JOB_ID, status: 'completed', progress: 1, filename: 'render_demo.mp4' } })
    if (path === '/download') return route.fulfill({ contentType: 'video/mp4', body: 'mocked-render-result' })
    return route.fulfill({ status: 404, body: 'Unknown endpoint' })
  })
}

async function signInFixture(page: Page) {
  await page.addInitScript(({ token, record }) => {
    if (sessionStorage.getItem('fixture-auth-installed')) return
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record }))
    sessionStorage.setItem('fixture-auth-installed', 'true')
  }, { token: TOKEN, record: USER })
}

test('anonymous visitors sign in and return to the requested API page', async ({ page }) => {
  await mockServices(page)
  await page.goto('/api')
  await expect(page).toHaveURL(/\/login\?next=%2Fapi$/)
  await expect(page.locator('.api-workbench')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(USER.email)
  await page.getByLabel('Password', { exact: true }).fill('Demo-password-42')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(/\/api$/)
  await expect(page.locator('.api-workbench')).toBeVisible()
})

test('toolkit signup preserves the requested destination', async ({ page }) => {
  await mockServices(page)
  await page.goto('/toolkit')
  await expect(page).toHaveURL(/\/login\?next=%2Ftoolkit$/)
  await expect(page.locator('.library')).toHaveCount(0)
  await page.getByRole('button', { name: 'No account? Sign up' }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(USER.name)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(USER.email)
  await page.getByLabel('Password', { exact: true }).fill('Demo-password-42')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await expect(page).toHaveURL(/\/toolkit$/)
  await expect(page.locator('.library')).toBeVisible()
})

test('API workspace uploads, validates, renders and downloads with account authorization', async ({ page }) => {
  await mockServices(page)
  await signInFixture(page)
  await page.goto('/api')
  await expect(page.locator('.api-workbench')).not.toContainText(TOKEN)
  await expect(page.getByRole('link', { name: 'API Keys & credits', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Install MCP for your agent', exact: true })).toHaveAttribute('href', '/mcp')
  await page.getByLabel('Upload media files', { exact: true }).setInputFiles({ name: 'your-clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture-media') })
  await expect(page.locator('.asset-title strong')).toHaveText('your-clip.mp4')
  await page.getByRole('button', { name: 'Validate', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recipe validated.' })).toBeVisible()
  await page.getByRole('button', { name: 'Render video', exact: true }).click()
  await expect(page.getByRole('progressbar', { name: 'API render progress' })).toHaveAttribute('value', '65')
  await expect(page.getByRole('link', { name: 'Download result' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download result' })).toHaveAttribute('download', 'render_demo.mp4')
  await page.getByRole('textbox', { name: 'API recipe YAML' }).fill('version: 1\nmode: assemble\ninvalid: true')
  await page.getByRole('button', { name: 'Compile', exact: true }).click()
  await expect(page.getByText('Unknown document field.')).toBeVisible()
})

test('API workspace registers a dropped image and binds it to the image recipe', async ({ page }) => {
  await mockServices(page)
  await signInFixture(page)
  await page.goto('/api')
  await page.getByRole('button', { name: 'Images', exact: true }).click()
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['fixture-image'], 'beaver.png', { type: 'image/png' }))
    return data
  })
  const registration = page.waitForRequest(value => value.method() === 'POST' && new URL(value.url()).pathname === '/compositions/assets')
  await page.locator('.upload-zone').dispatchEvent('dragover', { dataTransfer: transfer })
  await page.locator('.upload-zone').dispatchEvent('drop', { dataTransfer: transfer })
  expect((await registration).postDataJSON()).toEqual({ files: [{ id: 'media-1', file: 'beaver.png' }] })
  await expect(page.locator('.asset-title strong')).toHaveText('beaver.png')
  await expect(page.getByLabel('Bind to input')).toHaveValue('shots')
  const compilation = page.waitForRequest(value => value.method() === 'POST' && new URL(value.url()).pathname === '/compositions/compile')
  await page.getByRole('button', { name: 'Compile', exact: true }).click()
  const input = (await compilation).postDataJSON()
  expect(input.bindings.shots).toEqual(['media-1'])
  expect(input.assets[0]).toMatchObject({ id: 'media-1', file: 'beaver.png', kind: 'image' })
  await expect(page.getByRole('heading', { name: 'Composition compiled.' })).toBeVisible()
  await transfer.dispose()
})

test('toolkit search, catalog details, playground and logout work', async ({ page }) => {
  await mockServices(page)
  await signInFixture(page)
  await page.goto('/toolkit')
  await page.getByRole('searchbox', { name: 'Search the toolkit' }).fill('silver-contrast')
  await expect(page.locator('.preset-entry')).toHaveCount(1)
  await expect(page.locator('.preset-inspector pre')).toContainText('silver-contrast')
  await page.getByRole('searchbox', { name: 'Search the toolkit' }).fill('no-such-preset')
  await expect(page.getByRole('heading', { name: 'No matching presets.' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await page.getByRole('button', { name: /^Effects/ }).first().click()
  await page.getByRole('searchbox', { name: 'Search the toolkit' }).fill('gaussian-blur')
  await expect(page.locator('.preset-inspector')).toContainText('Sigma')
  await page.locator('.canvas-host canvas').waitFor()
  await page.getByRole('button', { name: 'Media', exact: true }).click()
  await page.getByRole('button', { name: 'Add The next move to timeline' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
  await page.getByRole('button', { name: 'Account settings', exact: true }).click()
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.goto('/toolkit')
  await expect(page).toHaveURL(/\/login\?next=%2Ftoolkit$/)
  await expect(page.locator('.library')).toHaveCount(0)
})

test('adding media to a saved request keeps existing assets and bindings', async ({ page }) => {
  await mockServices(page)
  await signInFixture(page)
  await page.goto('/api')
  const project = `document:
  version: 1
  mode: assemble
  inputs:
    shots: {kind: video, multiple: true}
  sequence:
    use: shots
    each:
      take: {from: 0, duration: 4}
bindings:
  shots: [media-1]
assets:
  - id: media-1
    file: existing-clip.mp4
    kind: video
    duration: 8
    version: sha256:${'b'.repeat(64)}`
  await page.getByRole('textbox', { name: 'API recipe YAML' }).fill(project)
  await page.getByLabel('Upload media files', { exact: true }).setInputFiles({ name: 'another-clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture-media') })
  await expect(page.locator('.asset-list')).toContainText('media-2')
  const request = page.waitForRequest(value => value.method() === 'POST' && new URL(value.url()).pathname === '/compositions/compile')
  await page.getByRole('button', { name: 'Compile', exact: true }).click()
  const input = (await request).postDataJSON()
  expect(input.bindings.shots).toEqual(['media-1', 'media-2'])
  expect(input.assets.map((asset: { id: string }) => asset.id)).toEqual(['media-1', 'media-2'])
})
