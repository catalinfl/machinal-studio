import { expect, test, type Page } from '@playwright/test'
import { compileComponent } from '../../services/scene-renderer/render.mjs'
import { overlayComponent, overlayConfig } from '../../services/scene-renderer/overlay-fixture.mjs'

const user = { id: 'overlaycreator12', name: 'Overlay Creator', email: 'overlay@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
const jobId = 'd'.repeat(32)
const file = `ai_scene_${jobId}_01.scene.json`

async function setup(page: Page) {
  const source = { version: 1, component: overlayComponent, config: overlayConfig, ...(await compileComponent({ component: overlayComponent, config: overlayConfig })) }
  let submitted: Record<string, unknown> | undefined
  let background = Buffer.alloc(0)
  await page.addInitScript(({ user, token }) => {
    if (window !== window.top) return
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
    localStorage.setItem('scrub-project-session-id', `u_${user.id}`)
  }, { user, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json: { token, record: user } }))
  await page.route(url => url.pathname === '/sessions', route => route.fulfill({ json: { id: `u_${user.id}` } }))
  const now = new Date().toISOString()
  const project = { id: 'overlay-project', name: 'Overlay test', sessionId: `u_${user.id}`, version: 1, createdAt: now, updatedAt: now, state: null }
  await page.route(url => url.pathname.startsWith('/projects'), route => route.fulfill({ json: route.request().url().endsWith('/projects') ? [project] : project }))
  await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
  await page.route(url => ['/thumbnail', '/waveform'].includes(url.pathname), route => route.fulfill({ status: 404 }))
  await page.route(url => url.pathname === '/download', route => new URL(route.request().url()).searchParams.get('file') === 'blue.png'
    ? route.fulfill({ contentType: 'image/png', body: background }) : route.fulfill({ json: source }))
  const scene = { id: `${jobId}_01`, title: 'An animated arrow', brief: 'An isolated arrow draws attention to your footage.', start: 0, end: 2, component: overlayComponent, source, manifest: null, asset: { id: `${jobId}_01`, file, kind: 'video', version: `sha256:${'a'.repeat(64)}`, duration: 2, width: 320, height: 180, hasAudio: false } }
  await page.route(url => url.pathname.startsWith('/ai/scenes'), route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON()
      return route.fulfill({ status: 202, json: { id: jobId, status: 'queued', progress: 0, message: 'Preparing overlay', scenes: [] } })
    }
    return route.fulfill({ json: { id: jobId, status: 'completed', progress: 1, message: 'Overlay ready', scenes: [scene] } })
  })
  await page.goto('/editor')
  const data = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
    const { editor } = await import(/* @vite-ignore */ path)
    editor.clearTimeline()
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 180
    const context = canvas.getContext('2d')!
    context.fillStyle = '#0000ff'; context.fillRect(0, 0, 320, 180)
    const image = canvas.toDataURL()
    editor.addClip(editor.channels.find((channel: { type: string }) => channel.type === 'video').id, { fileName: 'blue.png', mediaKind: 'image', sourceMode: 'proxy', scrubBlobUrl: image, sourceDuration: 3, sourceWidth: 320, sourceHeight: 180, inPoint: 0, outPoint: 3, start: 0 })
    editor.setCurrentTime(0.5)
    editor.clearHistory()
    return image
  })
  background = Buffer.from(data.split(',')[1], 'base64')
  await page.getByRole('button', { name: 'Generate scenes', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Generate scenes', exact: true })
  await dialog.getByLabel('Scene output', { exact: true }).selectOption({ label: 'Transparent overlay' })
  await dialog.getByLabel('What should happen in this scene?').fill('Draw an animated arrow with a soft sparkle. Leave everything else transparent.')
  return { source, dialog, submitted: () => submitted }
}

for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  test(`overlay authoring and checkerboard preview at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
    const { dialog, submitted } = await setup(page)
    await expect(dialog).toContainText('Adds above your clips at the playhead.')
    await page.screenshot({ path: `../.impeccable/review/scene-overlay-authoring-${width}-${theme}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Generate scenes', exact: true }).click()
    await expect(dialog.getByLabel('Scene output', { exact: true })).toHaveValue('true')
    await dialog.getByRole('button', { name: 'Generate scene', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Play scene', exact: true })).toBeEnabled()
    expect(submitted()).toMatchObject({ transparent: true })
    await expect(dialog.frameLocator('iframe').getByLabel('Animated arrow')).toBeVisible()
    await dialog.locator('.preview').scrollIntoViewIfNeeded()
    await expect(dialog).toContainText('The checkerboard is not part of your video.')
    await expect(dialog.getByRole('button', { name: 'Add overlay to timeline', exact: true })).toBeEnabled()
    await page.screenshot({ path: `../.impeccable/review/scene-overlay-result-${width}-${theme}.png`, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('transparent overlay retains alpha in captures, timeline layering, undo and local export', async ({ page }) => {
  test.setTimeout(180000)
  const { source, dialog } = await setup(page)
  await dialog.getByRole('button', { name: 'Generate scene', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Play scene', exact: true })).toBeEnabled()
  const pixels = await page.evaluate(async source => {
    const { LiveScenePlayer } = await import('/src/lib/live-scene.ts')
    const host = document.createElement('div'); document.body.appendChild(host)
    const player = new LiveScenePlayer(source, host)
    try {
      const bitmap = await player.seek(0, true, true)
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap!, 0, 0); bitmap!.close()
      return [[300, 150], [80, 90], [240, 40]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
    } finally { player.dispose(); host.remove() }
  }, source)
  expect(pixels[0][3]).toBe(0)
  expect(pixels[1]).toEqual([255, 0, 0, 255])
  expect(pixels[2][3]).toBeCloseTo(128, 0)
  await dialog.getByRole('button', { name: 'Add overlay to timeline', exact: true }).click()
  await expect(dialog).toContainText('Overlay added above your clips')
  await page.keyboard.press('Escape')
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(1)
  const state = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
    const { editor } = await import(/* @vite-ignore */ path)
    const videos = editor.channels.filter((channel: { type: string }) => channel.type === 'video')
    const placement = { background: videos[0].clips[0].start, overlay: videos.at(-1).clips[0].start, duration: editor.totalDuration }
    editor.undo()
    const afterUndo = editor.channels.flatMap((channel: { clips: unknown[] }) => channel.clips).length
    editor.redo()
    editor.setResolution('480p'); editor.setFps(10)
    return { ...placement, afterUndo }
  })
  expect(state).toEqual({ background: 0, overlay: 0.5, duration: 3, afterUndo: 1 })
  await page.getByRole('button', { name: 'Render', exact: true }).click()
  const renderDialog = page.getByRole('dialog', { name: 'Render project' })
  const download = page.waitForEvent('download')
  await renderDialog.getByRole('button', { name: /Local Render on this device/ }).click()
  await expect(renderDialog.getByRole('status').filter({ hasText: 'exported render_output.mp4' })).toBeVisible({ timeout: 150000 })
  const exported = await download
  const chunks: Buffer[] = []
  for await (const chunk of (await exported.createReadStream())!) chunks.push(Buffer.from(chunk))
  const rendered = await page.evaluate(async bytes => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }))
    try {
      video.src = url
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Cannot decode overlay export')) })
      await new Promise<void>(resolve => { video.onseeked = () => resolve(); video.currentTime = 0.7 })
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
      const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0)
      return [[300, 150], [80, 90], [244, 40]].map(([x, y]) => [...context.getImageData(Math.floor(x / 320 * canvas.width), Math.floor(y / 180 * canvas.height), 1, 1).data])
    } finally { URL.revokeObjectURL(url) }
  }, [...Buffer.concat(chunks)])
  for (const [index, expected] of [[0, [0, 0, 255]], [1, [255, 0, 0]], [2, [128, 0, 127]]] as const) {
    expected.forEach((value, channel) => expect(Math.abs(rendered[index][channel] - value), JSON.stringify(rendered)).toBeLessThan(25))
  }
})
