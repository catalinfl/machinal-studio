import { describe, expect, it } from 'vitest'
import {
  clipAlphaAt,
  clipFadeIn,
  clipFadeOut,
  clipOpacity,
  hasClipCompositing,
} from '../../lib/clip-compositing'

describe('clip compositing', () => {
  const clip = {
    start: 2,
    inPoint: 0,
    outPoint: 4,
    opacity: 0.8,
    fadeIn: 1,
    fadeOut: 0.5,
  }

  it('applies opacity after a clip-local fade envelope', () => {
    expect(clipAlphaAt(clip, 1.99)).toBe(0)
    expect(clipAlphaAt(clip, 2)).toBe(0)
    expect(clipAlphaAt(clip, 2.5)).toBeCloseTo(0.4)
    expect(clipAlphaAt(clip, 4)).toBeCloseTo(0.8)
    expect(clipAlphaAt(clip, 5.75)).toBeCloseTo(0.4)
    expect(clipAlphaAt(clip, 6)).toBe(0)
  })

  it('multiplies fade edges when they overlap', () => {
    expect(clipAlphaAt({
      start: 0,
      inPoint: 0,
      outPoint: 1,
      fadeIn: 1,
      fadeOut: 1,
    }, 0.5)).toBeCloseTo(0.25)
  })

  it('normalizes unsafe values and detects non-default compositing', () => {
    const unsafe = { ...clip, opacity: 4, fadeIn: -2, fadeOut: 20 }
    expect(clipOpacity(unsafe)).toBe(1)
    expect(clipFadeIn(unsafe)).toBe(0)
    expect(clipFadeOut(unsafe)).toBe(4)
    expect(hasClipCompositing(unsafe)).toBe(true)
    expect(hasClipCompositing({ start: 0, inPoint: 0, outPoint: 1 })).toBe(false)
    expect(clipFadeIn({ ...clip, fadeIn: 0.0000004 })).toBe(0)
  })
})
