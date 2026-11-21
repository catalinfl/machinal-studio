import { expect, test, type Page } from '@playwright/test'

async function openWorkspace(page: Page, theme: string) {
  await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
  await page.route('**/list*', route => route.fulfill({ json: [] }))
  await page.goto('/editor')
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  await expect(page.locator('.tl')).toBeVisible()
}

async function addPortraitProject(page: Page) {
  await page.evaluate(async () => {
    const moduleURL = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === path) ?? path
    const { registerMediaBinSource } = await import(/* @vite-ignore */ moduleURL('/src/lib/media-bin.ts'))
    const { editor } = await import(/* @vite-ignore */ moduleURL('/src/stores/editor.svelte.ts'))
    editor.clearTimeline()
    editor.setProjectAspect('portrait')
    editor.setPixelsPerSecond(40)
    const image = new Image()
    image.src = '/images/home/direction-coast-ai.png'
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 540
    canvas.height = 960
    const context = canvas.getContext('2d')!
    context.fillStyle = '#15293a'
    context.fillRect(0, 0, 540, 960)
    context.drawImage(image, 0, 300, 540, 400)
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.font = 'bold 44px sans-serif'
    context.fillText('COASTLINE', 270, 220)
    context.font = '22px sans-serif'
    context.fillText('A journey along the shore', 270, 265)
    const url = canvas.toDataURL('image/png')
    for (let index = 0; index < 22; index++) registerMediaBinSource({
      id: `portrait-source-${index}`, name: `coastline_scene_${String(index + 1).padStart(2, '0')}_a8c5127f940eb392.png`,
      kind: 'image', duration: 16, sourceMode: 'wasm', scrubBlobUrl: url, width: 540, height: 960,
    })
    const video = editor.channels.find((channel: { type: string }) => channel.type === 'video')
    const audio = editor.channels.find((channel: { type: string }) => channel.type === 'audio')
    for (let index = 0; index < 4; index++) editor.addClip(video.id, {
      fileName: `Coastline scene ${index + 1}.png`, mediaKind: 'image', scrubBlobUrl: url, sourceMode: 'wasm',
      sourceDuration: 16, sourceWidth: 540, sourceHeight: 960, inPoint: 0, outPoint: 16, start: index * 16,
    })
    editor.addClip(audio.id, {
      fileName: 'coastline_narration.wav', mediaKind: 'audio', sourceMode: 'wasm',
      sourceDuration: 64, inPoint: 0, outPoint: 64, start: 0,
    })
    for (let index = 0; index < 16; index++) editor.addTextItem(index * 4, {
      text: index === 0 ? 'A journey along the shore' : `Coastline chapter ${index + 1}`,
      duration: 3.8, isCaption: true, fontSize: 36, y: 800,
    })
  })
  await expect(page.locator('.stage canvas')).toBeVisible()
  await expect(page.locator('[data-timeline-clip-id]').first()).toBeVisible()
}

async function projectSnapshot(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
    const { editor } = await import(/* @vite-ignore */ url)
    return JSON.stringify({ channels: editor.channels, texts: editor.textItems, aspect: editor.projectAspect })
  })
}

for (const { width, height, theme } of [
  { width: 1034, height: 620, theme: 'dark' },
  { width: 1100, height: 700, theme: 'light' },
  { width: 390, height: 844, theme: 'dark' },
]) {
  test(`separates media and expands real portrait content at ${width}x${height} ${theme}`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height })
    await openWorkspace(page, theme)
    const emptyMediaButton = page.getByRole('button', { name: 'Open media library', exact: true })
    await emptyMediaButton.click()
    await page.getByRole('button', { name: 'Close tool panel', exact: true }).press('Escape')
    await expect(emptyMediaButton).toBeFocused()
    await emptyMediaButton.click()
    await addPortraitProject(page)
    await page.getByRole('button', { name: 'Close tool panel', exact: true }).click()
    const initialTools = page.getByRole('navigation', { name: width > 1024 ? 'Editor tools' : 'Editor panels' })
    await expect(initialTools.getByRole('button', { name: 'Media Bin', exact: true })).toBeFocused()
    const originalProject = await projectSnapshot(page)
    const deck = page.locator('.tool-deck')
    const preview = page.locator('.preview')
    const timeline = page.locator('.bottom')
    const canvas = preview.locator('.stage canvas')
    await expect(deck).toBeHidden()
    expect((await preview.boundingBox())!.width).toBe(width)
    const balancedCanvasHeight = (await canvas.boundingBox())!.height
    if (width > 1024) {
      expect(balancedCanvasHeight).toBeGreaterThan(195)
      await expect(page.locator('.thead.audio')).toBeInViewport()
      await expect(page.locator('.tl-toolbar')).toHaveCSS('flex-wrap', 'nowrap')
    }
    await page.screenshot({ path: testInfo.outputPath('composition.png'), animations: 'disabled' })

    await page.getByRole('button', { name: 'Expand preview', exact: true }).click()
    await expect(timeline).toBeHidden()
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(balancedCanvasHeight + 150)
    const restorePreview = page.getByRole('button', { name: 'Restore preview layout', exact: true })
    await expect(restorePreview).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('expanded-preview.png'), animations: 'disabled' })
    await restorePreview.press('Escape')
    await expect(timeline).toBeVisible()
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeCloseTo(balancedCanvasHeight, 0)

    const tools = page.getByRole('navigation', { name: width > 1024 ? 'Editor tools' : 'Editor panels' })
    const mediaButton = tools.getByRole('button', { name: 'Media Bin', exact: true })
    await mediaButton.click()
    await expect(page.locator('#media-bin-list .media-item')).toHaveCount(22)
    await expect(preview).toHaveAttribute('inert', '')
    const close = page.getByRole('button', { name: 'Close tool panel', exact: true })
    await expect(close).toBeFocused()
    await expect(page.getByRole('button', { name: 'Split at playhead' })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('separate-media.png'), animations: 'disabled' })
    await close.press('Escape')
    await expect(deck).toBeHidden()
    await expect(mediaButton).toBeFocused()
    await expect(preview).not.toHaveAttribute('inert', '')
    await mediaButton.click()
    await page.getByRole('button', { name: 'Close tool panel', exact: true }).click()
    await expect(mediaButton).toBeFocused()

    const heightBefore = (await timeline.boundingBox())!.height
    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click()
    await expect(preview).toBeHidden()
    expect((await timeline.boundingBox())!.height).toBeGreaterThan(heightBefore + 100)
    await page.screenshot({ path: testInfo.outputPath('expanded-timeline.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Restore timeline layout', exact: true }).click()
    await expect(preview).toBeVisible()
    expect((await timeline.boundingBox())!.height).toBeCloseTo(heightBefore, 0)
    expect(await projectSnapshot(page)).toBe(originalProject)
    if (width === 1034) {
      await page.setViewportSize({ width: 1279, height })
      await expect(deck).toBeHidden()
      await page.setViewportSize({ width: 1280, height: 720 })
      await expect(deck).toBeVisible()
      expect((await deck.boundingBox())!.width).toBe(320)
      await page.setViewportSize({ width, height })
      await expect(deck).toBeHidden()
      expect(await projectSnapshot(page)).toBe(originalProject)
    }
    const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
    expect(bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.height).toBeLessThanOrEqual(height)
    expect(errors).toEqual([])
  })
}
