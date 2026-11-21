import { describe, expect, it } from 'vitest'
import nativeLedger from '../../../../packages/mcp-installer/library/hyperframes-native.json'
import { filterNativePorts, nativeCategories, nativePorts, nativePreviewSize } from '../../lib/native-gallery-catalog'

describe('native Svelte gallery catalog', () => {
  it('shows only verified native ports; pending and blocked entries stay hidden', () => {
    const expectedIds = nativeLedger.filter(port => port.status === 'ported').map(port => port.id)
    expect(nativePorts).toHaveLength(expectedIds.length)
    expect(new Set(nativePorts.map(port => port.id))).toEqual(new Set(expectedIds))
    expect(nativePorts.every(port => port.visualMode === '2d' || port.visualMode === '3d')).toBe(true)
  })

  it('filters by ID, label, and category', () => {
    expect(filterNativePorts(nativePorts, 'ai-answer-rank', 'all').map(port => port.id)).toEqual(['blocks-ai-answer-rank'])
    expect(filterNativePorts(nativePorts, '3d transitions', 'all')).toHaveLength(1)
    expect(filterNativePorts(nativePorts, '', 'examples').every(port => port.category === 'examples')).toBe(true)
    expect(nativeCategories[0]).toBe('all')
  })

  it('provides both verified preview aspect ratios with a full motion window', () => {
    expect(nativePreviewSize('landscape')).toMatchObject({ width: 1920, height: 1080, fps: 30, durationInFrames: 780 })
    expect(nativePreviewSize('portrait')).toMatchObject({ width: 1080, height: 1920, fps: 30, durationInFrames: 780 })
  })
})
