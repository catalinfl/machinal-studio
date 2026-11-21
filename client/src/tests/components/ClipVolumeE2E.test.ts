import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/svelte'
import Clip from '../../components/Clip.svelte'
import { editor } from '../../stores/editor.svelte'
import * as api from '../../lib/api'
import type { WaveformData } from '../../lib/waveform'

const audioContextConstructor = vi.fn()

class FakeAudioBuffer {
  sampleRate = 44100
  length = 441000
  numberOfChannels = 1
  getChannelData(_ch: number) {
    const data = new Float32Array(this.length)
    for (let i = 0; i < this.length; i += 1103) data[i] = 0.9
    return data
  }
}

function fakeCanvas() {
  const fills: { x: number; y: number; h: number; style: string }[] = []
  let currentStyle = ''
  const ctx = {
    set fillStyle(v: string) { currentStyle = v },
    get fillStyle() { return currentStyle },
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, _w: number, h: number) => {
      fills.push({ x, y, h, style: currentStyle })
    }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as never)
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, value: 200 })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, value: 100 })
  return fills
}

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
  audioContextConstructor.mockClear()
  editor.clearHistory()
  for (const channel of [...editor.channels]) editor.removeChannel(channel.id)
  editor.selectClip(null)

  vi.stubGlobal('fetch', () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)) }))
  vi.stubGlobal('AudioContext', class {
    constructor(options?: AudioContextOptions) {
      audioContextConstructor(options)
    }
    decodeAudioData = vi.fn(() => Promise.resolve(new FakeAudioBuffer() as unknown as AudioBuffer))
  })

  const ch = editor.addChannel('audio')
  editor.addClip(ch.id, {
    fileName: 'audio.mp3',
    scrubBlobUrl: 'blob:audio',
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
  })
  editor.selectChannel(ch.id)
})

describe('clip volume end-to-end', () => {
  it('keeps narrow peaks visible when zoomed beyond the envelope resolution', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const fills = fakeCanvas()

    render(Clip, { props: { clip, channelId } })
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })

    expect(audioContextConstructor).toHaveBeenCalledOnce()
    expect(audioContextConstructor).toHaveBeenCalledWith({ sampleRate: 8_000 })
    expect(fills.filter((fill) => fill.h > 20).length).toBeGreaterThan(75)
  })

  it('draws the waveform when audio finishes loading after the initial frame', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    clip.scrubBlobUrl = 'blob:delayed-audio'
    const fills = fakeCanvas()
    let resolveArrayBuffer!: (data: ArrayBuffer) => void

    vi.stubGlobal('fetch', () => Promise.resolve({
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { resolveArrayBuffer = resolve }),
    }))

    render(Clip, { props: { clip, channelId } })
    await vi.waitFor(() => expect(fills).toHaveLength(1), { timeout: 2000 })

    fills.length = 0
    resolveArrayBuffer(new ArrayBuffer(16))

    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })
  })

  it('loads proxy waveform peaks on the server', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    clip.sourceMode = 'proxy'
    clip.scrubBlobUrl = 'blob:server-audio'
    const waveform: WaveformData = {
      sampleRate: 8_000,
      length: 80_000,
      peaks: {
        binSamples: 400,
        totalBins: 200,
        min: new Float32Array(200).fill(-0.5),
        max: new Float32Array(200).fill(0.5),
      },
    }
    const getWaveform = vi.spyOn(api, 'getWaveform').mockResolvedValue(waveform)
    const fills = fakeCanvas()

    render(Clip, { props: { clip, channelId } })

    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })
    expect(getWaveform).toHaveBeenCalledOnce()
    expect(getWaveform).toHaveBeenCalledWith('audio.mp3')
    expect(audioContextConstructor).not.toHaveBeenCalled()
  })

  it('reuses proxy waveform peaks after a cut', async () => {
    const channel = editor.channels.find((candidate) => candidate.type === 'audio')!
    const clip = channel.clips[0]
    clip.sourceMode = 'proxy'
    clip.scrubBlobUrl = 'blob:cut-server-audio'
    const waveform: WaveformData = {
      sampleRate: 8_000,
      length: 80_000,
      peaks: {
        binSamples: 400,
        totalBins: 200,
        min: new Float32Array(200).fill(-0.5),
        max: new Float32Array(200).fill(0.5),
      },
    }
    const getWaveform = vi.spyOn(api, 'getWaveform').mockResolvedValue(waveform)
    const second = editor.splitClip(clip.id, 2)
    fakeCanvas()

    render(Clip, { props: { clip, channelId: channel.id } })
    render(Clip, { props: { clip: second!, channelId: channel.id } })

    await vi.waitFor(() => expect(getWaveform).toHaveBeenCalledOnce(), { timeout: 2000 })
  })

  it('does not decode long local audio in browser memory', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    clip.sourceMode = 'wasm'
    clip.sourceDuration = 10 * 60
    clip.outPoint = clip.sourceDuration
    clip.scrubBlobUrl = 'blob:long-local-audio'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fills = fakeCanvas()

    render(Clip, { props: { clip, channelId } })

    await vi.waitFor(() => expect(fills).toHaveLength(4), { timeout: 2000 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(audioContextConstructor).not.toHaveBeenCalled()
  })

  it('shrinks the waveform when the volume is lowered', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const fills = fakeCanvas()

    render(Clip, { props: { clip, channelId } })
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })

    const tallMax = Math.max(...fills.map((f) => f.h))
    expect(tallMax).toBeGreaterThan(20)

    fills.length = 0
    editor.setClipVolume(clip.id, 25)
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })

    const shortMax = Math.max(...fills.map((f) => f.h))
    expect(shortMax).toBeLessThan(tallMax)
  })

  it('grows the waveform up to 200%', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const fills = fakeCanvas()

    render(Clip, { props: { clip, channelId } })
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })
    const at100 = Math.max(...fills.map((f) => f.h))

    fills.length = 0
    editor.setClipVolume(clip.id, 200)
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })
    const at200 = Math.max(...fills.map((f) => f.h))

    expect(at200).toBeGreaterThan(at100)
  })

  it('uses the warning color only while dragging the volume line above 100%', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const fills = fakeCanvas()

    const { container } = render(Clip, { props: { clip, channelId } })
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 100, width: 200, left: 0, right: 200, bottom: 100 } as DOMRect))
    const line = container.querySelector('.vol-line') as HTMLElement

    const restingStyle = fills[0]?.style
    expect(restingStyle).toBeTruthy()
    expect(fills.every((f) => f.style === restingStyle)).toBe(true)

    fills.length = 0
    await fireEvent.mouseDown(line, { clientY: 50 })
    await fireEvent.mouseMove(window, { clientY: 10 })
    await vi.waitFor(
      () => expect(fills.some((f) => f.style !== restingStyle)).toBe(true),
      { timeout: 2000 },
    )
    expect(clip.volume).toBe(180)

    fills.length = 0
    await fireEvent.mouseUp(window, { clientY: 10 })
    await vi.waitFor(() => expect(fills.length).toBeGreaterThan(50), { timeout: 2000 })
    expect(fills.every((f) => f.style === restingStyle)).toBe(true)
    expect(clip.volume).toBe(180)
  })
})
