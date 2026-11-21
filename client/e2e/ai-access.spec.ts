import { expect, test, type Page } from '@playwright/test'

const account = { id: 'testaccount1234', email: 'editor@example.com', name: 'Editor', collectionName: 'users', collectionId: '_pb_users_auth_' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`

async function mockServices(page: Page) {
  const project = { id: 'default', name: 'Main project', sessionId: `u_${account.id}`, version: 0, createdAt: '', updatedAt: '' }
  await page.route('**/projects', route => route.fulfill({ json: [project] }))
  await page.route('**/projects/default', route => route.fulfill({ json: { ...project, state: null } }))
  await page.route('**/billing/access', route => route.fulfill({ json: { paid: false } }))
  await page.route('**/list*', (route) => route.fulfill({ status: 200, body: '' }))
  await page.route('**/sessions**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('**/api/collections/users/auth-*', (route) => route.fulfill({ json: { token, record: account } }))
  // Free account: no subscriptions row for this user.
  await page.route('**/api/collections/subscriptions/records/*', (route) => route.fulfill({ status: 404, json: {} }))
}

async function addMedia(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/lib/media-bin.ts'
    const { registerMediaBinSource } = await import(/* @vite-ignore */ path)
    registerMediaBinSource({ id: 'local-image', name: 'My image.png', kind: 'image', duration: 5, sourceMode: 'wasm', sourceId: 'local-image' })
  })
}

async function openFeature(page: Page, feature: string) {
  if (feature === 'captions' && await page.getByRole('button', { name: 'Generate voice to text', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Generate voice to text', exact: true }).click()
    return
  }
  const menu = page.getByRole('button', { name: 'Open editor panels' })
  if (await menu.isVisible()) await menu.click()
  if (feature === 'captions') {
    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.getByRole('button', { name: 'Generate voice to text', exact: true }).click()
  } else {
    const desktopTools = await page.getByRole('navigation', { name: 'Editor tools' }).isVisible()
    const speechLabel = desktopTools ? 'Speech' : 'Text to Speech'
    const target = feature === 'image' ? 'Image' : feature === 'tts' ? speechLabel : 'AI Edit'
    await page.getByRole('button', { name: target, exact: true }).click()
  }
}

for (const feature of ['image', 'ai', 'captions', 'tts']) {
  test(`${feature}: empty anonymous editor goes to login and returns to pricing`, async ({ page }) => {
    await mockServices(page)
    await page.goto('/editor')
    await openFeature(page, feature)
    await expect(page).toHaveURL(`/login?ai=${feature}`)
    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Choose a prepaid pass')
    await expect(page).toHaveURL('/editor')
  })

  test(`${feature}: media stays in editor through inline login and pricing`, async ({ page }) => {
    await mockServices(page)
    let generationRequests = 0
    page.on('request', (request) => {
      if (/\/ai\/(images|edit|subtitles)(\?|$)/.test(request.url())) generationRequests++
    })
    await page.goto('/editor')
    await addMedia(page)
    await openFeature(page, feature)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Your media and timeline stay open here')
    await expect(page).toHaveURL('/editor')
    await dialog.getByLabel('Email', { exact: true }).fill(account.email)
    await dialog.getByLabel('Password', { exact: true }).fill('password123')
    await dialog.getByRole('button', { name: 'Log in & view AI plan' }).click()
    await expect(dialog).toContainText('Choose a prepaid pass')
    await dialog.getByRole('button', { name: 'Continue editing', exact: true }).click()
    const sources = await page.evaluate(async () => {
      const path = '/src/lib/media-bin.ts'
      return (await import(/* @vite-ignore */ path)).getMediaBinSources()
    })
    expect(sources).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'My image.png' })]))
    expect(generationRequests).toBe(0)
    await openFeature(page, feature)
    await expect(page.getByRole('dialog')).toContainText('Choose a prepaid pass')
  })
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`login dialog is dismissible and bounded at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockServices(page)
    await page.goto('/editor')
    await addMedia(page)
    await openFeature(page, 'image')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.height).toBeLessThanOrEqual(viewport.height)
    await page.screenshot({ path: `../.impeccable/review/ai-access-${viewport.width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL('/editor')
    await openFeature(page, 'image')
    await page.route('**/api/collections/users/auth-with-password', (route) => route.fulfill({ status: 400, json: { message: 'Invalid credentials' } }))
    await dialog.getByLabel('Email', { exact: true }).fill(account.email)
    await dialog.getByLabel('Password', { exact: true }).fill('wrong-password')
    await dialog.getByRole('button', { name: 'Log in & view AI plan' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Wrong email or password')
    await expect(page).toHaveURL('/editor')
    await page.unroute('**/api/collections/users/auth-with-password')
    await dialog.getByLabel('Password', { exact: true }).fill('password123')
    await dialog.getByRole('button', { name: 'Log in & view AI plan' }).click()
    await expect(dialog).toContainText('Choose a prepaid pass')
    await page.screenshot({ path: `../.impeccable/review/ai-pricing-${viewport.width}.png` })
  })
}
