import { describe, expect, it, vi } from 'vitest'
import { useWasmLoader } from '../../composables/useWasmLoader.svelte'

describe('wasm loader state', () => {
  it('shares a load between concurrent callers and becomes ready only on completion', async () => {
    let finish!: () => void
    const load = vi.fn((progress: (ratio: number, message: string) => void) => {
      progress(0.4, 'loading')
      return new Promise<void>(resolve => { finish = resolve })
    })
    const progress = vi.fn()
    const loader = useWasmLoader(load, progress)
    const first = loader.ensure()
    expect(loader.ensure()).toBe(first)
    await Promise.resolve()
    expect(loader.state).toBe('loading')
    expect(loader.ratio).toBe(0.4)
    expect(progress).toHaveBeenCalledWith(0.4, 'loading')
    finish()
    await first
    expect(loader.state).toBe('ready')
    expect(loader.ratio).toBe(1)
    expect(loader.message).toBe('')
    await loader.ensure()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries synchronous failures without retaining stale errors or progress', async () => {
    const load = vi.fn<() => Promise<unknown>>(() => { throw new Error('cannot load') })
    const loader = useWasmLoader(load, vi.fn())
    await loader.ensure()
    expect(loader.state).toBe('error')
    expect(loader.error).toBe('cannot load')
    expect(loader.ratio).toBe(0)
    load.mockResolvedValueOnce(undefined)
    const retry = loader.ensure()
    expect(loader.state).toBe('loading')
    expect(loader.error).toBe('')
    await retry
    expect(loader.state).toBe('ready')
  })

  it('ignores late progress after a load has completed', async () => {
    let lateProgress!: (ratio: number, message: string) => void
    const loader = useWasmLoader(async progress => { lateProgress = progress }, vi.fn())
    await loader.ensure()
    lateProgress(0.5, 'late callback')
    expect(loader.state).toBe('ready')
    expect(loader.message).toBe('')
  })
})
