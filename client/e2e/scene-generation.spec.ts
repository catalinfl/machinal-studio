import { expect, test, type Page, type Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileComponent } from '../../services/scene-renderer/render.mjs'
import { multimediaComponent, colorVideoSource } from '../../services/scene-renderer/multimedia-fixture.mjs'

const user = { id: 'scenecreator1234', name: 'Scene Creator', email: 'scenes@example.test', isPaid: true, collectionName: 'users' }
const token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`
const jobID = 'a'.repeat(32)
const fixture = readFileSync(resolve('../services/scene-renderer/out/scene-integration-fixture.mp4'))
const liveSource = JSON.parse(readFileSync(resolve('../services/scene-renderer/out/live-scene-fixture.json'), 'utf8'))
const canvasSource = JSON.parse(readFileSync(resolve('../services/scene-renderer/out/live-canvas-fixture.json'), 'utf8'))
const imageSource = JSON.parse(readFileSync(resolve('../services/scene-renderer/out/live-image-fixture.json'), 'utf8'))

async function settlePreview(dialog: Locator) {
  await expect(dialog.getByRole('button', { name:'Play scene', exact:true })).toBeEnabled()
  await dialog.getByLabel('Scene preview time').evaluate(element => {
    const input = element as HTMLInputElement
    input.value = '0.2'
    input.dispatchEvent(new Event('input', { bubbles:true }))
  })
  await expect(dialog.frameLocator('iframe').getByRole('heading',{name:'A growing idea'})).toBeVisible()
}

function scene(index: number, voice = false, source = liveSource) {
  const file = `ai_scene_${jobID}_${String(index).padStart(2, '0')}.scene.json`
  return {
    id: `${jobID}_${index}`, title: index === 1 ? 'A growing idea' : 'Branches unfold', brief: 'A seed moves into view as the idea takes shape.', start: index - 1, end: index,
    component: source.component,
    explanation: source.explanation ?? '',
    asset: { id: `${jobID}_${index}`, file, version: `sha256:${'b'.repeat(64)}`, kind: 'video', duration: 1, width: 320, height: 180, hasAudio: false },
    manifest: null,
    source: { ...source, ...(voice ? { audio:{ file:'narration.wav',start:index-1,duration:2 } } : {}) },
  }
}

async function setup(page: Page, voice = false, source = liveSource) {
  page.on('pageerror', error => console.error('Editor browser error:', error.message))
  let created = false
  let completed = false
  let stopped = false
  let failPoll = false
  let jobs = 0
  let editing = false
  const uploads: string[] = []
  let submitted: Record<string, unknown> | undefined
  await page.addInitScript(({ user, token }) => {
    if (window !== window.top) return
    localStorage.setItem('pocketbase_auth', JSON.stringify({ record:user, token }))
    localStorage.setItem('scrub-project-session-id', `u_${user.id}`)
  }, { user, token })
  await page.route('**/api/collections/users/auth-refresh', route => route.fulfill({ json:{ token, record:user } }))
  await page.route('**/sessions**', route => route.fulfill({ json:{ id:`u_${user.id}` } }))
  const now = new Date().toISOString()
  const project = {id:'scene-project',name:'Scene test',sessionId:`u_${user.id}`,version:1,createdAt:now,updatedAt:now,state:null}
  await page.route(url => url.pathname.startsWith('/projects'), route => {
    if (route.request().method() === 'GET') return route.fulfill({json:new URL(route.request().url()).pathname === '/projects' ? [project] : project})
    project.version++
    return route.fulfill({json:project})
  })
  await page.route(url => url.pathname === '/list', route => route.fulfill({ json:[] }))
  await page.route(url => url.pathname === '/thumbnail', route => route.fulfill({ status:404 }))
  await page.route(url => url.pathname === '/waveform', route => route.fulfill({ status:404 }))
  await page.route(url => url.pathname === '/download', route => route.request().url().includes('.scene.json') ? route.fulfill({json:source}) : route.fulfill({ contentType:'video/mp4', body:fixture }))
  await page.route(url => url.pathname === '/audio-preview', route => route.fulfill({contentType:'audio/wav',body:fixture}))
  await page.route(url => url.pathname === '/upload', route => { uploads.push(route.request().postData() ?? ''); return route.fulfill({ body:'Upload successful' }) })
  await page.route(url => url.pathname.startsWith('/ai/scenes'), async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    expect(route.request().headers()['x-session-id']).toBe(`u_${user.id}`)
    const method = route.request().method()
    if (method === 'POST') {
      created = true
      jobs++
      const input = route.request().postDataJSON()
      submitted = input
      if (input.sourceFile) {
        editing = true
        expect(input.prompt).toBe('Make the background warmer, keeping the attached image.')
        expect(input.duration).toBe(2)
        expect(input.images).toBeUndefined()
        expect(input.audioFile).toBeUndefined()
        return route.fulfill({ status:202, json:{ id:'c'.repeat(32), status:'queued', message:'Editing scene', progress:0, scenes:[] } })
      }
      expect(input.duration).toBe(8)
      if (voice) expect(input.audioFile).toBe('narration.wav')
      else expect(input.prompt).toContain('growing tree')
      return route.fulfill({ status:202, json:{ id:jobID, status:'queued', message:'Preparing scene', progress:0, scenes:[] } })
    }
    if (method === 'DELETE') { stopped = true; return route.fulfill({ status:204 }) }
    if (failPoll) { failPoll = false; return route.fulfill({ status:503, body:'Connection interrupted' }) }
    if (editing) {
      const result = scene(1, voice, { ...source, config:{ ...source.config, durationInFrames:source.config.fps * 2 } })
      result.id = 'edited-scene'
      result.title = 'Edited scene'
      result.brief = 'A warmer growing idea.'
      result.asset = { ...result.asset, id:result.id, file:`ai_scene_${'c'.repeat(32)}_01.scene.json`,duration:2 }
      return route.fulfill({ json:{ id:'c'.repeat(32), status:'completed', message:'Scene updated', progress:1, scenes:[result] } })
    }
    return route.fulfill({ json:{ id:jobID, status:stopped ? 'cancelled' : completed ? 'completed' : 'generating', message:completed ? 'Scenes ready' : 'Writing the Svelte component', progress:completed ? 1 : .2, transcript:voice ? 'The seed grows. Its branches unfold.' : '', scenes:completed ? voice ? [scene(1,true,source),scene(2,true,source)] : [scene(1,false,source)] : [] } })
  })
  await page.goto('/editor')
  await page.getByRole('button', { name:'Generate scenes', exact:true }).click()
  return { finish:() => { completed = true }, created:() => created, stopped:() => stopped, failNextPoll:() => { failPoll = true }, jobCount:() => jobs, uploads, submitted:() => submitted }
}

async function multimediaSource() {
  const config = {width:320,height:180,fps:10,durationInFrames:10}
  const videos = {video_1:colorVideoSource()}
  const {javascript} = await compileComponent({component:multimediaComponent,config,videos})
  return {version:1,component:multimediaComponent,javascript,config,videos,explanation:'A rotating 3D cube alongside silent, frame-synchronized footage with a black-and-white treatment.'}
}

test('3D design, separate copy and video looks survive reopening and produce moving timeline frames', async ({page}) => {
  const source = await multimediaSource()
  const control = await setup(page,false,source)
  const dialog = page.getByRole('dialog',{name:'Generate scenes',exact:true})
  await dialog.getByLabel('Text to display (optional)').fill('Salut {lume}!')
  await dialog.getByLabel('What should happen in this scene?').fill('A growing tree in 3D beside the attached footage.')
  await dialog.getByLabel('Scene design').selectOption('3d')
  await dialog.getByLabel('Videos to include',{exact:true}).setInputFiles({name:'Footage.mp4',mimeType:'video/mp4',buffer:Buffer.from(source.videos.video_1.split(',')[1],'base64')})
  await dialog.getByLabel('Video look',{exact:true}).selectOption('noir')
  await dialog.getByLabel('How should AI use this video?').fill('Show the footage on the right with a slow zoom.')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Generate scenes',exact:true}).click()
  await expect(dialog.getByLabel('Text to display (optional)')).toHaveValue('Salut {lume}!')
  await expect(dialog.getByLabel('Scene design')).toHaveValue('3d')
  await expect(dialog.getByLabel('Video look',{exact:true})).toHaveValue('noir')
  await dialog.getByRole('button',{name:'Generate scene',exact:true}).click()
  control.finish()
  await expect(dialog.getByRole('button',{name:'Play scene',exact:true})).toBeEnabled()
  expect(control.submitted()).toMatchObject({text:'Salut {lume}!',visualMode:'3d',videos:[{id:'video_1',name:'Footage.mp4',file:expect.stringMatching(/^scene_video_.*\.mp4$/),look:'noir',description:'Show the footage on the right with a slow zoom.'}]})
  expect(control.uploads).toHaveLength(1)
  await expect(dialog.frameLocator('iframe').getByLabel('3D scene',{exact:true})).toBeVisible()
  await expect(dialog.frameLocator('iframe').getByLabel('Scene video',{exact:true})).toBeVisible()
  await dialog.getByText('AI design notes',{exact:true}).click()
  await expect(dialog.getByText(source.explanation,{exact:true})).toBeVisible()
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900})
    await dialog.getByText(source.explanation,{exact:true}).scrollIntoViewIfNeeded()
    await page.screenshot({path:`../.impeccable/review/scenes-multimedia-result-${width}.png`,animations:'disabled'})
  }
  await dialog.getByRole('button',{name:'Add scene to timeline',exact:true}).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  await page.keyboard.press('Escape')
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(1)
  const captured = await page.evaluate(async source => {
    const {LiveScenePlayer} = await import('/src/lib/live-scene.ts')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-100000px;top:0'
    document.body.appendChild(host)
    const player = new LiveScenePlayer(source,host)
    try {
      const pixels = []
      for (const time of [.1,.7,.1]) {
        const bitmap = await player.seek(time,true,true)
        const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap!,0,0); bitmap!.close()
        pixels.push(Array.from(context.getImageData(240,90,1,1).data))
      }
      return pixels
    } finally {player.dispose();host.remove()}
  },source)
  expect(captured[0]).toEqual(captured[2])
  expect(captured[0][0]).toBeGreaterThan(captured[1][0]+30)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('restored 3D scenes do not repeatedly download their JSON source as video', async ({ page }) => {
  const source = await multimediaSource()
  const control = await setup(page, false, source)
  const dialog = page.getByRole('dialog', { name: 'Generate scenes', exact: true })
  await dialog.getByLabel('What should happen in this scene?').fill('A growing tree in 3D.')
  await dialog.getByRole('button', { name: 'Generate scene', exact: true }).click()
  control.finish()
  await expect(dialog.getByRole('button', { name: 'Play scene', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Add scene to timeline', exact: true }).click()
  await page.keyboard.press('Escape')

  const mediaRequests: string[] = []
  page.on('request', request => {
    if (request.resourceType() === 'media' && request.url().includes('.scene.json')) mediaRequests.push(request.url())
  })
  await page.evaluate(async () => {
    const { captureProjectState, restoreProjectState } = await import('/src/lib/project-state.ts')
    await restoreProjectState(captureProjectState(), 'scene-preview-regression')
  })
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(1)
  await page.waitForTimeout(1500)
  expect(mediaRequests).toHaveLength(0)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    const { editor } = await import(/* @vite-ignore */ path)
    const { mediaSourceUrl } = await import('/src/lib/api.ts')
    const clip = editor.channels.flatMap(channel => channel.clips).find(clip => clip.fileName.endsWith('.scene.json'))!
    clip.scrubBlobUrl = mediaSourceUrl(clip.fileName)
    editor.setCurrentTime(0.2)
    editor.setPlaying(true)
  })
  await page.waitForTimeout(1200)
  expect(mediaRequests).toHaveLength(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const width of [1440,390]) for (const theme of ['light','dark']) {
  test(`multimedia scene authoring at ${width}px in ${theme}`,async ({page}) => {
    await page.setViewportSize({width,height:900})
    await page.addInitScript(theme => {if (window === window.top) localStorage.setItem('scrub-theme',theme)},theme)
    await setup(page)
    const dialog = page.getByRole('dialog',{name:'Generate scenes',exact:true})
    await dialog.getByLabel('Text to display (optional)').fill('A world of ideas')
    await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree in 3D over the attached video.')
    await dialog.getByLabel('Scene design').selectOption('3d')
    await dialog.getByLabel('Videos to include',{exact:true}).setInputFiles({name:'Footage-with-a-long-descriptive-filename.mp4',mimeType:'video/mp4',buffer:fixture})
    await dialog.getByLabel('Video look',{exact:true}).selectOption('cinematic')
    await dialog.getByLabel('How should AI use this video?').fill('Slow zoom with a title reveal.')
    await expect(dialog.getByRole('button',{name:'Generate scene',exact:true})).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await dialog.locator('.workspace-content').evaluate(element => element.scrollTop = 0)
    await page.screenshot({path:`../.impeccable/review/scenes-multimedia-${width}-${theme}.png`,animations:'disabled'})
    await dialog.getByLabel('Scene design').scrollIntoViewIfNeeded()
    await dialog.getByLabel('How should AI use this video?').scrollIntoViewIfNeeded()
    await page.screenshot({path:`../.impeccable/review/scenes-multimedia-controls-${width}-${theme}.png`,animations:'disabled'})
    await dialog.getByRole('button',{name:'Remove Footage-with-a-long-descriptive-filename.mp4'}).click()
    await expect(dialog.getByLabel('Video look',{exact:true})).toHaveCount(0)
  })
}

test('prompt generates a previewable scene, survives closing, and inserts undoably', async ({ page }, testInfo) => {
  const control = await setup(page)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree with unfolding branches.')
  await dialog.getByRole('button', { name:'Generate scene', exact:true }).click()
  await expect.poll(control.created).toBe(true)
  await expect(dialog.getByRole('progressbar')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  control.finish()
  await page.getByRole('button', { name:'Generate scenes', exact:true }).click()
  await expect(dialog.getByRole('button', { name:'Add scene to timeline' })).toBeVisible()
  await settlePreview(dialog)
  await dialog.getByRole('button', { name:'Add scene to timeline' }).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  const clips = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    const { editor } = await import(/* @vite-ignore */ path)
    return editor.channels.flatMap((channel: { clips: unknown[] }) => channel.clips)
  })
  expect(clips).toEqual(expect.arrayContaining([expect.objectContaining({ start:0, outPoint:1, sourceMode:'proxy' })]))
  await page.keyboard.press('Escape')
  const canvas = page.locator('.stage').first()
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(1)
  await expect(page.frameLocator('iframe[title="Live generated scene"]').getByRole('heading',{name:'A growing idea'})).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)')
  await page.waitForTimeout(400)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const firstFrame = await canvas.screenshot()
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    ;(await import(/* @vite-ignore */ path)).editor.setCurrentTime(.6)
  })
  await expect(page.frameLocator('iframe[title="Live generated scene"]').getByRole('heading',{name:'A growing idea'})).toHaveCSS('transform','matrix(1, 0, 0, 1, 48, 0)')
  await page.waitForTimeout(400)
  const laterFrame = await canvas.screenshot({path:testInfo.outputPath('scenes-live-timeline.png')})
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(firstFrame.equals(laterFrame)).toBe(false)
  await page.getByRole('button', { name:'Undo last edit' }).click()
  expect(await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    return (await import(/* @vite-ignore */ path)).editor.channels.flatMap((channel: { clips: unknown[] }) => channel.clips).length
  })).toBe(0)
})

test('voice produces independently selectable scenes and linked narration', async ({ page }) => {
  const control = await setup(page,true)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  await dialog.getByRole('button', { name:'From a voice' }).click()
  await dialog.getByLabel('Voice recording', { exact:true }).setInputFiles({ name:'narration.wav', mimeType:'audio/wav', buffer:Buffer.from('fixture-upload') })
  await dialog.getByRole('button', { name:'Generate scene', exact:true }).click()
  control.finish()
  await expect(dialog.getByRole('button', { name:/02 Branches unfold/ })).toBeVisible()
  await dialog.getByRole('button', { name:/02 Branches unfold/ }).click()
  await dialog.getByRole('button', { name:'Add scene to timeline' }).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  const clips = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    return (await import(/* @vite-ignore */ path)).editor.channels.flatMap((channel: { clips: unknown[] }) => channel.clips)
  })
  expect(clips).toHaveLength(2)
  expect(clips).toEqual(expect.arrayContaining([expect.objectContaining({ mediaKind:'audio', linkedClipId:expect.any(String) })]))
})

test('generation can be stopped and retried', async ({ page }) => {
  const control = await setup(page)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree')
  await dialog.getByRole('button', { name:'Generate scene', exact:true }).click()
  await dialog.getByRole('button', { name:'Stop generation' }).click()
  await expect.poll(control.stopped).toBe(true)
  await expect(dialog.getByRole('button', { name:'Generate again' })).toBeEnabled()
})

test('status recovery resumes the original job without generating again', async ({ page }) => {
  const control = await setup(page)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  control.failNextPoll()
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree')
  await dialog.getByRole('button', { name:'Generate scene', exact:true }).click()
  await expect(dialog.getByRole('button', { name:'Retry status' })).toBeVisible()
  control.finish()
  await dialog.getByRole('button', { name:'Retry status' }).click()
  await expect(dialog.getByRole('button', { name:'Add scene to timeline' })).toBeVisible()
  expect(control.jobCount()).toBe(1)
})

test('retained voice is visible after reopening and can be cleared', async ({ page }) => {
  await setup(page,true)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  await dialog.getByRole('button', { name:'From a voice' }).click()
  await dialog.getByLabel('Voice recording', { exact:true }).setInputFiles({ name:'narration.wav', mimeType:'audio/wav', buffer:Buffer.from('voice') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name:'Generate scenes', exact:true }).click()
  await expect(dialog.getByText('narration.wav', { exact:true })).toBeVisible()
  await expect(dialog.getByRole('button', { name:'Replace recording' })).toBeVisible()
  await dialog.getByRole('button', { name:'Clear recording' }).click()
  await expect(dialog.getByText('No recording selected')).toBeVisible()
  await expect(dialog.getByRole('button', { name:'Generate scene', exact:true })).toBeDisabled()
})

test('images survive reopening, upload once per generation and appear in captured timeline frames', async ({ page }) => {
  const control = await setup(page, false, imageSource)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  const imageBytes = Buffer.from(imageSource.images.image_1.split(',')[1], 'base64')
  await dialog.getByLabel('Images to include', {exact:true}).setInputFiles({name:'Product cutout.png',mimeType:'image/png',buffer:imageBytes})
  await dialog.getByLabel('How should AI use this image?').fill('Show this product cutout on the right.')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name:'Generate scenes', exact:true }).click()
  await expect(dialog.getByText('Product cutout.png', {exact:true})).toBeVisible()
  await expect(dialog.getByLabel('How should AI use this image?')).toHaveValue('Show this product cutout on the right.')
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree beside the attached product.')
  await dialog.getByRole('button', {name:'Generate scene',exact:true}).click()
  control.finish()
  await settlePreview(dialog)
  expect(control.uploads).toHaveLength(1)
  expect(control.submitted()?.images).toEqual([expect.objectContaining({id:'image_1',name:'Product cutout.png',file:expect.stringMatching(/^scene_image_.*\.png$/),description:'Show this product cutout on the right.'})])
  const image = dialog.frameLocator('iframe').getByAltText('Attached product')
  await expect(image).toBeVisible()
  expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(2)
  await dialog.getByRole('button', {name:'Add scene to timeline'}).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  await page.keyboard.press('Escape')
  const pixels = await page.evaluate(async source => {
    const { LiveScenePlayer } = await import('/src/lib/live-scene.ts')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
    document.body.appendChild(host)
    const player = new LiveScenePlayer(source, host)
    try {
      const bitmap = await player.seek(.6, true, true)
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 180
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap!, 0, 0); bitmap!.close()
      return [Array.from(ctx.getImageData(80,120,1,1).data), Array.from(ctx.getImageData(240,120,1,1).data)]
    } finally { player.dispose(); host.remove() }
  }, imageSource)
  expect(pixels).toEqual([[37,244,238,255],[255,0,0,255]])
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('attachment limits and removal leave the scene brief usable', async ({ page }) => {
  await setup(page)
  const dialog = page.getByRole('dialog', {name:'Generate scenes',exact:true})
  const imageBytes = Buffer.from(imageSource.images.image_1.split(',')[1], 'base64')
  await dialog.getByLabel('Images to include', {exact:true}).setInputFiles(Array.from({length:5}, (_,i) => ({name:`product${i}.png`,mimeType:'image/png',buffer:imageBytes})))
  await expect(dialog.getByRole('alert')).toContainText('4 images')
  await dialog.getByLabel('Images to include', {exact:true}).setInputFiles({name:'product.png',mimeType:'image/png',buffer:imageBytes})
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', {name:'Remove product.png'}).click()
  await expect(dialog.getByText('product.png', {exact:true})).toHaveCount(0)
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree.')
  await expect(dialog.getByRole('button', {name:'Generate scene',exact:true})).toBeEnabled()
})

test('edits the previewed scene in the generator and adds the revised source', async ({ page }) => {
  const control = await setup(page, false, imageSource)
  const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree with the product.')
  await dialog.getByRole('button', { name:'Generate scene', exact:true }).click()
  control.finish()
  await settlePreview(dialog)
  await dialog.getByRole('button', { name:'Edit scene', exact:true }).click()
  await dialog.getByLabel('What should change?', { exact:true }).fill('Make the background warmer, keeping the attached image.')
  await dialog.getByLabel('Scene length (seconds)', { exact:true }).fill('2')
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900})
    await dialog.getByRole('button', { name:'Update scene', exact:true }).scrollIntoViewIfNeeded()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({path:`../.impeccable/review/scene-edit-${width}.png`,animations:'disabled'})
  }
  await dialog.getByRole('button', { name:'Update scene', exact:true }).click()
  await expect(dialog.getByRole('heading', { name:'Edited scene', exact:true })).toBeVisible()
  await expect(dialog.frameLocator('iframe').getByAltText('Attached product')).toBeVisible()
  expect(control.jobCount()).toBe(2)
  expect(control.submitted()?.sourceFile).toBe(`ai_scene_${jobID}_01.scene.json`)
  expect(control.uploads).toHaveLength(0)
  await dialog.getByRole('button', { name:'Add scene to timeline', exact:true }).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  const clips = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts') ?? '/src/stores/editor.svelte.ts'
    const { editor } = await import(/* @vite-ignore */ path)
    return editor.channels.flatMap((channel: { clips: unknown[] }) => channel.clips)
  })
  expect(clips).toEqual(expect.arrayContaining([expect.objectContaining({fileName:`ai_scene_${'c'.repeat(32)}_01.scene.json`,outPoint:2})]))
})

for (const width of [1440,390]) for (const theme of ['light','dark']) {
  test(`scene image authoring at ${width}px in ${theme}`, async ({page}) => {
    await page.setViewportSize({width,height:900})
    await page.addInitScript(theme => { if (window === window.top) localStorage.setItem('scrub-theme',theme) },theme)
    await setup(page)
    const dialog = page.getByRole('dialog', {name:'Generate scenes',exact:true})
    await dialog.getByLabel('Images to include', {exact:true}).setInputFiles({name:'Product-cutout-with-a-long-descriptive-filename.png',mimeType:'image/png',buffer:Buffer.from(imageSource.images.image_1.split(',')[1],'base64')})
    await dialog.getByLabel('How should AI use this image?').fill('Product cutout: center it, then slowly zoom in.')
    await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree beside the attached product.')
    await expect(dialog.getByRole('button', {name:'Generate scene',exact:true})).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({path:`../.impeccable/review/scenes-images-${width}-${theme}.png`,animations:'disabled'})
  })
}

test('ordinary local export materializes a live scene only after Render is requested', async ({ page }) => {
  test.setTimeout(120000)
  const control = await setup(page, false, imageSource)
  const renderRequests:string[] = []
  page.on('request', request => { if (/\/(?:render|renders)(?:\?|$|\/)/.test(new URL(request.url()).pathname)) renderRequests.push(request.url()) })
  const dialog = page.getByRole('dialog',{name:'Generate scenes',exact:true})
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree')
  await dialog.getByRole('button',{name:'Generate scene',exact:true}).click()
  control.finish()
  await settlePreview(dialog)
  await dialog.getByRole('button',{name:'Add scene to timeline'}).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  expect(renderRequests).toHaveLength(0)
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry=>entry.name).findLast(name=>new URL(name).pathname==='/src/stores/editor.svelte.ts')!
    const {editor} = await import(/* @vite-ignore */ path)
    editor.setResolution('480p')
    editor.setFps(10)
  })
  await page.getByRole('button',{name:'Render',exact:true}).click()
  const renderDialog = page.getByRole('dialog',{name:'Render project'})
  const download = page.waitForEvent('download')
  await renderDialog.getByRole('button',{name:/Local Render on this device/}).click()
  await expect(renderDialog.getByRole('status').filter({hasText:'exported render_output.mp4'})).toBeVisible({timeout:90000})
  const exported = await download
  expect(exported.suggestedFilename()).toBe('render_output.mp4')
  const stream = await exported.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const output = Buffer.concat(chunks)
  const pixels = await page.evaluate(async bytes => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:'video/mp4'}))
    try {
      video.src = url
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Exported video failed to decode')) })
      await new Promise<void>(resolve => { video.onseeked = () => resolve(); video.currentTime = .2 })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth; canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      return [.25,.75].map(x => Array.from(ctx.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*.67),1,1).data))
    } finally { URL.revokeObjectURL(url) }
  }, Array.from(output))
  for (const [index, expected] of [[0,[37,244,238]],[1,[255,0,0]]] as const) {
    expected.forEach((channel, offset) => expect(Math.abs(pixels[index][offset] - channel), JSON.stringify(pixels)).toBeLessThan(20))
  }
  expect(renderRequests).toHaveLength(0)
})

test('canvas scene captures keep moving in an off-screen timeline iframe', async ({ page }) => {
  const control = await setup(page,false,canvasSource)
  const dialog = page.getByRole('dialog',{name:'Generate scenes',exact:true})
  await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree')
  await dialog.getByRole('button',{name:'Generate scene',exact:true}).click()
  control.finish()
  await settlePreview(dialog)
  await dialog.getByRole('button',{name:'Add scene to timeline'}).click()
  await expect(dialog).toContainText('Scene added to the timeline')
  await page.keyboard.press('Escape')
  await expect(page.locator('iframe[title="Live generated scene"]')).toHaveCount(1)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
    const { editor } = await import(/* @vite-ignore */ path)
    const channel = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    // Force capture: unfiltered scenes now present directly, including transformed ones.
    editor.addEffectBlock(channel.id, 'grayscale', 0, editor.totalDuration)
  })
  await page.waitForTimeout(500)
  const canvas = page.locator('.stage > canvas').first()
  await expect(canvas).toBeVisible()
  const before = await canvas.screenshot()
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry=>entry.name).findLast(name=>new URL(name).pathname==='/src/stores/editor.svelte.ts')!
    ;(await import(/* @vite-ignore */ path)).editor.setCurrentTime(.6)
  })
  await page.waitForTimeout(500)
  expect(before.equals(await canvas.screenshot())).toBe(false)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const width of [1440, 390]) {
  test(`Full HD scene screen selection at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const control = await setup(page)
    const dialog = page.getByRole('dialog', { name: 'Generate scenes', exact: true })
    await expect(dialog).toContainText('Full HD · 1920 × 1080')
    await dialog.getByLabel('Screen format').selectOption('portrait')
    await expect(dialog).toContainText('Full HD · 1080 × 1920')
    await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree in a vertical scene.')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('scene-format.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Generate scene', exact: true }).click()
    await expect.poll(control.submitted).toMatchObject({ width: 1080, height: 1920, fps: 30 })
  })
}

for (const width of [1440,390]) for (const theme of ['light','dark']) for (const voice of [false,true]) {
  test(`scene dialog at ${width}px in ${theme} from ${voice ? 'voice' : 'prompt'}`, async ({ page }) => {
    await page.setViewportSize({ width, height:900 })
    await page.addInitScript(theme => { if (window === window.top) localStorage.setItem('scrub-theme',theme) },theme)
    const control = await setup(page,voice)
    const dialog = page.getByRole('dialog', { name:'Generate scenes', exact:true })
    if (voice) {
      await dialog.getByRole('button', { name:'From a voice' }).click()
      await dialog.getByLabel('Voice recording', { exact:true }).setInputFiles({ name:'narration.wav', mimeType:'audio/wav', buffer:Buffer.from('fixture-upload') })
      await dialog.getByLabel('Visual direction (optional)').fill('Hand-drawn diagrams that unfold with each spoken idea.')
    } else await dialog.getByLabel('What should happen in this scene?').fill('Animate a growing tree with unfolding branches.')
    await dialog.getByRole('button', { name:'Generate scene', exact:true }).click()
    control.finish()
    await settlePreview(dialog)
    await expect(dialog.getByRole('button', { name:'Add scene to timeline' })).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path:`../.impeccable/review/scenes-live-${width}-${theme}${voice ? '-voice' : ''}.png`, animations:'disabled' })
  })
}
