import { DataTextureCache } from './pixi-data-textures'

const textures = new DataTextureCache(4)

export function transitionRandom(width: number, height: number) {
  return textures.acquire(`${width}x${height}`, width, height, () => {
    const bytes = new Uint8Array(width * height * 4)
    const xScale = Math.fround(12.9898)
    const yScale = Math.fround(78.233)
    const multiplier = Math.fround(43758.545)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const angle = Math.fround(Math.fround(x * xScale) + Math.fround(y * yScale))
        const value = Math.fround(Math.fround(Math.sin(angle)) * multiplier)
        const encoded = Math.floor((value - Math.floor(value)) * 16777216)
        const index = (y * width + x) * 4
        bytes[index] = encoded >>> 16
        bytes[index + 1] = (encoded >>> 8) & 255
        bytes[index + 2] = encoded & 255
        bytes[index + 3] = 255
      }
    }
    return bytes
  })
}
