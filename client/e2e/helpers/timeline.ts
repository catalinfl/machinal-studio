import { expect, type Locator, type Page } from '@playwright/test'

export const PPS = 40
export const CLIP = 'Aldous Huxley 1.mp4'

export function ruler(page: Page): Locator {
  return page.getByRole('slider', { name: 'Timeline ruler' })
}

export function playhead(page: Page): Locator {
  return page.getByRole('slider', { name: 'Playhead' })
}

export function mediaCard(page: Page, name = CLIP): Locator {
  return page.locator('.card.ready', { hasText: name })
}

export function track(page: Page, name: string): Locator {
  return page.getByRole('application', { name: `Drop zone: ${name}` })
}

export function trackHeader(page: Page, name: string): Locator {
  return page.locator('.thead', { hasText: name })
}

export function newTrackZone(page: Page): Locator {
  return page.locator('[data-new-track-zone]')
}

export function clipsIn(trackLocator: Locator): Locator {
  return trackLocator.locator('.clip')
}

// The drop triggers a WASM audio extraction in the browser; the track shows a
// "processing" overlay until it settles (success or fallback).
export async function waitForProcessingDone(trackLocator: Locator, timeout = 150_000): Promise<void> {
  await expect(trackLocator.locator('.processing-overlay')).toHaveCount(0, { timeout })
}

// HTML5 drag & drop: Playwright's mouse API cannot start a native HTML5 drag
// session, so we dispatch DragEvents with a shared DataTransfer handle. The
// source's dragstart handler writes its custom payload (application/x-cineedit-*
// MIME type) into that handle; then dragenter/dragover/drop deliver it to the
// target at the requested timeline position.
//
// All events are dispatched inside ONE page.evaluate: the timeline auto-scrolls
// while dragging near the viewport edges (rAF loop), and separate IPC round
// trips between dispatched events let a tick move the ruler mid-drop. Doing
// everything synchronously in-page also makes the drop position consistent with
// the target rect it is measured against.
export async function dragToTrack(
  page: Page,
  source: Locator,
  target: Locator,
  opts: { timeSec?: number; clientX?: number } = {},
): Promise<void> {
  await expect(source).toBeVisible()
  const sourceHandle = await source.evaluateHandle((el) => el)
  const targetHandle = await target.evaluateHandle((el) => el)
  try {
    await page.evaluate(([src, tgt, { timeSec, clientX }]: unknown[]) => {
      const source = src as HTMLElement
      const target = tgt as HTMLElement
      const dataTransfer = new DataTransfer()
      source.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true }))
      const box = target.getBoundingClientRect()
      let x: number
      if (timeSec !== undefined) {
        const zoomInput = document.querySelector('#timeline-zoom') as HTMLInputElement | null
        const pps = Number(zoomInput?.value ?? 40)
        // The drop handler computes start = clientX - trackRect.left, so the
        // drop point must be expressed against the track's own rect.
        x = box.left + timeSec * pps
      } else if (clientX !== undefined) {
        x = clientX
      } else {
        x = box.left + box.width / 2
      }
      const y = box.top + Math.min(30, box.height / 2)
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      }
    }, [sourceHandle, targetHandle, { timeSec: opts.timeSec, clientX: opts.clientX }])
  } finally {
    await sourceHandle.dispose()
    await targetHandle.dispose()
  }
}

export async function dropMediaClip(
  page: Page,
  sourceName: string,
  target: Locator,
  opts: { timeSec?: number; clientX?: number } = {},
): Promise<void> {
  await dragToTrack(page, mediaCard(page, sourceName), target, opts)
}

export function effectCard(page: Page, effectId: string): Locator {
  return page.locator(`[data-effect-id="${effectId}"]`)
}

export function transitionCard(page: Page, transitionId: string): Locator {
  return page.locator(`[data-transition-id="${transitionId}"]`)
}

export async function dropCard(page: Page, card: Locator, target: Locator, timeSec: number): Promise<void> {
  await dragToTrack(page, card, target, { timeSec })
}

export async function dropEffect(page: Page, effectId: string, target: Locator, timeSec: number): Promise<void> {
  await dropCard(page, effectCard(page, effectId), target, timeSec)
}

export async function dropTransition(page: Page, transitionId: string, target: Locator, timeSec: number): Promise<void> {
  await dropCard(page, transitionCard(page, transitionId), target, timeSec)
}

export async function dropClipAtZero(page: Page): Promise<void> {
  await dropMediaClip(page, CLIP, track(page, 'Video 1'), { timeSec: 0 })
}

export async function clipDuration(clip: Locator): Promise<number> {
  const text = await clip.locator('.clip-dur').innerText()
  return parseFloat(text)
}

export async function selectClip(clip: Locator): Promise<void> {
  await clip.click()
  await expect(clip).toHaveClass(/selected/)
}

export async function currentPps(page: Page): Promise<number> {
  return Number(await page.locator('#timeline-zoom').inputValue())
}

export async function setZoom(page: Page, pps: number): Promise<void> {
  await page.locator('#timeline-zoom').evaluate((el, value) => {
    const input = el as HTMLInputElement
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, pps)
  await expect(page.locator('output[for="timeline-zoom"]')).toHaveText(`${pps}px/s`)
}

// Trims by a delta in seconds; the pixel distance is derived from the current
// zoom so handles stay inside the viewport.
export async function trimClipEdge(page: Page, clip: Locator, edge: 'left' | 'right', deltaSec: number): Promise<void> {
  const handle = clip.locator(edge === 'left' ? '.trim.left' : '.trim.right')
  await expect(handle).toBeVisible()
  const hb = await handle.boundingBox()
  if (!hb) throw new Error('trim handle not visible')
  const pps = await currentPps(page)
  const cx = hb.x + hb.width / 2
  const cy = hb.y + hb.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + deltaSec * pps, cy, { steps: 10 })
  await page.mouse.up()
}

export async function seekByRulerClick(page: Page, timeSec: number): Promise<void> {
  await ruler(page).click({ position: { x: timeSec * (await currentPps(page)), y: 13 } })
}
