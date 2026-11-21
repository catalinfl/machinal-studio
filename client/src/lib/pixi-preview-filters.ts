import type { Filter } from 'pixi.js'
import { createPixiFilters, createPixiTransitionFilter, type PixiBuiltFilters, type PixiFrameSize, type PixiPlan, type PixiTransitionPlan } from './effects-pixi'
import type { PixiHistory } from './pixi-history'

export class PixiPreviewFilters {
  #effects = new Map<string, { signature: string; history: PixiHistory; built: PixiBuiltFilters }>()
  #transitions = new Map<string, { signature: string; filter: Filter }>()

  effects(key: string, plans: readonly PixiPlan[], frame: PixiFrameSize, scale: { x: number; y: number }, history: PixiHistory): PixiBuiltFilters {
    const signature = JSON.stringify({ plans, frame, scale })
    const cached = this.#effects.get(key)
    if (cached?.signature === signature && cached.history === history) return cached.built
    this.releaseEffects(key)
    const built = createPixiFilters(plans, frame, scale, history)
    this.#effects.set(key, { signature, history, built })
    return built
  }

  transition(key: string, reveal: PixiTransitionPlan['reveal'], frame: PixiFrameSize): Filter | null {
    if (!reveal) return null
    const signature = JSON.stringify({ custom: reveal.custom, mode: reveal.uniforms.uMode, frame })
    let cached = this.#transitions.get(key)
    if (cached?.signature !== signature) {
      cached?.filter.destroy()
      this.#transitions.delete(key)
      const filter = createPixiTransitionFilter(reveal, frame)
      if (!filter) return null
      cached = { signature, filter }
      this.#transitions.set(key, cached)
    }
    const group = cached.filter.resources.customUniforms
    group.uniforms.uProgress = reveal.uniforms.uProgress ?? 0
    group.update()
    return cached.filter
  }

  releaseEffects(key: string): void {
    const cached = this.#effects.get(key)
    if (!cached) return
    for (const filter of cached.built.filters) filter.destroy()
    this.#effects.delete(key)
  }

  retain(keys: Set<string>): void {
    for (const key of this.#effects.keys()) if (!keys.has(key)) this.releaseEffects(key)
    for (const [key, cached] of this.#transitions) {
      if (keys.has(key)) continue
      cached.filter.destroy()
      this.#transitions.delete(key)
    }
  }

  dispose(): void {
    this.retain(new Set())
  }
}
