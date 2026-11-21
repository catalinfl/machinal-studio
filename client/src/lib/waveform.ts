export const WAVEFORM_SAMPLE_RATE = 8_000
export const PEAK_BIN_SECONDS = 0.05
export const WAVEFORM_BAR_WIDTH = 2
export const MAX_CANVAS_DPR = 1.5
export const WAVEFORM_TILE_WIDTH_PX = 1024
const INITIAL_WAVEFORM_VIEWPORT_PX = 4000

export interface WaveformTile { left: number; width: number }

export function waveformTiles(width: number, visible?: { start: number; end: number }): WaveformTile[] {
  if (!Number.isFinite(width) || width <= 0) return []
  const start = Math.max(0, visible?.start ?? 0)
  const end = Math.min(width, visible?.end ?? INITIAL_WAVEFORM_VIEWPORT_PX)
  if (end <= start) return []
  const tiles: WaveformTile[] = []
  for (let left = Math.floor(start / WAVEFORM_TILE_WIDTH_PX) * WAVEFORM_TILE_WIDTH_PX; left < end; left += WAVEFORM_TILE_WIDTH_PX) {
    tiles.push({ left, width: Math.min(WAVEFORM_TILE_WIDTH_PX, width - left) })
  }
  return tiles
}

// Clips wider than this get compositor-friendly treatment (no shadow while
// dragging, hidden waveform ghost) so moving them stays at 60fps.
export const HUGE_CLIP_WIDTH_PX = 8000
// Local previews longer than this are deliberately skipped (see
// useWaveform): decoding needs the whole file in RAM.
export const MAX_LOCAL_WAVEFORM_SECONDS = 120
export const MAX_LOCAL_WAVEFORM_BYTES = 300 * 1024 * 1024
// Above this the clip counts as "very very large": the empty-waveform UI
// switches to its explicit large-media copy (incl. the 2GB server note).
export const VERY_LARGE_WAVEFORM_SECONDS = 600
export const SERVER_UPLOAD_LIMIT_LABEL = '2GB'

export type WaveformUnavailableReason = 'too-long' | 'too-large' | 'undecodable' | 'empty'

export interface WaveformLoadResult {
  data: WaveformData | null
  reason: WaveformUnavailableReason | null
  sizeBytes: number | null
}

export function classifyLocalWaveformSkip(
  sourceDuration: number,
  sizeBytes: number | null,
): WaveformUnavailableReason | null {
  if (sourceDuration > MAX_LOCAL_WAVEFORM_SECONDS) return 'too-long'
  if (sizeBytes !== null && sizeBytes > MAX_LOCAL_WAVEFORM_BYTES) return 'too-large'
  return null
}

export function isVeryLargeWaveformSource(sourceDuration: number, sizeBytes: number | null): boolean {
  if (sourceDuration > VERY_LARGE_WAVEFORM_SECONDS) return true
  if (sizeBytes !== null && sizeBytes > MAX_LOCAL_WAVEFORM_BYTES) return true
  return false
}

export function formatMediaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatClockDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const seconds = Math.floor(totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

export interface WaveformPeaks { binSamples: number; totalBins: number; min: Float32Array; max: Float32Array }
export interface WaveformData { sampleRate: number; length: number; peaks: WaveformPeaks }

export function computeWaveformPeaks(buffer: AudioBuffer): WaveformPeaks {
  const binSamples = Math.max(1, Math.round(buffer.sampleRate * PEAK_BIN_SECONDS))
  const totalBins = Math.ceil(buffer.length / binSamples)
  const min = new Float32Array(totalBins)
  const max = new Float32Array(totalBins)
  const first = buffer.getChannelData(0)
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  for (let bin = 0; bin < totalBins; bin++) {
    const start = bin * binSamples
    const end = Math.min(buffer.length, start + binSamples)
    let low = 0
    let high = 0
    for (let index = start; index < end; index++) {
      const value = second ? (first[index] + second[index]) / 2 : first[index]
      if (value < low) low = value
      if (value > high) high = value
    }
    min[bin] = low
    max[bin] = high
  }
  return { binSamples, totalBins, min, max }
}
