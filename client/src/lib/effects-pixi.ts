
import {
  BlurFilter,
  Filter,
  GlProgram,
  NoiseFilter,
  Texture,
  UniformGroup,
} from 'pixi.js'
import {
  getEffect,
  normalizeEffectParams,
  rampIntensityAt,
  type EffectParams,
  type EffectRamp,
} from './effects'

import EFFECT_VERT from './glsl/effect.vert.glsl?raw'
import ADJUST_FRAG from './glsl/adjust.frag.glsl?raw'
import EQ_FRAG from './glsl/eq.frag.glsl?raw'
import WARP_FRAG from './glsl/warp.frag.glsl?raw'
import CONV_FRAG from './glsl/conv.frag.glsl?raw'
import RGBSHIFT_FRAG from './glsl/rgbshift.frag.glsl?raw'
import PIXELATE_FRAG from './glsl/pixelate.frag.glsl?raw'
import TILTSHIFT_FRAG from './glsl/tiltshift.frag.glsl?raw'
import BOXBLUR_FRAG from './glsl/boxblur.frag.glsl?raw'
import DIRBLUR_FRAG from './glsl/dirblur.frag.glsl?raw'
import GBLUR_FRAG from './glsl/gblur.frag.glsl?raw'
import MEDIAN_FRAG from './glsl/median.frag.glsl?raw'
import GEOMETRY_FRAG from './glsl/geometry.frag.glsl?raw'
import RECURSIVE_BLUR_FRAG from './glsl/recursive-blur.frag.glsl?raw'
import CHROMASHIFT_FRAG from './glsl/chromashift.frag.glsl?raw'
import { createCannyFilter } from './pixi-canny'
import { eqUniforms } from './pixi-eq'
import { boxBlurFilter, gaussianFilter, gaussianPasses, glowFilter, pixelAverageFilter, tiltShiftFilter } from './pixi-spatial'
import WAVE_YUV_FRAG from './glsl/wave-yuv.frag.glsl?raw'
import { createNativeNoiseFilter, type NativeNoiseOptions } from './pixi-noise'
import UNSHARP_FRAG from './glsl/unsharp.frag.glsl?raw'
import { DblurFilter } from './pixi-dblur'
import { transitionRandom } from './pixi-transition-random'
import { BilateralFilter } from './pixi-bilateral'
import { createDebandFilter } from './pixi-deband'
import { TmixFilter, StopMotionFilter } from './pixi-tmix'
import { Hqdn3dFilter } from './pixi-hqdn3d'
import type { PixiHistory } from './pixi-history'
import CAS_FRAG from './glsl/cas.frag.glsl?raw'
import DRAWGRID_FRAG from './glsl/drawgrid.frag.glsl?raw'
import COLORMATRIX_FRAG from './glsl/colormatrix.frag.glsl?raw'
import CB_FRAG from './glsl/colorbalance.frag.glsl?raw'
import HUE_FRAG from './glsl/hue.frag.glsl?raw'
import { VINTAGE_CURVE, CROSS_PROCESS_CURVE, INFRARED_CURVE } from './pixi-curves'
import GLOW_FRAG from './glsl/glow.frag.glsl?raw'
import TRANSITION_FRAG from './glsl/transition.frag.glsl?raw'

export const PIXI_PREVIEW_BACKEND = 'pixi' as const
export type EffectPreviewBackend = typeof PIXI_PREVIEW_BACKEND

export function getEffectPreviewBackend(_effectId: string): EffectPreviewBackend {
  return PIXI_PREVIEW_BACKEND
}

export function isPixiPreviewEffect(effectId: string): boolean {
  const def = getEffect(effectId)
  if (!def) return false
  if (def.kind === 'transition') return true
  return !!def.build
}

export function pixiIntensityAt(
  ramp: EffectRamp | null | undefined,
  blockStart: number,
  blockDuration: number,
  timelineTime: number,
): number {
  if (!ramp || !(blockDuration > 0)) return 1
  const progress = (timelineTime - blockStart) / blockDuration
  return rampIntensityAt(ramp, progress)
}

export interface ActivePixiEffect {
  blockId: string
  effectId: string
  params: EffectParams
  intensity: number
  progress: number
  timeSec?: number
  ramp?: EffectRamp | null
  epoch?: number
}

interface PixiBlockLike {
  id: string
  channelId: string
  effectId: string
  params: EffectParams
  ramp: EffectRamp | null
  start: number
  duration: number
  ownerClipId?: string
}

export function getActivePixiEffectsForClip(
  channelId: string,
  clipId: string,
  blocks: readonly PixiBlockLike[],
  timelineTime: number,
  clipStart = 0,
): ActivePixiEffect[] {
  const out: ActivePixiEffect[] = []
  const relevant = blocks.filter(block => block.channelId === channelId && (!block.ownerClipId || block.ownerClipId === clipId))
  const segmentStart = relevant.reduce((start, block) => {
    for (const boundary of [block.start, block.start + block.duration]) {
      if (boundary <= timelineTime && boundary > start) start = boundary
    }
    return start
  }, clipStart)
  for (const block of blocks) {
    if (block.channelId !== channelId) continue
    if (block.ownerClipId && block.ownerClipId !== clipId) continue
    if (timelineTime < block.start || timelineTime >= block.start + block.duration) continue
    if (!isPixiPreviewEffect(block.effectId)) continue
    const params = normalizeEffectParams(block.effectId, block.params)
    const progress = block.duration > 0 ? (timelineTime - block.start) / block.duration : 0
    out.push({
      blockId: block.id,
      effectId: block.effectId,
      params,
      intensity: pixiIntensityAt(block.ramp, block.start, block.duration, timelineTime),
      progress: Math.max(0, Math.min(1, progress)),
      timeSec: Math.max(0, timelineTime - segmentStart),
      ramp: block.ramp,
      epoch: segmentStart,
    })
  }
  return out
}

type PixiPlanCore =
  | { kind: 'colormatrix'; matrix: number[]; alpha: number; source: string; trunc?: boolean; lut?: boolean; intensity?: number }
  | { kind: 'blur'; strength: number; quality: number; source: string }
  | { kind: 'blur-dir'; strengthX: number; strengthY: number; quality: number; source: string }
  | { kind: 'noise'; noise: number; seed: number; source: string; options?: NativeNoiseOptions }
  | { kind: 'custom'; custom: string; uniforms: Record<string, number>; source: string }
  | {
      kind: 'transform'
      dx: number
      dy: number
      rotation: number
      shearX: number
      shearY: number
      scaleX: number
      scaleY: number
      mirrorH: boolean
      mirrorV: boolean
      source: string
    }
  | { kind: 'skip'; reason: string; source: string }

export type PixiPlan = PixiPlanCore & { key?: string }

export const HISTORY_EFFECTS = new Set(['denoise', 'global-beauty', 'motion-trails', 'frame-echo', 'datamosh', 'deflicker', 'deinterlace', 'stop-motion'])

export function pixiHistorySignature(effects: readonly ActivePixiEffect[]): string {
  return JSON.stringify(effects.map(({ blockId, effectId, params, ramp, epoch }) => ({ blockId, effectId, params, ramp, epoch })))
}

export interface PixiFrameSize {
  w: number
  h: number
  fps?: number
}

function lerp(neutral: number, target: number, intensity: number): number {
  return neutral + (target - neutral) * intensity
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array(20).fill(0)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[row * 5 + k] * b[k * 5 + col]
      out[row * 5 + col] = sum
    }
    let offset = a[row * 5 + 4]
    for (let k = 0; k < 4; k++) offset += a[row * 5 + k] * b[k * 5 + 4]
    out[row * 5 + 4] = offset
  }
  return out
}

function brightnessMatrix(offset: number): number[] {
  return [1, 0, 0, 0, offset, 0, 1, 0, 0, offset, 0, 0, 1, 0, offset, 0, 0, 0, 1, 0]
}

function contrastMatrix(contrast: number): number[] {
  const offset = 0.5 * (1 - contrast)
  return [
    contrast, 0, 0, 0, offset,
    0, contrast, 0, 0, offset,
    0, 0, contrast, 0, offset,
    0, 0, 0, 1, 0,
  ]
}

function saturationMatrix(saturation: number): number[] {
  // FFmpeg eq/hue saturation operates on YUV chroma (BT.601 luma).
  // vf_eq.c scales U/V around 128; the RGB-domain equivalent preserves
  // BT.601 luma (0.299/0.587/0.114), not Rec.709.
  const r = 0.299
  const g = 0.587
  const b = 0.114
  const s = saturation
  return [
    r + (1 - r) * s, g * (1 - s), b * (1 - s), 0, 0,
    r * (1 - s), g + (1 - g) * s, b * (1 - s), 0, 0,
    r * (1 - s), g * (1 - s), b + (1 - b) * s, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

function gammaMatrix(gamma: number): number[] {
  const approx = 1 / Math.max(0.1, gamma)
  return contrastMatrix(lerp(1, approx, 0.65))
}

function sepiaMatrix(): number[] {
  return [
    0.393, 0.769, 0.189, 0, 0,
    0.349, 0.686, 0.168, 0, 0,
    0.272, 0.534, 0.131, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

function grayscaleMatrix(): number[] {
  // Matches FFmpeg hue=s=0 (zeroed YUV chroma => BT.601 luma), vf_hue.c.
  const r = 0.299
  const g = 0.587
  const b = 0.114
  return [
    r, g, b, 0, 0,
    r, g, b, 0, 0,
    r, g, b, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

function negateMatrix(): number[] {
  return [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0]
}

function hueRotateMatrix(angleDeg: number): number[] {
  const angle = (angleDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const rgbToYiq = [
    0.299, 0.587, 0.114, 0, 0,
    0.596, -0.274, -0.322, 0, 0,
    0.211, -0.523, 0.312, 0, 0,
    0, 0, 0, 1, 0,
  ]
  const yiqToRgb = [
    1, 0.956, 0.621, 0, 0,
    1, -0.272, -0.647, 0, 0,
    1, -1.106, 1.703, 0, 0,
    0, 0, 0, 1, 0,
  ]
  const rot = [
    1, 0, 0, 0, 0,
    0, cos, -sin, 0, 0,
    0, sin, cos, 0, 0,
    0, 0, 0, 1, 0,
  ]
  return multiplyMatrices(yiqToRgb, multiplyMatrices(rot, rgbToYiq))
}

function colorBalanceMatrix(rs: number, gs: number, bs: number, rm = 0, gm = 0, bm = 0): number[] {
  const or_ = rs * 0.6 + rm * 0.4
  const og = gs * 0.6 + gm * 0.4
  const ob = bs * 0.6 + bm * 0.4
  return [1, 0, 0, 0, or_, 0, 1, 0, 0, og, 0, 0, 1, 0, ob, 0, 0, 0, 1, 0]
}

function channelMixerMatrix(rr: number, rg: number, rb: number, gr: number, gg: number, gb: number, br: number, bg: number, bb: number): number[] {
  return [rr, rg, rb, 0, 0, gr, gg, gb, 0, 0, br, bg, bb, 0, 0, 0, 0, 0, 1, 0]
}

function eqMatrix(brightness: number, saturation: number, contrast: number, gamma = 1): number[] {
  let m = identityMatrix()
  if (Math.abs(brightness) > 1e-9) m = multiplyMatrices(brightnessMatrix(brightness), m)
  if (Math.abs(contrast - 1) > 1e-9) m = multiplyMatrices(contrastMatrix(contrast), m)
  if (Math.abs(saturation - 1) > 1e-9) m = multiplyMatrices(saturationMatrix(saturation), m)
  if (Math.abs(gamma - 1) > 1e-9) m = multiplyMatrices(gammaMatrix(gamma), m)
  return m
}

function mixMatrixWithIdentity(matrix: number[], intensity: number): number[] {
  if (intensity >= 0.999) return matrix
  if (intensity <= 0.001) return identityMatrix()
  return matrix.map((value, index) => {
    const identity = index % 6 === 0 ? 1 : 0
    return identity + (value - identity) * intensity
  })
}

// Colormatrix plans for direct math bake intensity into the matrix (linear
// ops commute with blending); the LUT path keeps the full matrix because
// lrint rounding does not commute with lerping, and mixes in-shader instead.
// Partial ramps truncate like the native wrapIntensity blend (C-cast).
function cmPlan(matrix: number[], intensity: number, source: string, lut = false): PixiPlan {
  return {
    kind: 'colormatrix', matrix: lut ? matrix : mixMatrixWithIdentity(matrix, intensity),
    alpha: 1, source, trunc: intensity < 0.999 && intensity > 0.001, lut, intensity,
  }
}

// Exact FFmpeg vf_eq.c: Y contrast/brightness/gamma + UV saturation in
// BT.601 full-range YUV. Full params + one shader mix (uIntensity) so ramped
// blocks match ffmpeg wrapIntensity (single crossfade), never a double fade.
function eqPlan(
  contrast: number,
  brightness: number,
  saturation: number,
  gamma: number,
  intensity: number,
  source: string,
): PixiPlan {
  return {
    kind: 'custom', custom: 'eq',
    uniforms: {
      uContrast: contrast, uBrightness: brightness,
      uSaturation: saturation, uGamma: gamma, uIntensity: intensity,
    },
    source,
  }
}

// Exact FFmpeg vf_vignette.c forward factor needs frame W/H for dnorm:
// d = hypot(X-W/2,Y-H/2)/hypot(W/2,H/2). Keep them in the plan so the
// shader matches non-square frames (square-only length()*sqrt2 undershoots
// edge midpoints on 16:9).
function vignettePlan(angle: number, intensity: number, frame: PixiFrameSize, source: string, yuv = false): PixiPlan {
  return {
    kind: 'custom', custom: 'vignette',
    uniforms: { uIntensity: intensity, uAngle: angle, uTexW: frame.w, uTexH: frame.h, uYuv: yuv ? 1 : 0 },
    source,
  }
}

export function planPixiEffect(
  effectId: string,
  params: Readonly<EffectParams>,
  intensity: number,
  timeSec: number,
  frame: PixiFrameSize = { w: 1920, h: 1080 },
  ramped = intensity < 1,
): PixiPlan[] {
  const p = normalizeEffectParams(effectId, params)
  const I = clamp01(intensity)
  if (I <= 0.001 && !HISTORY_EFFECTS.has(effectId)) return []
  const src = (frag: string) => `ffmpeg:${frag}`
  const noisePlan = (strength: number, seed: number, options: { yuv?: boolean; temporal?: boolean; gaussian?: boolean } = {}): PixiPlan => ({
    kind: 'noise', noise: strength * I / 255, seed, source: src('noise'),
    options: { strength, seed, intensity: I, frameIndex: Math.floor(Math.max(0, timeSec) * (frame.fps ?? 30) + 0.00001), temporal: options.temporal ?? true, gaussian: options.gaussian ?? false, yuv: false },
  })

  switch (effectId) {
    case 'blur': {
      return [{ kind: 'custom', custom: 'boxblur-native', uniforms: { uLumaRadius: p.lumaRadius, uLumaPower: p.lumaPower, uChromaRadius: p.chromaRadius, uChromaPower: p.chromaPower, uIntensity: I }, source: src('boxblur') }]
    }
    case 'gaussian-blur': {
      const strength = lerp(0, p.sigma ?? 6, I)
      if (strength <= 0.02) return []
      return [{ kind: 'blur', strength, quality: Math.round(p.steps ?? 2), source: src('gblur') }]
    }
    case 'directional-blur': {
      // FFmpeg vf_dblur.c orients its IIR along (cos(angle), sin(angle)).
      // The preview convolves the exact simulated impulse response (see
      // pixi-dblur.ts) instead of a box average, matching decay rate and
      // DC gain; intensity mixes once like the ffmpeg wrapIntensity ramp.
      const degrees = p.angle ?? 45
      const angle = (degrees * Math.PI) / 180
      const radius = p.radius ?? 8
      if (radius < 0.5) return []
      return [{
        kind: 'custom', custom: 'dirblur',
        uniforms: { uRadius: radius, uAngle: degrees, uDirX: Math.cos(angle), uDirY: Math.sin(angle), uIntensity: I },
        source: src('dblur'),
      }]
    }
    case 'mosaic-blur':
    case 'block-damage': {
      const bw = effectId === 'mosaic-blur' ? (p.width ?? 16) : (p.blockSize ?? 8)
      const bh = effectId === 'mosaic-blur' ? (p.height ?? 16) : (p.blockSize ?? 8)
      const plans: PixiPlan[] = [{
        kind: 'custom', custom: 'pixelate',
        uniforms: { uBlockW: bw, uBlockH: bh, uIntensity: I },
        source: src('pixelize'),
      }]
      if (effectId === 'block-damage' && (p.noise ?? 4) > 0) {
        plans.push(noisePlan(p.noise ?? 4, 11, { temporal: false }))
      }
      return plans
    }
    case 'soft-focus': {
      const out: PixiPlan[] = []
      // Full sigma + one mix: ffmpeg wraps the whole gblur,eq chain, and the
      // eq stage below carries full params + one mix (ffmpeg wrapIntensity).
      const sigma = p.sigma ?? 1.2
      if (sigma > 0.02) out.push({ kind: 'custom', custom: 'gblur-2d', uniforms: { uSigma: sigma, uIntensity: I }, source: src('gblur') })
      out.push(eqPlan(1, p.brightness ?? 0.03, p.saturation ?? 1.05, 1, I, src('eq')))
      return out
    }

    case 'grayscale':
      return [cmPlan(grayscaleMatrix(), I, src('hue=s=0'))]
    case 'brightness': {
      return [eqPlan(1, p.brightness ?? 0.12, p.saturation ?? 1.25, 1, I, src('eq=brightness:saturation'))]
    }
    case 'contrast-pop': {
      return [eqPlan(p.contrast ?? 1.18, p.brightness ?? -0.02, p.saturation ?? 1.08, p.gamma ?? 1.03, I, src('eq=contrast:brightness:saturation:gamma'))]
    }
    case 'color-boost': {
      return [eqPlan(p.contrast ?? 1.05, 0, p.saturation ?? 1.45, 1, I, src('eq=saturation:contrast'))]
    }
    case 'hue-shift':
      // Exact FFmpeg vf_hue.c: rotate (U,V) around 128 by angle. Full angle
      // + one shader mix: lerping the angle as well would fade twice.
      return [{ kind: 'custom', custom: 'hue-rotate', uniforms: { uAngle: ((p.angle ?? 30) * Math.PI) / 180, uIntensity: I }, source: src('hue=h') }]
    case 'warm-grade':
      return [{ kind: 'custom', custom: 'colorbalance', uniforms: { uRS: 0.1, uGS: 0.02, uBS: -0.08, uRM: 0.08, uGM: 0.02, uBM: -0.06, uRH: 0, uGH: 0, uBH: 0, uIntensity: I }, source: src('colorbalance') }]
    case 'cool-grade':
      return [{ kind: 'custom', custom: 'colorbalance', uniforms: { uRS: -0.07, uGS: 0.01, uBS: 0.1, uRM: -0.05, uGM: 0.01, uBM: 0.08, uRH: 0, uGH: 0, uBH: 0, uIntensity: I }, source: src('colorbalance') }]
    case 'day-for-night': {
      // colorbalance bs=0.15:bm=0.12:bh=0.08:rs=-0.10 (shadows only rs) then eq.
      return [
        { kind: 'custom', custom: 'colorbalance', uniforms: { uRS: -0.1, uGS: 0, uBS: 0.15, uRM: 0, uGM: 0, uBM: 0.12, uRH: 0, uGH: 0, uBH: 0.08, uIntensity: I }, source: src('colorbalance') },
        eqPlan(1, -0.12, 0.75, 1, I, src('eq')),
      ]
    }
    case 'vintage':
      return [
        { kind: 'custom', custom: 'vintage-curve', uniforms: { uIntensity: I }, source: src('curves=preset=vintage') },
        eqPlan(1, 0, 0.85, 1, I, src('eq=saturation=0.85')),
      ]
    case 'bleach-bypass': {
      return [eqPlan(1.3, -0.03, 0.35, 1, I, src('eq=contrast:brightness:saturation'))]
    }
    case 'sepia':
      return [cmPlan(sepiaMatrix(), I, src('colorchannelmixer=sepia'), true)]
    case 'negate':
      return [cmPlan(negateMatrix(), I, src('negate'))]
    case 'sepia-dream': {
      const out: PixiPlan[] = []
      const sigma = 0.65
      if (sigma > 0.02) out.push({ kind: 'custom', custom: 'gblur-2d', uniforms: { uSigma: sigma, uSteps: 2, uIntensity: I }, source: src('gblur') })
      out.push({ kind: 'custom', custom: 'colorbalance', uniforms: { uRS: 0.08, uGS: 0.01, uBS: -0.08, uRM: 0.06, uGM: 0.01, uBM: -0.05, uRH: 0, uGH: 0, uBH: 0, uIntensity: I }, source: src('colorbalance') })
      // FFmpeg: eq in YUV, then RGB sepia matrix. Two stages like the
      // filter chain (not one combined RGB matrix) so contrast/saturation
      // match the export.
      out.push(eqPlan(0.96, -0.015, 0.82, 1, I, src('eq')))
      out.push(cmPlan(sepiaMatrix(), I, src('colorchannelmixer'), true))
      out.push(vignettePlan(0.7853982, I, frame, src('vignette')))
      return out
    }
    case 'negative-strobe': {
      const rate = p.rate ?? 10
      const duty = p.duty ?? 0.4
      const phase = timeSec * rate + 1e-7
      const active = phase - Math.floor(phase) < duty
      if (!active) return []
      return [cmPlan(negateMatrix(), I, src("negate=enable='lt(mod(t))'"))]
    }
    case 'flash-hit': {
      return [eqPlan(p.contrast ?? 1.08, p.brightness ?? 0.38, p.saturation ?? 0.45, 1, I, src('eq=brightness:contrast:saturation'))]
    }
    case 'rgb-punch': {
      const shift = Math.round(p.shift ?? 7)
      const out: PixiPlan[] = []
      if (Math.abs(shift) >= 0.5) {
        out.push({ kind: 'custom', custom: 'rgbshift', uniforms: { uShiftX: shift, uShiftY: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('rgbashift') })
      }
      out.push(eqPlan(p.contrast ?? 1.16, 0, p.saturation ?? 1.2, 1, I, src('eq')))
      return out
    }
    case 'analog-flicker': {
      const amount = p.amount ?? 0.035
      const rate = p.rate ?? 8
      // Full flicker brightness + one eq mix (ffmpeg wrapIntensity parity):
      // lerping contrast too would fade twice mid-ramp.
      const flickerFull = amount * Math.sin(2 * Math.PI * rate * timeSec)
      const out: PixiPlan[] = [
        eqPlan(p.contrast ?? 1.03, flickerFull, 1, 1, I, src("eq=brightness='amount*sin(2*PI*rate*t)'")),
      ]
      const grain = p.grain ?? 3
      if (grain > 0) out.push(noisePlan(grain, 29))
      return out
    }

    case 'film-grain': {
      const strength = p.strength ?? 12
      // FFmpeg vf_noise.c: uniform noise in [-strength/2, +strength/2] LSB
      // added to 0..255 pixels => float amplitude strength/255.
      return [noisePlan(strength, p.seed ?? 12345)]
    }
    case 'analog-damage': {
      const out: PixiPlan[] = [
        eqPlan(1.12, -0.03, 0.72, 1, I, src('eq')),
        noisePlan(10, 7),
      ]
      out.push({ kind: 'custom', custom: 'chromashift', uniforms: { uBlueX: 2, uBlueY: 1, uRedX: -2, uRedY: -1, uIntensity: I }, source: src('chromashift') })
      out.push(vignettePlan(0.7853982, I, frame, src('vignette')))
      return out
    }
    case 'scanlines': {
      return [{ kind: 'custom', custom: 'scanlines', uniforms: { uSpacing: p.spacing ?? 4, uThickness: p.thickness ?? 1, uOpacity: p.opacity ?? 0.35, uYuv: 0, uIntensity: I }, source: src('drawgrid') }]
    }
    case 'vignette':
      return [vignettePlan(0.7853982, I, frame, src('vignette=angle=PI/4'))]
    case 'dust-scratches': {
      const out: PixiPlan[] = []
      const dust = p.dust ?? 10
      if (dust > 0) out.push(noisePlan(dust, 79))
      out.push({
        kind: 'custom', custom: 'scanlines-v',
        uniforms: { uSpacing: p.spacing ?? 173, uThickness: p.thickness ?? 1, uOpacity: p.opacity ?? 0.12, uWhite: 1, uYuv: 0, uIntensity: I },
        source: src('drawgrid=vertical scratches'),
      })
      return out
    }
    case 'film-flicker': {
      const amount = p.amount ?? 0.07
      const rate = p.rate ?? 5
      const flickerFull = amount * (
        0.58 * Math.sin(2 * Math.PI * rate * timeSec) +
        0.29 * Math.sin(2 * Math.PI * rate * 2.37 * timeSec) +
        0.13 * Math.sin(2 * Math.PI * rate * 5.11 * timeSec)
      )
      return [eqPlan(p.contrast ?? 1.06, flickerFull, 1, 1, I, src('eq=brightness=flicker:eval=frame'))]
    }
    case 'old-projector': {
      const flickerFull = 0.055 * (0.65 * Math.sin(2 * Math.PI * 5 * timeSec) + 0.35 * Math.sin(2 * Math.PI * 11.7 * timeSec))
      return [
        // FFmpeg: curves=preset=vintage,eq=contrast=1.08:brightness=flicker:
        // saturation=0.72:eval=frame,noise,drawgrid,vignette (no colorbalance).
        { kind: 'custom', custom: 'vintage-curve', uniforms: { uIntensity: I }, source: src('curves=preset=vintage') },
        eqPlan(1.08, flickerFull, 0.72, 1, I, src('eq')),
        noisePlan(14, 83),
        // FFmpeg old-projector includes drawgrid white scratches (width 181).
        { kind: 'custom', custom: 'scanlines-v', uniforms: { uSpacing: 181, uThickness: 1, uOpacity: 0.1, uWhite: 1, uIntensity: I, uYuv: 0 }, source: src('drawgrid scratches') },
        vignettePlan(0.7853982, I, frame, src('vignette')),
      ]
    }
    case 'gate-weave': {
      const amount = p.amount ?? 2
      const speed = p.speed ?? 1
      return [geometryPlan(4, I, frame, { uMargin: Math.ceil(amount) + 2, uX: amount * Math.sin(speed * 7 * timeSec), uY: amount * 0.7 * Math.sin(speed * 11 * timeSec) }, src('crop+sin,scale'))]
    }

    case 'global-beauty': {
      const spatial = p.spatial ?? 2
      const temporal = p.temporal ?? 3
      const softness = p.softness ?? 0.35
      const out: PixiPlan[] = [{ kind: 'custom', custom: 'hqdn3d', uniforms: { uLumaSpatial: spatial, uChromaSpatial: spatial * .75, uLumaTemporal: temporal, uChromaTemporal: temporal * .75, uFrame: Math.floor(timeSec * (frame.fps ?? 30) + .00001), uIntensity: I }, source: src('hqdn3d') }]
      if (softness > 0) out.push({ kind: 'custom', custom: 'gblur-2d', uniforms: { uSigma: softness, uSteps: 2, uIntensity: I }, source: src('gblur') })
      const detail = p.detail ?? 0.25
      if (detail > 0) out.push({ kind: 'custom', custom: 'unsharp', uniforms: { uLuma: detail, uChroma: 0, uIntensity: I }, source: src('unsharp') })
      return out
    }
    case 'deband':
      return [{ kind: 'custom', custom: 'deband', uniforms: { uRange: p.range ?? 16, uThreshold: p.threshold ?? .02, uIntensity: I }, source: src('deband coupling=1') }]
    case 'deflicker':
      return [{ kind: 'skip', reason: 'deflicker needs frame history; preview passthrough', source: src('deflicker=size=5:mode=am') }]
    case 'denoise': {
      return [{ kind: 'custom', custom: 'hqdn3d', uniforms: { uLumaSpatial: p.lumaSpatial ?? 4, uChromaSpatial: p.chromaSpatial ?? 3, uLumaTemporal: p.lumaTemporal ?? 6, uChromaTemporal: p.chromaTemporal ?? 4.5, uFrame: Math.floor(timeSec * (frame.fps ?? 30) + .00001), uIntensity: I }, source: src('hqdn3d') }]
    }
    case 'dust-reduction': {
      return [{ kind: 'custom', custom: 'median', uniforms: { uIntensity: I, uRadius: p.radius ?? 1 }, source: src('median') }]
    }
    case 'chromatic-correction': {
      return [{ kind: 'custom', custom: 'chromashift', uniforms: { uBlueX: p.blueOffset ?? -2, uRedX: p.redOffset ?? 2, uIntensity: I }, source: src('chromashift') }]
    }
    case 'deinterlace':
      return [{ kind: 'skip', reason: 'deinterlace bob passthrough for progressive preview', source: src('yadif') }]
    case 'sharpen': {
      const amount = p.lumaAmount ?? 0.8
      return [{ kind: 'custom', custom: 'unsharp', uniforms: { uLuma: amount, uChroma: p.chromaAmount ?? 0.2, uIntensity: I }, source: src('unsharp') }]
    }
    case 'sharpen-edges': {
      const strength = p.strength ?? 0.5
      return [{ kind: 'custom', custom: 'sharpen', uniforms: { uAmount: strength, uIntensity: I }, source: src('cas') }]
    }
    case 'soften': {
      return [{ kind: 'custom', custom: 'unsharp', uniforms: { uLuma: p.lumaAmount ?? -0.6, uChroma: p.chromaAmount ?? -0.3, uIntensity: I }, source: src('negative unsharp') }]
    }

    case 'edge-detect':
      return [{ kind: 'custom', custom: 'edge', uniforms: { uLow: 0.08, uHigh: 0.25, uMode: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('edgedetect=colormix') }]
    case 'emboss':
      return [{ kind: 'custom', custom: 'emboss', uniforms: { uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('convolution=emboss') }]
    case 'pencil-sketch':
      return [
        { kind: 'custom', custom: 'edge', uniforms: { uLow: 0.06, uHigh: 0.2, uMode: 1, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('edgedetect=wires') },
        cmPlan(negateMatrix(), I, src('negate')),
      ]
    case 'posterize': {
      return [{ kind: 'custom', custom: 'posterize', uniforms: { uLevels: p.levels ?? 6, uIntensity: I }, source: src('lutrgb posterize') }]
    }
    case 'prism': {
      const shift = Math.round(p.shift ?? 4)
      if (Math.abs(shift) < 0.5) return []
      return [{ kind: 'custom', custom: 'rgbshift', uniforms: { uShiftX: shift, uShiftY: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('rgbashift') }]
    }
    case 'watercolor': {
      return [{ kind: 'custom', custom: 'bilateral', uniforms: { uSpatial: p.spatial ?? 5, uRange: p.range ?? .12, uIntensity: I }, source: src('bilateral') }]
    }
    case 'mirror':
      return [geometryPlan(0, I, frame, {}, src('hflip'))]
    case 'flip-v':
      return [geometryPlan(1, I, frame, {}, src('vflip'))]

    case 'motion-trails': {
      const frames = Math.max(2, Math.round(p.frames ?? 5))
      const uniforms: Record<string, number> = { uFrames: frames, uScale: 1 / frames, uFrame: Math.floor(Math.max(0, timeSec) * (frame.fps ?? 30) + 0.00001), uIntensity: I }
      for (let index = 0; index < frames; index++) uniforms[`uW${index}`] = 1
      return [{ kind: 'custom', custom: 'tmix', uniforms, source: src('tmix') }]
    }
    case 'frame-echo': {
      const frames = Math.max(2, Math.round((p.delayFrames ?? 3) + 1))
      const opacity = p.opacity ?? 0.55
      const uniforms: Record<string, number> = { uFrames: frames, uScale: 1 / (1 + opacity), uFrame: Math.floor(Math.max(0, timeSec) * (frame.fps ?? 30) + 0.00001), uIntensity: I, uW0: 1 }
      for (let index = 1; index < frames; index++) uniforms[`uW${index}`] = index === frames - 1 ? opacity : 0
      return [{ kind: 'custom', custom: 'tmix', uniforms, source: src('tmix') }]
    }
    case 'datamosh': {
      const frames = Math.max(2, Math.round(p.frames ?? 4))
      const uniforms: Record<string, number> = { uFrames: frames, uScale: 1 / frames, uFrame: Math.floor(Math.max(0, timeSec) * (frame.fps ?? 30) + 0.00001), uIntensity: I }
      for (let index = 0; index < frames; index++) uniforms[`uW${index}`] = 1
      return [
        { kind: 'custom', custom: 'tmix', uniforms, source: src('tmix') },
        { kind: 'custom', custom: 'pixelate', uniforms: { uBlockW: p.blockSize ?? 6, uBlockH: p.blockSize ?? 6, uIntensity: I }, source: src('pixelize') },
        eqPlan(p.contrast ?? 1.08, 0, p.saturation ?? 1.25, 1, I, src('eq')),
      ]
    }
    case 'stop-motion': {
      // FFmpeg fps= drops/duplicates frames onto the hold cadence. The
      // preview holds the filtered frame with the same cadence instead of
      // reseeking media: floor(t*holdFps) selects the source frame.
      return [{ kind: 'custom', custom: 'stopmotion', uniforms: { uHoldFps: p.fps ?? 12, uTime: timeSec }, source: src('fps') }]
    }

    case 'rotate': {
      return [geometryPlan(2, I, frame, { uAngle: (p.angle ?? 5) * Math.PI / 180 }, src('rotate'))]
    }
    case 'lens-distortion':
    case 'fisheye':
    case 'crt-curvature': {
      const cx = effectId === 'crt-curvature' ? 0.5 : (p.centerX ?? 0.5)
      const cy = effectId === 'crt-curvature' ? 0.5 : (p.centerY ?? 0.5)
      // Ramp the rendered image, not the lens coefficients or sample coordinates.
      const k1 = effectId === 'crt-curvature' ? (p.curvature ?? 0.22) : (p.k1 ?? 0.35)
      const k2 = effectId === 'crt-curvature' ? (p.curvature ?? 0.22) * 0.24 : (p.k2 ?? 0.08)
      const plans: PixiPlan[] = [{
        kind: 'custom', custom: 'lens',
        uniforms: { uK1: k1, uK2: k2, uCx: cx, uCy: cy, uIntensity: I, uTexW: frame.w, uTexH: frame.h },
        source: src('lenscorrection'),
      }]
      if (effectId === 'crt-curvature') {
        const div = p.vignette ?? 4
        plans.push(vignettePlan(Math.PI / Math.max(2, div), I, frame, src('vignette')))
      }
      return plans
    }
    case 'shear': {
      return [geometryPlan(3, I, frame, { uX: p.horizontal ?? 0.15, uY: p.vertical ?? 0 }, src('shear'))]
    }
    case 'waviness':
    case 'vhs-tracking':
    case 'vhs-head-noise':
    case 'glitch-bands': {
      if (effectId === 'waviness') {
        return [{ kind: 'custom', custom: 'wave', uniforms: { uAmp: p.amplitude ?? 8, uWaveLen: p.wavelength ?? 18, uSpeed: 0, uTime: timeSec, uIntensity: I, uTexW: frame.w, uTexH: frame.h, uMode: 0 }, source: src('geq waviness') }]
      }
      if (effectId === 'vhs-tracking') {
        const out: PixiPlan[] = [{
          kind: 'custom', custom: 'wave',
          uniforms: { uAmp: p.amount ?? 10, uWaveLen: p.band ?? 18, uSpeed: p.speed ?? 7, uTime: timeSec, uIntensity: I, uTexW: frame.w, uTexH: frame.h, uMode: 1 },
          source: src('geq vhs-tracking'),
        }]
        const noise = p.noise ?? 6
        if (noise > 0) out.push(noisePlan(noise, 41))
        return out
      }
      if (effectId === 'vhs-head-noise') {
        const out: PixiPlan[] = [{
          kind: 'custom', custom: 'wave',
          uniforms: { uAmp: p.amount ?? 14, uWaveLen: 2, uSpeed: 25, uTime: timeSec, uIntensity: I, uTexW: frame.w, uTexH: frame.h, uMode: 2, uStart: p.start ?? 0.82 },
          source: src('geq head-noise'),
        }]
        if (p.noise > 0) out.push(noisePlan(p.noise, 53, { gaussian: true }))
        return out
      }
      const out: PixiPlan[] = [{
        kind: 'custom', custom: 'wave',
        uniforms: { uAmp: p.amount ?? 18, uWaveLen: p.spacing ?? 72, uSpeed: p.speed ?? 90, uTime: timeSec, uIntensity: I, uTexW: frame.w, uTexH: frame.h, uMode: 3, uBandW: p.width ?? 10 },
        source: src('geq glitch-bands'),
      }]
      out.push({ kind: 'custom', custom: 'rgbshift', uniforms: { uShiftX: 2, uShiftY: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('rgbashift') })
      return out
    }
    case 'camera-shake': {
      const amount = p.amount ?? 8
      const speed = p.speed ?? 1
      return [geometryPlan(4, I, frame, { uMargin: Math.ceil(amount) + 2, uX: amount * Math.sin(13 * speed * timeSec), uY: amount * Math.sin(17 * speed * timeSec) }, src('crop+sin,scale'))]
    }

    case 'glow-bloom': {
      // FFmpeg splits, blurs+grades the copy, screen-blends with opacity.
      // Full layer params + the single glow-shader mix (which ends in
      // mix(src, out, uIntensity)): lerping them first would fade twice.
      return [{ kind: 'custom', custom: 'glow', uniforms: { uRadius: p.radius ?? 8, uOpacity: p.opacity ?? 0.35, uBrightness: p.brightness ?? 0.08, uSaturation: p.saturation ?? 1.15, uRed: 0, uIntensity: I }, source: src('gblur glow layer,screen blend') }]
    }
    case 'halation': {
      // FFmpeg colorbalance rs=red:gs=-red*0.25:bs=-red*0.55 on the blur copy.
      return [{ kind: 'custom', custom: 'glow', uniforms: { uRadius: p.radius ?? 5, uOpacity: p.opacity ?? 0.24, uBrightness: 0, uSaturation: 1, uRed: p.red ?? 0.18, uHalation: 1, uIntensity: I }, source: src('gblur halation,screen blend') }]
    }
    case 'lens-flare':
      return [{ kind: 'custom', custom: 'flare', uniforms: { uIntensity: I, uCx: 0.72, uCy: 0.28, uTexW: frame.w, uTexH: frame.h }, source: src('geq lens-flare') }]
    case 'light-rays': {
      const out: PixiPlan[] = [{
        kind: 'custom', custom: 'edge',
        uniforms: { uLow: p.threshold ?? 0.08, uHigh: Math.min(1, (p.threshold ?? 0.08) * 3), uMode: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h },
        source: src('edgedetect rays'),
      }]
      const length = p.length ?? 14
      if (length >= 0.5) {
        const degrees = p.angle ?? 45
        const angle = (degrees * Math.PI) / 180
        out.push({
          kind: 'custom', custom: 'dirblur',
          uniforms: { uRadius: length, uAngle: degrees, uDirX: Math.cos(angle), uDirY: Math.sin(angle), uIntensity: I },
          source: src('dblur rays'),
        })
      }
      // FFmpeg appends eq=brightness:contrast=1.08 after dblur.
      out.push(eqPlan(1.08, p.brightness ?? 0.04, 1, 1, I, src('eq rays lift')))
      return out
    }
    case 'radial-aberration': {
      const shift = p.shift ?? 5
      const vertical = p.vertical ?? 2
      const out: PixiPlan[] = []
      if (Math.abs(shift) >= 0.5 || Math.abs(vertical) >= 0.5) {
        // FFmpeg is a uniform rgbashift (rh/bh, rv/bv) followed by a
        // vignette=angle=PI/5 edge weight — not a radius-scaled shift.
        out.push({ kind: 'custom', custom: 'rgbshift', uniforms: { uShiftX: shift, uShiftY: vertical, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('rgbashift') })
      }
      out.push(vignettePlan(Math.PI / (p.vignette ?? 5), I, frame, src('vignette edge weight')))
      return out
    }
    case 'tilt-shift': {
      return [{ kind: 'custom', custom: 'tiltshift', uniforms: { uBlur: p.blur ?? 9, uFocus: p.focus ?? 0.24, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('gblur+blend focus band') }]
    }

    case 'bad-tv': {
      return [
        eqPlan(1.16, -0.025, 0.68, 1, I, src('eq')),
        noisePlan(13, 67),
        { kind: 'custom', custom: 'chromashift', uniforms: { uBlueX: 4, uBlueY: 1, uRedX: -4, uRedY: -1, uIntensity: I }, source: src('chromashift') },
        { kind: 'custom', custom: 'scanlines', uniforms: { uSpacing: 5, uThickness: 1, uOpacity: 0.22, uIntensity: I, uYuv: 0 }, source: src('drawgrid') },
        geometryPlan(4, I, frame, { uMargin: 4, uX: 3 * Math.sin(19 * timeSec), uY: 2 * Math.sin(23 * timeSec) }, src('crop wobble')),
      ]
    }
    case 'crt-phosphor': {
      return [
        { kind: 'custom', custom: 'rgbshift', uniforms: { uShiftX: 1, uShiftY: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('rgbashift') },
        { kind: 'custom', custom: 'phosphor-v', uniforms: { uPitch: p.pitch ?? 3, uThickness: p.thickness ?? 1, uOpacity: p.opacity ?? 0.3, uYuv: 0, uIntensity: I }, source: src('drawgrid vertical') },
        { kind: 'custom', custom: 'phosphor-h', uniforms: { uScanline: p.scanline ?? 4, uOpacity: p.opacity ?? 0.3, uYuv: 0, uIntensity: I }, source: src('drawgrid horizontal') },
      ]
    }

    case 'color-isolation': {
      return [{ kind: 'custom', custom: 'isolation', uniforms: { uR: p.red ?? 220, uG: p.green ?? 45, uB: p.blue ?? 40, uSimilarity: p.similarity ?? 0.18, uBlend: p.blend ?? 0.08, uIntensity: I }, source: src('colorhold') }]
    }
    case 'duotone':
      return [{ kind: 'custom', custom: 'duotone', uniforms: { uIntensity: I }, source: src('lutrgb duotone navy->amber') }]
    case 'tritone':
      return [{ kind: 'custom', custom: 'tritone', uniforms: { uIntensity: I }, source: src('lutrgb tritone') }]
    case 'false-color':
      return [{ kind: 'custom', custom: 'turbo', uniforms: { uIntensity: I }, source: src('pseudocolor=turbo,index=0 on GBRP') }]
    case 'solarize': {
      const threshold = (p.threshold ?? 128) / 255
      return [{ kind: 'custom', custom: 'solarize', uniforms: { uThreshold: threshold, uIntensity: I }, source: src('lutrgb solarize') }]
    }
    case 'infrared': {
      // FFmpeg: colorchannelmixer, curves=all=0/0 0.35/0.2 0.72/0.88 1/1
      // (smooth S-curve), eq=contrast=1.12:saturation=0.9. The S-curve is a
      // per-channel LUT stage like the chain (not folded into one matrix).
      return [
        cmPlan(channelMixerMatrix(0.1, 0.9, 0.2, 0.45, 0.2, 0.1, 0.1, 0.25, 0.85), I, src('colorchannelmixer'), true),
        { kind: 'custom', custom: 'infrared-curve', uniforms: { uIntensity: I }, source: src('curves=all=0/0 0.35/0.2 0.72/0.88 1/1') },
        eqPlan(1.12, 0, 0.9, 1, I, src('eq')),
      ]
    }
    case 'thermal':
      return [{ kind: 'custom', custom: 'inferno', uniforms: { uIntensity: I }, source: src('format=gray,pseudocolor=inferno') }]
    case 'cross-process': {
      return [
        { kind: 'custom', custom: 'cross-process-curve', uniforms: { uIntensity: I }, source: src('curves=cross-process') },
        eqPlan(1.08, 0, 1.18, 1, I, src('eq')),
      ]
    }

    case 'comic-book': {
      return [{ kind: 'custom', custom: 'edge', uniforms: { uLow: p.edgeLow ?? 0.06, uHigh: p.edgeHigh ?? 0.22, uMode: 2, uIntensity: I, uLevels: p.levels ?? 7, uInk: p.edgeOpacity ?? 0.82 }, source: src('Canny on original, multiply over posterize') }]
    }
    case 'oil-painting': {
      return [
        { kind: 'custom', custom: 'bilateral', uniforms: { uSpatial: p.spatial ?? 7, uRange: p.range ?? .16, uIntensity: I }, source: src('bilateral') },
        { kind: 'custom', custom: 'median', uniforms: { uRadius: p.median ?? 1, uIntensity: I }, source: src('median') },
        { kind: 'custom', custom: 'posterize', uniforms: { uLevels: p.levels ?? 12, uIntensity: I }, source: src('lutrgb quantize') },
      ]
    }
    case 'neon-edges': {
      return [
        { kind: 'custom', custom: 'edge', uniforms: { uLow: p.low ?? 0.04, uHigh: p.high ?? 0.18, uMode: 0, uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('edgedetect') },
        eqPlan(p.contrast ?? 1.7, p.brightness ?? -0.08, p.saturation ?? 2, 1, I, src('eq neon boost')),
        { kind: 'custom', custom: 'gblur-2d', uniforms: { uSigma: p.glow ?? 0.7, uIntensity: I }, source: src('gblur neon glow') },
      ]
    }
    case 'kaleidoscope':
      return [{ kind: 'custom', custom: 'kaleidoscope', uniforms: { uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('geq kaleidoscope') }]
    case 'tiny-planet':
      return [{ kind: 'custom', custom: 'tinyplanet', uniforms: { uIntensity: I, uTexW: frame.w, uTexH: frame.h }, source: src('geq tiny-planet') }]

    default: {
      return [{ kind: 'skip', reason: `no pixi mapping for ${effectId}`, source: 'none' }]
    }
  }
}

export function planPixiEffectStack(
  effects: readonly ActivePixiEffect[],
  timeSec: number,
  frame: PixiFrameSize,
): PixiPlan[] {
  const out: PixiPlan[] = []
  for (const effect of effects) {
    out.push(...planPixiEffect(effect.effectId, effect.params, effect.intensity, effect.timeSec ?? timeSec, frame, !!effect.ramp).map((plan, index) => ({ ...plan, key: `${effect.blockId}/${index}` })))
  }
  return out
}

export type PixiTransitionFamily =
  | 'dissolve'
  | 'wipe'
  | 'iris'
  | 'blinds'
  | 'motion'
  | 'custom'
  | 'matte'
  | 'panels'

export interface PixiTransitionPlan {
  id: string
  family: PixiTransitionFamily
  progress: number
  alphaA: number
  alphaB: number
  reveal: { custom: string; uniforms: Record<string, number>; source: string } | null
  revealA?: { custom: string; uniforms: Record<string, number>; source: string } | null
  moveA: { x: number; y: number; scale: number } | null
  moveB: { x: number; y: number; scale: number } | null
  glow: number
  source: string
}

function revealPlan(custom: string, uniforms: Record<string, number>, source: string): PixiTransitionPlan['reveal'] {
  return { custom, uniforms, source }
}

// Numeric values mirror enum XFadeTransitions in FFmpeg 5.1.4 vf_xfade.c.
// Custom transitions follow immediately and are evaluated by the same shader.
export const PIXI_FFMPEG_TRANSITION_MODES: Readonly<Record<string, number>> = {
  'cross-dissolve': 0,
  'wipe-left': 1,
  'wipe-right': 2,
  'wipe-up': 3,
  'wipe-down': 4,
  'slide-left': 5,
  'slide-right': 6,
  'slide-up': 7,
  'slide-down': 8,
  'circle-crop': 9,
  'rectangle-crop': 10,
  'difference-dissolve': 11,
  'fade-black': 12,
  'fade-white': 13,
  'clock-wipe': 14,
  'smooth-left': 15,
  'smooth-right': 16,
  'smooth-up': 17,
  'smooth-down': 18,
  circle: 19,
  'circle-close': 20,
  'barn-vertical-open': 21,
  'barn-vertical-close': 22,
  'barn-horizontal-open': 23,
  'barn-horizontal-close': 24,
  'noise-dissolve': 25,
  'mosaic-dissolve': 26,
  'diagonal-tl': 27,
  'diagonal-tr': 28,
  'diagonal-bl': 29,
  'diagonal-br': 30,
  'blinds-left': 31,
  'blinds-right': 32,
  'blinds-up': 33,
  'blinds-down': 34,
  'blur-dissolve': 35,
  'fade-grayscale': 36,
  'corner-tl': 37,
  'corner-tr': 38,
  'corner-bl': 39,
  'corner-br': 40,
  'squeeze-horizontal': 41,
  'squeeze-vertical': 42,
  'zoom-in': 43,
  'film-dissolve-fast': 44,
  'film-dissolve-slow': 45,
  'whip-pan-left': 46,
  'whip-pan-right': 47,
  'whip-pan-up': 48,
  'whip-pan-down': 49,
  'zoom-blur-in': 50,
  'zoom-blur-out': 51,
  'spin-zoom': 52,
  'camera-roll': 53,
  'lens-warp': 54,
  'stretch-horizontal': 55,
  'stretch-vertical': 56,
  'ripple-warp': 57,
  'liquid-wave': 58,
  'kaleidoscope-reveal': 59,
  'rgb-split-transition': 60,
  'digital-glitch-transition': 61,
  'vhs-tracking-transition': 62,
  'datamosh-transition': 63,
  'tv-static-transition': 64,
  'scanline-reveal': 65,
  'pixel-sort-reveal': 66,
  'light-leak-transition': 67,
  'film-burn-transition': 68,
  'flash-bulb-transition': 69,
  'luma-fade': 70,
  'chroma-fade': 71,
  'ink-bleed-reveal': 72,
  'page-turn-2d': 73,
  'split-panels': 74,
  'shutter-snap': 75,
}

function transitionFamily(mode: number): PixiTransitionFamily {
  if ([9, 10, 19, 20, 21, 22, 23, 24].includes(mode)) return 'iris'
  if ([5, 6, 7, 8, 41, 42, 43].includes(mode)) return 'motion'
  if ([31, 32, 33, 34].includes(mode)) return 'blinds'
  if ([1, 2, 3, 4, 14, 15, 16, 17, 18, 27, 28, 29, 30, 37, 38, 39, 40].includes(mode)) return 'wipe'
  if ([70, 71, 72].includes(mode)) return 'matte'
  if ([73, 74, 75].includes(mode)) return 'panels'
  return mode >= 46 ? 'custom' : 'dissolve'
}

export function planPixiTransition(transitionId: string, progress: number): PixiTransitionPlan {
  const timelineProgress = Math.max(0, Math.min(1, progress))
  const mode = PIXI_FFMPEG_TRANSITION_MODES[transitionId] ?? 0
  const source = `xfade:${getEffect(transitionId)?.xfade ?? 'fade'} (FFmpeg 5.1.4)`
  return {
    id: transitionId,
    family: transitionFamily(mode),
    progress: timelineProgress,
    alphaA: 1,
    alphaB: 1,
    reveal: revealPlan('transition-ffmpeg', { uProgress: timelineProgress, uMode: mode }, source),
    moveA: null,
    moveB: null,
    glow: 0,
    source,
  }
}

function geometryPlan(mode: number, intensity: number, frame: PixiFrameSize, uniforms: Record<string, number>, source: string): PixiPlan {
  return { kind: 'custom', custom: 'geometry', uniforms: { uMode: mode, uIntensity: intensity, uTexW: frame.w, uTexH: frame.h, ...uniforms }, source }
}

function uniformGroup(uniforms: Record<string, number>): UniformGroup {
  const entries: Record<string, { value: number; type: 'f32' }> = {}
  for (const [key, value] of Object.entries(uniforms)) {
    entries[key] = { value, type: 'f32' as const }
  }
  return new UniformGroup(entries)
}

function makeCustomFilter(name: string, fragment: string, uniforms: Record<string, number>): Filter {
  const glProgram = GlProgram.from({ vertex: EFFECT_VERT, fragment, name })
  return new Filter({
    glProgram,
    resources: { customUniforms: uniformGroup(uniforms) },
  })
}

function makeTransitionFilter(name: string, uniforms: Record<string, number>): Filter {
  const glProgram = GlProgram.from({ vertex: EFFECT_VERT, fragment: TRANSITION_FRAG, name })
  const random = uniforms.uTMode === 25 ? transitionRandom(uniforms.uTexW ?? 1920, uniforms.uTexH ?? 1080) : null
  const filter = new Filter({
    glProgram,
    blendRequired: true,
    resources: {
      customUniforms: uniformGroup(uniforms),
      uBackTexture: Texture.EMPTY,
      uNativeRandom: random?.texture.source ?? Texture.WHITE.source,
    },
  })
  if (random) {
    const destroy = filter.destroy.bind(filter)
    filter.destroy = () => { random.release(); destroy() }
  }
  return filter
}

export interface PixiBuiltFilters {
  filters: Filter[]
  transform: {
    dx: number
    dy: number
    rotation: number
    shearX: number
    shearY: number
    scaleX: number
    scaleY: number
    mirrorH: boolean
    mirrorV: boolean
  } | null
}

function emptyTransform(): NonNullable<PixiBuiltFilters['transform']> {
  return { dx: 0, dy: 0, rotation: 0, shearX: 0, shearY: 0, scaleX: 1, scaleY: 1, mirrorH: false, mirrorV: false }
}

function mergeTransform(
  base: PixiBuiltFilters['transform'],
  plan: Extract<PixiPlan, { kind: 'transform' }>,
): PixiBuiltFilters['transform'] {
  const out: NonNullable<PixiBuiltFilters['transform']> = base ?? emptyTransform()
  out.dx += plan.dx
  out.dy += plan.dy
  out.rotation += plan.rotation
  out.shearX += plan.shearX
  out.shearY += plan.shearY
  out.scaleX *= plan.scaleX
  out.scaleY *= plan.scaleY
  if (plan.mirrorH) out.mirrorH = !out.mirrorH
  if (plan.mirrorV) out.mirrorV = !out.mirrorV
  return out
}

export function createPixiFilters(
  plans: readonly PixiPlan[],
  frame: PixiFrameSize = { w: 1920, h: 1080 },
  pixelScale = { x: 1, y: 1 },
  history?: PixiHistory,
): PixiBuiltFilters {
  const filters: Filter[] = []
  let transform: PixiBuiltFilters['transform'] = null

  for (const plan of plans) {
    switch (plan.kind) {
      case 'colormatrix': {
        // Fused matrix + truncation in one shader (see colormatrix.frag.glsl):
        // chaining Pixi's ColorMatrixFilter with a truncate pass would round
        // at an intermediate byte buffer, while the native blend quantizes
        // once. uTrunc is set only for partial ramps (see cmPlan).
        const uniforms: Record<string, number> = { uTrunc: plan.trunc ? 1 : 0, uLut: plan.lut ? 1 : 0, uIntensity: plan.intensity ?? 1 }
        plan.matrix.forEach((value, index) => { uniforms[`uM${index}`] = value })
        if (plan.alpha !== 1) uniforms.uM18 = plan.alpha
        filters.push(makeCustomFilter('pixi-colormatrix', COLORMATRIX_FRAG, uniforms))
        break
      }
      case 'blur': {
        filters.push(...gaussianPasses(plan.strength, plan.quality, pixelScale))
        break
      }
      case 'blur-dir': {
        if (plan.strengthX > 0.02 || plan.strengthY > 0.02) {
          const filter = new BlurFilter({
            strengthX: plan.strengthX * Math.abs(pixelScale.x),
            strengthY: plan.strengthY * Math.abs(pixelScale.y),
            quality: plan.quality,
          })
          filter.repeatEdgePixels = true
          filters.push(filter)
        }
        break
      }
      case 'noise': {
        if (plan.noise > 0) {
          filters.push(createNativeNoiseFilter(plan.options ?? { strength: Math.round(plan.noise * 255), seed: plan.seed, intensity: 1, temporal: false, gaussian: false, yuv: false, frameIndex: 0 }, frame))
        }
        break
      }
      case 'custom': {
        let uniforms = plan.uniforms
        if (plan.custom === 'boxblur-h' || plan.custom === 'boxblur-v') {
          uniforms = { ...uniforms, uPixelScale: plan.custom === 'boxblur-h' ? pixelScale.x : pixelScale.y }
        } else if (plan.custom === 'boxblur-2d') {
          uniforms = { ...uniforms, uPixelScale: pixelScale.x, uPixelScaleY: pixelScale.y }
        } else if (['gblur-2d', 'median', 'emboss', 'edge', 'sharpen', 'unsharp', 'rgbshift', 'chromashift', 'glow', 'tiltshift', 'bilateral', 'dirblur'].includes(plan.custom)) {
          uniforms = { ...uniforms, uScaleX: Math.abs(pixelScale.x), uScaleY: Math.abs(pixelScale.y) }
        }
        const custom = buildCustomFilter(plan.custom, uniforms, frame, history, plan.key ?? `${plan.custom}/${plans.indexOf(plan)}`)
        if (custom) filters.push(custom)
        break
      }
      case 'transform': {
        transform = mergeTransform(transform, plan)
        break
      }
      case 'skip':
        break
    }
  }
  return { filters, transform }
}

function buildCustomFilter(custom: string, uniforms: Record<string, number>, frame: PixiFrameSize, history?: PixiHistory, key = custom): Filter | null {
  const W = frame.w
  const H = frame.h
  switch (custom) {
    case 'boxblur-native':
      return boxBlurFilter(uniforms, frame)
    case 'hqdn3d':
      return new Hqdn3dFilter(uniforms, history?.frame(key))
    case 'tmix':
      return new TmixFilter(uniforms, history?.ring(key, Math.max(1, Math.round(uniforms.uFrames ?? 2))))
    case 'stopmotion':
      return new StopMotionFilter(uniforms, history?.hold(key))
    case 'deband':
      return createDebandFilter(uniforms, frame)
    case 'bilateral':
      return new BilateralFilter(uniforms.uSpatial ?? 5, uniforms.uRange ?? .12, uniforms.uIntensity ?? 1, uniforms.uScaleX ?? 1)
    case 'unsharp':
      return makeCustomFilter('pixi-unsharp', UNSHARP_FRAG, {
        uLumaQ: Math.trunc(Math.fround(uniforms.uLuma ?? 0.8) * 65536),
        uChromaQ: Math.trunc(Math.fround(uniforms.uChroma ?? 0) * 65536),
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
        uIntensity: uniforms.uIntensity ?? 1,
      })
    case 'chromashift':
      return makeCustomFilter('pixi-chromashift', CHROMASHIFT_FRAG, {
        uBlueX: uniforms.uBlueX ?? 0, uBlueY: uniforms.uBlueY ?? 0,
        uRedX: uniforms.uRedX ?? 0, uRedY: uniforms.uRedY ?? 0,
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
        uIntensity: uniforms.uIntensity ?? 1,
      })
    case 'geometry':
      return makeCustomFilter('pixi-geometry', GEOMETRY_FRAG, {
        uMode: uniforms.uMode ?? 0, uIntensity: uniforms.uIntensity ?? 1,
        uX: uniforms.uX ?? 0, uY: uniforms.uY ?? 0, uAngle: uniforms.uAngle ?? 0,
        uMargin: uniforms.uMargin ?? 0, uTexW: W, uTexH: H,
      })
    case 'vignette':
      return makeCustomFilter('pixi-vignette', ADJUST_FRAG, { uMode: 0, uIntensity: uniforms.uIntensity ?? 0.5, uP0: uniforms.uAngle ?? 0.7853982, uP1: uniforms.uYuv ?? 0, uP2: 0, uP3: uniforms.uTexW ?? W, uP4: uniforms.uTexH ?? H })
    case 'scanlines':
      return makeCustomFilter('pixi-scanlines', DRAWGRID_FRAG, { uTexW: W, uTexH: H, uCellW: W, uCellH: uniforms.uSpacing ?? 4, uThickness: uniforms.uThickness ?? 1, uWhite: 0, uYuv: uniforms.uYuv ?? 0, uOpacity: uniforms.uOpacity ?? 0.3, uIntensity: uniforms.uIntensity ?? 1 })
    case 'scanlines-v':
      return makeCustomFilter('pixi-scratches', DRAWGRID_FRAG, { uTexW: W, uTexH: H, uCellW: uniforms.uSpacing ?? 173, uCellH: H, uThickness: uniforms.uThickness ?? 1, uWhite: uniforms.uWhite ?? 0, uYuv: uniforms.uYuv ?? 0, uOpacity: uniforms.uOpacity ?? 0.12, uIntensity: uniforms.uIntensity ?? 1 })
    case 'phosphor-v':
      return makeCustomFilter('pixi-phosphor-v', DRAWGRID_FRAG, { uTexW: W, uTexH: H, uCellW: uniforms.uPitch ?? 3, uCellH: H, uThickness: uniforms.uThickness ?? 1, uWhite: 0, uYuv: uniforms.uYuv ?? 0, uOpacity: uniforms.uOpacity ?? 0.3, uIntensity: uniforms.uIntensity ?? 1 })
    case 'phosphor-h':
      return makeCustomFilter('pixi-phosphor-h', DRAWGRID_FRAG, { uTexW: W, uTexH: H, uCellW: W, uCellH: uniforms.uScanline ?? 4, uThickness: 1, uWhite: 0, uYuv: uniforms.uYuv ?? 0, uOpacity: (uniforms.uOpacity ?? 0.3) * 0.8, uIntensity: uniforms.uIntensity ?? 1 })
    case 'posterize':
      return makeCustomFilter('pixi-posterize', ADJUST_FRAG, { uMode: 3, uIntensity: uniforms.uIntensity ?? 1, uP0: uniforms.uLevels ?? 6, uP1: 0, uP2: 0, uP3: 0, uP4: 0 })
    case 'solarize':
      return makeCustomFilter('pixi-solarize', ADJUST_FRAG, { uMode: 4, uIntensity: uniforms.uIntensity ?? 1, uP0: uniforms.uThreshold ?? 0.5, uP1: 0, uP2: 0, uP3: 0, uP4: 0 })
    case 'duotone':
      return makeCustomFilter('pixi-duotone', ADJUST_FRAG, { uMode: 5, uIntensity: uniforms.uIntensity ?? 1, uP0: 0, uP1: 0, uP2: 0, uP3: 0, uP4: 0 })
    case 'tritone':
      return makeCustomFilter('pixi-tritone', ADJUST_FRAG, { uMode: 6, uIntensity: uniforms.uIntensity ?? 1, uP0: 0, uP1: 0, uP2: 0, uP3: 0, uP4: 0 })
    case 'turbo':
      return makeCustomFilter('pixi-turbo', ADJUST_FRAG, { uMode: 7, uIntensity: uniforms.uIntensity ?? 1, uP0: 0, uP1: 0, uP2: 0, uP3: 0, uP4: 0 })
    case 'inferno':
      return makeCustomFilter('pixi-inferno', ADJUST_FRAG, { uMode: 8, uIntensity: uniforms.uIntensity ?? 1, uP0: 0, uP1: 0, uP2: 0, uP3: 0, uP4: 0 })
    case 'isolation':
      return makeCustomFilter('pixi-isolation', ADJUST_FRAG, {
        uMode: 9, uIntensity: uniforms.uIntensity ?? 1,
        uP0: uniforms.uR ?? 220, uP1: uniforms.uG ?? 45, uP2: uniforms.uB ?? 40, uP3: uniforms.uSimilarity ?? 0.18,
        uP4: uniforms.uBlend ?? 0.08,
      })
    case 'flare':
      return makeCustomFilter('pixi-flare', ADJUST_FRAG, { uMode: 10, uIntensity: uniforms.uIntensity ?? 1, uP0: uniforms.uTexW ?? W, uP1: uniforms.uTexH ?? H, uP2: 0, uP3: 0, uP4: 0 })
    case 'eq':
      return makeCustomFilter('pixi-eq', EQ_FRAG, eqUniforms(uniforms))
    case 'infrared-curve':
      return makeCustomFilter('pixi-infrared-curve', INFRARED_CURVE, { uIntensity: uniforms.uIntensity ?? 1 })
    case 'cross-process-curve':
      return makeCustomFilter('pixi-cross-process-curve', CROSS_PROCESS_CURVE, { uIntensity: uniforms.uIntensity ?? 1 })
    case 'boxblur-h':
      return makeCustomFilter('pixi-boxblur-h', BOXBLUR_FRAG, { uRadius: uniforms.uRadius ?? 8, uAxis: 0, uPixelScale: uniforms.uPixelScale ?? 1, uIntensity: uniforms.uIntensity ?? 1 })
    case 'boxblur-v':
      return makeCustomFilter('pixi-boxblur-v', BOXBLUR_FRAG, { uRadius: uniforms.uRadius ?? 8, uAxis: 1, uPixelScale: uniforms.uPixelScale ?? 1, uPixelScaleY: uniforms.uPixelScaleY ?? 1, uIntensity: uniforms.uIntensity ?? 1 })
    case 'boxblur-2d':
      return makeCustomFilter('pixi-boxblur-2d', BOXBLUR_FRAG, { uRadius: uniforms.uRadius ?? 8, uAxis: 2, uPixelScale: uniforms.uPixelScale ?? 1, uPixelScaleY: uniforms.uPixelScaleY ?? 1, uIntensity: uniforms.uIntensity ?? 1 })
    case 'gblur-2d':
      return gaussianFilter(uniforms)
    case 'dirblur': {
      const dirX = uniforms.uDirX ?? 1
      const dirY = uniforms.uDirY ?? 0
      const degrees = uniforms.uAngle ?? Math.atan2(dirY, dirX) * 180 / Math.PI
      const length = Math.hypot(dirX, dirY) || 1
      return new DblurFilter(degrees, uniforms.uRadius ?? 8, dirX / length, dirY / length, uniforms.uScaleX ?? 1, uniforms.uScaleY ?? 1, uniforms.uIntensity ?? 1)
    }
    case 'median':
      return makeCustomFilter('pixi-median', MEDIAN_FRAG, {
        uIntensity: uniforms.uIntensity ?? 1, uRadius: uniforms.uRadius ?? 1,
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
      })
    case 'colorbalance':
      return makeCustomFilter('pixi-colorbalance', CB_FRAG, {
        uIntensity: uniforms.uIntensity ?? 1,
        uRS: uniforms.uRS ?? 0, uGS: uniforms.uGS ?? 0, uBS: uniforms.uBS ?? 0,
        uRM: uniforms.uRM ?? 0, uGM: uniforms.uGM ?? 0, uBM: uniforms.uBM ?? 0,
        uRH: uniforms.uRH ?? 0, uGH: uniforms.uGH ?? 0, uBH: uniforms.uBH ?? 0,
      })
    case 'hue-rotate':
      return makeCustomFilter('pixi-hue', HUE_FRAG, { uAngle: uniforms.uAngle ?? 0, uIntensity: uniforms.uIntensity ?? 1 })
    case 'vintage-curve':
      return makeCustomFilter('pixi-vintage', VINTAGE_CURVE, { uIntensity: uniforms.uIntensity ?? 1 })
    case 'glow':
      return glowFilter(uniforms)
    case 'phosphor':
      return makeCustomFilter('pixi-phosphor', ADJUST_FRAG, {
        uMode: 11, uIntensity: uniforms.uOpacity ?? 0.3,
        uP0: uniforms.uPitch ?? 3, uP1: uniforms.uThickness ?? 1, uP2: 1, uP3: uniforms.uScanline ?? 4, uP4: 0,
      })
    case 'phosphor-legacy':
      return makeCustomFilter('pixi-phosphor-legacy', ADJUST_FRAG, {
        uMode: 11, uIntensity: uniforms.uOpacity ?? 0.3,
        uP0: uniforms.uPitch ?? 3, uP1: uniforms.uThickness ?? 1, uP2: 1, uP3: uniforms.uScanline ?? 4, uP4: 0,
      })
    case 'lens':
      return makeCustomFilter('pixi-lens', WARP_FRAG, {
        uMode: 0, uIntensity: uniforms.uIntensity ?? 1,
        uK1: uniforms.uK1 ?? 0, uK2: uniforms.uK2 ?? 0,
        uCx: uniforms.uCx ?? 0.5, uCy: uniforms.uCy ?? 0.5,
        uAmp: 0, uWaveLen: 1, uSpeed: 0, uTime: 0, uTexW: W, uTexH: H,
      })
    case 'wave':
      return makeCustomFilter('pixi-wave-yuv', WAVE_YUV_FRAG, {
        uMode: uniforms.uMode ?? 0,
        uIntensity: uniforms.uIntensity ?? 1,
        uBandW: uniforms.uBandW ?? 10, uStart: uniforms.uStart ?? 0.82,
        uAmp: uniforms.uAmp ?? 8, uWaveLen: uniforms.uWaveLen ?? 18,
        uSpeed: uniforms.uSpeed ?? 0, uTime: uniforms.uTime ?? 0,
        uTexW: W, uTexH: H,
      })
    case 'kaleidoscope':
      return makeCustomFilter('pixi-kaleido', WARP_FRAG, {
        uMode: 5, uIntensity: uniforms.uIntensity ?? 1,
        uK1: 0, uK2: 0, uCx: 0.5, uCy: 0.5, uAmp: 0, uWaveLen: 1, uSpeed: 0, uTime: 0, uTexW: W, uTexH: H,
      })
    case 'tinyplanet':
      return makeCustomFilter('pixi-tinyplanet', WARP_FRAG, {
        uMode: 6, uIntensity: uniforms.uIntensity ?? 1,
        uK1: 0, uK2: 0, uCx: 0.5, uCy: 0.5, uAmp: 0, uWaveLen: 1, uSpeed: 0, uTime: 0, uTexW: W, uTexH: H,
      })
    case 'edge':
      return createCannyFilter(uniforms, frame)
    case 'emboss':
      return makeCustomFilter('pixi-emboss', CONV_FRAG, {
        uMode: 2, uIntensity: uniforms.uIntensity ?? 1, uP0: 0, uP1: 0, uTexW: W, uTexH: H,
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
      })
    case 'sharpen':
      return makeCustomFilter('pixi-cas', CAS_FRAG, {
        uIntensity: uniforms.uIntensity ?? 1, uStrength: uniforms.uAmount ?? 0.5,
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
      })
    case 'rgbshift':
      return makeCustomFilter('pixi-rgbshift', RGBSHIFT_FRAG, {
        uShiftX: uniforms.uShiftX ?? 0, uShiftY: uniforms.uShiftY ?? 0,
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
        uIntensity: uniforms.uIntensity ?? 1, uTexW: uniforms.uTexW ?? W, uTexH: uniforms.uTexH ?? H, uRadial: 0,
      })
    case 'rgbshift-radial':
      return makeCustomFilter('pixi-radial', RGBSHIFT_FRAG, {
        uShiftX: uniforms.uShift ?? 5, uShiftY: uniforms.uVertical ?? 2,
        uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
        uIntensity: uniforms.uIntensity ?? 1, uTexW: uniforms.uTexW ?? W, uTexH: uniforms.uTexH ?? H, uRadial: 1,
      })
    case 'pixelate':
      return pixelAverageFilter(uniforms, frame)
    case 'tiltshift':
      return tiltShiftFilter(uniforms, H)
    default:
      return null
  }
}

export function createPixiTransitionFilter(
  reveal: PixiTransitionPlan['reveal'],
  frame: PixiFrameSize = { w: 1920, h: 1080 },
): Filter | null {
  if (!reveal) return null
  const { custom, uniforms } = reveal
  return custom === 'transition-ffmpeg'
    ? makeTransitionFilter('pixi-xfade-5.1.4', {
      uTMode: uniforms.uMode ?? 0,
      uProgress: uniforms.uProgress ?? 0,
      uTexW: frame.w, uTexH: frame.h,
    })
    : null
}

export const PIXI_FILTER_BUDGET = 4
export const PIXI_LOW_FPS_THRESHOLD = 30
export const PIXI_CRITICAL_FPS_THRESHOLD = 20

export function applyPixiPerfBudget(plans: readonly PixiPlan[], fps: number): PixiPlan[] {
  // Preview must stay WYSIWYG with the ffmpeg/ffmpeg-wasm render: dropping
  // grain or detail filters at low FPS would make the preview diverge from
  // the export (e.g. film-grain vanishing while scrubbing). Keep every plan
  // regardless of measured FPS; smoothness is handled by resolution, not by
  // silently removing effects.
  void fps
  return [...plans]
}

export function countExpensivePixiFilters(plans: readonly PixiPlan[]): number {
  return plans.filter((plan) => plan.kind === 'blur' || plan.kind === 'blur-dir' || plan.kind === 'noise' || plan.kind === 'custom').length
}
