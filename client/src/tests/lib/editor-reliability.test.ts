import { describe, expect, it, vi } from 'vitest'
import { activeTimedItems, indexTimedItems } from '../../lib/timed-index'
import { jobsForCategory, type JobSummary } from '../../lib/job-monitor'
import { validateReplacement } from '../../lib/relink-media'
import { textFontsReady, loadTextFont, textFontCSS } from '../../lib/text-render'
import { editor } from '../../stores/editor.svelte'

describe('large-project reliability', () => {
  it('finds active cues with overlaps, exact endpoints and original stacking order', () => {
    const items = [{ id: 'top', start: 2, duration: 3 }, { id: 'bottom', start: 0, duration: 10 }, { id: 'next', start: 5, duration: 1 }]
    const index = indexTimedItems(items)
    expect(activeTimedItems(index, 2).map(item => item.id)).toEqual(['top', 'bottom'])
    expect(activeTimedItems(index, 5).map(item => item.id)).toEqual(['bottom', 'next'])
    expect(activeTimedItems(index, 10)).toEqual([])
    expect(items[0].id).toBe('top')
  })

  it('matches a full scan across 10,000 measured cues without changing them', () => {
    const items = Array.from({ length: 10_000 }, (_, id) => ({ id, start: id * 2, duration: 1.8 }))
    const baseline = JSON.stringify(items)
    const index = indexTimedItems(items)
    for (const time of [0, 1.8, 200, 9999.5, 19_998, 20_000]) {
      expect(activeTimedItems(index, time)).toEqual(items.filter(item => time >= item.start && time < item.start + item.duration))
    }
    expect(JSON.stringify(items)).toBe(baseline)
  })

  it('keeps AI activity out of the default exports list without deleting recovery records', () => {
    const jobs = [{ kind: 'render' }, { kind: 'ai-speech' }, { kind: 'scene-compile' }, { kind: 'automation-render' }] as JobSummary[]
    expect(jobsForCategory(jobs, 'renders').map(job => job.kind)).toEqual(['render', 'automation-render'])
    expect(jobsForCategory(jobs, 'ai')).toHaveLength(2)
    expect(jobsForCategory(jobs, 'all')).toHaveLength(4)
  })

  it('rejects a replacement that would crop the source window or change dimensions', () => {
    const source = { id: 'v', name: 'v.mp4', kind: 'video' as const, duration: 12, width: 1920, height: 1080 }
    expect(() => validateReplacement(source, { duration: 4, width: 1920, height: 1080 }, 10)).toThrow('too short')
    expect(() => validateReplacement(source, { duration: 12, width: 1280, height: 720 }, 10)).toThrow('dimensions')
    expect(() => validateReplacement(source, { duration: 12, width: 1920, height: 1080 }, 10)).not.toThrow()
  })

  it('supports browsers without FontFaceSet and reports font failures without an unhandled rejection', async () => {
    const item = editor.addTextItem(0, { text: 'Știință și țară!', fontFamily: 'montserrat' })
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    try {
      Object.defineProperty(document, 'fonts', { configurable: true, value: undefined })
      expect(textFontsReady(item)).toBe(true)
      await expect(loadTextFont(item)).resolves.toEqual([])
      const load = vi.fn().mockRejectedValue(new Error('low-memory font failure'))
      Object.defineProperty(document, 'fonts', { configurable: true, value: { check: () => false, load } })
      const first = loadTextFont(item)
      expect(loadTextFont(item)).toBe(first)
      await expect(first).rejects.toThrow('font failure')
      expect(textFontsReady(item)).toBe(true)
      expect(textFontCSS(item)).toContain('Montserrat')
      expect(item.text).toBe('Știință și țară!')
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
      editor.removeTextItem(item.id)
    }
  })
})
