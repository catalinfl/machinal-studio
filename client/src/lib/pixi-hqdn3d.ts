import { Filter, RendererType, Texture, type FilterSystem, type RenderSurface, type UniformGroup } from 'pixi.js'
import { DataTextureCache } from './pixi-data-textures'
import { TemporalFrameState, historyTexturePool } from './pixi-history'
import { shaderFilter } from './pixi-filter-pipeline'
import FRAGMENT from './glsl/hqdn3d.frag.glsl?raw'

const coefficients = new DataTextureCache(16)

function roundEven(value: number): number {
  const low = Math.floor(value)
  return value - low === .5 ? low + (low % 2 === 0 ? 0 : 1) : Math.round(value)
}

function coefficientTable(strengths: number[]): Uint8Array {
  const bytes = new Uint8Array(1024 * 32 * 4)
  for (let kind = 0; kind < strengths.length; kind++) {
    const gamma = Math.log(.25) / Math.log(1 - Math.min(strengths[kind], 252) / 255 - .00001)
    for (let index = 0; index < 8192; index++) {
      const value = ((index - 4096) * 32 + 15) / 512
      const similarity = Math.max(0, 1 - Math.abs(value) / 255)
      const coefficient = roundEven(Math.pow(similarity, gamma) * 256 * value) + 32768
      const offset = (index * 4 + kind) * 4
      bytes[offset] = coefficient & 255
      bytes[offset + 1] = coefficient >> 8
      bytes[offset + 3] = 255
    }
  }
  return bytes
}

export class Hqdn3dFilter extends Filter {
  private pass: Filter
  private table: ReturnType<DataTextureCache['acquire']>
  private state: TemporalFrameState
  private ownsState: boolean

  constructor(values: Record<string, number>, state?: TemporalFrameState) {
    super({ resources: {}, compatibleRenderers: RendererType.WEBGL })
    const spatial = values.uLumaSpatial || 4
    const chroma = values.uChromaSpatial || spatial * .75
    const temporal = values.uLumaTemporal || spatial * 1.5
    const strengths = [spatial, chroma, temporal, values.uChromaTemporal || temporal * chroma / spatial]
    this.table = coefficients.acquire(strengths.join('/'), 1024, 32, () => coefficientTable(strengths))
    this.state = state ?? new TemporalFrameState()
    this.ownsState = !state
    this.frameIndex = values.uFrame ?? 0
    this.pass = shaderFilter('hqdn3d', FRAGMENT, { uPhase: 0, uPreviousValid: 0, uIntensity: values.uIntensity ?? 1 }, {
      uCoefficients: this.table.texture.source, uPrevious: Texture.EMPTY.source,
    })
  }

  private frameIndex: number

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const previous = this.state.prepare(this.frameIndex, input)
    const horizontal = historyTexturePool.getSameSizeTexture(input)
    const vertical = historyTexturePool.getSameSizeTexture(input)
    const temporal = historyTexturePool.getSameSizeTexture(input)
    let committed = false
    const render = (phase: number, source: Texture, destination: RenderSurface, last = false) => {
      const group = this.pass.resources.customUniforms as UniformGroup
      group.uniforms.uPhase = phase
      group.uniforms.uPreviousValid = previous ? 1 : 0
      group.update()
      this.pass.resources.uOriginal = input.source
      this.pass.resources.uPrevious = previous?.source ?? input.source
      this.pass.blendMode = last ? this.blendMode : 'none'
      this.pass.apply(manager, source, destination, last ? clear : true)
    }
    try {
      render(0, input, horizontal)
      render(1, horizontal, vertical)
      render(2, vertical, temporal)
      render(3, temporal, output, true)
      this.state.commit(temporal)
      committed = true
    } finally {
      historyTexturePool.returnTexture(horizontal)
      historyTexturePool.returnTexture(vertical)
      if (!committed) historyTexturePool.returnTexture(temporal)
    }
  }

  override destroy(): void {
    this.table.release()
    this.pass.destroy()
    if (this.ownsState) this.state.dispose()
    super.destroy()
  }
}
