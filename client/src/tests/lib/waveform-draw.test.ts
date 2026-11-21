import { describe, expect, it, vi } from 'vitest'
import { drawWaveformTile } from '../../lib/waveform-draw'

describe('waveform tile drawing', () => {
  it('draws a late tile at native resolution using its absolute source window', () => {
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'clientHeight', { value: 54 })
    const fillRect = vi.fn()
    const setTransform = vi.fn()
    vi.spyOn(canvas, 'getContext').mockReturnValue({ fillRect, setTransform, clearRect() {}, fillStyle: '' } as unknown as never)
    const max = new Float32Array(5000)
    max[1124] = 0.4
    drawWaveformTile(canvas, { left: 1024, width: 1024 }, {
      sampleRate: 1, length: 5000, peaks: { binSamples: 1, totalBins: 5000, min: new Float32Array(5000), max },
    }, { width: 4096, inPoint: 100, outPoint: 4196, volume: 100, dragging: false })
    expect(canvas.width).toBeGreaterThanOrEqual(1024)
    expect(canvas.width).toBeLessThanOrEqual(1536)
    expect(setTransform.mock.calls[0][0]).toBeGreaterThanOrEqual(1)
    expect(fillRect).toHaveBeenCalledTimes(512)
    expect(fillRect.mock.calls[0][3]).toBeGreaterThan(10)
    expect(fillRect.mock.calls[1][3]).toBe(1)
  })
})
