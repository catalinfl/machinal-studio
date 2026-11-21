import { describe, expect, it } from 'vitest'
import type { RenderPayload } from '../../lib/api'
import {
  estimateRenderWork,
  formatRenderTime,
  hasSceneRenderWork,
  RenderProgressEstimator,
} from '../../lib/render-progress'

function payload(width = 1280, height = 720): RenderPayload {
  return {
    resolution: { w: width, h: height },
    fps: 30,
    videoChannels: [{
      clips: [{ file: 'clip.mp4', inPoint: 0, outPoint: 10, start: 0, segments: [] }],
    }],
    audioChannels: [],
  }
}

describe('render progress estimates', () => {
  it('does not extrapolate weighted scene-export progress or contaminate timeline-only history', () => {
    const scenePayload = payload()
    scenePayload.videoChannels[0].clips[0].file = 'compiled.scene.json'
    expect(hasSceneRenderWork(scenePayload)).toBe(true)
    expect(hasSceneRenderWork({ ...scenePayload, format: 'mp3' })).toBe(false)
    expect(hasSceneRenderWork(payload())).toBe(false)
    let now = 0
    const values = new Map<string, string>()
    const estimator = new RenderProgressEstimator('server', 10, {
      nonlinearWork: true, now: () => now,
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } },
    })
    now = 600_000
    const capture = estimator.update({ ratio: 0.1, message: 'Rendering scene 1 of 7' })
    expect(capture.etaAvailable).toBe(false)
    expect(capture.elapsedSeconds).toBe(600)
    const timeline = estimator.update({ ratio: 0.3, message: 'Preparing captions' })
    expect(timeline.etaAvailable).toBe(false)
    expect(estimator.snapshot().etaAvailable).toBe(false)
    expect(estimator.finish().etaAvailable).toBe(true)
    expect(values.size).toBe(0)
  })

  it('scales initial work with output pixels and render passes', () => {
    const hdWork = estimateRenderWork(payload())
    const fullHdWork = estimateRenderWork(payload(1920, 1080))
    const composited = payload()
    composited.videoChannels.push({
      clips: [{ file: 'overlay.mp4', inPoint: 0, outPoint: 10, start: 0, segments: [] }],
    })

    expect(fullHdWork).toBeGreaterThan(hdWork * 2)
    expect(estimateRenderWork(composited)).toBeGreaterThanOrEqual(hdWork * 2)
  })

  it('does not treat ordinary cuts as transition encode passes', () => {
    const cutTimeline = payload()
    cutTimeline.videoChannels[0].clips = [
      { file: 'a.mp4', inPoint: 0, outPoint: 5, start: 0, segments: [] },
      { file: 'b.mp4', inPoint: 0, outPoint: 5, start: 5, segments: [] },
    ]
    const overlapTimeline = payload()
    overlapTimeline.videoChannels[0].clips = [
      { file: 'a.mp4', inPoint: 0, outPoint: 6, start: 0, segments: [] },
      { file: 'b.mp4', inPoint: 0, outPoint: 5, start: 5, segments: [] },
    ]

    expect(estimateRenderWork(cutTimeline)).toBeLessThan(estimateRenderWork(overlapTimeline))
  })

  it('accounts for the alpha-mask and base compositing passes', () => {
    const opaque = payload()
    const faded = payload()
    faded.videoChannels[0].clips[0].fadeIn = 1

    expect(estimateRenderWork(faded)).toBeGreaterThanOrEqual(estimateRenderWork(opaque) + 10)
  })

  it('keeps progress monotonic and refines remaining time from real samples', () => {
    let now = 0
    const estimator = new RenderProgressEstimator('server', 10, {
      now: () => now,
      storage: null,
    })
    now = 1_000
    const first = estimator.update({ ratio: 0.1, message: 'rendering' })
    now = 2_000
    const second = estimator.update({ ratio: 0.05, message: 'rendering' })

    expect(first.ratio).toBe(0.1)
    expect(second.ratio).toBe(0.1)
    expect(second.elapsedSeconds).toBe(2)
    expect(second.remainingSeconds).toBeGreaterThan(0)
  })

  it('converges when the true render is far slower than the initial estimate', () => {
    // Heavy effect stacks: initial ~4s (work=10 * 0.35 + startup) vs 120s true.
    let now = 0
    const estimator = new RenderProgressEstimator('server', 10, {
      now: () => now,
      storage: null,
    })
    const trueTotal = 120
    let previousRemaining = Number.POSITIVE_INFINITY
    for (let elapsed = 2; elapsed <= 60; elapsed += 2) {
      now = elapsed * 1000
      const snapshot = estimator.update({ ratio: elapsed / trueTotal, message: 'rendering' })
      // No sawtooth: remaining must not collapse to a few seconds while 60s+ are left.
      expect(snapshot.remainingSeconds).toBeGreaterThan(10)
      // After the learning phase (first ~10s) the countdown must be stable:
      // it may refine downward, never jump back up (old code snapped 0.6s -> 5s -> 0.1s -> 5.8s).
      if (elapsed >= 12) {
        expect(snapshot.remainingSeconds).toBeLessThanOrEqual(previousRemaining + 1)
      }
      previousRemaining = snapshot.remainingSeconds
    }
    now = 60_000
    const late = estimator.snapshot()
    // Within ~15% of the truth once a third of the render has been observed.
    expect(Math.abs(late.remainingSeconds - (trueTotal - 60))).toBeLessThan(15)
  })

  it('weights heavy effects more than cheap color filters', () => {
    const heavy = payload()
    heavy.videoChannels[0].clips[0].segments = [
      { srcStart: 0, srcEnd: 10, effects: [{ id: 'waviness', params: {} }] },
    ]
    const cheap = payload()
    cheap.videoChannels[0].clips[0].segments = [
      { srcStart: 0, srcEnd: 10, effects: [{ id: 'brightness', params: {} }] },
    ]
    expect(estimateRenderWork(heavy)).toBeGreaterThan(estimateRenderWork(cheap) + 5)
  })

  it('stores a smoothed engine-specific calibration after completion', () => {
    let now = 0
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const estimator = new RenderProgressEstimator('local', 10, { now: () => now, storage })
    now = 20_000
    const result = estimator.finish()

    expect(result.ratio).toBe(1)
    expect(result.remainingSeconds).toBe(0)
    expect(values.get('scrub-render-seconds-per-work-v1:local')).toBeTruthy()
  })

  it('formats compact render durations', () => {
    expect(formatRenderTime(8)).toBe('8s')
    expect(formatRenderTime(0.4)).toBe('<1s')
    expect(formatRenderTime(75)).toBe('1m 15s')
    expect(formatRenderTime(7_380)).toBe('2h 3m')
  })
})
