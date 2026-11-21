import { describe, expect, it, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import Clip from '../../components/Clip.svelte'
import { editor } from '../../stores/editor.svelte'
import { vi } from 'vitest'

beforeEach(() => {
  cleanup()
  editor.clearHistory()
  for (const ch of [...editor.channels]) editor.removeChannel(ch.id)
  editor.selectClip(null)
  const ch = editor.addChannel('audio')
  editor.addClip(ch.id, {
    fileName: 'audio.mp3',
    scrubBlobUrl: 'blob:audio',
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
  })
})

describe('clip volume waveform reactivity', () => {
  it('hides the volume line until the audio channel is selected', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const { container } = render(Clip, { props: { clip, channelId } })

    expect(container.querySelector('.vol-line')).toBeNull()
    editor.selectChannel(channelId)
    await tick()
    expect(container.querySelector('.vol-line')).toBeTruthy()
  })

  it('mutating clip volume moves the volume line', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.selectChannel(channelId)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    expect(line).toBeTruthy()
    expect(line.style.top).toBe('50%')

    editor.moveClip(channelId, clip.id, 2)
    await tick()
    expect(clip.start).toBe(2)
    const clipEl = container.querySelector('.clip') as HTMLElement
    expect(clipEl.style.left).toBe('80px')

    editor.setClipVolume(clip.id, 50)
    await tick()
    expect(clip.volume).toBe(50)
    expect(line.style.top).toBe('75%')
  })

  it('dragging the volume line updates the clip volume', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.selectChannel(channelId)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 100, width: 200, left: 0, right: 200, bottom: 100 } as DOMRect))

    await fireEvent.mouseDown(line, { clientY: 50 })
    await fireEvent.mouseMove(window, { clientY: 25 })
    await fireEvent.mouseUp(window, { clientY: 25 })

    expect(clip.volume).toBe(150)
  })

  it('tracks consecutive pointer moves without accumulating volume changes', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.selectChannel(channelId)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 100, width: 200, left: 0, right: 200, bottom: 100 } as DOMRect))

    await fireEvent.mouseDown(line, { clientY: 50 })
    await fireEvent.mouseMove(window, { clientY: 75 })
    await fireEvent.mouseMove(window, { clientY: 74 })
    await fireEvent.mouseMove(window, { clientY: 73 })
    await fireEvent.mouseUp(window, { clientY: 73 })
    expect(clip.volume).toBe(54)
  })

  it('changes volume relative to the grabbed line without jumping', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.setClipVolume(clip.id, 50)
    editor.selectChannel(channelId)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 100, height: 100, width: 200, left: 0, right: 200, bottom: 200 } as DOMRect))

    await fireEvent.mouseDown(line, { clientY: 175 })
    await fireEvent.mouseMove(window, { clientY: 170 })
    await fireEvent.mouseUp(window, { clientY: 170 })

    expect(clip.volume).toBe(60)
  })

  it('rounds volume from pointer coordinates to a whole percent', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.selectChannel(channelId)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 64, width: 200, left: 0, right: 200, bottom: 64 } as DOMRect))

    await fireEvent.mouseDown(line, { clientY: 32 })
    await fireEvent.mouseMove(window, { clientY: 31.9 })
    await fireEvent.mouseUp(window, { clientY: 31.9 })

    expect(clip.volume ?? 100).toBe(100)
  })

  it('dragging the volume line moves every selected audio clip by the same offset', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.addClip(channelId, {
      fileName: 'other.mp3',
      scrubBlobUrl: 'blob:other',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 6,
    })
    const otherClip = editor.channels.find((c) => c.type === 'audio')!.clips[1]
    editor.selectClip(clip.id)
    editor.selectClip(otherClip.id, true)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 100, width: 200, left: 0, right: 200, bottom: 100 } as DOMRect))

    await fireEvent.mouseDown(line, { clientY: 50 })
    await fireEvent.mouseMove(window, { clientY: 25 })
    await fireEvent.mouseUp(window, { clientY: 25 })

    expect(clip.volume).toBe(150)
    expect(otherClip.volume).toBe(150)
  })

  it('multi-selection keeps relative differences between clips', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.addClip(channelId, {
      fileName: 'other.mp3',
      scrubBlobUrl: 'blob:other',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 6,
    })
    const otherClip = editor.channels.find((c) => c.type === 'audio')!.clips[1]
    editor.setClipVolume(otherClip.id, 40)
    editor.selectClip(clip.id)
    editor.selectClip(otherClip.id, true)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement
    const clipEl = container.querySelector('.clip') as HTMLElement
    clipEl.getBoundingClientRect = vi.fn(() => ({ top: 0, height: 100, width: 200, left: 0, right: 200, bottom: 100 } as DOMRect))

    await fireEvent.mouseDown(line, { clientY: 50 })
    await fireEvent.mouseMove(window, { clientY: 75 })
    await fireEvent.mouseUp(window, { clientY: 75 })

    expect(clip.volume).toBe(50)
    expect(otherClip.volume).toBe(0)
  })

  it('arrow keys nudge every selected audio clip together', async () => {
    const channelId = editor.channels.find((c) => c.type === 'audio')!.id
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.addClip(channelId, {
      fileName: 'other.mp3',
      scrubBlobUrl: 'blob:other',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 4,
      start: 6,
    })
    const otherClip = editor.channels.find((c) => c.type === 'audio')!.clips[1]
    editor.selectClip(clip.id)
    editor.selectClip(otherClip.id, true)

    const { container } = render(Clip, { props: { clip, channelId } })
    const line = container.querySelector('.vol-line') as HTMLElement

    await fireEvent.keyDown(line, { key: 'ArrowUp' })

    expect(clip.volume).toBe(105)
    expect(otherClip.volume).toBe(105)
  })
})
