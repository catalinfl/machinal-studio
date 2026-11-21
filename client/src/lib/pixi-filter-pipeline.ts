import { Filter, GlProgram, RendererType, Texture, TexturePool, UniformGroup, type FilterSystem, type RenderSurface } from 'pixi.js'
import VERTEX from './glsl/effect.vert.glsl?raw'

export function shaderFilter(name: string, fragment: string, values: Record<string, number>, textures: Record<string, Texture['source']> = {}): Filter {
  const uniforms = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, type: 'f32' as const }]))
  return new Filter({
    glProgram: GlProgram.from({ name, vertex: VERTEX, fragment }),
    resources: { customUniforms: new UniformGroup(uniforms), uOriginal: Texture.EMPTY.source, ...textures },
  })
}

export class FilterPipeline extends Filter {
  constructor(readonly passes: Filter[]) {
    super({ resources: {}, compatibleRenderers: RendererType.WEBGL })
  }

  override apply(manager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const temporary: Texture[] = []
    let current = input
    try {
      for (let index = 0; index < this.passes.length; index++) {
        const pass = this.passes[index]
        const last = index === this.passes.length - 1
        const destination = last ? output : TexturePool.getSameSizeTexture(input)
        if (!last) temporary.push(destination as Texture)
        if ('uOriginal' in pass.resources) pass.resources.uOriginal = input.source
        pass.blendMode = last ? this.blendMode : 'normal'
        pass.apply(manager, current, destination, last ? clear : true)
        if (!last) current = destination as Texture
      }
    } finally {
      temporary.forEach(texture => TexturePool.returnTexture(texture))
    }
  }

  override destroy(): void {
    this.passes.forEach(pass => pass.destroy())
    super.destroy()
  }
}
