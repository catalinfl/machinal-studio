import { BufferImageSource, Texture } from 'pixi.js'

interface Entry {
  texture: Texture
  references: number
  used: number
}

export class DataTextureCache {
  private entries = new Map<string, Entry>()
  private clock = 0

  constructor(private readonly capacity: number) {}

  acquire(key: string, width: number, height: number, create: () => Uint8Array): { texture: Texture; release: () => void } {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { texture: new Texture({ source: new BufferImageSource({ resource: create(), width, height, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: 'nearest' }) }), references: 0, used: 0 }
      this.entries.set(key, entry)
    }
    entry.references++
    entry.used = ++this.clock
    const acquired = entry
    let released = false
    return {
      texture: acquired.texture,
      release: () => {
        if (released) return
        released = true
        acquired.references--
        this.prune()
      },
    }
  }

  private prune(): void {
    for (const [key, entry] of [...this.entries].sort((a, b) => a[1].used - b[1].used)) {
      if (this.entries.size <= this.capacity) break
      if (entry.references !== 0) continue
      entry.texture.destroy(true)
      this.entries.delete(key)
    }
  }
}
