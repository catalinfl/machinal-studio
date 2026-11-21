import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewPlayback } from '../../lib/preview-playback'

function voice(play = vi.fn(() => Promise.resolve())) {
  return { currentTime: 0, playbackRate: 1, defaultPlaybackRate: 1, seeking: false, muted: false, volume: 1, play, pause: vi.fn() } as unknown as HTMLVideoElement
}

afterEach(() => vi.unstubAllGlobals())

describe('preview playback lifetime', () => {
  it('shares an unresolved play and pauses it if the desired state changes', async () => {
    let finish!: () => void
    const element = voice(vi.fn(() => new Promise<void>(resolve => { finish = resolve })))
    const playback = new PreviewPlayback(() => ({ muted: false, volume: 100 }))
    playback.register('voice', element, true)
    playback.sync('voice', element, 2, true, 2, 30)
    playback.sync('voice', element, 2, true, 2, 30)
    expect(element.play).toHaveBeenCalledTimes(1)
    expect(element.currentTime).toBe(2)
    expect(element.playbackRate).toBe(2)
    playback.sync('voice', element, 2, false, 2, 30)
    finish()
    await Promise.resolve()
    expect(element.pause).toHaveBeenCalledTimes(2)
  })

  it('never restarts a released or replaced element after a late play resolution', async () => {
    let finish!: () => void
    const old = voice(vi.fn(() => new Promise<void>(resolve => { finish = resolve })))
    const replacement = voice()
    const playback = new PreviewPlayback(() => ({ muted: false, volume: 100 }))
    playback.register('voice', old, true)
    playback.sync('voice', old, 0, true, 1, 30)
    playback.release('voice', old)
    playback.register('voice', replacement, true)
    finish()
    await Promise.resolve()
    expect(old.pause).toHaveBeenCalledTimes(2)
    expect(replacement.pause).not.toHaveBeenCalled()
    expect(playback.voices.get('voice')?.element).toBe(replacement)
  })

  it('retries a rejected play without an unhandled rejection', async () => {
    const element = voice(vi.fn().mockRejectedValueOnce(new Error('gesture required')).mockResolvedValue(undefined))
    const playback = new PreviewPlayback(() => ({ muted: false, volume: 100 }))
    playback.register('voice', element, true)
    playback.sync('voice', element, 0, true, 1, 30)
    await Promise.resolve()
    await Promise.resolve()
    playback.sync('voice', element, 0, true, 1, 30)
    expect(element.play).toHaveBeenCalledTimes(2)
    playback.dispose()
    await Promise.resolve()
    expect(playback.voices.size).toBe(0)
  })

  it('preserves active voices and stops voices leaving the timeline', async () => {
    const active = voice()
    const outgoing = voice()
    const playback = new PreviewPlayback(() => ({ muted: false, volume: 100 }))
    for (const [key, element] of [['active', active], ['outgoing', outgoing]] as const) {
      playback.register(key, element, true)
      playback.sync(key, element, 0, true, 1, 30)
    }
    await Promise.resolve()
    playback.stopInactive(new Set(['active']))
    expect(active.pause).not.toHaveBeenCalled()
    expect(outgoing.pause).toHaveBeenCalledTimes(1)
  })

  it('uses WebAudio gain ramps and disconnects every released voice', async () => {
    const gain = () => ({ gain: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() })
    const master = gain()
    const channel = gain()
    const source = { connect: vi.fn(() => channel), disconnect: vi.fn() }
    const context = { state: 'running', currentTime: 5, destination: {}, createGain: vi.fn().mockReturnValueOnce(master).mockReturnValue(channel), createMediaElementSource: vi.fn(() => source), resume: vi.fn(async () => {}), close: vi.fn(async () => {}) }
    vi.stubGlobal('AudioContext', class { constructor() { return context } })
    const playback = new PreviewPlayback(() => ({ muted: false, volume: 50 }))
    const element = voice()
    playback.ensureAudio()
    await playback.resume()
    playback.register('voice', element, true)
    playback.setGain('voice', element, true, false, 0.4)
    expect(master.gain.value).toBe(0.5)
    expect(channel.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 5.02)
    playback.release('voice', element)
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(channel.disconnect).toHaveBeenCalledTimes(1)
    playback.dispose()
    expect(context.close).toHaveBeenCalledTimes(1)
  })
})
