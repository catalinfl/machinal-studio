import { describe, expect, it } from 'vitest'
import { canPresentDirectEffects, directEffectMatrices, DirectPreviewEffects } from '../../lib/direct-preview-effects'
import { planPixiEffect, type PixiPlan } from '../../lib/effects-pixi'

describe('native preview color effects', () => {
  it('supports linear color plans but retains exact LUT, spatial and temporal effects on Pixi', () => {
    expect(canPresentDirectEffects(planPixiEffect('grayscale', {}, 0.5, 0))).toBe(true)
    expect(canPresentDirectEffects(planPixiEffect('negate', {}, 1, 0))).toBe(true)
    for (const id of ['sepia', 'film-grain', 'blur', 'frame-echo']) {
      expect(canPresentDirectEffects(planPixiEffect(id, {}, 1, 0))).toBe(false)
    }
  })

  it('copies matrix alpha without mutating the shared plans', () => {
    const plan = planPixiEffect('grayscale', {}, 1, 0)[0] as Extract<PixiPlan, { kind: 'colormatrix' }>
    const matrices = directEffectMatrices([{ ...plan, alpha: 0.5 }])
    expect(matrices[0][18]).toBe(0.5)
    expect(plan.matrix[18]).toBe(1)
  })

  it('reuses unchanged SVG primitives, updates edits, and releases unused filters', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const effects = new DirectPreviewEffects(() => parent)
    try {
      const plans = planPixiEffect('grayscale', {}, 1, 0)
      const url = effects.filter('clip', plans)
      const primitive = parent.querySelector('feColorMatrix')
      expect(effects.filter('clip', plans)).toBe(url)
      expect(parent.querySelector('feColorMatrix')).toBe(primitive)
      effects.filter('clip', planPixiEffect('grayscale', {}, 0.5, 0))
      expect(parent.querySelector('feColorMatrix')).not.toBe(primitive)
      effects.retain(new Set())
      expect(parent.querySelector('filter')).toBeNull()
    } finally { effects.dispose(); parent.remove() }
  })
})
