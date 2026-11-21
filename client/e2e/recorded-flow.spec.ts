// Flow înregistrat cu `playwright codegen` (e2e/recorded-flow.spec.js — salvarea
// raw). Codegen-ul nu poate captura drag&drop HTML5, deci partea de drag din
// Media Bin folosește helperul dropMediaClip din helpers/timeline.ts.
import { expect, test } from './helpers/fixtures'
import {
  CLIP,
  clipDuration,
  clipsIn,
  dropEffect,
  dropMediaClip,
  dropTransition,
  mediaCard,
  playhead,
  seekByRulerClick,
  selectClip,
  setZoom,
  track,
  trimClipEdge,
  waitForProcessingDone,
} from './helpers/timeline'

test('recorded flow: add a clip to the channel and trim it', async ({ page }) => {
  const shaderErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /shader|glsl|program/i.test(message.text())) shaderErrors.push(message.text())
  })
  await page.goto('/editor')
  await expect(mediaCard(page)).toBeVisible({ timeout: 30_000 })

  const video = track(page, 'Video 1')
  await dropMediaClip(page, CLIP, video, { timeSec: 0 })
  await waitForProcessingDone(video)

  await selectClip(clipsIn(video).first())
  await expect(clipsIn(video).first()).toHaveClass(/selected/)

  // Zoom out so the trim handles fit the viewport; move the playhead off the
  // left handle (it has a higher z-index and would swallow the drag).
  await setZoom(page, 20)
  await seekByRulerClick(page, 5)
  await expect(playhead(page)).toHaveAttribute('aria-valuenow', /^5(\.0+)?$/)

  const clip = clipsIn(video).first()
  const before = await clipDuration(clip)
  await trimClipEdge(page, clip, 'right', -2)
  await expect.poll(async () => clipDuration(clip)).toBeCloseTo(before - 2, 0)

  // Drag & drop an effect from the palette onto the timeline. HTML5 dnd is not
  // recordable with codegen, so these steps are scripted with dragToTrack.
  await page.getByRole('button', { name: 'Effects' }).click()
  await expect(page.getByLabel('Effects browser')).toBeVisible()
  await dropEffect(page, 'grayscale', video, 5)
  await expect(page.locator('[data-timeline-effect-id]')).toHaveCount(1)

  // A transition needs two adjacent clips: drop a second copy right after the
  // first, then drag a cross-dissolve onto the junction between them.
  const d = await clipDuration(clipsIn(video).first())
  await dropMediaClip(page, CLIP, video, { timeSec: d })
  await waitForProcessingDone(video)
  await expect(clipsIn(video)).toHaveCount(2)

  await page.getByRole('button', { name: 'Transitions' }).click()
  await expect(page.getByLabel('Transitions browser')).toBeVisible()
  await dropTransition(page, 'cross-dissolve', video, d)
  await expect(video.locator('.transition-marker')).toHaveCount(1)
  await seekByRulerClick(page, d)
  await page.waitForTimeout(100)
  expect(shaderErrors).toEqual([])
})
