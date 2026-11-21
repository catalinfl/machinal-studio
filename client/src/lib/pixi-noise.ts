import { NativeRandom } from './native-random'
import { DataTextureCache } from './pixi-data-textures'
import { shaderFilter } from './pixi-filter-pipeline'
import FRAGMENT from './glsl/native-noise.frag.glsl?raw'

const NOISE_SAMPLES = 5120
const ROWS = 4096
const generators = new Map<string, { bytes: Uint8Array; states: NativeRandom[] }>()
const textures = new DataTextureCache(32)

function noiseGenerator(seed: number, strength: number, gaussian: boolean) {
  const key = `${seed}/${strength}/${gaussian}`
  const existing = generators.get(key)
  if (existing) return { ...existing, key }
  const bytes = new Uint8Array(NOISE_SAMPLES * 4)
  const states: NativeRandom[] = []
  for (let plane = 0; plane < 3; plane++) {
    const random = new NativeRandom((seed + plane * 31415) >>> 0)
    for (let index = 0; index < NOISE_SAMPLES; index++) {
      let noise: number
      if (gaussian) {
        let x: number, y: number, squared: number
        do {
          x = 2 * random.next() / 4294967296 - 1
          y = 2 * random.next() / 4294967296 - 1
          squared = x * x + y * y
        } while (squared >= 1 || squared === 0)
        noise = Math.trunc(Math.max(-128, Math.min(127, x * Math.sqrt(-2 * Math.log(squared) / squared) * strength / Math.sqrt(3))))
      } else noise = Math.floor(strength * random.next() / 4294967296) - Math.trunc(strength / 2)
      bytes[index * 4 + plane] = noise + 128
      bytes[index * 4 + 3] = 255
      random.next()
    }
    random.skip(ROWS * 3)
    states.push(random)
  }
  const result = { bytes, states }
  if (generators.size >= 16) generators.delete(generators.keys().next().value!)
  generators.set(key, result)
  return { ...result, key }
}

export interface NativeNoiseOptions {
  strength: number
  seed: number
  intensity: number
  frameIndex: number
  temporal: boolean
  gaussian: boolean
  yuv: boolean
}

export function createNativeNoiseFilter(options: NativeNoiseOptions, frame: { w: number; h: number }) {
  const generator = noiseGenerator(options.seed, options.strength, options.gaussian)
  const table = textures.acquire(`table/${generator.key}`, 1024, 5, () => generator.bytes)
  const frameIndex = options.temporal ? Math.max(0, options.frameIndex) : 0
  const shifts = textures.acquire(`shifts/${generator.key}/${frameIndex}`, 3, ROWS, () => {
    const bytes = new Uint8Array(3 * ROWS * 4)
    for (let plane = 0; plane < 3; plane++) {
      const random = generator.states[plane].clone()
      random.skip(frameIndex * ROWS)
      for (let row = 0; row < ROWS; row++) {
        const shift = random.next() & 1023
        const index = (row * 3 + plane) * 4
        bytes[index] = shift & 255
        bytes[index + 1] = shift >> 8
        bytes[index + 3] = 255
      }
    }
    return bytes
  })
  const filter = shaderFilter('ffmpeg-noise', FRAGMENT, {
    uTexW: frame.w, uTexH: frame.h, uIntensity: options.intensity, uYuv: options.yuv ? 1 : 0,
  }, { uNoiseTable: table.texture.source, uRowShifts: shifts.texture.source })
  const destroy = filter.destroy.bind(filter)
  filter.destroy = () => { table.release(); shifts.release(); destroy() }
  return filter
}
