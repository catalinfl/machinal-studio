import { describe, expect, it } from 'vitest'
import { fitCaptionLayout } from '../../lib/caption-layout'
import { textDesignSize, textSafeInsets } from '../../lib/text-geometry'
import type { TextItem } from '../../stores/editor.svelte'

const measure = (text: string, size: number) => text.length * size * 0.6
const caption = {
  text: 'Călătorind printre asteroizi, prințul descoperă',
  isCaption: true, fontSize: 58, strokeWidth: 3,
  backgroundOpacity: 0.85, backgroundPadding: 20,
  highlightMode: 'word', x: 1040, y: 1880,
  words: [{ text: 'Călătorind', start: 0, end: 0.6 }],
} as TextItem

describe('caption safe-area layout', () => {
  it('fits long portrait captions into two measured lines without changing word timings', () => {
    const fitted = fitCaptionLayout(caption, 'portrait', measure)
    expect(fitted.text.split('\n').length).toBeLessThanOrEqual(2)
    expect(fitted.text.replace(/\s+/g, ' ')).toBe(caption.text)
    expect(fitted.words).toBe(caption.words)
    expect(caption.x).toBe(1040)
    const design = textDesignSize('portrait')
    const safe = textSafeInsets('portrait')
    const width = Math.max(...fitted.text.split('\n').map(line => measure(line, fitted.fontSize)))
    expect(fitted.x - width / 2).toBeGreaterThanOrEqual(safe.left)
    expect(fitted.x + width / 2).toBeLessThanOrEqual(design.w - safe.right)
    expect(fitted.y).toBeLessThan(design.h - safe.bottom)
  })

  it('does not change ordinary titles or their deliberate positioning', () => {
    const title = { ...caption, isCaption: false }
    expect(fitCaptionLayout(title, 'portrait', measure)).toBe(title)
  })

  it('shrinks a long unbreakable word instead of clipping the image', () => {
    const fitted = fitCaptionLayout({ ...caption, text: 'responsabilitateresponsabilitateresponsabilitate' }, 'portrait', measure)
    expect(fitted.fontSize).toBeLessThan(caption.fontSize)
    expect(fitted.text).not.toContain('\n')
  })

  it.each([undefined, Number.NaN, Infinity, 0])('rejects an invalid font size (%s) without looping or changing saved data', fontSize => {
    const item = { ...caption, fontSize } as TextItem
    const words = item.words
    expect(() => fitCaptionLayout(item, 'portrait', measure)).toThrow('incomplete or invalid')
    expect(item.fontSize).toBe(fontSize)
    expect(item.text).toBe(caption.text)
    expect(item.words).toBe(words)
  })

  it('bounds fitting even for an enormous finite font with unusable measurements', () => {
    let calls = 0
    const item = { ...caption, text: 'word', fontSize: 1e300 }
    expect(() => fitCaptionLayout(item, 'portrait', () => { calls++; return Infinity })).toThrow('safe limit')
    expect(calls).toBeLessThanOrEqual(256)
    expect(item.fontSize).toBe(1e300)
  })
})
