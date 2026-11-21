import { BufferImageSource, Filter, RendererType, Texture, type FilterSystem, type RenderSurface, type UniformGroup } from 'pixi.js'
import { historyTexturePool } from './pixi-history'
import { shaderFilter } from './pixi-filter-pipeline'
import FRAGMENT from './glsl/dirblur-exact.frag.glsl?raw'

const f = Math.fround

interface Kernel {
  weights: Float32Array
  texture: Texture
  uses: number
  pair: { fwd: Kernel; bwd: Kernel } | null
  taps: Tap[]
}

const kernels = new Map<string, Kernel>()

function dblurCoefficients(angleDeg: number, radius: number) {
  const angle = f(angleDeg * Math.PI / 180)
  const mu = f(Math.cos(angle))
  const nu = f(Math.sin(angle))
  const r = f(radius)
  const R1 = f(f(mu * r) * f(mu * r))
  const R2 = f(f(nu * r) * f(nu * r))
  const R3 = f(f(f(mu * nu) * r) * r)
  const w1 = f(Math.sqrt(f(0.25 + R1)))
  const w2 = f(Math.sqrt(f(0.25 + R2)))
  const a0 = f(f(f(w1 + 0.5) * (w2 + 0.5)) - Math.abs(R3))
  const a1 = f(0.5 + w2 - a0)
  const a2 = f(0.5 + w1 - a0)
  const a3 = f(a0 - w1 - w2)
  return { b0: f(1 / a0), b1: f(-a2 / a0), q: f(-a1 / a0), c: f(-a3 / a0), R3 }
}

// Faithful float32 transcription of vf_dblur.c filter_horizontally: run the
// exact raster recurrence on an impulse. The response is one-dimensional
// along the lattice (verified against the native binary). The native filter
// is a forward raster sweep followed by a backward sweep; each sweep keeps
// its own edge rule (replicated head, cut tail), so the preview runs the
// same two one-sided convolutions instead of one symmetric kernel.
interface Tap {
  dx: number
  dy: number
  w: number
}

function simulateSweep(angleDeg: number, radius: number, forward: boolean): Tap[] {
  const { b0, b1, q, c, R3 } = dblurCoefficients(angleDeg, radius)
  const extent = Math.min(400, Math.ceil(6 * radius) + 8)
  const size = extent * 2 + 1
  const buf = new Float32Array(size * size)
  buf[extent * size + extent] = 1
  const W = size
  const H = size
  // Run ONLY the requested sweep on the impulse: the native filter chains
  // forward then backward, and each sweep owns its edge rule, so the preview
  // convolves the two one-sided kernels in the same order.
  const runForward = () => {
    if (R3 > 0) {
      for (let y = 1; y < H - 1; y++) {
        let g = f(f(q * buf[y * W]) + f(c * buf[y * W]))
        for (let x = 0; x < W; x++) {
          buf[y * W + x] = f(f(f(b0 * buf[y * W + x]) + f(b1 * buf[(y - 1) * W + x])) + g)
          g = f(f(q * buf[y * W + x]) + f(c * buf[(y - 1) * W + x]))
        }
      }
    } else {
      for (let y = 1; y < H - 1; y++) {
        let g = f(f(q * buf[y * W + W - 1]) + f(c * buf[y * W + W - 1]))
        for (let x = W - 1; x >= 0; x--) {
          buf[y * W + x] = f(f(f(b0 * buf[y * W + x]) + f(b1 * buf[(y - 1) * W + x])) + g)
          g = f(f(q * buf[y * W + x]) + f(c * buf[(y - 1) * W + x]))
        }
      }
    }
  }
  const runBackward = () => {
    if (R3 > 0) {
      for (let y = H - 2; y >= 0; y--) {
        let g = f(f(q * buf[y * W + W - 1]) + f(c * buf[y * W + W - 1]))
        for (let x = W - 1; x >= 0; x--) {
          buf[y * W + x] = f(f(f(b0 * buf[y * W + x]) + f(b1 * buf[(y + 1) * W + x])) + g)
          g = f(f(q * buf[y * W + x]) + f(c * buf[(y + 1) * W + x]))
        }
      }
    } else {
      for (let y = H - 2; y >= 0; y--) {
        let g = f(f(q * buf[y * W]) + f(c * buf[y * W]))
        for (let x = 0; x < W; x++) {
          buf[y * W + x] = f(f(f(b0 * buf[y * W + x]) + f(b1 * buf[(y + 1) * W + x])) + g)
          g = f(f(q * buf[y * W + x]) + f(c * buf[(y + 1) * W + x]))
        }
      }
    }
  }
  if (forward) runForward()
  else runBackward()
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const taps: { dx: number; dy: number; w: number }[] = []
  const threshold = 0.5 / 255
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const w = buf[y * W + x]
      if (Math.abs(w) >= threshold) taps.push({ dx: x - extent, dy: y - extent, w })
    }
  }
  // Order along the blur direction for cache-friendly sampling.
  taps.sort((a, b) => (a.dx * dx + a.dy * dy) - (b.dx * dx + b.dy * dy))
  return taps
}

export function dblurKernels(angleDeg: number, radius: number): { fwd: Kernel; bwd: Kernel } {
  const key = `${angleDeg.toFixed(3)}/${radius.toFixed(3)}`
  const existing = kernels.get(key)
  if (existing) {
    existing.uses++
    return existing.pair!
  }
  const make = (forward: boolean): Kernel => {
    let taps = simulateSweep(angleDeg, radius, forward)
    if (taps.length > 255) {
      const start = Math.floor((taps.length - 255) / 2)
      taps = taps.slice(start, start + 255)
      const sum = taps.reduce((a, t) => a + t.w, 0)
      if (sum !== 0) taps = taps.map(t => ({ ...t, w: t.w / sum }))
    }
    const data = new Float32Array(taps.length * 4)
    taps.forEach((t, index) => { data[index * 4] = t.w; data[index * 4 + 1] = t.dx; data[index * 4 + 2] = t.dy })
    const texture = new Texture({
      source: new BufferImageSource({ resource: data, width: Math.max(1, taps.length), height: 1, format: 'rgba32float', alphaMode: 'no-premultiply-alpha', scaleMode: 'nearest' }),
    })
    return { weights: Float32Array.from(taps.map(t => t.w)), texture, uses: 1, pair: null, taps }
  }
  const pair = { fwd: make(true), bwd: make(false) }
  const holder: Kernel = { weights: pair.fwd.weights, texture: pair.fwd.texture, uses: 1, pair: pair as never, taps: pair.fwd.taps }
  if (kernels.size >= 32) {
    let oldest: string | null = null
    let oldestUses = Infinity
    for (const [k, v] of kernels) {
      if (v.uses < oldestUses) {
        oldestUses = v.uses
        oldest = k
      }
    }
    if (oldest) {
      const victim = kernels.get(oldest)!
      victim.pair?.fwd.texture.destroy(true)
      victim.pair?.bwd.texture.destroy(true)
      kernels.delete(oldest)
    }
  }
  kernels.set(key, holder)
  return pair
}

export class DblurFilter extends Filter {
  private pass: Filter
  private kernels: { fwd: Kernel; bwd: Kernel }
  private full: Kernel | null = null

  constructor(angleDeg: number, radius: number, dirX: number, dirY: number, scaleX: number, scaleY: number, intensity: number) {
    super({ resources: {}, compatibleRenderers: RendererType.WEBGL })
    this.kernels = dblurKernels(angleDeg, radius)
    // The two one-sided sweeps compose to a symmetric full kernel
    // (linearity); a single symmetric convolution reproduces the native
    // interior response, with edge replication along the sampling line.
    this.full = combineKernels(this.kernels.fwd, this.kernels.bwd)
    this.pass = shaderFilter('dblur-exact', FRAGMENT, {
      uTaps: this.full.weights.length,
      uDirX: dirX, uDirY: dirY,
      uScaleX: scaleX, uScaleY: scaleY,
      uPositive: 0, uMixOriginal: 1, uIntensity: intensity,
    }, { uKernel: this.full.texture.source })
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const group = this.pass.resources.customUniforms as UniformGroup
    group.update()
    this.pass.resources.uOriginal = input.source
    this.pass.blendMode = this.blendMode
    this.pass.apply(manager, input, output, clear)
  }

  override destroy(): void {
    this.pass.destroy()
    this.full?.texture.destroy(true)
    super.destroy()
  }
}

function combineKernels(a: Kernel, b: Kernel): Kernel {
  const map = new Map<string, { dx: number; dy: number; w: number }>()
  for (const t of a.taps) {
    for (const u of b.taps) {
      const dx = t.dx + u.dx
      const dy = t.dy + u.dy
      const key = `${dx},${dy}`
      const existing = map.get(key)
      if (existing) existing.w += t.w * u.w
      else map.set(key, { dx, dy, w: t.w * u.w })
    }
  }
  const taps = [...map.values()].filter(t => Math.abs(t.w) >= 0.5 / 255)
  taps.sort((m, n) => m.dx - n.dx || m.dy - n.dy)
  // Preserve DC gain: one-sided pre-thresholding drops sub-LSB tails whose
  // products matter after combination; renormalize the combined kernel.
  const sum = taps.reduce((a, t) => a + t.w, 0)
  const normalized = sum !== 0 ? taps.map(t => ({ ...t, w: t.w / sum })) : taps
  const data = new Float32Array(normalized.length * 4)
  normalized.forEach((t, index) => { data[index * 4] = t.w; data[index * 4 + 1] = t.dx; data[index * 4 + 2] = t.dy })
  const texture = new Texture({
    source: new BufferImageSource({ resource: data, width: Math.max(1, normalized.length), height: 1, format: 'rgba32float', alphaMode: 'no-premultiply-alpha', scaleMode: 'nearest' }),
  })
  return { weights: Float32Array.from(normalized.map(t => t.w)), texture, uses: 1, pair: null, taps: normalized }
}
