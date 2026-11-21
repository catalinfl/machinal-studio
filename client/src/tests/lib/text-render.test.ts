import { describe, expect, it, vi } from 'vitest'
import { activeCaptionWordIndex, activeCaptionWordState, buildRenderTextPayloads, highlightWordScale, highlightWordYOffsetRatio, rasterizeTextCanvas, textAnimationOffset, textAnimationYOffset, textItemSignature } from '../../lib/text-render'
import { wordAnimationOption } from '../../lib/text-presets'
import { editor } from '../../stores/editor.svelte'

describe('caption text rendering', () => {
  it('tracks the active word from timeline time and changes the raster signature only at word boundaries', () => {
    const item = editor.addTextItem(5, {
      text: 'Hello world',
      duration: 2,
      isCaption: true,
      highlightMode: 'word',
      words: [
        { text: 'Hello', start: 0, end: 0.8 },
        { text: 'world', start: 1, end: 2 },
      ],
    })

    expect(activeCaptionWordIndex(item, 4.99)).toBe(-1)
    expect(activeCaptionWordIndex(item, 5.4)).toBe(0)
    expect(activeCaptionWordIndex(item, 5.9)).toBe(0)
    expect(activeCaptionWordIndex(item, 6)).toBe(1)
    expect(activeCaptionWordIndex(item, 6.2)).toBe(1)
    expect(activeCaptionWordIndex(item, 7)).toBe(-1)
    expect(textItemSignature(item, 1, 0)).not.toBe(textItemSignature(item, 1, 1))

    editor.removeTextItem(item.id)
  })

  it('holds the last spoken word through gaps and the cue tail without moving measured word times', () => {
    const item = editor.addTextItem(10, {
      text: 'Un test continuu', duration: 2, isCaption: true, highlightMode: 'word',
      words: [
        { text: 'Un', start: 0.1, end: 0.3 },
        { text: 'test', start: 0.305, end: 0.5 },
        { text: 'continuu', start: 0.9, end: 1.4 },
      ],
    })
    const original = JSON.stringify(item)
    try {
      expect(activeCaptionWordIndex(item, 10.099)).toBe(-1)
      expect(activeCaptionWordIndex(item, 10.1)).toBe(0)
      expect(activeCaptionWordIndex(item, 10.304999)).toBe(0)
      expect(activeCaptionWordState(item, 10.305)).toEqual({ index: 1, progress: 0 })
      expect(activeCaptionWordState(item, 10.899)).toEqual({ index: 1, progress: 1 })
      expect(activeCaptionWordState(item, 10.9)).toEqual({ index: 2, progress: 0 })
      expect(activeCaptionWordState(item, 11.999)).toEqual({ index: 2, progress: 1 })
      expect(activeCaptionWordIndex(item, 12)).toBe(-1)
      expect(JSON.stringify(item)).toBe(original)
    } finally {
      editor.removeTextItem(item.id)
    }
  })

  it('settles the highlighted word at normal size without changing the rest of the caption', () => {
    const scale = vi.fn()
    const fillText = vi.fn()
    const context = {
      font: '', textAlign: 'left', textBaseline: 'middle', lineJoin: 'round', globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText, strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), scale,
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const item = editor.addTextItem(0, {
      text: 'Hello world',
      isCaption: true,
      highlightMode: 'word',
      highlightAnimation: 'pop',
      words: [{ text: 'Hello', start: 0, end: 1 }],
    })

    try {
      rasterizeTextCanvas(item, 1, { activeWordIndex: 0 })

      expect(scale).toHaveBeenCalledOnce()
      expect(scale).toHaveBeenCalledWith(1, 1)
      expect(fillText).toHaveBeenCalledWith('Hello', 0, 0)
      expect(fillText).toHaveBeenCalledWith('world', expect.any(Number), expect.any(Number))
    } finally {
      getContext.mockRestore()
      editor.removeTextItem(item.id)
    }
  })

  it('keeps the canvas and neighboring words fixed throughout the pop and word change', () => {
    const fillText = vi.fn()
    const translate = vi.fn()
    const context = {
      font: '', textAlign: 'left', textBaseline: 'middle', lineJoin: 'round', globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText, strokeText: vi.fn(), translate, rotate: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const item = editor.addTextItem(0, {
      text: 'Hello world\nSecond line', isCaption: true, highlightMode: 'word', highlightAnimation: 'pop',
      words: [
        { text: 'Hello', start: 0, end: 0.8 }, { text: 'world', start: 0.8, end: 1.6 },
        { text: 'Second', start: 1.6, end: 2.4 }, { text: 'line', start: 2.4, end: 3.2 },
      ],
    })

    try {
      const positions = [0, 0.4, 1].map((progress) => {
        fillText.mockClear()
        translate.mockClear()
        const canvas = rasterizeTextCanvas(item, 1, { activeWordIndex: 0, activeWordProgress: progress })
        return { width: canvas.width, height: canvas.height, word: fillText.mock.calls.find(([text]) => text === 'world'), active: translate.mock.calls[0] }
      })
      expect(positions[1]).toEqual(positions[0])
      expect(positions[2]).toEqual(positions[0])

      translate.mockClear()
      const nextWord = rasterizeTextCanvas(item, 1, { activeWordIndex: 1, activeWordProgress: 0.4 })
      expect([nextWord.width, nextWord.height]).toEqual([positions[0].width, positions[0].height])
      expect(translate.mock.calls[0][0]).toBeCloseTo(positions[0].word![1] + 'world'.length * 10)
      for (const activeWordIndex of [-1, 2, 3]) {
        fillText.mockClear()
        const canvas = rasterizeTextCanvas(item, 1, { activeWordIndex, activeWordProgress: 1 })
        expect([canvas.width, canvas.height]).toEqual([positions[0].width, positions[0].height])
        expect(fillText.mock.calls.find(([text]) => text === 'world')).toEqual(positions[0].word)
        expect(fillText.mock.calls.map(([text]) => text)).toEqual(['Hello', 'world', 'Second', 'line'])
      }
    } finally {
      getContext.mockRestore()
      editor.removeTextItem(item.id)
    }
  })

  it('exports mutually exclusive full-caption frames for highlighted words', async () => {
    const scale = vi.fn()
    const context = {
      font: '', textAlign: 'left', textBaseline: 'middle', lineJoin: 'round', globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), scale,
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
    const item = editor.addTextItem(5, {
      text: 'Hello world',
      duration: 2,
      isCaption: true,
      highlightMode: 'word',
      highlightAnimation: 'pop',
      words: [
        { text: 'Hello', start: 0, end: 0.8 },
        { text: 'world', start: 1, end: 2 },
      ],
    })

    try {
      const payloads = await buildRenderTextPayloads(item, 1920, 1080, 'landscape')

      expect(payloads).toHaveLength(16)
      expect(payloads[0].start).toBe(5)
      expect(payloads[0].duration).toBeCloseTo(1 / 30)
      expect(payloads[6].start).toBeCloseTo(5.2)
      expect(payloads[7]).toMatchObject({ start: 5.22 })
      expect(payloads[8]).toMatchObject({ start: 6 })
      expect(payloads[15]).toMatchObject({ start: 6.22 })
      expect(new Set(scale.mock.calls.slice(0, 7).map(([amount]) => amount)).size).toBeGreaterThan(3)
      expect(scale.mock.calls[7][0]).toBe(1)
      expect(payloads.every((payload, index) => (
        index === 0 || payload.start >= payloads[index - 1].start + payloads[index - 1].duration - 0.000001
      ))).toBe(true)
      const serialized = payloads.map(({ start, duration }) => ({
        start: Math.round(start * 1_000_000), duration: Math.round(duration * 1_000_000),
      }))
      for (let index = 1; index < serialized.length; index++) {
        expect(serialized[index].start).toBe(serialized[index - 1].start + serialized[index - 1].duration)
      }
      for (const fps of [24, 25, 30, 60]) {
        const ranges = serialized.map(({ start, duration }) => ({
          start: Math.ceil(start / 1_000_000 * fps - 1e-9),
          end: Math.ceil((start + duration) / 1_000_000 * fps - 1e-9),
        }))
        for (let frame = 5 * fps; frame < 7 * fps; frame++) {
          expect(ranges.filter(({ start, end }) => frame >= start && frame < end), `fps=${fps}, frame=${frame}`).toHaveLength(1)
        }
      }
    } finally {
      toBlob.mockRestore()
      getContext.mockRestore()
      editor.removeTextItem(item.id)
    }
  })

  it('moves animated text fully offscreen at both ends and rests at its target', () => {
    const left = { start: 2, duration: 3, animation: 'slide-left' as const, animationDuration: 0.5 }
    const right = { ...left, animation: 'slide-right' as const }

    expect(textAnimationOffset(left, 2, 1920, 300, 120)).toBe(-420)
    expect(textAnimationOffset(left, 2.5, 1920, 300, 120)).toBe(0)
    expect(textAnimationOffset(left, 5, 1920, 300, 120)).toBe(-420)
    expect(textAnimationOffset(right, 2, 1920, 300, 120)).toBe(1800)
  })

  it('settles short-form text vertically and returns it below frame at the end', () => {
    const rise = { start: 2, duration: 3, animation: 'rise' as const, animationDuration: 0.5 }
    const pop = { ...rise, animation: 'pop' as const }

    expect(textAnimationYOffset(rise, 2, 1080)).toBeCloseTo(129.6)
    expect(textAnimationYOffset(rise, 2.5, 1080)).toBe(0)
    expect(textAnimationYOffset(rise, 5, 1080)).toBeCloseTo(129.6)
    expect(textAnimationYOffset(pop, 2, 1080)).toBeCloseTo(75.6)
    expect(textAnimationOffset(pop, 2, 1920, 300, 120)).toBe(0)
  })

  it('previews drop, bounce, shake and float motion with distinct trajectories', () => {
    const base = { start: 2, duration: 3, animationDuration: 0.5 }
    const drop = { ...base, animation: 'drop' as const }
    const bounce = { ...base, animation: 'bounce' as const }
    const shake = { ...base, animation: 'shake' as const }
    const float = { ...base, animation: 'float' as const }

    expect(textAnimationYOffset(drop, 2, 1080)).toBeCloseTo(-129.6)
    expect(textAnimationYOffset(drop, 5, 1080)).toBeCloseTo(-129.6)
    expect(textAnimationYOffset(bounce, 2, 1080)).toBeCloseTo(86.4)
    expect(textAnimationYOffset(bounce, 2.5, 1080)).toBe(0)
    expect(textAnimationOffset(shake, 2, 1920, 300, 120)).toBeCloseTo(-24)
    expect(textAnimationOffset(shake, 2.5, 1920, 300, 120)).toBe(0)
    expect(textAnimationYOffset(float, 2, 1080)).toBeCloseTo(27)
    expect(textAnimationYOffset(float, 3.5, 1080)).toBe(0)
    expect(textAnimationYOffset(float, 5, 1080)).toBeCloseTo(-27)
  })

  it('exposes the TikTok word-motion catalog', () => {
    expect(wordAnimationOption('pop').label).toBe('TikTok pop')
    expect(wordAnimationOption('bounce').label).toBe('Bounce')
    expect(wordAnimationOption('slide-up').label).toBe('Slide up')
    expect(wordAnimationOption('glow').label).toBe('Glow')
    expect(wordAnimationOption('none').label).toBe('Off')
    expect(wordAnimationOption(undefined).id).toBe('pop')
  })

  it('tracks per-word progress with a brief accent that settles at normal size', () => {
    const item = editor.addTextItem(10, {
      text: 'Hello world',
      duration: 2,
      isCaption: true,
      highlightMode: 'word',
      highlightAnimation: 'pop',
      words: [
        { text: 'Hello', start: 0, end: 0.8 },
        { text: 'world', start: 1, end: 2 },
      ],
    })
    try {
      expect(activeCaptionWordState(item, 10.1)).toMatchObject({ index: 0 })
      expect(activeCaptionWordState(item, 10.1).progress).toBeGreaterThan(0)
      expect(activeCaptionWordState(item, 10.1).progress).toBeLessThan(1)
      expect(activeCaptionWordState(item, 10.9)).toEqual({ index: 0, progress: 1 })
      expect(activeCaptionWordState(item, 10.1).progress).toBeCloseTo(0.1 / 0.22)
      expect(activeCaptionWordState(item, 10.4).progress).toBe(1)
      expect(highlightWordScale('pop', 0)).toBe(1)
      expect(highlightWordScale('pop', 0.4)).toBeCloseTo(1.06)
      expect(highlightWordScale('pop', 1)).toBe(1)
      expect(highlightWordScale('bounce', 1)).toBe(1)
      expect(highlightWordScale('slide-up', 1)).toBe(1)
      expect(highlightWordScale('glow', 1)).toBe(1)
      expect(highlightWordScale('none', 0.5)).toBe(1)
      expect(highlightWordYOffsetRatio('slide-up', 0)).toBeCloseTo(0.38)
      expect(highlightWordYOffsetRatio('slide-up', 1)).toBeCloseTo(0)
      expect(highlightWordYOffsetRatio('pop', 0.5)).toBe(0)
      // Progress changes the raster signature so the preview re-renders mid-word.
      expect(textItemSignature(item, 1, 0, 0)).not.toBe(textItemSignature(item, 1, 0, 1))
    } finally {
      editor.removeTextItem(item.id)
    }
  })

  it('paints a background pill behind the active word when enabled', () => {
    const fill = vi.fn()
    const context = {
      font: '', textAlign: 'left', textBaseline: 'middle', lineJoin: 'round', globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill, fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const item = editor.addTextItem(0, {
      text: 'Hello world',
      isCaption: true,
      highlightMode: 'word',
      highlightColor: '#121318',
      highlightBackgroundColor: '#f4ea58',
      highlightBackgroundOpacity: 1,
      highlightAnimation: 'none',
      words: [{ text: 'Hello', start: 0, end: 1 }],
    })
    try {
      rasterizeTextCanvas(item, 1, { activeWordIndex: 0, activeWordProgress: 1 })
      expect(fill).toHaveBeenCalled()
    } finally {
      getContext.mockRestore()
      editor.removeTextItem(item.id)
    }
  })

  it('keeps the active-word outline at its designed thickness while popped', () => {
    let outlinedWidth = -1
    const context = {
      font: '', textAlign: 'left', textBaseline: 'middle', lineJoin: 'round', globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 0, shadowColor: '', shadowBlur: 0,
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    vi.mocked(context.strokeText).mockImplementation(((text: string) => {
      if (text === 'Hello') outlinedWidth = context.lineWidth
    }) as unknown as typeof context.strokeText)
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext)
    const item = editor.addTextItem(0, {
      text: 'Hello world',
      isCaption: true,
      highlightMode: 'word',
      highlightAnimation: 'pop',
      strokeWidth: 6,
      words: [{ text: 'Hello', start: 0, end: 1 }],
    })
    try {
      rasterizeTextCanvas(item, 1, { activeWordIndex: 0, activeWordProgress: 0.4 })
      expect(outlinedWidth).toBeCloseTo(12 / 1.06)
    } finally {
      getContext.mockRestore()
      editor.removeTextItem(item.id)
    }
  })
})
