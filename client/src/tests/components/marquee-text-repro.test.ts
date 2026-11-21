import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import Timeline from '../../components/Timeline.svelte'
import { editor, type Clip } from '../../stores/editor.svelte'

vi.mock('../../lib/wasm', () => ({
  getFFmpeg: vi.fn().mockResolvedValue(undefined),
  renderSegment: vi.fn(),
  extractAudio: vi.fn().mockResolvedValue({ blobUrl: 'blob:audio', blob: {} }),
}))
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  compileProject: vi.fn(),
}))
vi.mock('../../lib/local-render', () => ({
  compileProjectLocal: vi.fn(),
}))

function mockRect(el: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300, x: 0, y: 0, toJSON: () => ({}),
      ...rect,
    }),
  })
}

function addClip(channelId: string, over: Partial<Clip> = {}): Clip {
  return editor.addClip(channelId, {
    fileName: 'test.mp4',
    scrubBlobUrl: 'blob:abc',
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
    ...over,
  })
}

describe('marquee text repro', () => {
  beforeEach(() => {
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.selectClip(null)
    editor.setCurrentTime(0)
    editor.setPlaying(false)
    editor.setFps(30)
    editor.setPixelsPerSecond(40)
    editor.setResolution('1080p')
    editor.resetProjectAspect()
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    editor.clearHistory()
  })

  it('selects clips and text together with marquee', async () => {
    const clip = addClip(editor.channels[0].id, { start: 0 })
    const text = editor.addTextItem(0, { text: 'Title', duration: 3 })
    const { container } = render(Timeline)
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    const textEl = container.querySelector<HTMLElement>(`[data-timeline-text-id="${text.id}"]`)!
    expect(textEl).toBeTruthy()

    mockRect(clipEl, { left: 100, right: 300, top: 150, bottom: 200, width: 200, height: 50 })
    mockRect(textEl, { left: 110, right: 230, top: 20, bottom: 55, width: 120, height: 35 })

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, {
      button: 0,
      pointerId: 1,
      clientX: 90,
      clientY: 15,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 210 })

    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.selectedTextItemIds).toEqual([text.id])
  })

  it('drags a marquee-selected clip with text to the left as one group', async () => {
    const clip = addClip(editor.channels[0].id, { start: 4 })
    const text = editor.addTextItem(4, { text: 'Title', duration: 2 })
    const { container } = render(Timeline)
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    const textEl = container.querySelector<HTMLElement>(`[data-timeline-text-id="${text.id}"]`)!
    mockRect(clipEl, { left: 420, right: 620, top: 150, bottom: 200, width: 200, height: 50 })
    mockRect(textEl, { left: 430, right: 510, top: 20, bottom: 55, width: 80, height: 35 })

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, {
      button: 0,
      pointerId: 1,
      clientX: 400,
      clientY: 15,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 640, clientY: 210 })
    await fireEvent.pointerUp(window, { pointerId: 1 })
    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.selectedTextItemIds).toEqual([text.id])

    await fireEvent.mouseDown(clipEl, { clientX: 500, clientY: 50 })
    await fireEvent.mouseMove(window, { clientX: 420, clientY: 50 })
    await fireEvent.mouseUp(window, { clientX: 420, clientY: 50 })

    expect(editor.getClipById(clip.id)!.clip.start).toBe(2)
    expect(editor.textItems.find((item) => item.id === text.id)!.start).toBe(2)
  })

  it('drags a ctrl+click-selected text block left together with the clip', async () => {
    const clip = addClip(editor.channels[0].id, { start: 4 })
    const text = editor.addTextItem(4, { text: 'Title', duration: 2 })
    const { container } = render(Timeline)
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    const textEl = container.querySelector<HTMLElement>(`[data-timeline-text-id="${text.id}"]`)!

    await fireEvent.mouseDown(clipEl, { clientX: 500, clientY: 50 })
    await fireEvent.mouseUp(window, { clientX: 500, clientY: 50 })
    await fireEvent.mouseDown(textEl, { clientX: 450, clientY: 30, ctrlKey: true })
    await fireEvent.mouseUp(window, { clientX: 450, clientY: 30 })
    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.selectedTextItemIds).toEqual([text.id])

    await fireEvent.mouseDown(clipEl, { clientX: 500, clientY: 50 })
    await fireEvent.mouseMove(window, { clientX: 420, clientY: 50 })
    await fireEvent.mouseUp(window, { clientX: 420, clientY: 50 })

    expect(editor.getClipById(clip.id)!.clip.start).toBe(2)
    expect(editor.textItems.find((item) => item.id === text.id)!.start).toBe(2)
  })

  it('drags a mixed selection from the selected text block', async () => {
    const clip = addClip(editor.channels[0].id, { start: 4 })
    const text = editor.addTextItem(4, { text: 'Title', duration: 2 })
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 4, 2)!
    editor.selectItems([clip.id], [block.id], [text.id])
    const { container } = render(Timeline)
    const textEl = container.querySelector<HTMLElement>(`[data-timeline-text-id="${text.id}"]`)!

    await fireEvent.mouseDown(textEl, { clientX: 500, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 420, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 420, clientY: 30 })

    expect(editor.getClipById(clip.id)!.clip.start).toBe(2)
    expect(editor.effectBlocks.find((item) => item.id === block.id)!.start).toBe(2)
    expect(editor.textItems.find((item) => item.id === text.id)!.start).toBe(2)
  })

  it('does not snap a text-led selection to its own selected clip', async () => {
    const clip = addClip(editor.channels[0].id, { start: 4 })
    const text = editor.addTextItem(4, { text: 'Title', duration: 2 })
    editor.selectItems([clip.id], [], [text.id])
    const { container } = render(Timeline)
    const textEl = container.querySelector<HTMLElement>(`[data-timeline-text-id="${text.id}"]`)!

    await fireEvent.mouseDown(textEl, { clientX: 500, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 502, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 502, clientY: 30 })

    expect(editor.getClipById(clip.id)!.clip.start).toBeCloseTo(4.05)
    expect(editor.textItems.find((item) => item.id === text.id)!.start).toBeCloseTo(4.05)
  })

  it('does not snap an effect-led selection to its own selected clip', async () => {
    const clip = addClip(editor.channels[0].id, { start: 4 })
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 4, 2)!
    editor.selectItems([clip.id], [block.id])
    const { container } = render(Timeline)
    const effectEl = container.querySelector<HTMLElement>(`[data-timeline-effect-id="${block.id}"]`)!

    await fireEvent.mouseDown(effectEl, { clientX: 500, clientY: 100 })
    await fireEvent.mouseMove(window, { clientX: 502, clientY: 100 })
    await fireEvent.mouseUp(window, { clientX: 502, clientY: 100 })

    expect(editor.getClipById(clip.id)!.clip.start).toBeCloseTo(4.05)
    expect(editor.effectBlocks.find((item) => item.id === block.id)!.start).toBeCloseTo(4.05)
  })
})
