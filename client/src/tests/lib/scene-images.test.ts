import { describe, expect, it, vi } from 'vitest'
import { sceneImageInputs, validateEmbeddedSceneImages, validateSceneImageFiles } from '../../lib/scene-images'
import { uploadSceneImages } from '../../lib/scene-generation'

const file = new File(['original pixels'], 'Product.png', { type: 'image/png' })
const attachment = { id: 'local-id', file, uploadName: 'scene_image_unique.png', previewUrl: 'blob:preview', description: '  Product cutout on the right  ' }

describe('scene image attachments', () => {
  it('builds metadata-only AI requests with stable source names and trimmed directions', () => {
    expect(sceneImageInputs([attachment])).toEqual([{ id: 'image_1', file: 'scene_image_unique.png', name: 'Product.png', description: 'Product cutout on the right' }])
    expect(() => sceneImageInputs([{ ...attachment, description: 'a'.repeat(601) }])).toThrow('600')
    expect(() => validateSceneImageFiles([file, file], 3)).toThrow('4 images')
    expect(() => validateSceneImageFiles([new File(['svg'], 'image.svg', { type: 'image/svg+xml' })])).toThrow('JPEG')
    expect(() => validateSceneImageFiles([new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })])).toThrow('5 MB')
  })

  it('uploads originals under collision-free names, with cancellation support', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('Upload successful'))
    vi.stubGlobal('fetch', fetcher)
    try {
      const controller = new AbortController()
      await uploadSceneImages([attachment], controller.signal)
      const options = fetcher.mock.calls[0][1]
      const uploaded = options.body.get('file') as File
      expect(uploaded.name).toBe('scene_image_unique.png')
      expect(uploaded.size).toBe(file.size)
      expect(options.signal).toBe(controller.signal)
    } finally { vi.unstubAllGlobals() }
  })

  it('accepts bounded embedded raster assets and rejects URLs or unsupported formats', () => {
    expect(() => validateEmbeddedSceneImages({ image_1: 'data:image/png;base64,AA==' })).not.toThrow()
    for (const images of [{ image_1: 'https://example.test/image.png' }, { image_1: 'data:image/svg+xml;base64,AA==' }, { image_9: 'data:image/png;base64,AA==' }, ['data:image/png;base64,AA==']]) {
      expect(() => validateEmbeddedSceneImages(images)).toThrow('invalid')
    }
  })
})
