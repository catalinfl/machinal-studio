import { describe, expect, it } from 'vitest'
import { EFFECTS } from '../lib/effects'
import BOXBLUR_FRAG from '../lib/glsl/boxblur.frag.glsl?raw'
import GBLUR_FRAG from '../lib/glsl/gblur.frag.glsl?raw'
import RGBSHIFT_FRAG from '../lib/glsl/rgbshift.frag.glsl?raw'
import {
  applyPixiPerfBudget,
  countExpensivePixiFilters,
  createPixiFilters,
  createPixiTransitionFilter,
  getActivePixiEffectsForClip,
  getEffectPreviewBackend,
  isPixiPreviewEffect,
  PIXI_FFMPEG_TRANSITION_MODES,
  pixiIntensityAt,
  planPixiEffect,
  planPixiEffectStack,
  planPixiTransition,
  type ActivePixiEffect,
} from '../lib/effects-pixi'

describe('Pixi preview backend (tot preview-ul video in Pixi)', () => {
  const effects = EFFECTS.filter((item) => item.kind === 'effect')
  const transitions = EFFECTS.filter((item) => item.kind === 'transition')

  it('maps every video effect and transition to pixi with no prerender', () => {
    expect(effects).toHaveLength(84)
    expect(transitions).toHaveLength(76)
    for (const item of EFFECTS) {
      expect(getEffectPreviewBackend(item.id)).toBe('pixi')
      expect(isPixiPreviewEffect(item.id)).toBe(true)
    }
    expect(isPixiPreviewEffect('missing-id')).toBe(false)
  })

  it('uses the same ramp envelope as ffmpeg, evaluated per frame', () => {
    const ramp = { mode: 'in-out' as const, curve: 'ease-in-out' as const, amount: 0.25 }
    expect(pixiIntensityAt(ramp, 10, 4, 10)).toBeCloseTo(0)
    expect(pixiIntensityAt(ramp, 10, 4, 12)).toBeCloseTo(1)
    expect(pixiIntensityAt(ramp, 10, 4, 14)).toBeCloseTo(0)
    expect(pixiIntensityAt(null, 0, 4, 2)).toBe(1)
    expect(pixiIntensityAt(ramp, 0, 4, -5)).toBeCloseTo(0)
    expect(planPixiEffect('sepia', {}, 0, 1)).toEqual([])
  })

  it('resolves active blocks by start/duration/ramp and owner scope', () => {
    const blocks = [
      { id: 'b1', channelId: 'v1', effectId: 'grayscale', params: {}, ramp: null, start: 0, duration: 4 },
      { id: 'b2', channelId: 'v1', effectId: 'sepia', params: {}, ramp: { mode: 'in' as const, curve: 'linear' as const, amount: 0.5 }, start: 2, duration: 4 },
      { id: 'b3', channelId: 'v1', effectId: 'sepia', params: {}, ramp: null, start: 0, duration: 4, ownerClipId: 'other' },
      { id: 'b4', channelId: 'v2', effectId: 'sepia', params: {}, ramp: null, start: 0, duration: 4 },
    ]
    const at1 = getActivePixiEffectsForClip('v1', 'clip1', blocks, 1)
    expect(at1.map((e) => e.effectId)).toEqual(['grayscale'])
    const at3 = getActivePixiEffectsForClip('v1', 'clip1', blocks, 3)
    expect(at3.map((e) => e.effectId)).toEqual(['grayscale', 'sepia'])
    expect(at3[1].intensity).toBeGreaterThan(0)
    expect(at3[1].intensity).toBeLessThanOrEqual(1)
  })

  it('maps color/blur params to Pixi coefficients (sursa ffmpeg documentata)', () => {
    const gray = planPixiEffect('grayscale', {}, 1, 0)
    expect(gray[0]).toMatchObject({ kind: 'colormatrix', source: expect.stringContaining('hue=s=0') })
    const matrix = (gray[0] as { matrix: number[] }).matrix
    // BT.601 luma, matching FFmpeg vf_hue.c (YUV chroma zeroed).
    expect(matrix[0]).toBeCloseTo(0.299)

    const sepia = planPixiEffect('sepia', {}, 1, 0)
    const sepiaMatrix = (sepia[0] as { matrix: number[] }).matrix
    expect(sepiaMatrix.slice(0, 3)).toEqual([0.393, 0.769, 0.189])

    const bright = planPixiEffect('brightness', { brightness: 0.12, saturation: 1.25 }, 1, 0)
    // Exact FFmpeg vf_eq.c: YUV-domain eq (contrast on Y, saturation on UV),
    // full params + one uIntensity mix (ffmpeg wrapIntensity parity).
    expect(bright[0]).toMatchObject({
      kind: 'custom', custom: 'eq', source: expect.stringContaining('eq=brightness'),
      uniforms: expect.objectContaining({ uBrightness: 0.12, uSaturation: 1.25, uContrast: 1, uGamma: 1, uIntensity: 1 }),
    })
    const boost = planPixiEffect('color-boost', { saturation: 1.45, contrast: 1.05 }, 1, 0)
    expect(boost[0]).toMatchObject({
      kind: 'custom', custom: 'eq', source: expect.stringContaining('eq=saturation'),
      uniforms: expect.objectContaining({ uSaturation: 1.45, uContrast: 1.05, uIntensity: 1 }),
    })

    const blur = planPixiEffect('gaussian-blur', { sigma: 6, steps: 2 }, 1, 0)
    expect(blur[0]).toMatchObject({ kind: 'blur', strength: 6, quality: 2, source: expect.stringContaining('gblur') })

    const dbl = planPixiEffect('directional-blur', { angle: 0, radius: 8 }, 1, 0)
    expect(dbl[0]).toMatchObject({
      kind: 'custom', custom: 'dirblur',
      uniforms: expect.objectContaining({ uRadius: 8, uIntensity: 1 }),
    })
    const dblDir = (dbl[0] as { uniforms: Record<string, number> }).uniforms
    expect(dblDir.uDirX).toBeCloseTo(1)
    expect(dblDir.uDirY).toBeCloseTo(0)

    const dblDiag = planPixiEffect('directional-blur', { angle: 135, radius: 8 }, 1, 0)
    const diagDir = (dblDiag[0] as { uniforms: Record<string, number> }).uniforms
    // Signed direction: 135° is the opposite diagonal from 45°, not abs().
    expect(diagDir.uDirX).toBeCloseTo(Math.cos((135 * Math.PI) / 180))
    expect(diagDir.uDirY).toBeCloseTo(Math.sin((135 * Math.PI) / 180))
    expect(diagDir.uDirX).toBeLessThan(0)

    const rays = planPixiEffect('light-rays', { angle: 45, length: 14 }, 1, 0)
    expect(rays[1]).toMatchObject({ kind: 'custom', custom: 'dirblur' })

    const builtDir = createPixiFilters(dbl, { w: 1080, h: 1920 })
    expect(builtDir.filters.length).toBe(1)

    const poster = planPixiEffect('posterize', { levels: 6 }, 1, 0)
    expect(poster[0]).toMatchObject({ kind: 'custom', custom: 'posterize', source: expect.stringContaining('lutrgb') })

    const prism = planPixiEffect('prism', { shift: 4 }, 1, 0)
    expect(prism[0]).toMatchObject({ kind: 'custom', custom: 'rgbshift' })

    expect(planPixiEffect('mirror', {}, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'geometry', uniforms: { uMode: 0 } })
    expect(planPixiEffect('flip-v', {}, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'geometry', uniforms: { uMode: 1 } })

    expect(planPixiEffect('rotate', { angle: 5 }, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'geometry', uniforms: { uAngle: 5 * Math.PI / 180 } })
  })

  it('covers the whole effect catalog with a Pixi plan (no dead prerender path)', () => {
    for (const item of effects) {
      const plans = planPixiEffect(item.id, {}, 1, 1.0, { w: 1920, h: 1080 })
      expect(Array.isArray(plans)).toBe(true)
      for (const plan of plans) {
        expect(['colormatrix', 'blur', 'blur-dir', 'noise', 'custom', 'transform', 'skip']).toContain(plan.kind)
      }
    }
  })

  it('builds exact tmix plans for temporal effects (ffmpeg vf_mix.c)', () => {
    const trails = planPixiEffect('motion-trails', { frames: 5 }, 1, 0.5)
    expect(trails[0]).toMatchObject({
      kind: 'custom', custom: 'tmix',
      uniforms: expect.objectContaining({ uFrames: 5, uScale: 0.2, uW0: 1, uW4: 1 }),
    })
    const echo = planPixiEffect('frame-echo', { delayFrames: 3, opacity: 0.55 }, 1, 0.25)
    expect(echo[0]).toMatchObject({
      kind: 'custom', custom: 'tmix',
      uniforms: expect.objectContaining({ uFrames: 4, uW0: 1, uW1: 0, uW2: 0, uW3: 0.55 }),
    })
    expect((echo[0] as { uniforms: Record<string, number> }).uniforms.uScale).toBeCloseTo(1 / 1.55, 5)
    const mosh = planPixiEffect('datamosh', {}, 1, 0)
    expect(mosh[0]).toMatchObject({ kind: 'custom', custom: 'tmix' })
    expect(mosh[1]).toMatchObject({ kind: 'custom', custom: 'pixelate' })
    const built = createPixiFilters(trails, { w: 160, h: 90 })
    expect(built.filters.length).toBeGreaterThan(0)
    built.filters.forEach((filter) => filter.destroy())
  })

  it('stacks effect plans bottom->top and builds real Pixi filters', () => {
    const active: ActivePixiEffect[] = [
      { blockId: 'b1', effectId: 'grayscale', params: {}, intensity: 1, progress: 0.5 },
      { blockId: 'b2', effectId: 'gaussian-blur', params: { sigma: 6, steps: 2 }, intensity: 0.5, progress: 0.5 },
      { blockId: 'b3', effectId: 'vignette', params: {}, intensity: 1, progress: 0.5 },
    ]
    const plans = planPixiEffectStack(active, 1.0, { w: 1920, h: 1080 })
    expect(plans.length).toBeGreaterThanOrEqual(3)
    expect(countExpensivePixiFilters(plans)).toBeGreaterThanOrEqual(2)

    const built = createPixiFilters(plans, { w: 1920, h: 1080 })
    expect(built.filters.length).toBeGreaterThanOrEqual(3)
    expect(built.filters.length).toBeLessThanOrEqual(6)
  })

  it('keeps every filter at any FPS so preview matches the ffmpeg export', () => {
    const plans = [
      ...planPixiEffect('film-grain', { strength: 12, seed: 1 }, 1, 0),
      ...planPixiEffect('grayscale', {}, 1, 0),
      ...planPixiEffect('gaussian-blur', { sigma: 6, steps: 2 }, 1, 0),
    ]
    expect(applyPixiPerfBudget(plans, 60)).toHaveLength(plans.length)
    // No silent degradation: low FPS must not drop grain/detail, otherwise
    // the Pixi preview would diverge from the ffmpeg render.
    expect(applyPixiPerfBudget(plans, 25)).toHaveLength(plans.length)
    expect(applyPixiPerfBudget(plans, 15)).toHaveLength(plans.length)
  })

  it('maps every video transition to its FFmpeg 5.1.4 shader mode', () => {
    for (const item of transitions) {
      const plan = planPixiTransition(item.id, 0.5)
      expect(plan.id).toBe(item.id)
      expect(plan.progress).toBe(0.5)
      expect(plan.alphaA).toBe(1)
      expect(plan.alphaB).toBe(1)
      expect(plan.reveal).toMatchObject({
        custom: 'transition-ffmpeg',
        uniforms: {
          uMode: PIXI_FFMPEG_TRANSITION_MODES[item.id],
          uProgress: 0.5,
        },
      })
      expect(plan.source).toContain('FFmpeg 5.1.4')
    }
    expect(Object.keys(PIXI_FFMPEG_TRANSITION_MODES)).toHaveLength(transitions.length)
    expect(new Set(Object.values(PIXI_FFMPEG_TRANSITION_MODES)).size).toBe(transitions.length)
    expect(planPixiTransition('missing', 2)).toMatchObject({ progress: 1, family: 'dissolve' })
  })

  it('converts soft focus source pixels to screen pixels without scaling its color grade', () => {
    for (const intensity of [0.5, 1]) {
      const plans = planPixiEffect('soft-focus', {}, intensity, 0)
      const original = structuredClone(plans)
      // Single crossfade: full sigma + one mix (ffmpeg wrapIntensity parity),
      // never an animated sigma. The eq stage is exact YUV (vf_eq.c).
      expect(plans[0]).toMatchObject({
        kind: 'custom', custom: 'gblur-2d',
        uniforms: expect.objectContaining({ uSigma: 1.2, uIntensity: intensity }),
      })
      expect(plans[1]).toMatchObject({
        kind: 'custom', custom: 'eq',
        uniforms: expect.objectContaining({ uBrightness: 0.03, uSaturation: 1.05, uContrast: 1, uIntensity: intensity }),
      })
      for (const scale of [0.15, 0.3, -0.15]) {
        const built = createPixiFilters(plans, { w: 1672, h: 941 }, { x: scale, y: scale * 2 })
        expect(built.filters.length).toBeGreaterThanOrEqual(2)
        built.filters.forEach((filter) => filter.destroy())
      }
      expect(plans).toEqual(original)
    }
  })

  it('scales blur sample spacing without rounding a subpixel radius to zero', () => {
    const scale = { x: 0.15, y: -0.3 }
    const plans = planPixiEffect('directional-blur', { angle: 45, radius: 1 }, 0.5, 0)
    expect(plans[0]).toMatchObject({
      kind: 'custom', custom: 'dirblur',
      uniforms: expect.objectContaining({ uRadius: 1, uIntensity: 0.5 }),
    })
    const directional = createPixiFilters(plans, undefined, scale)
    expect(directional.filters.length).toBeGreaterThan(0)

    const box = createPixiFilters(planPixiEffect('blur', { lumaRadius: 1 }, 1, 0), undefined, scale)
    expect(box.filters.length).toBeGreaterThan(0)
    ;[...directional.filters, ...box.filters].forEach((filter) => filter.destroy())
  })

  it('builds every two-input transition filter without prerender', () => {
    const wipe = planPixiTransition('wipe-left', 0.3)
    expect(createPixiTransitionFilter(wipe.reveal)).toBeTruthy()
    const custom = planPixiTransition('ripple-warp', 0.6)
    expect(createPixiTransitionFilter(custom.reveal)).toBeTruthy()
    expect(createPixiTransitionFilter(null)).toBeNull()
    for (const item of transitions) {
      const plan = planPixiTransition(item.id, 0.5)
      expect(createPixiTransitionFilter(plan.reveal), item.id).toBeTruthy()
    }
  })

  it('uses the exact FFmpeg modes for previously approximated transitions', () => {
    const modes = (id: string) => planPixiTransition(id, 0.25).reveal?.uniforms.uMode
    expect(modes('difference-dissolve')).toBe(11)
    expect(modes('blur-dissolve')).toBe(35)
    expect(modes('fade-grayscale')).toBe(36)
    expect(modes('squeeze-horizontal')).toBe(41)
    expect(modes('squeeze-vertical')).toBe(42)
    expect(modes('zoom-in')).toBe(43)
    expect(modes('film-dissolve-fast')).toBe(44)
    expect(modes('film-dissolve-slow')).toBe(45)
  })

  it('matches FFmpeg filter math in Pixi plans (sursa: repo-ul open-source FFmpeg)', () => {
    // vf_boxblur.c: native luma/chroma radii and powers, H then V per pass.
    const blur = planPixiEffect('blur', { lumaRadius: 8, lumaPower: 1, chromaRadius: 4, chromaPower: 1 }, 1, 0)
    expect(blur.map((p) => (p as { custom?: string }).custom)).toEqual(['boxblur-native'])
    // vf_hue.c: UV rotation around 128, not YIQ.
    expect(planPixiEffect('hue-shift', { angle: 30 }, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'hue-rotate' })
    // vf_colorbalance.c: luma-weighted shadows/midtones/highlights.
    expect(planPixiEffect('warm-grade', {}, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'colorbalance' })
    expect(planPixiEffect('cool-grade', {}, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'colorbalance' })
    // curves=preset=vintage: exact natural spline LUTs.
    expect(planPixiEffect('vintage', {}, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'vintage-curve' })
    // vf_vignette.c: cos(angle*d)^4 with the FFmpeg angle.
    const vignette = planPixiEffect('vignette', {}, 1, 0)[0] as Extract<
      import('../lib/effects-pixi').PixiPlan,
      { kind: 'custom' }
    >
    expect(vignette).toMatchObject({ kind: 'custom', custom: 'vignette' })
    expect(vignette.uniforms.uIntensity).toBe(1)
    expect(vignette.uniforms.uAngle).toBeCloseTo(Math.PI / 4)
    // median=radius=1 is a 3x3 median, not a blur.
    expect(planPixiEffect('dust-reduction', { radius: 1 }, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'median' })
    // screen-blended glow layers, not sequential lift.
    expect(planPixiEffect('glow-bloom', { radius: 8, opacity: 0.35 }, 1, 0)[0]).toMatchObject({ kind: 'custom', custom: 'glow' })
    // radial-aberration is a uniform rgbashift + PI/5 vignette.
    const radial = planPixiEffect('radial-aberration', { shift: 5, vertical: 2 }, 1, 0)
    expect(radial[0]).toMatchObject({ kind: 'custom', custom: 'rgbshift' })
    // comic-book multiplies dark wires (ink branch), not emboss.
    const comic = planPixiEffect('comic-book', {}, 1, 0)
    expect(comic[0]).toMatchObject({ kind: 'custom', custom: 'edge', uniforms: expect.objectContaining({ uMode: 2 }) })
    // vf_colorkey.c colorhold: average gray, normalized distance, blend.
    const isolation = planPixiEffect('color-isolation', { red: 220, green: 45, blue: 40, similarity: 0.18, blend: 0.08 }, 1, 0)
    expect(isolation[0]).toMatchObject({
      kind: 'custom', custom: 'isolation',
      uniforms: expect.objectContaining({ uSimilarity: 0.18, uBlend: 0.08 }),
    })
    // shake/weave carry the FFmpeg crop-then-scale cover zoom.
    const shake = planPixiEffect('camera-shake', { amount: 8, speed: 1 }, 1, 0.2)
    expect(shake[0]).toMatchObject({ kind: 'custom', custom: 'geometry', uniforms: { uMode: 4, uMargin: 10, uIntensity: 1 } })
  })

  it('renders custom transition expressions in the two-input shader', () => {
    expect(planPixiTransition('whip-pan-left', 0.5).glow).toBe(0)
    expect(planPixiTransition('flash-bulb-transition', 0.5).glow).toBe(0)
    expect(planPixiTransition('light-leak-transition', 0.25).alphaB).toBe(1)
    expect(planPixiTransition('flash-bulb-transition', 0.25).alphaB).toBe(1)
    expect(planPixiTransition('rgb-split-transition', 0.25).alphaB).toBe(1)
    expect(planPixiTransition('whip-pan-left', 0.25).alphaB).toBe(1)
  })

  it('keeps the boxblur shader linkable as GLSL ES 1.00 (no int min/max)', () => {
    // Pixi compiles preview filters as GLSL ES 1.00 on many setups, where
    // min()/max() only accept floats. An int overload fails with:
    // "'min' : no matching overloaded function found" + float->int assign.
    expect(BOXBLUR_FRAG).not.toMatch(/min\s*\(\s*r\s*,/)
    expect(BOXBLUR_FRAG).toContain('r < 64 ? r : 64')
    expect(GBLUR_FRAG).not.toMatch(/min\s*\(\s*r\s*,/)
    expect(GBLUR_FRAG).toContain('r < 16 ? r : 16')
  })

  it('applies ramp intensity exactly once per stage (ffmpeg wrapIntensity parity)', () => {
    // Every nonlinear stage carries FULL params + one uIntensity mix. Lerping
    // the param as well would fade twice and undershoot mid-ramp vs export.
    const half = (id: string, params: Record<string, number> = {}) =>
      planPixiEffect(id, params, 0.5, 0)
    expect(half('blur', { lumaRadius: 8 })[0]).toMatchObject({
      kind: 'custom', custom: 'boxblur-native',
      uniforms: expect.objectContaining({ uLumaRadius: 8, uIntensity: 0.5 }),
    })
    expect(half('hue-shift', { angle: 30 })[0]).toMatchObject({
      kind: 'custom', custom: 'hue-rotate',
      uniforms: expect.objectContaining({ uAngle: (30 * Math.PI) / 180, uIntensity: 0.5 }),
    })
    expect(half('rgb-punch', { shift: 7 })[0]).toMatchObject({
      kind: 'custom', custom: 'rgbshift',
      uniforms: expect.objectContaining({ uShiftX: 7, uIntensity: 0.5 }),
    })
    expect(half('sharpen', { lumaAmount: 0.8 })[0]).toMatchObject({
      kind: 'custom', custom: 'unsharp',
      uniforms: expect.objectContaining({ uLuma: 0.8, uIntensity: 0.5 }),
    })
    expect(half('lens-distortion', { k1: 0.35, k2: 0.08 })[0]).toMatchObject({
      kind: 'custom', custom: 'lens',
      uniforms: expect.objectContaining({ uK1: 0.35, uK2: 0.08, uIntensity: 0.5 }),
    })
    expect(half('waviness', { amplitude: 8 })[0]).toMatchObject({
      kind: 'custom', custom: 'wave',
      uniforms: expect.objectContaining({ uAmp: 8, uIntensity: 0.5 }),
    })
    expect(half('tilt-shift', { blur: 9 })[0]).toMatchObject({
      kind: 'custom', custom: 'tiltshift',
      uniforms: expect.objectContaining({ uBlur: 9, uIntensity: 0.5 }),
    })
    expect(half('glow-bloom', { radius: 8, opacity: 0.35 })[0]).toMatchObject({
      kind: 'custom', custom: 'glow',
      uniforms: expect.objectContaining({ uRadius: 8, uOpacity: 0.35, uIntensity: 0.5 }),
    })
    // Multi-stage grades keep the full grade; only the intensity mix fades.
    // sepia-dream is now [gblur, colorbalance, eq(YUV), sepia, vignette].
    const dreamHalf = half('sepia-dream')[2] as { uniforms: Record<string, number> }
    const dreamFull = planPixiEffect('sepia-dream', {}, 1, 0)[2] as { uniforms: Record<string, number> }
    expect(dreamHalf.uniforms.uContrast).toBe(dreamFull.uniforms.uContrast)
    expect(dreamHalf.uniforms.uSaturation).toBe(dreamFull.uniforms.uSaturation)
    expect(dreamHalf.uniforms.uIntensity).toBe(0.5)
    expect(dreamFull.uniforms.uIntensity).toBe(1)
    // eq stages also keep full params mid-ramp (single mix parity).
    expect(half('color-boost', { saturation: 1.45, contrast: 1.05 })[0]).toMatchObject({
      kind: 'custom', custom: 'eq',
      uniforms: expect.objectContaining({ uSaturation: 1.45, uContrast: 1.05, uIntensity: 0.5 }),
    })
    // Vignette carries frame W/H so non-square frames match vf_vignette.c.
    const vig = planPixiEffect('vignette', {}, 1, 0, { w: 1920, h: 1080 })[0] as { uniforms: Record<string, number> }
    expect(vig.uniforms.uTexW).toBe(1920)
    expect(vig.uniforms.uTexH).toBe(1080)
    // The rgbshift shader itself must not scale the shift by intensity.
    expect(RGBSHIFT_FRAG).toContain('vec2(uShiftX * uScaleX, uShiftY * uScaleY) * texel;')
    expect(RGBSHIFT_FRAG).not.toMatch(/texel \* uIntensity/)
    // New blur shaders build real filters.
    for (const plans of [
      planPixiEffect('blur', { lumaRadius: 8 }, 0.5, 0),
      planPixiEffect('soft-focus', {}, 0.5, 0),
    ]) {
      const built = createPixiFilters(plans, { w: 1080, h: 1920 })
      expect(built.filters.length).toBeGreaterThan(0)
      built.filters.forEach((filter) => filter.destroy())
    }
  })

  it('reflects spatial and temporal denoise strength in the preview plan', () => {
    // hqdn3d preview carries the native spatial/temporal strengths with frame
    // history; every slider must move the plan, otherwise it reads as broken.
    const base = planPixiEffect(
      'denoise',
      { lumaSpatial: 4, chromaSpatial: 3, lumaTemporal: 6, chromaTemporal: 4.5 },
      1, 0,
    )
    expect(base[0]).toMatchObject({ kind: 'custom', custom: 'hqdn3d' })
    const baseUniforms = (base[0] as { uniforms: Record<string, number> }).uniforms
    expect(baseUniforms.uLumaSpatial).toBe(4)
    expect(baseUniforms.uLumaTemporal).toBe(6)

    const strongTemporal = planPixiEffect(
      'denoise',
      { lumaSpatial: 4, chromaSpatial: 3, lumaTemporal: 30, chromaTemporal: 30 },
      1, 0,
    )
    const strongUniforms = (strongTemporal[0] as { uniforms: Record<string, number> }).uniforms
    expect(strongUniforms.uLumaTemporal).toBeGreaterThan(baseUniforms.uLumaTemporal)

    const strongSpatial = planPixiEffect(
      'denoise',
      { lumaSpatial: 20, chromaSpatial: 20, lumaTemporal: 6, chromaTemporal: 4.5 },
      1, 0,
    )
    const spatialUniforms = (strongSpatial[0] as { uniforms: Record<string, number> }).uniforms
    expect(spatialUniforms.uLumaSpatial).toBeGreaterThan(baseUniforms.uLumaSpatial)
  })
})
