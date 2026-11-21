import { Filter, RendererType, Texture, type FilterSystem, type RenderSurface, type UniformGroup } from 'pixi.js'
import { HoldState, TmixRingState, historyBytePool, historyTexturePool } from './pixi-history'
import { shaderFilter } from './pixi-filter-pipeline'
import COPY_FRAG from './glsl/tmix-copy.frag.glsl?raw'
import MIX_FRAG from './glsl/tmix-mix.frag.glsl?raw'

const CHUNK = 8

export class TmixFilter extends Filter {
  private copy: Filter
  private mix: Filter
  private weights: number[]
  private scale: number
  private intensity: number
  private frameIndex: number
  private ring: TmixRingState
  private ownsRing: boolean

  constructor(values: Record<string, number>, ring?: TmixRingState) {
    super({ resources: {}, compatibleRenderers: RendererType.WEBGL })
    const frames = Math.max(1, Math.round(values.uFrames ?? 2))
    this.weights = Array.from({ length: frames }, (_, index) => values[`uW${index}`] ?? (index === 0 ? 1 : 0))
    this.scale = values.uScale ?? 1
    this.intensity = values.uIntensity ?? 1
    this.frameIndex = values.uFrame ?? 0
    this.ring = ring ?? new TmixRingState(frames)
    this.ownsRing = !ring
    this.copy = shaderFilter('tmix-copy', COPY_FRAG, {})
    this.mix = shaderFilter('tmix-mix', MIX_FRAG, {
      uHasAccum: 0, uCount: 0,
      uW0: 0, uW1: 0, uW2: 0, uW3: 0, uW4: 0, uW5: 0, uW6: 0, uW7: 0,
      uScale: this.scale, uFinal: 0, uIntensity: this.intensity,
    }, {
      uAccum: Texture.EMPTY.source,
      uF0: Texture.EMPTY.source, uF1: Texture.EMPTY.source,
      uF2: Texture.EMPTY.source, uF3: Texture.EMPTY.source,
      uF4: Texture.EMPTY.source, uF5: Texture.EMPTY.source,
      uF6: Texture.EMPTY.source, uF7: Texture.EMPTY.source,
    })
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const n = this.weights.length
    const held: Texture[] = []
    const acquireByte = () => {
      const texture = historyBytePool.getSameSizeTexture(input)
      held.push(texture)
      return texture
    }
    try {
      const step = this.ring.check(this.frameIndex, input)
      if (step === 'reset') {
        this.ring.clear()
        for (let i = 0; i < n; i++) {
          const slot = acquireByte()
          this.copy.apply(manager, input, slot, true)
          held.splice(held.indexOf(slot), 1)
          this.ring.slots.push(slot)
        }
      } else if (step === 'next') {
        const slot = acquireByte()
        this.copy.apply(manager, input, slot, true)
        held.splice(held.indexOf(slot), 1)
        this.ring.slots.push(slot)
        while (this.ring.slots.length > n) {
          historyBytePool.returnTexture(this.ring.slots.shift()!)
        }
      }
      const slots = this.ring.slots
      const group = this.mix.resources.customUniforms as UniformGroup
      const chunks = Math.ceil(n / CHUNK)
      let accum: Texture | null = null
      const temps: Texture[] = []
      for (let c = 0; c < chunks; c++) {
        const start = c * CHUNK
        const count = Math.min(CHUNK, n - start)
        const last = c === chunks - 1
        Object.assign(group.uniforms, {
          uHasAccum: c === 0 ? 0 : 1,
          uCount: count,
          uW0: this.weights[start] ?? 0, uW1: this.weights[start + 1] ?? 0,
          uW2: this.weights[start + 2] ?? 0, uW3: this.weights[start + 3] ?? 0,
          uW4: this.weights[start + 4] ?? 0, uW5: this.weights[start + 5] ?? 0,
          uW6: this.weights[start + 6] ?? 0, uW7: this.weights[start + 7] ?? 0,
          uScale: this.scale, uFinal: last ? 1 : 0, uIntensity: this.intensity,
        })
        group.update()
        for (let k = 0; k < CHUNK; k++) {
          const slot = k < count ? slots[start + k] : input
          this.mix.resources[`uF${k}`] = slot.source
        }
        this.mix.resources.uAccum = accum?.source ?? Texture.EMPTY.source
        this.mix.resources.uOriginal = input.source
        if (!last) {
          const temp = historyTexturePool.getSameSizeTexture(input)
          temps.push(temp)
          this.mix.blendMode = 'none'
          this.mix.apply(manager, input, temp, true)
          accum = temp
        } else {
          this.mix.blendMode = this.blendMode
          this.mix.apply(manager, input, output, clear)
        }
      }
      for (const temp of temps) historyTexturePool.returnTexture(temp)
    } finally {
      for (const texture of held) historyBytePool.returnTexture(texture)
    }
  }

  override destroy(): void {
    this.copy.destroy()
    this.mix.destroy()
    if (this.ownsRing) this.ring.dispose()
    super.destroy()
  }
}

export class StopMotionFilter extends Filter {
  private copy: Filter
  private holdFps: number
  private timeSec: number
  private state: HoldState
  private ownsState: boolean

  constructor(values: Record<string, number>, state?: HoldState) {
    super({ resources: {}, compatibleRenderers: RendererType.WEBGL })
    this.holdFps = Math.max(1, values.uHoldFps ?? 12)
    this.timeSec = Math.max(0, values.uTime ?? 0)
    this.state = state ?? new HoldState()
    this.ownsState = !state
    this.copy = shaderFilter('stopmotion-copy', COPY_FRAG, {})
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const geometry = `${input.width}/${input.height}`
    const reset = this.state.check(geometry)
    const cadence = Math.floor(this.timeSec * this.holdFps + 0.00001)
    if (reset || cadence !== this.state.lastCadence || !this.state.held) {
      this.state.lastCadence = cadence
      if (this.state.held) historyBytePool.returnTexture(this.state.held)
      const held = historyBytePool.getSameSizeTexture(input)
      this.copy.blendMode = 'none'
      this.copy.apply(manager, input, held, true)
      this.state.held = held
    }
    // Blit the held frame to output (identity copy, no resampling error).
    this.copy.blendMode = this.blendMode
    this.copy.apply(manager, this.state.held!, output, clear)
  }

  override destroy(): void {
    this.copy.destroy()
    if (this.ownsState) this.state.dispose()
    super.destroy()
  }
}
