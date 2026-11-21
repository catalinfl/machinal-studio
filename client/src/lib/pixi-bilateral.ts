import { Filter, RendererType, Texture, TexturePoolClass, type FilterSystem, type RenderSurface, type UniformGroup } from 'pixi.js'
import { shaderFilter } from './pixi-filter-pipeline'
import FRAGMENT from './glsl/bilateral-scan.frag.glsl?raw'

const pool = new TexturePoolClass({ format: 'rgba32float', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' })

export class BilateralFilter extends Filter {
  private pass: Filter

  constructor(spatial: number, range: number, intensity: number, pixelScale: number) {
    super({ resources: {}, compatibleRenderers: RendererType.WEBGL })
    const sigma = Math.fround(Math.max(.001, spatial * Math.abs(pixelScale)))
    this.pass = shaderFilter('bilateral-scan', FRAGMENT, {
      uPhase: 0, uAxis: 0, uDirection: 1, uStride: 1, uIntensity: intensity,
      uAlpha: Math.fround(Math.exp(Math.fround(-Math.fround(Math.SQRT2) / sigma))),
      uInvRange: Math.fround(1 / Math.fround(Math.fround(range) * 255)),
    }, { uOther: Texture.EMPTY.source })
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const held = new Set<Texture>()
    const acquire = () => {
      const texture = pool.getSameSizeTexture(input)
      held.add(texture)
      return texture
    }
    const release = (texture: Texture) => {
      held.delete(texture)
      pool.returnTexture(texture)
    }
    const render = (source: Texture, target: RenderSurface, values: Record<string, number>, other = input, last = false) => {
      const group = this.pass.resources.customUniforms as UniformGroup
      Object.assign(group.uniforms, values)
      group.update()
      this.pass.resources.uOriginal = input.source
      this.pass.resources.uOther = other.source
      this.pass.blendMode = last ? this.blendMode : 'none'
      this.pass.apply(manager, source, target, last ? clear : true)
    }
    const scan = (source: Texture, axis: number, direction: number) => {
      let current = acquire()
      render(source, current, { uPhase: 0, uAxis: axis, uDirection: direction, uStride: 1 })
      for (let stride = 1; stride < (axis === 0 ? input.width : input.height); stride *= 2) {
        const next = acquire()
        render(current, next, { uPhase: 1, uStride: stride })
        release(current)
        current = next
      }
      return current
    }
    try {
      const left = scan(input, 0, 1)
      const right = scan(input, 0, -1)
      const horizontal = acquire()
      render(left, horizontal, { uPhase: 2 }, right)
      release(left)
      release(right)
      const top = scan(horizontal, 1, 1)
      const bottom = scan(horizontal, 1, -1)
      render(top, output, { uPhase: 3 }, bottom, true)
    } finally {
      for (const texture of held) pool.returnTexture(texture)
    }
  }

  override destroy(): void {
    this.pass.destroy()
    super.destroy()
  }
}
