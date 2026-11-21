import { expect, test } from '@playwright/test'

test('native media tags use a read capability without exposing the login token', async ({ page, baseURL }) => {
  const user = { id: 'mediaowner', name: 'Media Owner', email: 'media@example.test', collectionName: 'users' }
  const loginToken = `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
  const mediaToken = 'a'.repeat(64)
  const requests: Array<{ authorization?: string; mediaToken: string | null }> = []
  await page.route('**/*', route => new URL(route.request().url()).host === new URL(baseURL!).host ? route.continue() : route.abort())
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
  }, { user, token: loginToken })
  await page.route(url => url.pathname.startsWith('/api/collections/'), route => route.fulfill({ json: { token: loginToken, record: user, items: [] } }))
  await page.route(url => url.pathname.startsWith('/billing/'), route => route.fulfill({ json: { paid: false } }))
  await page.route(url => url.pathname.startsWith('/sessions/'), route => route.fulfill({ json: { id: 'u_mediaowner', mediaToken } }))
  await page.route(url => url.pathname === '/download', route => {
    const request = route.request()
    const url = new URL(request.url())
    requests.push({ authorization: request.headers().authorization, mediaToken: url.searchParams.get('mediaToken') })
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    })
  })
  await page.goto('/docs')
  const result = await page.evaluate(async ({ mediaToken }) => {
    const { activateProject } = await import('/src/lib/project-api.ts')
    const { mediaSourceUrl } = await import('/src/lib/api.ts')
    const { selectProjectSession } = await import('/src/lib/session.ts')
    const stop = activateProject({ id: 'default', name: 'Synthetic media project', sessionId: 'u_mediaowner', mediaToken, version: 1, createdAt: '', updatedAt: '' })
    const url = mediaSourceUrl('poster.png')
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('native media tag did not load'))
      image.src = url
    })
    stop()
    selectProjectSession('p_other')
    return { url, width: image.naturalWidth, nextUrl: mediaSourceUrl('poster.png') }
  }, { mediaToken })
  expect(result.width).toBe(1)
  expect(result.url).toContain(`mediaToken=${mediaToken}`)
  expect(result.url).not.toContain(loginToken)
  expect(result.nextUrl).not.toContain('mediaToken')
  expect(requests).toEqual([{ authorization: undefined, mediaToken }])
})
