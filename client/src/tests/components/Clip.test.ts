import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import Clip from '../../components/Clip.svelte'
import EffectBlock from '../../components/EffectBlock.svelte'
import TextBlock from '../../components/TextBlock.svelte'
import { editor } from '../../stores/editor.svelte'

describe('Clip', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.selectClip(null)
    editor.setPixelsPerSecond(40)
  })

  it('renders filename and duration', () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'myclip.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { getByText } = render(Clip, { clip: c, channelId: ch.id })
    expect(getByText('myclip.mp4')).toBeTruthy()
    expect(getByText('4.0s')).toBeTruthy()
  })

  it('renders durations longer than a minute using minutes and seconds', () => {
    const ch = editor.channels[0]
    const clip = editor.addClip(ch.id, {
      fileName: 'long-video.mp4',
      mediaKind: 'video',
      scrubBlobUrl: null,
      sourceDuration: 70,
      inPoint: 0,
      outPoint: 65,
      start: 0,
    })

    const { getByText } = render(Clip, { clip, channelId: ch.id })

    expect(getByText('1m 05.0s')).toBeTruthy()
  })

  it('marks clips with a non-default transform or preset', () => {
    const ch = editor.channels[0]
    const clip = editor.addClip(ch.id, {
      fileName: 'treated.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const clean = render(Clip, { clip, channelId: ch.id })
    expect(clean.queryByLabelText('Transform or preset applied')).toBeNull()
    clean.unmount()

    editor.setClipTransform(clip.id, { zoomX: 1.2 })
    const treated = render(Clip, { clip: editor.getClipById(clip.id)!.clip, channelId: ch.id })
    expect(treated.getByText('T')).toBeTruthy()
    expect(treated.getByLabelText('Transform applied')).toBeTruthy()
    treated.unmount()

    editor.resetClipTransform(clip.id)
    editor.applyClipLook(clip.id, 'balanced-enhance')
    const preset = render(Clip, { clip: editor.getClipById(clip.id)!.clip, channelId: ch.id })
    expect(preset.getByText('T')).toBeTruthy()
    expect(preset.getByLabelText('Preset applied')).toBeTruthy()
  })

  it('clicking selects the clip', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'sel.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { getByRole } = render(Clip, { clip: c, channelId: ch.id })
    const el = getByRole('button')
    await fireEvent.mouseDown(el)
    expect(editor.selectedClipId).toBe(c.id)
  })

  it('highlights a linked audio clip when its video partner is selected', () => {
    const videoChannel = editor.channels[0]
    const audioChannel = editor.addChannel('audio')
    const video = editor.addClip(videoChannel.id, {
      fileName: 'video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 0,
    })
    const audio = editor.addClip(audioChannel.id, {
      fileName: 'audio.mp3', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 0,
    })
    video.linkedClipId = audio.id
    audio.linkedClipId = video.id
    editor.selectClip(video.id)

    const { container } = render(Clip, { clip: audio, channelId: audioChannel.id })
    const audioElement = container.querySelector('.clip') as HTMLElement

    expect(audioElement).toHaveClass('linked-selected')
    expect(audioElement).not.toHaveClass('selected')
    expect(audioElement.querySelector('[title="Delete clip"]')).toBeNull()
  })

  it('raises a selected overlapping clip so its full highlight stays visible', () => {
    const ch = editor.channels[0]
    const selected = editor.addClip(ch.id, {
      fileName: 'selected.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.addClip(ch.id, {
      fileName: 'overlap.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 2,
    })
    editor.selectClip(selected.id)

    const { container } = render(Clip, { clip: selected, channelId: ch.id })
    const selectedElement = container.querySelector('.clip') as HTMLElement

    expect(selectedElement).toHaveClass('selected')
  })

  it('Ctrl+click adds and removes clips from the selection', async () => {
    const ch = editor.channels[0]
    const first = editor.addClip(ch.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const second = editor.addClip(ch.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 3,
    })
    const firstView = render(Clip, { clip: first, channelId: ch.id })
    const secondView = render(Clip, { clip: second, channelId: ch.id })
    const firstEl = firstView.container.querySelector('.clip') as HTMLElement
    const secondEl = secondView.container.querySelector('.clip') as HTMLElement

    await fireEvent.mouseDown(firstEl)
    await fireEvent.mouseUp(window)
    await fireEvent.mouseDown(secondEl, { ctrlKey: true })
    await fireEvent.mouseUp(window)
    expect(editor.selectedClipIds).toEqual([first.id, second.id])
    expect(firstEl).toHaveClass('selected')
    expect(secondEl).toHaveClass('selected')

    await fireEvent.mouseDown(firstEl, { ctrlKey: true })
    expect(editor.selectedClipIds).toEqual([second.id])
  })

  it('dragging a multi-selection moves every clip past an obstacle', async () => {
    const videoChannel = editor.channels[0]
    const audioChannel = editor.addChannel('audio')
    const video = editor.addClip(videoChannel.id, {
      fileName: 'video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    editor.addClip(videoChannel.id, {
      fileName: 'blocker.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 4,
    })
    const audio = editor.addClip(audioChannel.id, {
      fileName: 'audio.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 1,
    })
    editor.selectClip(video.id)
    editor.selectClip(audio.id, true)
    const { container } = render(Clip, { clip: video, channelId: videoChannel.id })
    const clipEl = container.querySelector('.clip') as HTMLElement

    await fireEvent.mouseDown(clipEl, { clientX: 0, clientY: 20 })
    await fireEvent.mouseMove(window, { clientX: 400, clientY: 20 })
    await fireEvent.mouseUp(window, { clientX: 400, clientY: 20 })

    expect(editor.getClipById(video.id)!.clip.start).toBe(10)
    expect(editor.getClipById(audio.id)!.clip.start).toBe(11)
  })

  it('dragging far enough moves a clip past its right-side neighbour', async () => {
    const channel = editor.channels[0]
    const moving = editor.addClip(channel.id, {
      fileName: 'moving.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const neighbour = editor.addClip(channel.id, {
      fileName: 'neighbour.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 2,
    })
    const { container } = render(Clip, { clip: moving, channelId: channel.id })
    const clipEl = container.querySelector('.clip') as HTMLElement

    await fireEvent.mouseDown(clipEl, { clientX: 0, clientY: 20 })
    await fireEvent.mouseMove(window, { clientX: 120, clientY: 20 })
    await fireEvent.mouseUp(window, { clientX: 120, clientY: 20 })

    expect(editor.getClipById(moving.id)!.clip.start).toBeGreaterThan(neighbour.start)
    expect(channel.clips[0].id).toBe(neighbour.id)
  })

  it('delete button removes the full multi-selection', async () => {
    const channel = editor.channels[0]
    const first = editor.addClip(channel.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const second = editor.addClip(channel.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 3,
    })
    editor.selectClip(first.id)
    editor.selectClip(second.id, true)
    const { getByTitle } = render(Clip, { clip: first, channelId: channel.id })
    const deleteButton = getByTitle('Delete clip')

    await fireEvent.mouseDown(deleteButton)
    await fireEvent.mouseUp(deleteButton)
    await fireEvent.click(deleteButton)

    expect(channel.clips).toHaveLength(0)
    expect(editor.selectedClipIds).toHaveLength(0)
  })

  it('selected clip shows delete button and clicking it removes the clip', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'del.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.selectClip(c.id)
    const { getByTitle } = render(Clip, {
      clip: c,
      channelId: ch.id,
    })
    expect(getByTitle('Delete clip')).toBeTruthy()
    await fireEvent.click(getByTitle('Delete clip'))
    expect(editor.channels[0].clips.find((x) => x.id === c.id)).toBeUndefined()
  })

  it('does not move when channel is locked', async () => {
    editor.toggleLock(editor.channels[0].id)
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'lock.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { getByRole } = render(Clip, { clip: c, channelId: ch.id })
    await fireEvent.mouseDown(getByRole('button'), { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(c.start).toBe(0)
  })

  it('starts moving vertically after a 30px threshold and resets on release', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'drag.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { getByRole } = render(Clip, { clip: c, channelId: ch.id })
    const el = getByRole('button') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 20, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 20, clientY: 44 })
    expect(el.style.transform).toBe('translateY(0px)')

    await fireEvent.mouseMove(window, { clientX: 20, clientY: 110 })
    expect(el.style.transform).toBe('translateY(80px)')
    expect(el.classList.contains('dragging')).toBe(true)

    await fireEvent.mouseUp(window, { clientX: 20, clientY: 110 })
    expect(el.style.transform).toBe('translateY(0px)')
    expect(el.classList.contains('dragging')).toBe(false)
  })

  it('cancels a drag when the browser window loses focus', async () => {
    const ch = editor.channels[0]
    const clip = editor.addClip(ch.id, {
      fileName: 'focus-loss.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { container } = render(Clip, { clip, channelId: ch.id })
    const clipEl = container.querySelector('.clip') as HTMLElement

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 100, clientY: 30 })
    expect(editor.getClipById(clip.id)!.clip.start).toBe(2)

    window.dispatchEvent(new Event('blur'))
    await tick()

    expect(editor.getClipById(clip.id)!.clip.start).toBe(0)
    expect(clipEl).not.toHaveClass('dragging')
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 30 }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(0)
  })

  it('moves every selected clip in the vertical drag preview', async () => {
    const ch = editor.channels[0]
    const first = editor.addClip(ch.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const second = editor.addClip(ch.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 3,
    })
    editor.selectClips([first.id, second.id])
    const firstView = render(Clip, { clip: first, channelId: ch.id })
    const secondView = render(Clip, { clip: second, channelId: ch.id })
    const firstEl = firstView.container.querySelector('.clip') as HTMLElement
    const secondEl = secondView.container.querySelector('.clip') as HTMLElement

    await fireEvent.mouseDown(firstEl, { clientX: 20, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 20, clientY: 110 })

    expect(firstEl.style.transform).toBe('translateY(80px)')
    expect(secondEl.style.transform).toBe('translateY(80px)')
    expect(firstEl).toHaveClass('dragging')
    expect(secondEl).toHaveClass('dragging')

    await fireEvent.mouseUp(window, { clientX: 20, clientY: 110 })
    expect(firstEl.style.transform).toBe('translateY(0px)')
    expect(secondEl.style.transform).toBe('translateY(0px)')
  })

  it('previews anchored effects and text with a vertically dragged clip', async () => {
    const source = editor.channels[0]
    const target = editor.addChannel('video')
    const clip = editor.addClip(source.id, {
      fileName: 'mixed.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    editor.addClip(target.id, {
      fileName: 'target.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const block = editor.addEffectBlock(source.id, 'blur', 0, 1)!
    block.ownerClipId = clip.id
    const text = editor.addTextItem(0, { text: 'Caption', duration: 1 })
    text.sourceClipId = clip.id
    editor.selectClip(clip.id)

    const clipView = render(Clip, { clip, channelId: source.id })
    const effectView = render(EffectBlock, { block, laneIndex: 0 })
    const textView = render(TextBlock, { item: text, laneIndex: 0 })
    const clipEl = clipView.container.querySelector('.clip') as HTMLElement
    const effectEl = effectView.container.querySelector('.fxblock') as HTMLElement
    const textEl = textView.container.querySelector('.text-block') as HTMLElement
    const targetElement = document.createElement('div')
    targetElement.dataset.timelineChannelId = target.id
    targetElement.dataset.channelType = 'video'
    targetElement.dataset.channelLocked = 'false'
    Object.defineProperty(targetElement, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 500, top: 100, bottom: 250, width: 500, height: 150 }),
    })
    document.body.appendChild(targetElement)

    await fireEvent.mouseDown(clipEl, { clientX: 100, clientY: 20 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 80 }))
    await tick()

    expect(effectEl).toHaveClass('drag-preview')
    expect(effectEl.style.transform).toBe('translateY(60px)')
    expect(textEl.style.transform).toBe('translateY(60px)')

    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 160 }))
    await tick()
    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)!.channelId).toBe(target.id)
    expect(textEl.style.transform).toBe('translateY(0px)')
    targetElement.remove()
  })

  it('snaps the right edge to a playhead up to 2px away', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'snap-right.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.setCurrentTime(4.04)
    const { getByRole } = render(Clip, { clip: c, channelId: ch.id })

    await fireEvent.mouseDown(getByRole('button'), { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 101, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 101, clientY: 30 })

    expect(editor.channels[0].clips[0].start).toBeCloseTo(0.04)
  })

  it('snaps the left edge to a playhead up to 2px away', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'snap-left.mp4',
      scrubBlobUrl: null,
      sourceDuration: 12,
      inPoint: 0,
      outPoint: 4,
      start: 5,
    })
    editor.setCurrentTime(4.98)
    const { getByRole } = render(Clip, { clip: c, channelId: ch.id })

    await fireEvent.mouseDown(getByRole('button'), { clientX: 200, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 200, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 200, clientY: 30 })

    expect(editor.channels[0].clips[0].start).toBeCloseTo(4.98)
  })

  it('snaps its right edge to the next clip within 3px', async () => {
    const ch = editor.channels[0]
    const moving = editor.addClip(ch.id, {
      fileName: 'moving.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 0,
    })
    editor.addClip(ch.id, {
      fileName: 'next.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 4.1,
    })
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: moving, channelId: ch.id })
    const el = getByText('moving.mp4').closest('.clip') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 102, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 102, clientY: 30 })

    expect(editor.channels[0].clips.find((c) => c.id === moving.id)!.start).toBeCloseTo(0.1)
  })

  it('snaps its left edge to the previous clip within 3px', async () => {
    const ch = editor.channels[0]
    editor.addClip(ch.id, {
      fileName: 'previous.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 0,
    })
    const moving = editor.addClip(ch.id, {
      fileName: 'moving.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 4.1,
    })
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: moving, channelId: ch.id })
    const el = getByText('moving.mp4').closest('.clip') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 98, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 98, clientY: 30 })

    expect(editor.channels[0].clips.find((c) => c.id === moving.id)!.start).toBeCloseTo(4)
  })

  it('moves past clip snap when dragged farther to create a transition overlap', async () => {
    const ch = editor.channels[0]
    const moving = editor.addClip(ch.id, {
      fileName: 'moving.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 0,
    })
    editor.addClip(ch.id, {
      fileName: 'next.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 4.1,
    })
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: moving, channelId: ch.id })
    const el = getByText('moving.mp4').closest('.clip') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 108, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 108, clientY: 30 })

    const stored = editor.channels[0].clips.find((c) => c.id === moving.id)!
    expect(stored.start + stored.outPoint - stored.inPoint).toBeGreaterThan(4.1)
  })

  it('snaps audio clip starts across different audio channels', async () => {
    const upper = editor.addChannel('audio')
    const lower = editor.addChannel('audio')
    editor.addClip(upper.id, {
      fileName: 'upper.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 5,
    })
    const moving = editor.addClip(lower.id, {
      fileName: 'lower.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 4.9,
    })
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: moving, channelId: lower.id })
    const el = getByText('lower.mp4').closest('.clip') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 102, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 102, clientY: 30 })

    expect(editor.channels.find((c) => c.id === lower.id)!.clips[0].start).toBeCloseTo(5)
  })

  it('snaps audio clip ends across different audio channels', async () => {
    const upper = editor.addChannel('audio')
    const lower = editor.addChannel('audio')
    editor.addClip(upper.id, {
      fileName: 'upper.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 5, start: 0,
    })
    const moving = editor.addClip(lower.id, {
      fileName: 'lower.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 3, start: 2.1,
    })
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: moving, channelId: lower.id })
    const el = getByText('lower.mp4').closest('.clip') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 98, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 98, clientY: 30 })

    expect(editor.channels.find((c) => c.id === lower.id)!.clips[0].start).toBeCloseTo(2)
  })

  it('snaps video clips across different video channels', async () => {
    const upper = editor.channels[0]
    const lower = editor.addChannel('video')
    editor.addClip(upper.id, {
      fileName: 'upper-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 5,
    })
    const moving = editor.addClip(lower.id, {
      fileName: 'lower-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 4.9,
    })
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: moving, channelId: lower.id })
    const el = getByText('lower-video.mp4').closest('.clip') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100, clientY: 30 })
    await fireEvent.mouseMove(window, { clientX: 102, clientY: 30 })
    await fireEvent.mouseUp(window, { clientX: 102, clientY: 30 })

    expect(editor.channels.find((c) => c.id === lower.id)!.clips[0].start).toBeCloseTo(5)
  })

  it('snaps a linked multi-selection to the playhead', async () => {
    const videoChannel = editor.channels[0]
    const audioChannel = editor.addChannel('audio')
    const firstVideo = editor.addClip(videoChannel.id, {
      fileName: 'first-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const secondVideo = editor.addClip(videoChannel.id, {
      fileName: 'second-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 4,
    })
    const firstAudio = editor.addClip(audioChannel.id, {
      fileName: 'first-audio.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const secondAudio = editor.addClip(audioChannel.id, {
      fileName: 'second-audio.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 4,
    })
    firstVideo.linkedClipId = firstAudio.id
    firstAudio.linkedClipId = firstVideo.id
    secondVideo.linkedClipId = secondAudio.id
    secondAudio.linkedClipId = secondVideo.id
    editor.selectClips([firstVideo.id, secondVideo.id])
    editor.setCurrentTime(2.05)
    const { getByText } = render(Clip, { clip: firstVideo, channelId: videoChannel.id })

    await fireEvent.mouseDown(getByText('first-video.mp4').closest('.clip')!, { clientX: 100 })
    await fireEvent.mouseMove(window, { clientX: 101 })
    await fireEvent.mouseUp(window, { clientX: 101 })

    expect(editor.getClipById(firstVideo.id)!.clip.start).toBeCloseTo(0.05)
    expect(editor.getClipById(firstAudio.id)!.clip.start).toBeCloseTo(0.05)
  })

  it('snaps any edge in a linked multi-selection to a clip on another track', async () => {
    const upperVideoChannel = editor.channels[0]
    const lowerVideoChannel = editor.addChannel('video')
    const audioChannel = editor.addChannel('audio')
    editor.addClip(upperVideoChannel.id, {
      fileName: 'upper.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 6.05,
    })
    const firstVideo = editor.addClip(lowerVideoChannel.id, {
      fileName: 'first-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const secondVideo = editor.addClip(lowerVideoChannel.id, {
      fileName: 'second-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 4,
    })
    const firstAudio = editor.addClip(audioChannel.id, {
      fileName: 'first-audio.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const secondAudio = editor.addClip(audioChannel.id, {
      fileName: 'second-audio.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 4,
    })
    firstVideo.linkedClipId = firstAudio.id
    firstAudio.linkedClipId = firstVideo.id
    secondVideo.linkedClipId = secondAudio.id
    secondAudio.linkedClipId = secondVideo.id
    editor.selectClips([firstVideo.id, secondVideo.id])
    editor.setCurrentTime(20)
    const { getByText } = render(Clip, { clip: firstVideo, channelId: lowerVideoChannel.id })

    await fireEvent.mouseDown(getByText('first-video.mp4').closest('.clip')!, { clientX: 100 })
    await fireEvent.mouseMove(window, { clientX: 101 })
    await fireEvent.mouseUp(window, { clientX: 101 })

    expect(editor.getClipById(firstVideo.id)!.clip.start).toBeCloseTo(0.05)
    expect(editor.getClipById(secondVideo.id)!.clip.start).toBeCloseTo(4.05)
  })

  it('renders a waveform canvas for clips on audio channels', () => {
    editor.addChannel('audio')
    const audioCh = editor.channels.find((c) => c.type === 'audio')!
    const c = editor.addClip(audioCh.id, {
      fileName: 'sound.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { container } = render(Clip, { clip: c, channelId: audioCh.id })
    expect(container.querySelector('canvas.waveform')).toBeTruthy()
    expect(container.querySelector('.clip.audio')).toBeTruthy()
  })

  it('skips waveform canvases when an audio clip is too narrow to show useful detail', () => {
    editor.addChannel('audio')
    const audioCh = editor.channels.find((c) => c.type === 'audio')!
    const clip = editor.addClip(audioCh.id, {
      fileName: 'short.mp3', scrubBlobUrl: null, sourceDuration: 1,
      inPoint: 0, outPoint: 0.5, start: 0,
    })

    const { container } = render(Clip, { clip, channelId: audioCh.id })

    expect(container.querySelector('.clip.audio')).toBeTruthy()
    expect(container.querySelector('canvas.waveform')).toBeNull()
  })

  it('coalesces repeated clip moves until the next animation frame', async () => {
    const channel = editor.channels[0]
    const clip = editor.addClip(channel.id, {
      fileName: 'batched.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    editor.setCurrentTime(20)
    const moveClip = vi.spyOn(editor, 'moveClip')
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 123)
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const { container } = render(Clip, { clip, channelId: channel.id })
    const clipElement = container.querySelector('.clip') as HTMLElement

    try {
      await fireEvent.mouseDown(clipElement, { clientX: 0, clientY: 20 })
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 20 }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 20 }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80, clientY: 20 }))

      expect(moveClip).toHaveBeenCalledTimes(1)
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 80, clientY: 20 }))
      expect(moveClip).toHaveBeenCalledTimes(2)
      expect(editor.getClipById(clip.id)!.clip.start).toBeCloseTo(2)
    } finally {
      moveClip.mockRestore()
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it('shows an explicit large-media badge for a 58-minute local audio clip', async () => {
    editor.addChannel('audio')
    const audioCh = editor.channels.find((c) => c.type === 'audio')!
    const clip = editor.addClip(audioCh.id, {
      fileName: 'long-local.mp4',
      scrubBlobUrl: 'blob:long-local',
      sourceDuration: 3480,
      inPoint: 0,
      outPoint: 3480,
      start: 0,
    })
    const { container, getByText, queryByText } = render(Clip, { clip, channelId: audioCh.id })

    await waitFor(() => expect(getByText('Waveform off · local')).toBeTruthy())
    expect(container.querySelector('.clip')).toHaveClass('huge')
    const badge = container.querySelector('.waveform-large') as HTMLElement
    expect(badge.getAttribute('title')).toContain('2GB')
    // The badge sits where the duration label would be, so the label hides.
    expect(queryByText('58m 00.0s')).toBeNull()
  })

  it('does not show the large-media badge for server-backed audio', async () => {
    editor.addChannel('audio')
    const audioCh = editor.channels.find((c) => c.type === 'audio')!
    const clip = editor.addClip(audioCh.id, {
      fileName: 'server-long.mp4',
      sourceMode: 'proxy',
      scrubBlobUrl: 'https://example.invalid/proxy',
      sourceDuration: 3480,
      inPoint: 0,
      outPoint: 3480,
      start: 0,
    })
    const { container, queryByText } = render(Clip, { clip, channelId: audioCh.id })

    await tick()
    await tick()
    expect(queryByText(/Waveform off/)).toBeNull()
    expect(container.querySelector('canvas.waveform')).toBeTruthy()
  })

  it('skips store updates for sub-pixel drags', async () => {
    const channel = editor.channels[0]
    const clip = editor.addClip(channel.id, {
      fileName: 'steady.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    editor.setCurrentTime(20)
    const moveClip = vi.spyOn(editor, 'moveClip')
    const { container } = render(Clip, { clip, channelId: channel.id })
    const clipElement = container.querySelector('.clip') as HTMLElement

    try {
      await fireEvent.mouseDown(clipElement, { clientX: 100, clientY: 20 })
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 20 }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 20 }))

      expect(moveClip).not.toHaveBeenCalled()
      expect(editor.getClipById(clip.id)!.clip.start).toBe(0)
    } finally {
      moveClip.mockRestore()
    }
  })

  it('does not render a waveform for clips on video channels', () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'movie.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const { container } = render(Clip, { clip: c, channelId: ch.id })
    expect(container.querySelector('canvas.waveform')).toBeNull()
  })

  it('shows trim handles only when selected', () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'trim.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const unselected = render(Clip, { clip: c, channelId: ch.id })
    expect(unselected.queryByLabelText('Trim start')).toBeNull()
    expect(unselected.queryByLabelText('Trim end')).toBeNull()
    unselected.unmount()

    editor.selectClip(c.id)
    const selected = render(Clip, { clip: c, channelId: ch.id })
    expect(selected.getByLabelText('Trim start')).not.toHaveClass('short-clip')
    expect(selected.getByLabelText('Trim end')).not.toHaveClass('short-clip')
  })

  it('hides trim handle visuals for selected clips shorter than one second', () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'short.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 0.9,
      start: 0,
    })
    editor.selectClip(c.id)

    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    expect(getByLabelText('Trim start')).toHaveClass('short-clip')
    expect(getByLabelText('Trim end')).toHaveClass('short-clip')
  })

  it('dragging the right handle trims the out point without moving start', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'trimout.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.selectClip(c.id)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // 40px at 40px/s = 1s trim inwards
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 160 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    // Read through the store: the object returned by addClip is not the
    // reactive proxy the store mutates.
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.outPoint).toBeCloseTo(3)
    expect(stored.start).toBe(0)
    expect(stored.inPoint).toBe(0)
  })

  it('dragging the left handle trims the in point and shifts start', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'trimin.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 2,
    })
    editor.selectClip(c.id)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    await fireEvent.mouseDown(getByLabelText('Trim start'), { clientX: 80 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.inPoint).toBeCloseTo(1)
    expect(stored.start).toBeCloseTo(3)
    expect(stored.outPoint).toBe(4)
  })

  it('full flow: click to select, then left handle drag right trims the start', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'flow.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const { getByRole, getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // 1. Click the clip body to select it (mousedown + mouseup)
    await fireEvent.mouseDown(getByRole('button'), { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(editor.selectedClipId).toBe(c.id)
    // 2. Drag the left handle right by 40px = 1s
    await fireEvent.mouseDown(getByLabelText('Trim start'), { clientX: 4 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 44 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.inPoint).toBeCloseTo(1)
    expect(stored.start).toBeCloseTo(1)
    expect(stored.outPoint).toBe(5)
  })

  it('trim handle drag does not start a clip move', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'nomove.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 2,
    })
    editor.selectClip(c.id)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 240 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    // start only changes via in-point trims; an out-trim must not move the clip
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.start).toBe(2)
    expect(stored.outPoint).toBeCloseTo(8)
  })

  it('right trim edge snaps to the playhead within 3px', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'snapout.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(3)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // Right edge at 160px (4s), playhead at 120px (3s). Drag to 123px:
    // desired edge = 3.075s = 3px from the playhead -> snaps exactly to 3s.
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 160 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 123 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.outPoint).toBeCloseTo(3)
    expect(stored.start).toBe(0)
  })

  it('left trim edge snaps to the playhead within 3px', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'snapin.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 2,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(3)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // Left edge at 80px (2s), playhead at 120px (3s). Drag to 118px:
    // desired edge = 2.95s = 2px from the playhead -> snaps exactly to 3s.
    await fireEvent.mouseDown(getByLabelText('Trim start'), { clientX: 80 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 118 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.inPoint).toBeCloseTo(1)
    expect(stored.start).toBeCloseTo(3)
  })

  it('trim edge after snap release stays under the mouse, no lag', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'relag.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(3)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // 1. Drag to 123px: desired edge 3.075s = 3px from playhead -> snaps to 3s.
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 160 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 123 }))
    const afterSnap = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(afterSnap.outPoint).toBeCloseTo(3)
    // 2. Keep dragging past the zone to 131px: desired edge = 4 + (131-160)/40
    //    = 3.275s (131px) -> outside the 3px zone -> the edge must follow the
    //    mouse exactly instead of lagging behind the snapped reference.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 131 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.outPoint).toBeCloseTo(3.275)
  })

  it('right trim edge moves immediately after reversing from a neighbour boundary', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'bounded-right.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    editor.addClip(ch.id, {
      fileName: 'right-neighbour.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 3,
    })
    editor.selectClip(c.id)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })

    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 80 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    const atBoundary = editor.getClipById(c.id)!.clip.outPoint
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 396 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.getClipById(c.id)!.clip.outPoint).toBeCloseTo(atBoundary - 0.1)
  })

  it('left trim edge moves immediately after reversing from a neighbour boundary', async () => {
    const ch = editor.channels[0]
    editor.addClip(ch.id, {
      fileName: 'left-neighbour.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const c = editor.addClip(ch.id, {
      fileName: 'bounded-left.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 3, outPoint: 5, start: 3,
    })
    editor.selectClip(c.id)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })

    await fireEvent.mouseDown(getByLabelText('Trim start'), { clientX: 120 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: -200 }))
    const atBoundary = editor.getClipById(c.id)!.clip.start
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: -196 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.getClipById(c.id)!.clip.start).toBeCloseTo(atBoundary + 0.1)
  })

  it('trim edge further than 3px from the playhead does not snap', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'nosnap.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(3)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // Drag to 100px: desired edge = 2.5s = 20px from the playhead -> no snap.
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 160 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.outPoint).toBeCloseTo(2.5)
  })

  it('right trim edge snaps to the next clip within 3px when enlarging', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'trim-next.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    editor.addClip(ch.id, {
      fileName: 'next.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 8,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(20)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // Right edge at 160px (4s). Drag to 319px: desired edge = 7.975s, 1px
    // from the next clip at 8s -> snaps exactly to 8s.
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 160 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 319 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.outPoint).toBeCloseTo(8)
    expect(stored.start).toBe(0)
  })

  it('left trim edge snaps to the previous clip within 3px when enlarging', async () => {
    const ch = editor.channels[0]
    editor.addClip(ch.id, {
      fileName: 'prev.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 0,
    })
    const c = editor.addClip(ch.id, {
      fileName: 'trim-prev.mp4',
      scrubBlobUrl: null,
      sourceDuration: 12,
      inPoint: 4,
      outPoint: 9,
      start: 8,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(20)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // Left edge at 320px (8s). Drag to 161px: desired edge = 4.025s, 1px
    // from the previous clip's end at 4s -> snaps exactly to 4s.
    await fireEvent.mouseDown(getByLabelText('Trim start'), { clientX: 320 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 161 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.inPoint).toBeCloseTo(0)
    expect(stored.start).toBeCloseTo(4)
  })

  it('trim snap to the next clip does not over-extend past the source handles', async () => {
    const ch = editor.channels[0]
    const c = editor.addClip(ch.id, {
      fileName: 'nohandle.mp4',
      scrubBlobUrl: null,
      sourceDuration: 6,
      inPoint: 0,
      outPoint: 6,
      start: 0,
    })
    editor.addClip(ch.id, {
      fileName: 'next.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 8,
    })
    editor.selectClip(c.id)
    editor.setCurrentTime(20)
    const { getByLabelText } = render(Clip, { clip: c, channelId: ch.id })
    // Right edge at 240px (6s), next clip at 320px (8s). Drag past the snap
    // zone to 324px: desired edge 8.1s is 4px from the next clip -> no snap,
    // but the clip has no handles, so it must not extend at all.
    await fireEvent.mouseDown(getByLabelText('Trim end'), { clientX: 240 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 324 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    const stored = editor.channels[0].clips.find((x) => x.id === c.id)!
    expect(stored.outPoint).toBeCloseTo(6)
  })
})
