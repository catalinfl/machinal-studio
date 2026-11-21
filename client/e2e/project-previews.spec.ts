import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import type { CompositionInput } from '../src/lib/composition-types'
import type { PreparedComposition } from '../src/lib/project-presentation'

function preparedFixture(): PreparedComposition {
  const output = { aspect: 'landscape' as const, resolution: '720p' as const, fps: 30, format: 'mp4' as const, quality: 'normal' as const }
  const tracks = [{ id: 'video', type: 'video' as const, name: 'Prepared video', muted: false, hidden: false, locked: false,
    clips: [{ id: 'prepared-clip', assetId: 'poster', start: 0, inPoint: 0, outPoint: 5, playbackRate: 1, volume: 0,
      transform: { zoomX: 1, zoomY: 1, linkZoom: true, positionX: 0, positionY: 0, rotation: 0, anchorX: 0.5, anchorY: 0.5,
        pitch: 0, yaw: 0, flipH: false, flipV: false }, transformKeyframes: [], opacity: 1, fadeIn: 0, fadeOut: 0 }] }]
  return {
    updatedAt: '2026-11-06T12:00:00Z', jobId: 'completed-render', filename: 'render_fixture.mp4',
    document: { version: 1, mode: 'assemble', tracks, output }, bindings: {},
    composition: { id: 'prepared-composition', compilerVersion: '1', catalogVersion: '1', documentRevision: 'revision', duration: 5,
      output, assets: [{ id: 'poster', file: 'poster.png', version: 'sha256:fixture', kind: 'image', duration: 5, width: 640, height: 360 }],
      tracks, effects: [], transitions: [], textItems: [], textRenderKey: '', segments: {} },
  }
}

async function mediaFixture(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const context = canvas.getContext('2d')!
    context.fillStyle = '#152f46'
    context.fillRect(0, 0, 640, 360)
    context.fillStyle = '#9ba8ff'
    context.fillRect(48, 48, 112, 8)
    context.font = 'bold 36px sans-serif'
    context.fillStyle = '#ffffff'
    context.fillText('Prepared project', 48, 172)
    context.font = '18px sans-serif'
    context.fillStyle = '#c2cddd'
    context.fillText('Synthetic test fixture', 48, 214)
    const image = canvas.toDataURL('image/png').split(',')[1]
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks: Blob[] = []
    recorder.ondataavailable = event => chunks.push(event.data)
    const finished = new Promise<string>(resolve => { recorder.onstop = async () => {
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
      resolve(btoa(String.fromCharCode(...bytes)))
    } })
    recorder.start()
    for (let frame = 0; frame < 36; frame++) {
      context.fillStyle = frame % 2 ? '#152f46' : '#9ba8ff'
      context.fillRect(600, 312, 8, 8)
      await new Promise(requestAnimationFrame)
    }
    recorder.stop()
    const video = await finished
    stream.getTracks().forEach(track => track.stop())
    return { image, video }
  })
}

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`local projects expose editable YAML without cloud or login at ${width}px ${theme}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 })
      const media = await mediaFixture(page)
      const prepared = preparedFixture()
      const now = prepared.updatedAt
      const records = new Map<string, any>([
        ['default', { id: 'default', name: 'Empty workspace', sessionId: 'u_local', version: 2, createdAt: now, updatedAt: now, state: null }],
        ['p_prepared', { id: 'p_prepared', name: 'Prepared film', sessionId: 'p_prepared', version: 1, createdAt: now, updatedAt: now,
          state: null, presentation: { prepared, lastRender: prepared } }],
      ])
      const forbidden: string[] = []
      let compilerAvailable = true
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === baseURL) return route.fallback()
        forbidden.push(`${url.origin}${url.pathname}`)
        return route.fulfill({ status: 404, body: 'No unmocked services in this local fixture' })
      })
      page.on('request', request => {
        if (request.headers().authorization) forbidden.push('Unexpected Authorization header')
      })
      await page.addInitScript(theme => {
        localStorage.setItem('scrub-theme', theme)
        localStorage.setItem('scrub:welcome-dismissed', '1')
      }, theme)
      await page.route('**/settings/openrouter', route => route.fulfill({ json: { configured: false } }))
      await page.route('**/sessions**', route => route.fulfill({ json: {} }))
      await page.route(url => url.pathname.startsWith('/projects'), route => {
        const id = new URL(route.request().url()).pathname.split('/')[2]
        if (route.request().method() === 'GET') return route.fulfill({ json: id ? records.get(id) : [...records.values()].map(({ state, presentation, ...summary }) => summary) })
        const project = records.get(id)!
        const body = route.request().postDataJSON()
        if (body.version !== project.version) return route.fulfill({ status: 409 })
        Object.assign(project, body, { version: project.version + 1 })
        const { state, presentation, ...summary } = project
        return route.fulfill({ json: summary })
      })
      await page.route(url => url.pathname === '/list', route => route.fulfill({ json: [] }))
      await page.route(url => ['/download', '/thumbnail'].includes(url.pathname), route => {
        const video = new URL(route.request().url()).searchParams.get('file') === 'render_fixture.mp4'
        return route.fulfill({ contentType: video ? 'video/webm' : 'image/png', body: Buffer.from(video ? media.video : media.image, 'base64') })
      })
      await page.route(url => url.pathname === '/media-metadata', route => route.fulfill({ json: { duration: 5, width: 640, height: 360 } }))
      await page.route(url => url.pathname === '/compositions/compile', route => {
        if (!compilerAvailable) return route.fulfill({ status: 503, body: 'Local compiler unavailable' })
        const input = route.request().postDataJSON() as CompositionInput
        const document = input.document as NonNullable<PreparedComposition['document']>
        const composition = structuredClone(prepared.composition!)
        composition.tracks[0].name = document.tracks![0].name!
        return route.fulfill({ json: {
          document, composition, expectedRevision: input.snapshot!.revision,
          diagnostics: [], requirements: [], summary: 'Local recipe applied.',
        } })
      })
      await page.route(url => url.pathname.startsWith('/ai/') || url.pathname === '/renders' || url.pathname.includes('compile-and-generate') || url.pathname.startsWith('/billing') || url.pathname.startsWith('/api/collections'), route => {
        forbidden.push(route.request().url())
        return route.fulfill({ status: 500, body: 'Opening must not generate, render, authenticate or bill' })
      })
      await page.goto('/editor')
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      await page.getByRole('button', { name: /Prepared film/ }).click()
      await expect(page.locator('[data-timeline-clip-id="prepared-clip"]')).toHaveCount(1)
      await expect.poll(() => records.get('p_prepared').state?.preparedCompositionId).toBe('prepared-composition')
      await page.getByRole('button', { name: 'Projects', exact: true }).click()
      const panel = page.getByRole('dialog', { name: 'Projects', exact: true })
      await expect(panel.getByText('Recipe → Code DSL', { exact: true })).toBeVisible()
      await expect(panel.getByRole('link', { name: /log in/i })).toHaveCount(0)
      await expect(panel.getByRole('heading', { name: 'Last render' })).toBeVisible()
      const video = panel.getByLabel('Last rendered video')
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(640)
      await video.evaluate((element: HTMLVideoElement) => element.play())
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.ended)).toBe(true)
      await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 0 })
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
      const downloaded = page.waitForEvent('download')
      await panel.getByRole('button', { name: 'Download render JSON' }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe('render_fixture.mp4.edit.json')
      const json = JSON.parse(await readFile((await download.path())!, 'utf8'))
      expect(json.document).toEqual(prepared.document)
      expect(json.assets).toEqual(prepared.composition!.assets)
      await page.screenshot({ path: resolve(`../.impeccable/review/project-previews-local-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
      await panel.getByRole('button', { name: 'Close projects' }).click()
      await page.getByRole('button', { name: 'Recipe', exact: true }).click()
      const recipe = page.getByRole('dialog', { name: 'Video recipe' })
      await recipe.getByRole('tab', { name: 'Code DSL' }).click()
      const source = recipe.getByRole('textbox', { name: 'Recipe', exact: true })
      await expect(source).toHaveValue(/poster\.png/)
      const original = parse(await source.inputValue())
      expect(original.document.tracks[0].clips[0]).toMatchObject({ id: 'prepared-clip', assetId: 'poster', start: 0, outPoint: 5 })
      expect(original.assets).toEqual(prepared.composition!.assets)
      await page.screenshot({ path: resolve(`../.impeccable/review/local-project-yaml-${width}-${theme}.png`), fullPage: true, animations: 'disabled' })
      const yamlDownload = page.waitForEvent('download')
      await recipe.getByRole('button', { name: 'Save YAML', exact: true }).click()
      const yamlFile = await yamlDownload
      expect(yamlFile.suggestedFilename()).toBe('composition.edit.yaml')
      const exported = parse(await readFile((await yamlFile.path())!, 'utf8'))
      expect(exported.document.tracks).toEqual(original.document.tracks)
      expect(exported.assets).toEqual(original.assets)
      await source.fill((await source.inputValue()).replace('name: Prepared video', 'name: Reviewed locally'))
      await recipe.getByRole('button', { name: 'Compile and apply' }).click()
      await expect(recipe.getByRole('status')).toHaveText('Local recipe applied.')
      await expect.poll(() => records.get('p_prepared').state?.timeline.channels[0].name).toBe('Reviewed locally')
      await recipe.getByRole('button', { name: 'Close video recipe' }).click()
      await page.reload()
      await expect(page.locator('[data-timeline-clip-id="prepared-clip"]')).toHaveCount(1)
      await page.getByRole('button', { name: 'Recipe', exact: true }).click()
      await recipe.getByRole('tab', { name: 'Code DSL' }).click()
      await expect(source).toHaveValue(/Reviewed locally/)
      await recipe.getByRole('button', { name: 'Close video recipe' }).click()
      compilerAvailable = false
      const project = records.get('p_prepared')!
      project.state.timeline.channels[0].clips[0].id = 'manual-clip'
      project.state.timeline.documentSession.kind = 'dirty'
      project.presentation = structuredClone(project.presentation)
      project.presentation.prepared.composition.id = 'new-compiled-version'
      await page.reload()
      await expect(page.locator('[data-timeline-clip-id="manual-clip"]')).toHaveCount(1)
      expect(forbidden).toEqual([])
      expect(await page.evaluate(() => localStorage.getItem('pocketbase_auth'))).toBeNull()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  }
}
