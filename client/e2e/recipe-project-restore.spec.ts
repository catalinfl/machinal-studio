import { expect, test } from '@playwright/test'
import type { Composition, CompositionInput } from '../src/lib/composition-types'
import type { SavedProject } from '../src/lib/project-api'
import type { ProjectState } from '../src/lib/project-state'

test('reopening an empty saved project clears the old recipe duration error', async ({ page }) => {
  const user = { id: 'recipecreator', name: 'Recipe Creator', email: 'recipe@example.test', isPaid: true, collectionName: 'users' }
  const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
  const composition: Composition = {
    id: 'empty', documentRevision: 'empty', compilerVersion: '1', catalogVersion: '1', duration: 0, textRenderKey: 'empty',
    output: { aspect: 'landscape', resolution: '1080p', fps: 30, format: 'mp4', quality: 'normal' },
    tracks: [{ id: 'video', name: 'Video', type: 'video', clips: [], muted: false, hidden: false, locked: false }],
    assets: [], effects: [], transitions: [], textItems: [], segments: {},
  }
  const now = new Date().toISOString()
  const project: SavedProject = {
    id: 'empty', name: 'Empty project', sessionId: 'p_empty', version: 2, createdAt: now, updatedAt: now,
    state: {
      schemaVersion: 1, media: [],
      timeline: {
        channels: composition.tracks, effectBlocks: [], transitions: [], textItems: [], fps: 30, resolution: '1080p', projectAspect: 'landscape',
        currentTime: 0, selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [],
        documentSession: {
          kind: 'error', message: 'duration: composition duration must be positive and at most 24 hours',
          document: { version: 1, mode: 'assemble', tracks: composition.tracks, output: composition.output },
          composition, assets: [], bindings: {},
        },
      },
    },
  }
  let releaseProject!: () => void
  const mounted = new Promise<void>((resolve) => { releaseProject = resolve })
  let compilations = 0

  await page.addInitScript(({ user, token }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record: user, token }))
  }, { user, token })
  await page.route('**/api/collections/users/auth-refresh', (route) => route.fulfill({ json: { token, record: user } }))
  await page.route('**/sessions**', (route) => route.fulfill({ json: {} }))
  await page.route('**/list*', (route) => route.fulfill({ json: [] }))
  await page.route((url) => url.pathname.startsWith('/projects'), async (route) => {
    const request = route.request()
    const id = new URL(request.url()).pathname.split('/')[2]
    if (request.method() === 'GET' && id) {
      await mounted
      return route.fulfill({ json: project })
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { state: ProjectState }
      project.state = body.state
      project.version++
    }
    const { state, ...summary } = project
    return route.fulfill({ json: id ? summary : [summary] })
  })
  await page.route(/\/compositions\/compile(?:\?.*)?$/, async (route) => {
    expect(new URL(route.request().url()).searchParams.get('draft')).toBe('true')
    const input = route.request().postDataJSON() as CompositionInput
    compilations++
    await route.fulfill({ json: {
      document: input.document, composition, expectedRevision: input.snapshot!.revision,
      diagnostics: [], requirements: [], summary: '0 clips, 0s.',
    } })
  })

  await page.goto('/editor')
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
  releaseProject()
  await expect.poll(() => compilations).toBe(1)
  await page.getByRole('button', { name: 'Recipe', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Video recipe' })
  await expect(dialog.locator('.error')).toHaveCount(0)
  await expect(dialog.locator('.recipe-status')).toHaveText('Draft')
  await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(0)
  await expect.poll(() => project.state?.timeline.documentSession?.kind).toBe('ready')

  await page.reload()
  await page.getByRole('button', { name: 'Recipe', exact: true }).click()
  await expect(dialog.locator('.error')).toHaveCount(0)
  await expect(dialog.locator('.recipe-status')).toHaveText('Draft')
  expect(compilations).toBe(1)
})
