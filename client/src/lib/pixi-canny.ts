import { FilterPipeline, shaderFilter } from './pixi-filter-pipeline'
import BLUR from './glsl/canny-blur.frag.glsl?raw'
import SUPPRESS from './glsl/canny-suppress.frag.glsl?raw'
import FINISH from './glsl/canny-finish.frag.glsl?raw'

export function createCannyFilter(uniforms: Record<string, number>, frame: { w: number; h: number }): FilterPipeline {
  const values = {
    uTexW: frame.w, uTexH: frame.h,
    uScaleX: uniforms.uScaleX ?? 1, uScaleY: uniforms.uScaleY ?? 1,
    uGray: (uniforms.uMode ?? 0) === 0 ? 0 : 1,
    uLow: uniforms.uLow ?? 0.08, uHigh: uniforms.uHigh ?? 0.25,
    uIntensity: uniforms.uIntensity ?? 1, uMode: uniforms.uMode ?? 0,
    uLevels: uniforms.uLevels ?? 7, uInk: uniforms.uInk ?? 0.82,
  }
  return new FilterPipeline([
    shaderFilter('canny-blur', BLUR, values),
    shaderFilter('canny-suppress', SUPPRESS, values),
    shaderFilter('canny-finish', FINISH, values),
  ])
}
