import { describe, expect, it } from 'vitest'
import { CLIP_LOOKS, resolveClipLook } from '../../lib/clip-looks'
import { getEffect, normalizeEffectParams, normalizeRamp } from '../../lib/effects'

describe('compound clip looks', () => {
  it('provides a broad catalog with unique IDs and popular looks first', () => {
    expect(CLIP_LOOKS).toHaveLength(60)
    expect(new Set(CLIP_LOOKS.map(({ id }) => id)).size).toBe(CLIP_LOOKS.length)
    expect(CLIP_LOOKS.slice(0, 10).every(({ popular }) => popular)).toBe(true)
    expect(new Set(CLIP_LOOKS.map(({ category }) => category))).toEqual(new Set([
      'Essentials',
      'Cinematic',
      'Social',
      'Retro',
      'Dreamy',
      'Monochrome',
      'Night',
      'Action',
      'Digital',
      'Artistic',
      'Short-form',
    ]))
    expect(CLIP_LOOKS.every(({ description }) => description.trim().length > 0)).toBe(true)
    expect(CLIP_LOOKS.find(({ id }) => id === 'kodak-gold-summer')?.label).toBe('Warm Summer Film')
    expect(CLIP_LOOKS.find(({ id }) => id === 'kodak-portra-soft')?.label).toBe('Soft Warm Portrait')
    expect(CLIP_LOOKS.find(({ id }) => id === 'fuji-cool-chrome')?.label).toBe('Cool Crisp Film')
    expect(CLIP_LOOKS.find(({ id }) => id === 'cinestill-800t')?.label).toBe('Tungsten Night Grain')
  })

  it('resolves the reference sepia strobe style relative to clip duration', () => {
    const look = resolveClipLook('sepia-strobe', 20, 30)

    expect(CLIP_LOOKS).toContainEqual(expect.objectContaining({ id: 'sepia-strobe' }))
    expect(look.transformKeyframes[0].transform.zoomX).toBeCloseTo(1.03)
    expect(look.transformKeyframes.at(-1)).toMatchObject({
      time: 20,
      transform: { zoomX: 1.12, zoomY: 1.12 },
    })
    expect(look.effects.map(({ effectId }) => effectId)).toEqual([
      'sepia-dream',
      'brightness',
      'gaussian-blur',
      'frame-echo',
      'negative-strobe',
      'negative-strobe',
      'negative-strobe',
      'negative-strobe',
    ])
    expect(look.effects[1]).toMatchObject({
      offset: 0,
      duration: 3,
      ramp: { mode: 'out', curve: 'linear', amount: 1 },
    })
    const pulseOffsets = look.effects.filter(({ effectId }) => effectId === 'negative-strobe').map(({ offset }) => offset)
    for (const [index, offset] of [4.3, 9.6, 16.7, 19.1].entries()) {
      expect(pulseOffsets[index]).toBeCloseTo(offset)
    }
  })

  it('uses registered effects with valid parameters in every recipe', () => {
    for (const { id } of CLIP_LOOKS) {
      const look = resolveClipLook(id, 12, 30)

      expect(look.effects.length, id).toBeGreaterThanOrEqual(3)
      for (const effect of look.effects) {
        expect(getEffect(effect.effectId), `${id}: ${effect.effectId}`).toMatchObject({ kind: 'effect' })
        expect(normalizeEffectParams(effect.effectId, effect.params), `${id}: ${effect.effectId}`).toEqual(effect.params)
        expect(normalizeRamp(effect.ramp), `${id}: ${effect.effectId}`).toEqual(effect.ramp)
      }
    }
  })

  it('clamps every recipe layer and motion keyframe to short clips', () => {
    for (const { id } of CLIP_LOOKS) {
      const look = resolveClipLook(id, 0.5, 30)

      expect(
        look.effects.every(({ offset, duration }) => offset >= 0 && duration > 0 && offset + duration <= 0.5 + 1e-9),
        id,
      ).toBe(true)
      expect(
        look.transformKeyframes.every(({ time }) => time >= 0 && time <= 0.5),
        id,
      ).toBe(true)
    }
  })

  it('keeps repair ordering and digital glitch hits intentional', () => {
    expect(resolveClipLook('balanced-enhance', 10, 30).effects.map(({ effectId }) => effectId)).toEqual([
      'denoise',
      'contrast-pop',
      'sharpen-edges',
    ])

    const glitch = resolveClipLook('rgb-glitch', 10, 30)
    expect(glitch.effects.filter(({ effectId }) => effectId === 'frame-echo')).toHaveLength(2)
    expect(glitch.effects.filter(({ effectId }) => effectId === 'block-damage')).toHaveLength(2)
    expect(glitch.transformKeyframes.length).toBeGreaterThan(2)
  })

  it('builds distinct film-stock and analog-camera recipes', () => {
    expect(resolveClipLook('kodak-gold-summer', 10, 30).effects.map(({ effectId }) => effectId)).toEqual([
      'vintage',
      'warm-grade',
      'contrast-pop',
      'film-grain',
      'vignette',
    ])

    const camcorder = resolveClipLook('y2k-camcorder', 10, 30)
    expect(camcorder.effects.map(({ effectId }) => effectId)).toContain('deinterlace')
    expect(camcorder.effects.map(({ effectId }) => effectId)).toContain('crt-phosphor')
    expect(camcorder.transformKeyframes.length).toBeGreaterThan(2)

    expect(resolveClipLook('vhs-rental-tape', 10, 30).effects.map(({ effectId }) => effectId)).toContain('block-damage')
  })

  it('combines focused layers for commercial and stylized looks', () => {
    expect(resolveClipLook('beauty-commercial', 10, 30).effects[0]).toMatchObject({
      effectId: 'global-beauty',
      params: { softness: 0.45, detail: 0.2 },
    })
    expect(resolveClipLook('comic-pop', 10, 30).effects.map(({ effectId }) => effectId)).toEqual([
      'comic-book',
      'color-boost',
      'contrast-pop',
      'sharpen-edges',
      'stop-motion',
    ])
    expect(resolveClipLook('paparazzi-flash', 10, 30).effects.filter(({ effectId }) => effectId === 'flash-hit')).toHaveLength(3)
    expect(resolveClipLook('thermal-surveillance', 10, 30).effects.map(({ effectId }) => effectId)).toContain('thermal')
  })

  it('builds short-form hits as brief ramped layers', () => {
    const punch = resolveClipLook('hook-punch', 8, 30)
    const flash = punch.effects.find(({ effectId }) => effectId === 'flash-hit')
    const rgb = punch.effects.find(({ effectId }) => effectId === 'rgb-punch')

    expect(punch.transformKeyframes.length).toBeGreaterThan(2)
    expect(flash).toMatchObject({ offset: 0, duration: 0.18, ramp: { mode: 'out', curve: 'ease-out', amount: 1 } })
    expect(rgb).toMatchObject({ offset: 0, duration: 0.14 })
    expect(resolveClipLook('whip-switch', 8, 30).transformKeyframes[0].transform.positionX).toBe(10)
  })
})
