import { expect, test } from './helpers/fixtures'
import {
  CLIP,
  clipDuration,
  clipsIn,
  dropClipAtZero,
  dropMediaClip,
  mediaCard,
  track,
  waitForProcessingDone,
} from './helpers/timeline'

test.beforeEach(async ({ page }) => {
  await page.goto('/editor')
  await expect(mediaCard(page)).toBeVisible({ timeout: 30_000 })
})

async function filledWaveformPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('.clip.audio canvas.waveform') as HTMLCanvasElement
    if (!c || !c.width) return 0
    const ctx = c.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
    return n
  })
}

// Filled (non-transparent) pixel count per audio waveform, in timeline order.
async function filledWaveformPixelsAll(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('.clip.audio canvas.waveform')]
    return canvases.map((c) => {
      const canvas = c as HTMLCanvasElement
      if (!canvas.width) return 0
      const ctx = canvas.getContext('2d')
      if (!ctx) return 0
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let n = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
      return n
    })
  })
}

test('waveform amplitude follows clip volume (drag on the volume line)', async ({ page }) => {
  const audio = track(page, 'Audio 1')
  await dropClipAtZero(page)
  await waitForProcessingDone(track(page, 'Video 1'))
  await waitForProcessingDone(audio)

  const audioClip = clipsIn(audio).first()
  await expect(audioClip.locator('canvas.waveform')).toBeVisible()

  // Wait until a real waveform (not the 1px placeholder) is drawn.
  await expect.poll(() => filledWaveformPixels(page), { timeout: 20_000 }).toBeGreaterThan(400)
  const at100 = await filledWaveformPixels(page)
  expect(at100).toBeGreaterThan(400)

  // Drag the volume line down ~25% of the clip height (64px track => ~14px).
  const volLine = audioClip.locator('.vol-line')
  await expect(volLine).toBeVisible()
  const box = await volLine.boundingBox()
  if (!box) throw new Error('vol line not visible')
  await page.mouse.move(box.x + 60, box.y + 3)
  await page.mouse.down()
  await page.mouse.move(box.x + 60, box.y + 3 + 14, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)

  // The volume line moved down below its default 50% position.
  const style = await volLine.getAttribute('style')
  expect(style).toContain('top: 7')

  await expect.poll(() => filledWaveformPixels(page), { timeout: 10_000 }).toBeLessThan(at100 * 0.8)
})

test('select all clips and lower every audio waveform from the inspector', async ({ page }) => {
  const VIDEOS = [CLIP, 'Aldous Huxley 2.mp4', 'Fyodor Dostoevski.mp4']

  const video = track(page, 'Video 1')
  const audio = track(page, 'Audio 1')

  // Drop 3 videos back to back; each one also creates a linked audio clip on
  // Audio 1 (the linked waveform we are going to control).
  let cursor = 0
  for (const name of VIDEOS) {
    await dropMediaClip(page, name, video, { timeSec: cursor })
    await waitForProcessingDone(video)
    await waitForProcessingDone(audio)
    cursor += await clipDuration(clipsIn(video).last())
  }
  await expect(clipsIn(video)).toHaveCount(3)
  await expect(clipsIn(audio)).toHaveCount(3)

  // Wait until all three waveforms are drawn for real (not the 1px placeholder).
  await expect
    .poll(async () => (await filledWaveformPixelsAll(page)).every((n) => n > 400), { timeout: 30_000 })
    .toBe(true)

  // Select every video and linked audio clip with the timeline shortcut.
  await page.keyboard.press('Shift+A')

  const videoClips = clipsIn(video)
  const audioClips = clipsIn(audio)
  for (const clip of await videoClips.all()) await expect(clip).toHaveClass(/selected/)
  for (const clip of await audioClips.all()) await expect(clip).toHaveClass(/selected/)

  // The inspector shows the full selection and one shared volume slider for
  // its three audio clips.
  const inspector = page.locator('#effect-inspector')
  await expect(inspector).toBeVisible()
  await expect(inspector.getByRole('heading', { name: '6 clips' })).toBeVisible()
  await expect(inspector.locator('.selection-label')).toHaveText('2 tracks / 6 selected')
  await expect(inspector.locator('section.audio .section-title span')).toHaveText('3 clips')
  const slider = inspector.getByLabel('Clip volume')
  await expect(slider).toBeVisible()

  // Control all of them at once: click the inspector slider down to ~20 %.
  const baseline = await filledWaveformPixelsAll(page)
  const sb = await slider.boundingBox()
  if (!sb) throw new Error('volume slider not visible')
  await slider.click({ position: { x: Math.round(sb.width * 0.2), y: Math.round(sb.height / 2) } })
  const setTo = Number(await slider.inputValue())
  expect(setTo).toBeLessThan(90)

  // Every selected waveform's volume line moved to the same height and the
  // inspector shows the common value.
  const expectedTop = (1 - setTo / 200) * 100
  const topText = String(Math.round(expectedTop * 10) / 10).replace(/\.0$/, '')
  for (const line of await audioClips.locator('.vol-line').all()) {
    expect(await line.getAttribute('style')).toContain(`top: ${topText}%`)
  }
  await expect(inspector.locator('.vol-value')).toHaveText(`${setTo}%`)

  // And every waveform visually shrank with the new volume.
  await expect
    .poll(async () => {
      const now = await filledWaveformPixelsAll(page)
      return now.length === 3 && now.every((n, i) => n < baseline[i] * 0.7)
    }, { timeout: 10_000 })
    .toBe(true)

  for (const clip of await videoClips.all()) await expect(clip).toHaveClass(/selected/)
  for (const clip of await audioClips.all()) await expect(clip).toHaveClass(/selected/)
})
