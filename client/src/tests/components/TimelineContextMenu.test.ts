import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import Timeline from '../../components/Timeline.svelte'
import { editor, type Clip } from '../../stores/editor.svelte'

function addClip(channelId: string, values: Partial<Clip> = {}): Clip {
  return editor.addClip(channelId, {
    fileName: 'sample.mp4',
    scrubBlobUrl: null,
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
    ...values,
  })
}

describe('Timeline clip interactions', () => {
  beforeEach(() => {
    editor.clearSelection()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.setCurrentTime(2)
    editor.clearHistory()
  })

  it('opens the clip inspector on the second left click', async () => {
    const clip = addClip(editor.channels[0].id)
    const onOpenClipInspector = vi.fn()
    const { container } = render(Timeline, { onOpenClipInspector })
    const clipElement = container.querySelector(`[data-timeline-clip-id="${clip.id}"]`)!

    await fireEvent.mouseDown(clipElement)
    await fireEvent.mouseUp(window)
    await fireEvent.click(clipElement)
    expect(onOpenClipInspector).not.toHaveBeenCalled()

    await fireEvent.mouseDown(clipElement, { button: 0, detail: 2 })
    expect(onOpenClipInspector).toHaveBeenCalledTimes(1)
  })

  it('shows audio actions and mutes an audio clip from its context menu', async () => {
    const clip = addClip(editor.channels[1].id, { fileName: 'voice.wav', mediaKind: 'audio' })
    const view = render(Timeline)
    const clipElement = view.container.querySelector(`[data-timeline-clip-id="${clip.id}"]`)!

    await fireEvent.contextMenu(clipElement, { clientX: 140, clientY: 120 })

    expect(view.getByRole('menu', { name: 'Actions for voice.wav' })).toBeInTheDocument()
    const mute = view.getByRole('menuitemcheckbox', { name: 'Mute clip audio' })
    expect(mute).toHaveAttribute('aria-checked', 'false')
    await fireEvent.click(mute)
    expect(editor.getClipById(clip.id)?.clip.volume).toBe(0)
  })

  it('does not open the clip inspector when right-clicking a clip', async () => {
    const clip = addClip(editor.channels[0].id)
    const onOpenClipInspector = vi.fn()
    const view = render(Timeline, { onOpenClipInspector })
    const clipElement = view.container.querySelector(`[data-timeline-clip-id="${clip.id}"]`)!

    await fireEvent.contextMenu(clipElement, { clientX: 140, clientY: 120 })

    expect(onOpenClipInspector).not.toHaveBeenCalled()
    expect(view.getByRole('menu', { name: 'Actions for sample.mp4' })).toBeInTheDocument()
  })

  it('shows channel actions and toggles the audio track state', async () => {
    const audioChannel = editor.channels[1]
    const view = render(Timeline)
    const audioHeader = view.container.querySelector('.thead.audio')!

    await fireEvent.contextMenu(audioHeader, { clientX: 80, clientY: 160 })

    expect(view.getByRole('menu', { name: `Actions for ${audioChannel.name}` })).toBeInTheDocument()
    const mute = view.getByRole('menuitemcheckbox', { name: 'Mute track' })
    expect(mute).toHaveAttribute('aria-checked', 'false')
    await fireEvent.click(mute)
    expect(audioChannel.muted).toBe(true)
  })
})
