import { untrack } from 'svelte'
import { MAX_LOCAL_WAVEFORM_BYTES, WAVEFORM_SAMPLE_RATE, classifyLocalWaveformSkip, computeWaveformPeaks, waveformTiles, type WaveformTile, type WaveformLoadResult } from '../lib/waveform'
import { drawWaveformTile } from '../lib/waveform-draw'
import { getWaveform } from '../lib/api'

// Decoding needs the whole file as an ArrayBuffer, so never attempt it for
// multi-hundred-MB local videos (e.g. 2GB+ timeline clips whose audio reuses
// the video blob URL). The clip keeps an explicit large-media badge instead
// of freezing/OOMing the tab; timeline audio playback is unaffected.
const cache = new Map<string, Promise<WaveformLoadResult>>()
let audioContext: AudioContext | null = null

interface WaveformProps {
  src: string | null
  fileName: string
  sourceMode?: 'proxy' | 'wasm'
  sourceDuration: number
  inPoint: number
  outPoint: number
  volume: number
  width: number
  visiblePixels?: { start: number; end: number }
  dragging: boolean
  /** True while the clip itself is being moved: skip redraws, the ghost is hidden via CSS. */
  moveDragging?: boolean
}

const loadLocalWaveform = async (source: string, sourceDuration: number): Promise<WaveformLoadResult> => {
  const early = classifyLocalWaveformSkip(sourceDuration, null)
  if (early) return { data: null, reason: early, sizeBytes: null }

  try {
    const totalBytes = await probeLocalSourceSize(source)
    const skip = classifyLocalWaveformSkip(sourceDuration, totalBytes)
    if (skip) return { data: null, reason: skip, sizeBytes: totalBytes }

    const data = await fetchCappedBytes(source, MAX_LOCAL_WAVEFORM_BYTES)
    if (data === null) return { data: null, reason: 'too-large', sizeBytes: totalBytes }
    audioContext ??= new AudioContext({ sampleRate: WAVEFORM_SAMPLE_RATE })
    const buffer = await audioContext.decodeAudioData(data.buffer as ArrayBuffer)
    return { data: { sampleRate: buffer.sampleRate, length: buffer.length, peaks: computeWaveformPeaks(buffer) }, reason: null, sizeBytes: totalBytes }
  } catch {
    // Huge/undecodable local sources keep the explicit large-media badge.
    return { data: null, reason: 'undecodable', sizeBytes: null }
  }
}

// Probe total size with a 2-byte range read so a 2GB+ blob: URL is never
// downloaded just to decide the waveform must be skipped. Returns null when
// the size cannot be determined (then the capped fetch below still decides).
// Never consumes a full response body: only 206 probes are drained.
async function probeLocalSourceSize(source: string): Promise<number | null> {
  try {
    const probe = await fetch(source, { headers: { Range: 'bytes=0-1' } })
    if (probe.status === 206) {
      const contentRange = probe.headers.get('content-range')
      if (contentRange) {
        const total = Number(contentRange.split('/').pop())
        if (Number.isFinite(total) && total >= 0) {
          try { await probe.arrayBuffer() } catch {}
          return total
        }
      }
      try { await probe.arrayBuffer() } catch {}
      return null
    }
    // Range ignored (opaque 200 with the full body): do NOT drain it here —
    // the capped fetch below streams with an early cancel instead.
    try { await probe.body?.cancel() } catch {}
    const contentLength = probe.headers.get('content-length')
    if (contentLength !== null) {
      const total = Number(contentLength)
      if (Number.isFinite(total) && total >= 0) return total
    }
  } catch {}
  return null
}

// Stream the source but cancel as soon as it exceeds the cap, so a 2GB+ blob
// URL costs at most cap+chunk bytes of RAM/transfer instead of OOMing the tab.
// Returns null when the source is larger than the cap.
async function fetchCappedBytes(source: string, cap: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const response = await fetch(source)
  // Fast path: an honest content-length avoids streaming hundreds of MB just
  // to learn the file is over the cap. (Optional-chained: unit-test fetch
  // stubs may not provide headers at all.)
  const declared = response.headers?.get?.('content-length') ?? null
  if (declared !== null) {
    const total = Number(declared)
    if (Number.isFinite(total) && total > cap) {
      try { await response.body?.cancel() } catch {}
      return null
    }
  }
  if (!response.body?.getReader) {
    const data = new Uint8Array(await response.arrayBuffer())
    return data.byteLength > cap ? null : (data as Uint8Array<ArrayBuffer>)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > cap) {
          try { await reader.cancel() } catch {}
          return null
        }
        chunks.push(value)
      }
    }
  } catch {
    try { await reader.cancel() } catch {}
    return null
  }
  const out = new Uint8Array(new ArrayBuffer(total)) as Uint8Array<ArrayBuffer>
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const loadWaveform = (props: WaveformProps): Promise<WaveformLoadResult> => {
  const source = props.src
  if (!source) return Promise.resolve({ data: null, reason: 'empty', sizeBytes: null })

  const serverBacked = props.sourceMode === 'proxy'
  const key = serverBacked ? `proxy:${props.fileName}:${source}` : `local:${source}`
  let result = cache.get(key)
  if (!result) {
    result = serverBacked
      ? getWaveform(props.fileName).then(
          (data) => ({ data, reason: null, sizeBytes: null }) as WaveformLoadResult,
          (): WaveformLoadResult => ({ data: null, reason: 'undecodable', sizeBytes: null }),
        )
      : loadLocalWaveform(source, props.sourceDuration)
    cache.set(key, result)
    result.catch(() => cache.delete(key))
  }
  return result
}

export function useWaveform(props: WaveformProps) {
  let wrap = $state<HTMLDivElement>()
  let result = $state<WaveformLoadResult>({ data: null, reason: null, sizeBytes: null })
  let frame: number | null = null
  const canvases = new Map<HTMLCanvasElement, WaveformTile>()
  const tiles = $derived(waveformTiles(props.width, props.visiblePixels))

  const status = $derived(
    result.data ? 'ready' as const
    : result.reason === 'empty' ? 'empty' as const
    : result.reason ? 'unavailable' as const
    : 'loading' as const,
  )

  function scheduleDraw(): void {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = null
      if (props.moveDragging) return
      for (const [canvas, tile] of canvases) drawWaveformTile(canvas, tile, result.data, props)
    })
  }

  function attachCanvas(canvas: HTMLCanvasElement, tile: WaveformTile) {
    canvases.set(canvas, tile)
    scheduleDraw()
    return {
      update(next: WaveformTile) { canvases.set(canvas, next); scheduleDraw() },
      destroy() { canvases.delete(canvas); canvas.width = 0; canvas.height = 0 },
    }
  }

  $effect(() => {
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(wrap)
    return () => observer.disconnect()
  })

  $effect(() => {
    // Only source changes load peaks; trimming, scrolling and volume edits redraw tiles.
    props.src
    props.fileName
    props.sourceMode
    props.sourceDuration
    result = { data: null, reason: null, sizeBytes: null }
    let cancelled = false
    untrack(() => loadWaveform(props)).then(next => {
      if (!cancelled) result = next
    })
    return () => { cancelled = true }
  })

  $effect(() => {
    result
    props.width
    props.inPoint
    props.outPoint
    props.volume
    props.dragging
    props.moveDragging
    scheduleDraw()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    }
  })

  return {
    attachCanvas,
    get wrap() { return wrap },
    set wrap(value: HTMLDivElement | undefined) { wrap = value },
    get tiles() { return tiles },
    get status() { return status },
    get reason() { return result.reason },
    get sizeBytes() { return result.sizeBytes },
  }
}
