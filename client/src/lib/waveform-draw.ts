import { MAX_CANVAS_DPR, WAVEFORM_BAR_WIDTH, type WaveformData, type WaveformTile } from './waveform'

export interface WaveformDrawOptions {
  width: number
  inPoint: number
  outPoint: number
  volume: number
  dragging: boolean
}

export function drawWaveformTile(canvas: HTMLCanvasElement, tile: WaveformTile, data: WaveformData | null, options: WaveformDrawOptions): void {
  const height = canvas.clientHeight
  if (height <= 0) return
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR)
  const pixelWidth = Math.max(1, Math.round(tile.width * dpr))
  const pixelHeight = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(pixelWidth / tile.width, 0, 0, pixelHeight / height, 0, 0)
  context.clearRect(0, 0, tile.width, height)
  const styles = getComputedStyle(canvas)
  const color = styles.getPropertyValue('--waveform-color').trim() || 'currentColor'
  const muted = styles.getPropertyValue('--waveform-muted').trim() || 'currentColor'
  const hot = styles.getPropertyValue('--waveform-hot').trim() || 'Highlight'
  if (!data) {
    context.fillStyle = muted
    context.fillRect(0, height / 2 - 0.5, tile.width, 1)
    return
  }
  const { peaks, sampleRate } = data
  const middle = height / 2
  const amplitude = Math.max(0, middle - 1) * 0.75 * options.volume / 100
  const samplesPerPixel = (options.outPoint - options.inPoint) * sampleRate / options.width
  context.fillStyle = options.volume > 100 && options.dragging ? hot : color
  for (let x = 0; x < tile.width; x += WAVEFORM_BAR_WIDTH) {
    const fromSample = Math.max(0, options.inPoint * sampleRate + (tile.left + x) * samplesPerPixel)
    const toSample = Math.min(data.length, options.inPoint * sampleRate + (tile.left + Math.min(tile.width, x + WAVEFORM_BAR_WIDTH)) * samplesPerPixel)
    if (fromSample >= data.length || toSample <= fromSample) continue
    const first = Math.floor(fromSample / peaks.binSamples)
    const last = Math.min(peaks.totalBins, Math.max(first + 1, Math.ceil(toSample / peaks.binSamples)))
    let low = 0
    let high = 0
    for (let bin = first; bin < last; bin++) {
      low = Math.min(low, peaks.min[bin])
      high = Math.max(high, peaks.max[bin])
    }
    low = Math.max(-1, low * 2.5)
    high = Math.min(1, high * 2.5)
    context.fillRect(x, middle - high * amplitude, Math.min(WAVEFORM_BAR_WIDTH, tile.width - x), Math.max(1, (high - low) * amplitude))
  }
}
