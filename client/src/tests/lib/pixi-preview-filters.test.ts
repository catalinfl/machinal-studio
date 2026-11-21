import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPixiFilters, createPixiTransitionFilter, type PixiPlan } from '../../lib/effects-pixi'
import { PixiHistory } from '../../lib/pixi-history'
import { PixiPreviewFilters } from '../../lib/pixi-preview-filters'

vi.mock('../../lib/effects-pixi', () => ({
  createPixiFilters: vi.fn(() => ({ filters: [{ destroy: vi.fn() }], transform: null })),
  createPixiTransitionFilter: vi.fn(() => ({ destroy: vi.fn(), resources: { customUniforms: { uniforms: {}, update: vi.fn() } } })),
}))

beforeEach(() => vi.clearAllMocks())

describe('preview filter ownership', () => {
  const frame = { w: 640, h: 360 }
  const scale = { x: 1, y: 1 }
  const plans: PixiPlan[] = [{ kind: 'blur', strength: 2, quality: 1, source: 'test' }]

  it('keeps unchanged effect filters and rebuilds only changed plans or history', () => {
    const cache = new PixiPreviewFilters()
    const history = new PixiHistory()
    const first = cache.effects('clip', plans, frame, scale, history)
    expect(cache.effects('clip', plans, frame, scale, history)).toBe(first)
    expect(createPixiFilters).toHaveBeenCalledTimes(1)
    cache.effects('clip', plans, frame, { x: 0.5, y: 0.5 }, history)
    expect(first.filters[0].destroy).toHaveBeenCalledTimes(1)
    cache.effects('clip', plans, frame, { x: 0.5, y: 0.5 }, new PixiHistory())
    expect(createPixiFilters).toHaveBeenCalledTimes(3)
    cache.dispose()
  })

  it('updates transition progress on the same shader and destroys it when obsolete', () => {
    const cache = new PixiPreviewFilters()
    const reveal = { custom: 'transition-ffmpeg', uniforms: { uMode: 1, uProgress: 0.25 }, source: 'test' }
    const filter = cache.transition('right', reveal, frame)!
    expect(cache.transition('right', { ...reveal, uniforms: { ...reveal.uniforms, uProgress: 0.75 } }, frame)).toBe(filter)
    expect(filter.resources.customUniforms.uniforms.uProgress).toBe(0.75)
    expect(createPixiTransitionFilter).toHaveBeenCalledTimes(1)
    cache.retain(new Set())
    expect(filter.destroy).toHaveBeenCalledTimes(1)
    cache.dispose()
    expect(filter.destroy).toHaveBeenCalledTimes(1)
  })
})
