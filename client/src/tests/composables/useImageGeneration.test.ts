import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageGeneration, type ImageGenerationRequest } from '../../composables/useImageGeneration.svelte'

const image = vi.hoisted(() => ({ execute: vi.fn(), upload: vi.fn() }))

vi.mock('../../lib/ai-image', () => ({ executeAIImageJob: image.execute, importProxyImage: image.upload }))

const request: ImageGenerationRequest = { mode: 'generate', prompt: 'An image' }
const execution = { asset: { name: 'image.png' }, clip: null }

describe('ImageGeneration lifecycle', () => {
  beforeEach(() => {
    image.execute.mockReset().mockResolvedValue(execution)
    image.upload.mockReset().mockResolvedValue('reference.png')
  })

  it('allows another generation after success and clears the previous result while working', async () => {
    const generation = new ImageGeneration()
    await generation.generate(request)
    expect(generation.phase.kind).toBe('success')
    expect(generation.busy).toBe(false)
    const pending = generation.generate(request)
    expect(generation.busy).toBe(true)
    expect(generation.resultName).toBe('')
    await pending
    expect(image.execute).toHaveBeenCalledTimes(2)
  })

  it('allows retry after failure without retaining an error on success', async () => {
    image.execute.mockRejectedValueOnce(new Error('Generation failed'))
    const generation = new ImageGeneration()
    await generation.generate(request)
    expect(generation.error).toBe('Generation failed')
    expect(generation.busy).toBe(false)
    await generation.generate(request)
    expect(generation.error).toBe('')
    expect(generation.resultName).toBe('image.png')
  })

  it('does not accept a second request while generating', async () => {
    const generation = new ImageGeneration()
    const pending = generation.generate(request)
    await generation.generate(request)
    await pending
    expect(image.execute).toHaveBeenCalledOnce()
  })

  it('ignores a request that completes after reset', async () => {
    let resolve!: (value: typeof execution) => void
    image.execute.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const generation = new ImageGeneration()
    const pending = generation.generate(request)
    generation.reset()
    resolve(execution)
    await pending
    expect(generation.phase).toEqual({ kind: 'idle' })
  })

  it('permits an upload after a validation error', async () => {
    const generation = new ImageGeneration()
    await generation.generate({ ...request, mode: 'edit' })
    expect(generation.phase.kind).toBe('error')
    expect(await generation.upload(new File(['image'], 'reference.png'), true)).toBe('reference.png')
    expect(generation.phase).toEqual({ kind: 'idle' })
  })
})
