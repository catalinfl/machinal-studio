import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import ChannelRow from '../../components/ChannelRow.svelte'
import { editor } from '../../stores/editor.svelte'
import { scrubSettings } from '../../stores/scrub.svelte'
import * as api from '../../lib/api'
import { CLIP_LOOK_DRAG_MIME } from '../../lib/clip-looks'

function makeDataTransfer(data: Record<string, string> = {}): DataTransfer {
  return {
    getData: (type: string) => data[type] ?? '',
    setData: (type: string, val: string) => {
      data[type] = val
    },
    types: Object.keys(data),
    effectAllowed: 'copy',
    dropEffect: 'copy',
    files: [],
    items: [],
  } as unknown as DataTransfer
}

describe('ChannelRow', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.selectClip(null)
    editor.setCurrentTime(0)
    editor.setPixelsPerSecond(40)
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    scrubSettings.setMode('proxy')
  })

  it('renders with a drop zone aria-label', () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    expect(getByLabelText(`Drop zone: ${ch.name}`)).toBeTruthy()
  })

  it('renders only visible clips while preserving an offscreen selection', () => {
    const channel = editor.channels[0]
    const clips = Array.from({ length: 100 }, (_, index) => editor.addClip(channel.id, {
      fileName: `clip-${index}.mp4`,
      scrubBlobUrl: null,
      sourceDuration: 1,
      inPoint: 0,
      outPoint: 0.25,
      start: index,
    }))
    editor.selectClip(clips[99].id)

    const { container } = render(ChannelRow, {
      channel,
      visibleRange: { start: 0, end: 2 },
    })
    const renderedIds = Array.from(container.querySelectorAll<HTMLElement>('[data-timeline-clip-id]'))
      .map((element) => element.dataset.timelineClipId)

    expect(renderedIds).toHaveLength(4)
    expect(renderedIds).toContain(clips[99].id)
  })

  it('uses the full sourceDuration instead of capping to 5s', async () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'long.mp4',
        scrubBlobUrl: 'blob:long',
        sourceDuration: 41,
      }),
    })
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, right: 80, top: 0, bottom: 0, width: 80, height: 64, x: 0, y: 0, toJSON: () => ({}) }) as any,
    })
    Object.defineProperty(dropZone, 'scrollLeft', { configurable: true, value: 0 })
    await fireEvent.drop(dropZone, { dataTransfer: dt, clientX: 0 })
    await new Promise((r) => setTimeout(r, 0))
    const clip = editor.channels[0].clips[0]
    expect(clip.outPoint).toBe(41)
    expect(clip.sourceDuration).toBe(41)
  })

  it('aligns a dropped clip start with the dragged card left edge', async () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'dropped.mp4',
        scrubBlobUrl: 'blob:xyz',
        sourceDuration: 8,
        dragOffsetX: 40,
      }),
    })
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          left: 0,
          right: 80,
          top: 0,
          bottom: 0,
          width: 80,
          height: 64,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    Object.defineProperty(dropZone, 'scrollLeft', {
      configurable: true,
      value: 0,
    })
    const event = new MouseEvent('drop', {
      clientX: 160,
      bubbles: true,
      cancelable: true,
    })
    ;(event as MouseEvent & { dataTransfer: unknown }).dataTransfer = dt
    dropZone.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 0))
    expect(editor.channels[0].clips).toHaveLength(1)
    expect(editor.channels[0].clips[0].fileName).toBe('dropped.mp4')
    expect(editor.channels[0].clips[0].start).toBe(3)
    // full sourceDuration is used, not capped to 5
    expect(editor.channels[0].clips[0].outPoint).toBe(8)
  })

  it('moves a video drop to a new video channel above 50% overlap', async () => {
    const firstVideo = editor.channels[0]
    editor.addClip(firstVideo.id, {
      fileName: 'existing.mp4',
      mediaKind: 'video',
      scrubBlobUrl: 'blob:existing',
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const { getByLabelText } = render(ChannelRow, { channel: firstVideo })
    const dropZone = getByLabelText(`Drop zone: ${firstVideo.name}`)
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'dropped.mp4',
        mediaKind: 'video',
        scrubBlobUrl: 'blob:dropped',
        sourceDuration: 4,
      }),
    })

    await fireEvent.drop(dropZone, { dataTransfer: dt, clientX: 0 })

    const videoChannels = editor.channels.filter((channel) => channel.type === 'video')
    expect(videoChannels).toHaveLength(2)
    expect(firstVideo.clips.map((clip) => clip.fileName)).toEqual(['existing.mp4'])
    expect(videoChannels[1].clips.map((clip) => clip.fileName)).toEqual(['dropped.mp4'])
  })

  it('ignores drop with no payload', async () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    await fireEvent.drop(dropZone, { dataTransfer: makeDataTransfer() })
    expect(editor.channels[0].clips).toHaveLength(0)
  })

  it('ignores drop with invalid JSON', async () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({ 'application/x-cineedit-clip': 'not-json{' })
    await fireEvent.drop(dropZone, { dataTransfer: dt })
    expect(editor.channels[0].clips).toHaveLength(0)
  })

  it('rejects an audio asset on a video channel', async () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'music.mp3',
        mediaKind: 'audio',
        scrubBlobUrl: 'blob:music',
        sourceDuration: 4,
      }),
    })

    await fireEvent.drop(dropZone, { dataTransfer: dt, clientX: 0 })

    expect(editor.channels[0].clips).toHaveLength(0)
  })

  it('falls back to getScrubProxy when payload has no blobUrl', async () => {
    const ch = editor.channels[0]
    vi.spyOn(api, 'getScrubProxy').mockResolvedValue({
      blobUrl: 'blob:proxy',
      duration: 20,
    })
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({ fileName: 'no-blob.mp4', scrubMode: 'proxy' }),
    })
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          left: 0,
          right: 80,
          top: 0,
          bottom: 0,
          width: 80,
          height: 64,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    Object.defineProperty(dropZone, 'scrollLeft', {
      configurable: true,
      value: 0,
    })
    await fireEvent.drop(dropZone, { dataTransfer: dt, clientX: 0 })
    await new Promise((r) => setTimeout(r, 10))
    expect(api.getScrubProxy).toHaveBeenCalledWith('no-blob.mp4', 'landscape')
    expect(editor.channels[0].clips.length).toBe(1)
    expect(editor.channels[0].clips[0].scrubBlobUrl).toBe('blob:proxy')
    expect(editor.channels[0].clips[0].outPoint).toBe(20)
    vi.restoreAllMocks()
  })

  it('refuses dragover on a locked channel', async () => {
    editor.toggleLock(editor.channels[0].id)
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({ 'application/x-cineedit-clip': 'x' })
    const event = new Event('dragover', { bubbles: true });
    (event as any).dataTransfer = dt as DataTransfer
    const spy = vi.spyOn(event, 'preventDefault')
    dropZone.dispatchEvent(event)
    expect(spy).not.toHaveBeenCalled()
  })

  it('drops an effect at the pointer position on a video channel', async () => {
    const ch = editor.channels[0]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, right: 500, top: 0, bottom: 64, width: 400, height: 64, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
    })
    const dt = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia' }),
    })
    const event = new MouseEvent('drop', { clientX: 220, bubbles: true, cancelable: true })
    ;(event as MouseEvent & { dataTransfer: DataTransfer }).dataTransfer = dt
    dropZone.dispatchEvent(event)
    expect(editor.effectBlocks).toHaveLength(1)
    expect(editor.effectBlocks[0]).toMatchObject({ channelId: ch.id, effectId: 'sepia', start: 3, duration: 2 })
  })

  it('covers the entire clip when an effect is dropped inside it', async () => {
    const ch = editor.channels[0]
    const clip = editor.addClip(ch.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, right: 500, top: 0, bottom: 64, width: 400, height: 64, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
    })
    const dt = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia' }),
    })
    const event = new MouseEvent('drop', { clientX: 220, bubbles: true, cancelable: true })
    ;(event as MouseEvent & { dataTransfer: DataTransfer }).dataTransfer = dt
    dropZone.dispatchEvent(event)
    expect(editor.effectBlocks).toHaveLength(1)
    expect(editor.effectBlocks[0]).toMatchObject({ start: 0, duration: 5, ownerClipId: clip.id })
  })

  it('uses the full trimmed timeline duration, including playback speed, on effect drop', async () => {
    const channel = editor.channels[0]
    const clip = editor.addClip(channel.id, {
      fileName: 'long.mp4', scrubBlobUrl: null, sourceDuration: 100,
      inPoint: 4, outPoint: 84, start: 5, playbackRate: 2,
    })
    const { getByLabelText } = render(ChannelRow, { channel })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia', duration: 2 }),
    })

    const event = new MouseEvent('drop', { clientX: 400, bubbles: true, cancelable: true })
    ;(event as MouseEvent & { dataTransfer: DataTransfer }).dataTransfer = dataTransfer
    getByLabelText(`Drop zone: ${channel.name}`).dispatchEvent(event)

    expect(editor.effectBlocks[0]).toMatchObject({ start: 5, duration: 40, ownerClipId: clip.id })
  })

  it('covers only the targeted clip on a drop at an overlap, including a very short clip', async () => {
    const channel = editor.channels[0]
    editor.addClip(channel.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 0,
    })
    const target = editor.addClip(channel.id, {
      fileName: 'short.mp4', scrubBlobUrl: null, sourceDuration: 1,
      inPoint: 0, outPoint: 0.1, start: 4.95,
    })
    const { container } = render(ChannelRow, { channel })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia' }),
    })
    const event = new MouseEvent('drop', { clientX: 199, bubbles: true, cancelable: true })
    ;(event as MouseEvent & { dataTransfer: DataTransfer }).dataTransfer = dataTransfer
    container.querySelector(`[data-timeline-clip-id="${target.id}"]`)!.dispatchEvent(event)

    expect(editor.effectBlocks[0]).toMatchObject({ start: 4.95, duration: 0.1, ownerClipId: target.id })
    expect(editor.undo()).toBe(true)
    expect(editor.effectBlocks).toHaveLength(0)
    expect(editor.redo()).toBe(true)
    expect(editor.effectBlocks[0]).toMatchObject({ start: 4.95, duration: 0.1, ownerClipId: target.id })
  })

  it('leaves a dropped effect timeline-anchored over empty space', async () => {
    const ch = editor.channels[0]
    editor.addClip(ch.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 10,
    })
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    Object.defineProperty(dropZone, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, right: 500, top: 0, bottom: 64, width: 400, height: 64, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
    })
    const dt = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia' }),
    })
    const event = new MouseEvent('drop', { clientX: 220, bubbles: true, cancelable: true })
    ;(event as MouseEvent & { dataTransfer: DataTransfer }).dataTransfer = dt
    dropZone.dispatchEvent(event)
    expect(editor.effectBlocks).toHaveLength(1)
    expect(editor.effectBlocks[0].ownerClipId).toBeUndefined()
  })

  it('moves an anchored effect together with its clip', async () => {
    const ch = editor.channels[0]
    const clip = editor.addClip(ch.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const block = editor.addEffectBlock(ch.id, 'sepia', 1, 2)!
    expect(editor.anchorEffectBlock(block.id, 2)).toBe(true)
    editor.moveClip(ch.id, clip.id, 2)
    expect(editor.effectBlocks[0].start).toBeCloseTo(3)
  })

  it('continues dragging an owned effect when overlap moves it to another lane', async () => {
    const channel = editor.channels[0]
    editor.addClip(channel.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 0,
    })
    const second = editor.addClip(channel.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 5,
    })
    editor.addEffectBlock(channel.id, 'grayscale', 0, 5)
    const moving = editor.addEffectBlock(channel.id, 'sepia', 5, 5)!
    editor.anchorEffectBlock(moving.id, 7)
    editor.clearHistory()
    const { container } = render(ChannelRow, { channel })
    const selector = `[data-timeline-effect-id="${moving.id}"]`
    const element = container.querySelector(selector)!

    await fireEvent.mouseDown(element, { clientX: 200 })
    await fireEvent.mouseMove(window, { clientX: 160 })
    await tick()
    expect(container.querySelector(selector)).toBe(element)
    await fireEvent.mouseMove(window, { clientX: 80 })
    expect(editor.effectBlocks.find((block) => block.id === moving.id)).toMatchObject({ start: 2, duration: 5 })
    expect(editor.effectBlocks.find((block) => block.id === moving.id)!.ownerClipId).toBeUndefined()
    await fireEvent.mouseUp(window, { clientX: 80 })

    expect(editor.undo()).toBe(true)
    expect(editor.effectBlocks.find((block) => block.id === moving.id)).toMatchObject({ start: 5, ownerClipId: second.id })
  })

  it('continues extending an effect over the previous clip when its lane changes', async () => {
    const channel = editor.channels[0]
    editor.addClip(channel.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 0,
    })
    editor.addClip(channel.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 5,
    })
    editor.addEffectBlock(channel.id, 'grayscale', 0, 5)
    const resizing = editor.addEffectBlock(channel.id, 'sepia', 5, 5)!
    editor.anchorEffectBlock(resizing.id, 7)
    const { container } = render(ChannelRow, { channel })
    const element = container.querySelector(`[data-timeline-effect-id="${resizing.id}"]`)!

    await fireEvent.mouseDown(element.querySelector('.fx-resize.left')!, { clientX: 200 })
    await fireEvent.mouseMove(window, { clientX: 160 })
    await tick()
    await fireEvent.mouseMove(window, { clientX: 80 })
    await fireEvent.mouseUp(window, { clientX: 80 })

    expect(editor.effectBlocks.find((block) => block.id === resizing.id)).toMatchObject({ start: 2, duration: 8 })
    expect(editor.effectBlocks.find((block) => block.id === resizing.id)!.ownerClipId).toBeUndefined()
  })

  it('rejects an effect drop on an audio channel', async () => {
    const ch = editor.channels[1]
    const { getByLabelText } = render(ChannelRow, { channel: ch })
    const dropZone = getByLabelText(`Drop zone: ${ch.name}`)
    const dt = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia' }),
    })
    await fireEvent.drop(dropZone, { dataTransfer: dt, clientX: 100 })
    expect(editor.effectBlocks).toHaveLength(0)
  })

  it('applies a dropped look to one clip or all selected video clips', async () => {
    const channel = editor.channels[0]
    const first = editor.addClip(channel.id, {
      fileName: 'first.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const second = editor.addClip(channel.id, {
      fileName: 'second.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 5,
    })
    const { container } = render(ChannelRow, { channel })
    const firstElement = container.querySelector(`[data-timeline-clip-id="${first.id}"]`)
    const dataTransfer = makeDataTransfer({
      [CLIP_LOOK_DRAG_MIME]: JSON.stringify({ lookId: 'sepia-strobe' }),
    })

    await fireEvent.drop(firstElement!, { dataTransfer })
    expect(editor.effectBlocks.filter((block) => block.ownerClipId === first.id)).toHaveLength(8)
    expect(editor.effectBlocks.filter((block) => block.ownerClipId === second.id)).toHaveLength(0)

    editor.selectClips([first.id, second.id])
    await fireEvent.drop(firstElement!, { dataTransfer })
    expect(editor.effectBlocks.filter((block) => block.ownerClipId === first.id)).toHaveLength(8)
    expect(editor.effectBlocks.filter((block) => block.ownerClipId === second.id)).toHaveLength(8)
  })
})
