import { shaderFilter } from './pixi-filter-pipeline'
import { transitionRandom } from './pixi-transition-random'
import FRAGMENT from './glsl/deband.frag.glsl?raw'

export function createDebandFilter(values: Record<string, number>, frame: { w: number; h: number }) {
  const random = transitionRandom(frame.w, frame.h)
  const filter = shaderFilter('ffmpeg-deband', FRAGMENT, {
    uTexW: frame.w, uTexH: frame.h,
    uRange: values.uRange ?? 16,
    uThreshold: Math.floor(Math.fround(values.uThreshold ?? .02) * 255),
    uIntensity: values.uIntensity ?? 1,
  }, { uNativeRandom: random.texture.source })
  const destroy = filter.destroy.bind(filter)
  filter.destroy = () => { random.release(); destroy() }
  return filter
}
