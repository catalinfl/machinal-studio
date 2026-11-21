import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import InspectorFactory from '../../components/InspectorFactory.svelte'
import { editor } from '../../stores/editor.svelte'
import { clearMediaBinSources, registerMediaBinSource, renameMediaBinSource } from '../../lib/media-bin'
import { tick } from 'svelte'

describe('Inspector', () => {
  beforeEach(() => {
    editor.clearSelection()
    clearMediaBinSources()
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.clearHistory()
  })

  it('creates the text inspector for a selected text item', () => {
    const item = editor.addTextItem(0, { text: 'Caption' })
    editor.selectTextItem(item.id)

    const { getByLabelText } = render(InspectorFactory)

    expect(getByLabelText('Text inspector')).toBeInTheDocument()
  })

  it('creates a clip inspector with transform controls for a selected video', () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)

    const { getByLabelText, queryByLabelText, getByText } = render(InspectorFactory)

    expect(getByLabelText('Clip inspector')).toBeInTheDocument()
    expect(getByText('Motion presets')).toBeInTheDocument()
    expect(queryByLabelText('Text inspector')).not.toBeInTheDocument()
  })

  it('creates the clip inspector for a selected clip', () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)

    const { getByLabelText } = render(InspectorFactory)

    expect(getByLabelText('Clip inspector')).toBeInTheDocument()
  })

  it('updates transform values from the combined clip inspector', async () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)

    const { getByLabelText } = render(InspectorFactory)
    await fireEvent.change(getByLabelText('Position X'), { target: { value: '25' } })

    expect(editor.getClipById(clip.id)?.clip.transform?.positionX).toBe(25)
  })

  it('updates the inspector title reactively without changing the selected original', async () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'poster.png', mediaKind: 'image', scrubBlobUrl: null, sourceDuration: 5, inPoint: 0, outPoint: 5, start: 0,
    })
    registerMediaBinSource({ id: 'original', name: 'poster.png', kind: 'image', duration: 5 })
    editor.selectClip(clip.id)
    const view = render(InspectorFactory)

    renameMediaBinSource('poster.png', 'Opening title')
    await tick()

    expect(view.getByRole('heading', { name: 'Opening title' })).toBeInTheDocument()
    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.getClipById(clip.id)?.clip.fileName).toBe('poster.png')
  })

  it('edits clip position and duration from the inspector', async () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'timing.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 1,
    })
    editor.selectClip(clip.id)

    const { getByLabelText } = render(InspectorFactory)
    await fireEvent.change(getByLabelText('Clip position'), { target: { value: '3' } })
    await fireEvent.change(getByLabelText('Clip duration'), { target: { value: '7' } })

    expect(editor.getClipById(clip.id)?.clip.start).toBe(3)
    expect(editor.getClipById(clip.id)?.clip.outPoint).toBe(7)
  })

  it('closes the clip inspector without leaving an empty inspector', async () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)

    const view = render(InspectorFactory)

    expect(view.getByLabelText('Clip inspector')).toBeInTheDocument()
    await fireEvent.click(view.getByLabelText('Close inspector'))
    expect(view.queryByLabelText('Clip inspector')).not.toBeInTheDocument()
  })

  it('closes the active inspector with Escape from an input', async () => {
    const channel = editor.addChannel('video')
    const clip = editor.addClip(channel.id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)

    const view = render(InspectorFactory)
    await fireEvent.keyDown(view.getByLabelText('Clip position'), { key: 'Escape' })

    expect(view.queryByLabelText('Clip inspector')).not.toBeInTheDocument()
  })
})
