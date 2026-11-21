import { TexturePoolClass, type Texture } from 'pixi.js'

export const historyTexturePool = new TexturePoolClass({ format: 'rgba32float', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' })
export const historyBytePool = new TexturePoolClass({ format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' })

export class TemporalFrameState {
  private index = -1
  private geometry = ''
  private current: Texture | null = null
  private previous: Texture | null = null

  prepare(index: number, input: Texture): Texture | null {
    const geometry = `${input.width}/${input.height}/${input.source.resolution}`
    if (geometry !== this.geometry || (index !== this.index && index !== this.index + 1)) this.dispose()
    if (index !== this.index) {
      if (this.previous) historyTexturePool.returnTexture(this.previous)
      this.previous = this.current
      this.current = null
      this.index = index
    }
    this.geometry = geometry
    return this.previous
  }

  commit(texture: Texture): void {
    if (this.current) historyTexturePool.returnTexture(this.current)
    this.current = texture
  }

  dispose(): void {
    if (this.current) historyTexturePool.returnTexture(this.current)
    if (this.previous) historyTexturePool.returnTexture(this.previous)
    this.current = this.previous = null
    this.index = -1
    this.geometry = ''
  }
}

export class HoldState {
  lastCadence = -1
  held: Texture | null = null
  private geometry = ''

  check(geometry: string): boolean {
    if (geometry !== this.geometry) {
      this.dispose()
      this.geometry = geometry
      return true
    }
    return false
  }

  dispose(): void {
    if (this.held) historyBytePool.returnTexture(this.held)
    this.held = null
    this.lastCadence = -1
    this.geometry = ''
  }
}

export class TmixRingState {
  slots: Texture[] = []
  private geometry = ''
  lastIndex = -1

  constructor(readonly size: number) {}

  /** 'reset' on cold/seek (refill with current), 'next' on sequential advance (push current), 'repeat' on same-index re-apply (reuse ring untouched). */
  check(index: number, input: Texture): 'reset' | 'next' | 'repeat' {
    const geometry = `${input.width}/${input.height}`
    if (geometry !== this.geometry) {
      this.dispose()
      this.geometry = geometry
      this.lastIndex = index
      return 'reset'
    }
    if (index === this.lastIndex) return 'repeat'
    const sequential = index === this.lastIndex + 1
    this.lastIndex = index
    return sequential ? 'next' : 'reset'
  }

  clear(): void {
    for (const texture of this.slots) historyBytePool.returnTexture(texture)
    this.slots = []
  }

  dispose(): void {
    this.clear()
    this.geometry = ''
    this.lastIndex = -1
  }
}

export class PixiHistory {
  private frames = new Map<string, TemporalFrameState>()
  private rings = new Map<string, TmixRingState>()
  private holds = new Map<string, HoldState>()

  frame(key: string): TemporalFrameState {
    let state = this.frames.get(key)
    if (!state) {
      state = new TemporalFrameState()
      this.frames.set(key, state)
    }
    return state
  }

  ring(key: string, size: number): TmixRingState {
    let state = this.rings.get(key)
    if (!state || state.size !== size) {
      state?.dispose()
      state = new TmixRingState(size)
      this.rings.set(key, state)
    }
    return state
  }

  hold(key: string): HoldState {
    let state = this.holds.get(key)
    if (!state) {
      state = new HoldState()
      this.holds.set(key, state)
    }
    return state
  }

  dispose(): void {
    this.frames.forEach(state => state.dispose())
    this.frames.clear()
    this.rings.forEach(state => state.dispose())
    this.rings.clear()
    this.holds.forEach(state => state.dispose())
    this.holds.clear()
  }
}
