// Cuts "Aldous Huxley 1.mp4" into 10 equal parts, joins every junction with a
// randomly chosen transition (seeded PRNG for reproducibility — change SEED to
// get a different random sequence), and drops random effects between the
// junctions. Everything is scripted with the HTML5 dnd helpers, which codegen
// cannot record.
import { expect, test } from './helpers/fixtures'
import {
  clipDuration,
  clipsIn,
  dropClipAtZero,
  dropEffect,
  dropTransition,
  playhead,
  seekByRulerClick,
  setZoom,
  track,
  waitForProcessingDone,
} from './helpers/timeline'

const PARTS = 10
const EFFECT_COUNT = 5
const SEED = 20260731

// Deterministic PRNG (mulberry32).
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('cuts the clip into 10 parts joined with random transitions and effects', async ({ page }) => {
  await page.goto('/editor')
  const video = track(page, 'Video 1')
  await dropClipAtZero(page)
  await waitForProcessingDone(video)
  const fullDuration = await clipDuration(clipsIn(video).first())

  // Zoom out so all 10 parts fit inside the viewport.
  await setZoom(page, 20)
  const part = fullDuration / PARTS

  // Cut into PARTS equal pieces.
  for (let i = 1; i < PARTS; i++) {
    await seekByRulerClick(page, i * part)
    await expect(playhead(page)).toHaveAttribute('aria-valuenow', /^\d+(\.\d+)?$/)
    await page.getByLabel('Split at playhead').click()
  }
  await expect(clipsIn(video)).toHaveCount(PARTS)

  const rand = mulberry32(SEED)

  await page.getByRole('button', { name: 'Effects' }).click()
  await expect(page.getByLabel('Effects browser')).toBeVisible()
  const effectIds = await page
    .locator('[data-effect-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-effect-id')!).filter((id) => id !== null))
  const effectStarts = Array.from(
    { length: EFFECT_COUNT },
    (_, k) => 1 + (k * (fullDuration - 4)) / EFFECT_COUNT + rand() * 0.8,
  )
  for (const t of effectStarts) {
    await dropEffect(page, effectIds[Math.floor(rand() * effectIds.length)], video, t)
  }
  await expect(page.locator('[data-timeline-effect-id]')).toHaveCount(EFFECT_COUNT)

  await page.getByRole('button', { name: 'Transitions' }).click()
  await expect(page.getByLabel('Transitions browser')).toBeVisible()
  const transitionIds = await page
    .locator('[data-transition-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-transition-id')!).filter((id) => id !== null))
  for (let i = 1; i < PARTS; i++) {
    await dropTransition(page, transitionIds[Math.floor(rand() * transitionIds.length)], video, i * part)
  }
  await expect(video.locator('.transition-marker')).toHaveCount(PARTS - 1)
})
