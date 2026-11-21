import { expect, test, type Page } from '@playwright/test'

async function openEditor(page: Page, theme = 'light') {
  await page.addInitScript(theme => localStorage.setItem('scrub-theme', theme), theme)
  await page.route('**/list*', route => route.fulfill({ json: [] }))
  await page.goto('/editor')
  await expect(page.locator('#media-bin-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Got it', exact: true }).click()
}

async function populateEditor(page: Page) {
  await page.evaluate(async () => {
    const moduleURL = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === path) ?? path
    const { registerMediaBinSource } = await import(/* @vite-ignore */ moduleURL('/src/lib/media-bin.ts'))
    const { editor } = await import(/* @vite-ignore */ moduleURL('/src/stores/editor.svelte.ts'))
    editor.clearTimeline()
    editor.setPixelsPerSecond(40)
    const channel = editor.channels.find((candidate: { type: string }) => candidate.type === 'video')
    for (const [index, name] of ['Coast opening', 'Mountain pass', 'Coast detail', 'Mountain ridge', 'Coast closing', 'Mountain outro'].entries()) {
      const url = `/images/home/direction-${index % 2 ? 'mountains' : 'coast'}-ai.png`
      const image = new Image()
      image.src = url
      await image.decode()
      const source = { name: `${name}.png`, kind: 'image', duration: 8, sourceMode: 'wasm', scrubBlobUrl: url, width: image.naturalWidth, height: image.naturalHeight }
      registerMediaBinSource({ ...source, id: `laptop-source-${index}` })
      if (index < 3) editor.addClip(channel.id, {
        fileName: source.name, mediaKind: 'image', scrubBlobUrl: url, sourceMode: 'wasm',
        sourceDuration: 8, sourceWidth: source.width, sourceHeight: source.height,
        inPoint: 0, outPoint: 8, start: index * 8,
      })
    }
  })
  await expect(page.locator('#media-bin-list .media-item')).toHaveCount(6)
  await expect(page.locator('.preview .stage canvas')).toBeVisible()
}

async function expectAlignedTracks(page: Page) {
  const rows = await page.locator('.thead[data-channel-id]').evaluateAll(headers => headers.map(header => {
    const track = document.querySelector(`[data-timeline-channel-id="${(header as HTMLElement).dataset.channelId}"]`)!
    return { header: header.getBoundingClientRect().toJSON(), track: track.getBoundingClientRect().toJSON() }
  }))
  for (const { header, track } of rows) {
    expect(header.y).toBeCloseTo(track.y, 0)
    expect(header.height).toBeCloseTo(track.height, 0)
  }
}

for (const { width, height, theme } of [
  { width: 1366, height: 768, theme: 'light' },
  { width: 1366, height: 768, theme: 'dark' },
  { width: 1366, height: 650, theme: 'light' },
  { width: 1280, height: 720, theme: 'dark' },
]) {
  test(`compact laptop workspace at ${width}x${height} in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    await openEditor(page, theme)
    await expect(page.getByRole('button', { name: 'Open media library', exact: true })).toBeInViewport()
    await populateEditor(page)

    const preview = page.locator('.preview')
    const bin = page.locator('#media-bin-panel')
    const list = bin.locator('.list')
    const timeline = page.locator('.bottom')
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))
    expect(dimensions.width).toBeLessThanOrEqual(width)
    expect(dimensions.height).toBeLessThanOrEqual(height)
    await expect(page.locator('.topbar.command')).toHaveCSS('height', '48px')
    await expect(preview).toHaveCSS('padding', '8px 12px')
    await expect(page.locator('.clips-area').first()).toHaveCSS('height', '56px')
    await expect(page.locator('.tl-left')).toHaveCSS('width', '208px')
    expect((await page.locator('.tool-deck').boundingBox())!.width).toBeLessThan(400)
    expect((await preview.boundingBox())!.width).toBeGreaterThan(850)
    expect((await timeline.boundingBox())!.height).toBeGreaterThanOrEqual(232)
    expect((await list.boundingBox())!.height).toBeGreaterThan(height * 0.28)
    expect((await preview.locator('.stage').boundingBox())!.height).toBeGreaterThan(height * 0.33)
    expect((await list.locator('.media-item').first().boundingBox())!.height).toBeLessThanOrEqual(64)
    await expect(page.getByRole('button', { name: 'Render', exact: true })).toBeInViewport()
    await expect(page.getByLabel('Video framing', { exact: true })).toBeInViewport()
    await expectAlignedTracks(page)

    await page.getByRole('button', { name: 'Expand preview', exact: true }).click()
    await expect(timeline).toBeHidden()
    await page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name: 'Media Bin', exact: true }).click()
    await expect(bin).toBeVisible()
    await expect(timeline).toBeVisible()
    const savedHeight = (await timeline.boundingBox())!.height
    await page.getByRole('button', { name: 'Expand timeline', exact: true }).click()
    await expect(preview).toBeHidden()
    await page.getByRole('button', { name: 'Restore timeline layout', exact: true }).click()
    expect((await timeline.boundingBox())!.height).toBeCloseTo(savedHeight, 0)
    await page.screenshot({ path: testInfo.outputPath('laptop-list.png'), animations: 'disabled' })

    await bin.getByRole('button', { name: 'Append Mountain outro.png to timeline', exact: true }).click()
    await expect(page.locator('[data-timeline-clip-id]')).toHaveCount(4)
    await bin.getByRole('button', { name: 'Media bin options', exact: true }).click()
    await bin.getByRole('button', { name: 'Grid view', exact: true }).click()
    expect(await list.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
    await page.screenshot({ path: testInfo.outputPath('laptop-grid.png'), animations: 'disabled' })

    const deckResizer = page.getByRole('slider', { name: 'Resize tool deck', exact: true })
    const deckBox = (await deckResizer.boundingBox())!
    await page.mouse.move(deckBox.x + deckBox.width / 2, deckBox.y + 40)
    await page.mouse.down()
    await page.mouse.move(deckBox.x - 80, deckBox.y + 40, { steps: 5 })
    await page.mouse.up()
    expect((await page.locator('.tool-deck').boundingBox())!.width).toBeLessThan(560)
    await deckResizer.press('ArrowRight')
    const timelineResizer = page.getByRole('slider', { name: 'Resize timeline', exact: true })
    const initialHeight = (await timeline.boundingBox())!.height
    await timelineResizer.press('ArrowUp')
    expect((await timeline.boundingBox())!.height).toBeCloseTo(initialHeight + 24, 0)
    const timelineHandle = (await timelineResizer.boundingBox())!
    await page.mouse.move(timelineHandle.x + timelineHandle.width / 2, timelineHandle.y + timelineHandle.height / 2)
    await page.mouse.down()
    await page.mouse.move(timelineHandle.x + timelineHandle.width / 2, timelineHandle.y - 35, { steps: 5 })
    await page.mouse.up()
    expect((await timeline.boundingBox())!.height).toBeGreaterThan(initialHeight + 24)
    await timelineResizer.press('Home')
    expect((await timeline.boundingBox())!.height).toBe(220)

    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name)
        .findLast(name => new URL(name).pathname === '/src/stores/editor.svelte.ts')!
      const { editor } = await import(/* @vite-ignore */ url)
      const channel = editor.channels.find((candidate: { type: string }) => candidate.type === 'video')
      editor.addEffectBlock(channel.id, 'grayscale', 1, 3)
      editor.addEffectBlock(channel.id, 'sepia', 1, 3)
    })
    await expect(page.locator('.track.video').first()).toHaveCSS('height', '100px')
    await expectAlignedTracks(page)
    const scrollbar = (await page.locator('.tl-scrollbar').boundingBox())!
    const trackArea = (await page.locator('.tl-track-scroll').boundingBox())!
    expect(scrollbar.x).toBe(trackArea.x)
    expect(scrollbar.width).toBe(trackArea.width)

    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(preview).toHaveCSS('padding', '20px 24px')
    await expect(page.locator('.clips-area').first()).toHaveCSS('height', '64px')
    await expect(page.locator('.tl-left')).toHaveCSS('width', '260px')
    await expectAlignedTracks(page)
  })
}
