import { expect, test } from './helpers/fixtures'
import { mockPaidAuth } from './helpers/paid-auth'
import {
  CLIP,
  PPS,
  clipDuration,
  clipsIn,
  dropClipAtZero,
  dropMediaClip,
  mediaCard,
  newTrackZone,
  playhead,
  ruler,
  seekByRulerClick,
  selectClip,
  setZoom,
  track,
  trackHeader,
  trimClipEdge,
  waitForProcessingDone,
} from './helpers/timeline'

test.beforeEach(async ({ page }) => {
  await page.goto('/editor')
  // Proxy mode lists the videos from the server volume; wait for a ready card.
  await expect(mediaCard(page)).toBeVisible({ timeout: 30_000 })
})

test.describe('adding clips to the timeline', () => {
  test('drops a clip from the media bin onto Video 1 and links audio', async ({ page }) => {
    const video = track(page, 'Video 1')
    const audio = track(page, 'Audio 1')

    await dropClipAtZero(page)
    await waitForProcessingDone(video)

    await expect(clipsIn(video)).toHaveCount(1)
    await expect(clipsIn(audio)).toHaveCount(1)
    await expect(clipsIn(video).first()).toContainText(CLIP)
    await expect(clipsIn(video).first()).toContainText(/s/)
  })

  test('places the clip at the drop position on the timeline', async ({ page }) => {
    const video = track(page, 'Video 1')

    await dropMediaClip(page, CLIP, video, { timeSec: 4 })
    await waitForProcessingDone(video)

    const trackBox = await video.boundingBox()
    const clipBox = await clipsIn(video).first().boundingBox()
    expect(trackBox).not.toBeNull()
    expect(clipBox).not.toBeNull()
    const expectedLeft = trackBox!.x + 4 * PPS
    expect(Math.abs(clipBox!.x - expectedLeft)).toBeLessThanOrEqual(3)
  })

  test('rejects drops on a locked channel (no drop highlight)', async ({ page }) => {
    const video = track(page, 'Video 1')
    await page.getByLabel('Lock Video 1').click()
    await expect(trackHeader(page, 'Video 1')).toHaveClass(/locked/)

    const card = mediaCard(page)
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await card.dispatchEvent('dragstart', { dataTransfer })
    await video.dispatchEvent('dragover', { dataTransfer, clientX: 400, clientY: 30 })
    await expect(video).not.toHaveClass(/drop-active/)
    await dataTransfer.dispose()
  })

  test('creates a new track when dropping on the new-track zone', async ({ page }) => {
    const video = track(page, 'Video 1')

    await dropMediaClip(page, CLIP, newTrackZone(page), { timeSec: 0 })
    await waitForProcessingDone(page.locator('.track').last())

    await expect(trackHeader(page, 'Video 2')).toBeVisible()
    await expect(clipsIn(track(page, 'Video 1'))).toHaveCount(0)
    await expect(clipsIn(track(page, 'Video 2'))).toHaveCount(1)
  })

  test('adds video and audio channels from the toolbar', async ({ page }) => {
    await page.getByRole('button', { name: '+V' }).click()
    await expect(trackHeader(page, 'Video 2')).toBeVisible()
    await page.getByRole('button', { name: '+A' }).click()
    await expect(trackHeader(page, 'Audio 2')).toBeVisible()
  })
})

test.describe('editing clips', () => {
  test('trims the right edge and shortens the clip', async ({ page }) => {
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)
    // Zoom out so the whole clip (and its trim handles) fit the viewport.
    await setZoom(page, 20)

    const clip = clipsIn(video).first()
    const before = await clipDuration(clip)
    await selectClip(clip)
    await trimClipEdge(page, clip, 'right', -2)

    const after = await clipDuration(clip)
    expect(after).toBeCloseTo(before - 2, 0)
  })

  test('trims the left edge: duration shrinks and the clip moves right', async ({ page }) => {
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)
    await setZoom(page, 20)
    // The playhead sits at 0 and covers the left trim handle (higher z-index),
    // so move it away before trimming.
    await seekByRulerClick(page, 5)

    const clip = clipsIn(video).first()
    const before = await clipDuration(clip)
    const boxBefore = await clip.boundingBox()
    await selectClip(clip)
    await trimClipEdge(page, clip, 'left', 2)

    const after = await clipDuration(clip)
    expect(after).toBeCloseTo(before - 2, 0)
    const boxAfter = await clip.boundingBox()
    expect(boxAfter!.x - boxBefore!.x).toBeCloseTo(2 * 20, 0)
  })

  test('splits a clip at the playhead', async ({ page }) => {
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)
    const fullDuration = await clipDuration(clipsIn(video).first())

    await seekByRulerClick(page, 3)
    await expect(playhead(page)).toHaveAttribute('aria-valuenow', /^3(\.0+)?$/)
    await page.getByLabel('Split at playhead').click()

    await expect(clipsIn(video)).toHaveCount(2)
    const halves = clipsIn(video)
    expect(await clipDuration(halves.nth(0))).toBeCloseTo(3, 0)
    expect(await clipDuration(halves.nth(1))).toBeCloseTo(fullDuration - 3, 0)
  })

  test('deletes the selected clip, then undo/redo restores and removes it again', async ({ page }) => {
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)
    await expect(clipsIn(video)).toHaveCount(1)

    await selectClip(clipsIn(video).first())
    await page.keyboard.press('Delete')
    await expect(clipsIn(video)).toHaveCount(0)

    await page.keyboard.press('Control+z')
    await expect(clipsIn(video)).toHaveCount(1)

    await page.keyboard.press('Control+Shift+z')
    await expect(clipsIn(video)).toHaveCount(0)
  })

  test('moves a clip to a new track by dragging it down', async ({ page }) => {
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)

    const clip = clipsIn(video).first()
    const box = await clip.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy + 140, { steps: 12 })
    await page.mouse.up()

    await expect(trackHeader(page, 'Video 2')).toBeVisible()
    await expect(clipsIn(video)).toHaveCount(0)
    await expect(clipsIn(track(page, 'Video 2'))).toHaveCount(1)
  })

  test('drags cut clips down-left without source collisions during auto-scroll', async ({ page }) => {
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)
    const duration = await clipDuration(clipsIn(video).first())
    await setZoom(page, 20)

    const part = duration / 8
    for (let index = 1; index < 8; index++) {
      await seekByRulerClick(page, index * part)
      await page.getByLabel('Split at playhead').click()
    }
    await expect(clipsIn(video)).toHaveCount(8)
    for (let index = 4; index < 8; index++) {
      await clipsIn(video).nth(index).click({ modifiers: ['Control'] })
    }

    await setZoom(page, 80)
    const timelineScroll = page.locator('.tl-track-scroll')
    await timelineScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    const anchor = clipsIn(video).nth(7)
    const anchorId = await anchor.getAttribute('data-timeline-clip-id')
    if (!anchorId) throw new Error('missing anchor id')
    const draggedAnchor = page.locator(`[data-timeline-clip-id="${anchorId}"]`)
    const zone = newTrackZone(page)
    const anchorBox = await draggedAnchor.boundingBox()
    const zoneBox = await zone.boundingBox()
    const bodyBox = await timelineScroll.boundingBox()
    if (!anchorBox || !zoneBox || !bodyBox) throw new Error('missing drag geometry')

    const startX = anchorBox.x + anchorBox.width - 30
    const startY = anchorBox.y + 20
    const pointerX = bodyBox.x + 10
    const pointerY = zoneBox.y + 32
    const scrollBefore = await timelineScroll.evaluate((element) => element.scrollLeft)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(pointerX, pointerY, { steps: 12 })
    await page.waitForTimeout(100)

    const scrollAfter = await timelineScroll.evaluate((element) => element.scrollLeft)
    const draggedBox = await draggedAnchor.boundingBox()
    expect(draggedBox).not.toBeNull()
    expect(scrollAfter).toBeLessThan(scrollBefore)
    expect(draggedBox!.x).toBeCloseTo(anchorBox.x + pointerX - startX, 0)
    await expect(zone).toHaveClass(/drop-active/)
    await expect(page.locator('.xfade')).toHaveCount(0)

    await page.mouse.up()
    await expect(trackHeader(page, 'Video 2')).toBeVisible()
    await expect(clipsIn(track(page, 'Video 2'))).toHaveCount(4)
  })
})

test.describe('channel controls', () => {
  test('mutes and hides a channel', async ({ page }) => {
    const header = trackHeader(page, 'Video 1')
    await page.getByLabel('Mute Video 1').click()
    await expect(header).toHaveClass(/muted/)
    await page.getByLabel('Mute Video 1').click()
    await expect(header).not.toHaveClass(/muted/)
    // The header (with its controls) is fully hidden while the channel is
    // hidden, so hiding is one-way from the header.
    await page.getByLabel('Hide Video 1').click()
    await expect(header).toHaveClass(/hidden/)
  })
})

test.describe('transport and zoom', () => {
  test('ruler click and keyboard arrows seek the playhead', async ({ page }) => {
    // totalDuration is 0 on an empty timeline, which clamps all seeking, so add a clip first.
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)

    await seekByRulerClick(page, 5)
    await expect(playhead(page)).toHaveAttribute('aria-valuenow', /^5(\.0+)?$/)

    await ruler(page).focus()
    await page.keyboard.press('Home')
    await expect(playhead(page)).toHaveAttribute('aria-valuenow', /^0(\.0+)?$/)

    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight')
    await expect(playhead(page)).toHaveAttribute('aria-valuenow', /^0\.5(\.0+)?$/)

    await page.keyboard.press('End')
    // At the end, currentTime equals totalDuration; both are formatted the
    // same way, so the values must match exactly.
    const total = await ruler(page).getAttribute('aria-valuemax')
    await expect(playhead(page)).toHaveAttribute('aria-valuenow', total ?? '0')
  })

  test('drags the playhead to a new time', async ({ page }) => {
    // With an empty timeline totalDuration is 0 and seek clamps to 0, so add a clip first.
    const video = track(page, 'Video 1')
    await dropClipAtZero(page)
    await waitForProcessingDone(video)

    const head = playhead(page)
    const box = await head.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 2 * PPS, cy, { steps: 10 })
    await page.mouse.up()
    await expect(head).toHaveAttribute('aria-valuenow', /^2(\.0+)?$/)
  })

  test('zooms the timeline', async ({ page }) => {
    await page.locator('#timeline-zoom').evaluate((el) => {
      const input = el as HTMLInputElement
      input.value = '80'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(page.locator('output[for="timeline-zoom"]')).toHaveText('80px/s')
  })
})

test.describe('effects and render', () => {
  test('adds an effect block at the playhead from the palette', async ({ page }) => {
    await page.getByRole('button', { name: 'Effects' }).click()
    await expect(page.getByLabel('Effects browser')).toBeVisible()

    const card = page.locator('[data-effect-id="grayscale"]').first()
    await card.click()
    await expect(page.locator('[data-timeline-effect-id]')).toHaveCount(1)
    await page.locator('[data-timeline-effect-id]').first().dblclick()
    await expect(page.getByRole('complementary', { name: 'Effect inspector' })).toBeVisible()
  })

  test('opens the render dialog with output settings', async ({ page }) => {
    await mockPaidAuth(page)
    await page.goto('/editor')
    await page.getByRole('button', { name: 'Render', exact: true }).click()
    await expect(page.getByLabel('Render and export')).toBeVisible()
    await expect(page.locator('#render-resolution')).toHaveValue('1080p')
    await page.getByLabel('Close render menu').click()
    await expect(page.getByLabel('Render and export')).toBeHidden()
  })
})
