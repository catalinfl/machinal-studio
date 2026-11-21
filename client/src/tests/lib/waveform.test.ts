import { describe, it, expect } from 'vitest'
import {
  MAX_LOCAL_WAVEFORM_BYTES,
  classifyLocalWaveformSkip,
  formatClockDuration,
  formatMediaBytes,
  isVeryLargeWaveformSource,
  waveformTiles,
} from '../../lib/waveform'

describe('waveform tiles', () => {
  it('allocates only visible, bounded tiles for a 58-minute clip', () => {
    const tiles = waveformTiles(3480 * 40, { start: 100000, end: 102500 })
    expect(tiles.map(tile => tile.left)).toEqual([99328, 100352, 101376, 102400])
    expect(tiles.every(tile => tile.width === 1024)).toBe(true)
  })

  it('keeps the final partial tile and avoids off-clip canvases', () => {
    expect(waveformTiles(2200, { start: 2000, end: 3000 })).toEqual([
      { left: 1024, width: 1024 }, { left: 2048, width: 152 },
    ])
    expect(waveformTiles(2200, { start: 3000, end: 4000 })).toEqual([])
    expect(waveformTiles(0)).toEqual([])
  })
})

describe('classifyLocalWaveformSkip', () => {
  it('skips previews longer than the local decode budget', () => {
    expect(classifyLocalWaveformSkip(3480, null)).toBe('too-long')
    expect(classifyLocalWaveformSkip(121, 1024)).toBe('too-long')
  })

  it('skips files larger than the local byte budget', () => {
    expect(classifyLocalWaveformSkip(60, MAX_LOCAL_WAVEFORM_BYTES + 1)).toBe('too-large')
  })

  it('allows ordinary local media', () => {
    expect(classifyLocalWaveformSkip(60, 1024)).toBeNull()
    expect(classifyLocalWaveformSkip(120, MAX_LOCAL_WAVEFORM_BYTES)).toBeNull()
  })
})

describe('isVeryLargeWaveformSource', () => {
  it('flags a 58-minute local file as very large', () => {
    expect(isVeryLargeWaveformSource(3480, null)).toBe(true)
  })

  it('flags oversized byte counts even for short media', () => {
    expect(isVeryLargeWaveformSource(60, MAX_LOCAL_WAVEFORM_BYTES + 1)).toBe(true)
  })

  it('does not flag ordinary local media', () => {
    expect(isVeryLargeWaveformSource(90, 1024)).toBe(false)
  })
})

describe('formatMediaBytes', () => {
  it('formats bytes, megabytes and gigabytes', () => {
    expect(formatMediaBytes(512)).toBe('512 B')
    expect(formatMediaBytes(1536)).toBe('1.5 KB')
    expect(formatMediaBytes(300 * 1024 * 1024)).toBe('300 MB')
    expect(formatMediaBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })
})

describe('formatClockDuration', () => {
  it('formats a 58-minute source as 58:00', () => {
    expect(formatClockDuration(3480)).toBe('58:00')
  })

  it('includes hours for very long sources', () => {
    expect(formatClockDuration(3723)).toBe('1:02:03')
  })
})
