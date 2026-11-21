import { describe, expect, it } from 'vitest'
import { clipTransformAt, DEFAULT_CLIP_TRANSFORM, TRANSFORM_PRESETS, layerExitKeyframes, layerMotionKeyframes, transformPreset } from '../../lib/clip-transform'

describe('clip transform animation', () => {
  it('interpolates zoom and position between keyframes', () => {
    const transform = clipTransformAt({
      transformKeyframes: [
        { time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 1, zoomY: 1, positionX: -10 } },
        { time: 4, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 2, zoomY: 2, positionX: 10 } },
      ],
    }, 2)

    expect(transform.zoomX).toBeCloseTo(1.5)
    expect(transform.positionX).toBeCloseTo(0)
  })

  it('holds completed short-form motion for the rest of the clip', () => {
    const keyframes = transformPreset('punch', 6).keyframes
    const clip = { transformKeyframes: keyframes }

    expect(clipTransformAt(clip, -1).zoomX).toBeCloseTo(1.02)
    expect(clipTransformAt(clip, 0.32).zoomX).toBeCloseTo(1.14)
    expect(clipTransformAt(clip, 3).zoomX).toBeCloseTo(1.14)
    expect(clipTransformAt(clip, 9).zoomX).toBeCloseTo(1.14)
  })

  it('creates restrained TikTok-style camera motion presets', () => {
    expect(transformPreset('zoom-in', 5).keyframes.at(-1)?.transform.zoomX).toBeCloseTo(1.12)
    expect(transformPreset('ken-burns', 5).keyframes).toHaveLength(4)

    const drift = transformPreset('drift', 5).keyframes
    expect(drift[0].transform).toMatchObject({ zoomX: 1.2, zoomY: 1.2, positionX: -7, rotation: 0 })
    expect(drift.at(-1)?.transform).toMatchObject({ zoomX: 1.2, zoomY: 1.2, positionX: 7, rotation: 0 })

    const whip = transformPreset('whip-left', 5).keyframes
    expect(whip[0].transform).toMatchObject({ zoomX: 1.24, positionX: 10 })
    expect(whip.at(-1)?.transform).toMatchObject({ zoomX: 1.2, positionX: 0 })
  })

  it('builds exit keyframes that settle from base to the exit offset', () => {
    const keyframes = layerExitKeyframes('sink', DEFAULT_CLIP_TRANSFORM, 5, 0.5)

    expect(keyframes).toHaveLength(4)
    expect(keyframes[0]).toMatchObject({ time: 4.5, transform: { positionY: 0, zoomX: 1, zoomY: 1 } })
    expect(keyframes.at(-1)).toMatchObject({ time: 5, transform: { positionY: 7, zoomX: 1.025, zoomY: 1.025 } })
  })

  it('combines entrance and exit motion without dropping either side', () => {
    const keyframes = layerMotionKeyframes({
      entrance: 'lift',
      exit: 'sink',
      base: DEFAULT_CLIP_TRANSFORM,
      duration: 5,
      entranceDuration: 0.5,
      exitDuration: 0.5,
    })

    expect(keyframes[0]).toMatchObject({ time: 0, transform: { positionY: 7 } })
    expect(keyframes.at(-1)).toMatchObject({ time: 5, transform: { positionY: 7 } })
    const middle = keyframes.find((keyframe) => Math.abs(keyframe.time - 0.5) < 1e-9)
    expect(middle?.transform).toMatchObject({ positionY: 0, zoomX: 1, zoomY: 1 })
    expect(keyframes.map(({ time }) => time)).toEqual(
      [...keyframes].map(({ time }) => time).sort((a, b) => a - b),
    )
  })

  it('keeps every animated preset inside the frame while translating', () => {
    const animatedPresets = TRANSFORM_PRESETS.filter(({ value }) => value !== 'none')

    for (const preset of animatedPresets) {
      const keyframes = transformPreset(preset.value, 5).keyframes
      expect(keyframes.length, preset.value).toBeGreaterThan(1)
      expect(keyframes.map(({ time }) => time), preset.value).toEqual(
        [...keyframes].map(({ time }) => time).sort((a, b) => a - b),
      )
      for (const { transform } of keyframes) {
        const minimumZoomX = 1 + 2 * Math.abs(transform.positionX) / 100
        const minimumZoomY = 1 + 2 * Math.abs(transform.positionY) / 100
        expect(transform.zoomX, `${preset.value} X overscan`).toBeGreaterThanOrEqual(minimumZoomX)
        expect(transform.zoomY, `${preset.value} Y overscan`).toBeGreaterThanOrEqual(minimumZoomY)
        expect(transform.zoomY, `${preset.value} linked zoom`).toBe(transform.zoomX)
        expect(transform.rotation, `${preset.value} edge-safe rotation`).toBe(0)
      }
    }
  })
})
