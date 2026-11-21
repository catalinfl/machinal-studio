import { type Filter } from 'pixi.js'
import { FilterPipeline, shaderFilter } from './pixi-filter-pipeline'
import { eqUniforms } from './pixi-eq'
import GAUSSIAN from './glsl/recursive-blur.frag.glsl?raw'
import COMBINE from './glsl/pipeline-combine.frag.glsl?raw'
import PIXELATE from './glsl/pixel-average.frag.glsl?raw'
import EQ from './glsl/eq.frag.glsl?raw'
import COLOR_BALANCE from './glsl/colorbalance.frag.glsl?raw'
import BOXBLUR from './glsl/boxblur-native.frag.glsl?raw'

export function gaussianPasses(sigma: number, quality: number, scale: { x: number; y: number }): Filter[] {
  if (sigma < 0.02) return []
  const steps = Math.max(1, Math.min(6, Math.round(quality)))
  const lambda = sigma * sigma / (2 * steps)
  const nu = 2 * lambda / (1 + 2 * lambda + Math.sqrt(1 + 4 * lambda))
  const radius = Math.min(256, Math.max(1, Math.ceil(Math.log(0.0001) / Math.log(nu))))
  return [0, 1].flatMap(axis => Array.from({ length: steps }, () => shaderFilter('pixi-recursive-blur', GAUSSIAN, {
    uNu: nu, uRadius: radius, uAxis: axis, uPixelScale: Math.abs(axis === 0 ? scale.x : scale.y),
  })))
}

function combine(values: Record<string, number>): Filter {
  return shaderFilter('pipeline-combine', COMBINE, {
    uMode: 0, uIntensity: 1, uOpacity: 1, uFocus: 0, uYuv: 0, uTexH: 1, ...values,
  })
}

export function gaussianFilter(values: Record<string, number>): FilterPipeline {
  return new FilterPipeline([
    ...gaussianPasses(values.uSigma ?? 1, values.uSteps ?? 1, { x: values.uScaleX ?? 1, y: values.uScaleY ?? 1 }),
    combine({ uIntensity: values.uIntensity ?? 1 }),
  ])
}

export function pixelAverageFilter(values: Record<string, number>, frame: { w: number; h: number }): FilterPipeline {
  const uniforms = { uBlockW: values.uBlockW ?? 16, uBlockH: values.uBlockH ?? 16, uTexW: frame.w, uTexH: frame.h, uIntensity: values.uIntensity ?? 1 }
  return new FilterPipeline([0, 1].map(uAxis => shaderFilter('pixel-average', PIXELATE, { ...uniforms, uAxis })))
}

export function boxBlurFilter(values: Record<string, number>, frame: { w: number; h: number }): FilterPipeline {
  const limit = Math.floor(Math.min(frame.w, frame.h) / 2)
  const uniforms = {
    uTexW: frame.w, uTexH: frame.h,
    uLumaRadius: Math.min(values.uLumaRadius ?? 8, limit), uChromaRadius: Math.min(values.uChromaRadius ?? 4, limit),
    uLumaPower: values.uLumaPower ?? 1, uChromaPower: values.uChromaPower ?? 1,
  }
  const passes = Math.max(uniforms.uLumaPower, uniforms.uChromaPower)
  return new FilterPipeline([
    ...[0, 1].flatMap(uAxis => Array.from({ length: passes }, (_, uPass) => shaderFilter('boxblur-native', BOXBLUR, { ...uniforms, uAxis, uPass }))),
    combine({ uIntensity: values.uIntensity ?? 1 }),
  ])
}

export function glowFilter(values: Record<string, number>): FilterPipeline {
  const halation = (values.uHalation ?? 0) > .5
  const grading = halation
    ? shaderFilter('glow-colorbalance', COLOR_BALANCE, { uIntensity: 1, uRS: values.uRed, uGS: -values.uRed * .25, uBS: -values.uRed * .55, uRM: 0, uGM: 0, uBM: 0, uRH: 0, uGH: 0, uBH: 0 })
    : shaderFilter('glow-eq', EQ, eqUniforms({ uBrightness: values.uBrightness ?? .08, uSaturation: values.uSaturation ?? 1.15, uOutputYuv: 1 }))
  return new FilterPipeline([
    ...gaussianPasses(values.uRadius ?? 8, 1, { x: values.uScaleX ?? 1, y: values.uScaleY ?? 1 }),
    grading,
    combine({ uMode: 1, uYuv: halation ? 0 : 1, uOpacity: values.uOpacity ?? .35, uIntensity: values.uIntensity ?? 1 }),
  ])
}

export function tiltShiftFilter(values: Record<string, number>, height: number): FilterPipeline {
  return new FilterPipeline([
    ...gaussianPasses(values.uBlur ?? 9, 1, { x: values.uScaleX ?? 1, y: values.uScaleY ?? 1 }),
    combine({ uMode: 2, uFocus: values.uFocus ?? .24, uTexH: height, uIntensity: values.uIntensity ?? 1 }),
  ])
}
