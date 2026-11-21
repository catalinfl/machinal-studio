import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import PresetsPanel from '../../components/PresetsPanel.svelte'
import { CLIP_LOOK_DRAG_MIME, CLIP_LOOKS } from '../../lib/clip-looks'
import { editor } from '../../stores/editor.svelte'

describe('PresetsPanel', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    editor.selectClip(null)
    editor.setCurrentTime(0)
  })

  it('renders the presets browser separately from effects', () => {
    const { getByLabelText, getByText } = render(PresetsPanel)

    expect(getByLabelText('Clip styles browser')).toBeTruthy()
    expect(getByText('Clip Styles')).toBeTruthy()
    expect(getByText('Ready-made looks for your clips')).toBeTruthy()
  })

  it('renders every clip look with distinct preview metadata', () => {
    const { container, getAllByText } = render(PresetsPanel)

    expect(container.querySelectorAll('[data-look-id]')).toHaveLength(CLIP_LOOKS.length)
    expect(container.querySelector('[data-look-id="fine-film"] .look-fine-film')).toBeTruthy()
    expect(getAllByText('Top')).toHaveLength(CLIP_LOOKS.filter(({ popular }) => popular).length)
    expect(container.querySelectorAll('[data-look-id] .popular')).toHaveLength(
      CLIP_LOOKS.filter(({ popular }) => popular).length,
    )
  })

  it('applies a compound clip look to exactly one selected video clip', async () => {
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    const clip = editor.addClip(channel.id, {
      fileName: 'portrait.mp4',
      scrubBlobUrl: null,
      sourceDuration: 20,
      inPoint: 0,
      outPoint: 20,
      start: 0,
    })
    editor.selectClip(clip.id)
    const { getByRole } = render(PresetsPanel)

    await fireEvent.click(getByRole('button', { name: /Sepia Strobe/ }))

    expect(editor.effectBlocks).toHaveLength(8)
    expect(editor.effectBlocks.every((block) => block.ownerClipId === clip.id)).toBe(true)
    expect(editor.getClipById(clip.id)?.clip.transformKeyframes?.at(-1)?.transform.zoomX).toBeCloseTo(1.12)
  })

  it('applies a preset across the full duration of every selected video clip', async () => {
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    const clips = [
      editor.addClip(channel.id, {
        fileName: 'first.mp4',
        scrubBlobUrl: null,
        sourceDuration: 20,
        inPoint: 0,
        outPoint: 4,
        start: 1,
      }),
      editor.addClip(channel.id, {
        fileName: 'second.mp4',
        scrubBlobUrl: null,
        sourceDuration: 20,
        inPoint: 2,
        outPoint: 8,
        start: 7,
      }),
    ]
    editor.selectClips(clips.map((clip) => clip.id))
    const { getByRole } = render(PresetsPanel)
    const preset = getByRole('button', { name: /Sepia Strobe/ })

    expect(preset).not.toBeDisabled()
    await fireEvent.click(preset)

    for (const clip of clips) {
      const ownedBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === clip.id)
      expect(ownedBlocks).toHaveLength(8)
      expect(Math.max(...ownedBlocks.map((block) => block.start + block.duration)))
        .toBeCloseTo(clip.start + (clip.outPoint - clip.inPoint))
    }
  })

  it('keeps clip looks available for drag and drop without selected video clips', () => {
    const { getByRole } = render(PresetsPanel)

    const preset = getByRole('button', { name: /Sepia Strobe/ })
    expect(preset).not.toBeDisabled()
    expect(preset).toHaveAttribute('draggable', 'true')
  })

  it('writes a clip look payload for drag and drop', async () => {
    const { getByRole } = render(PresetsPanel)
    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: 'none' } as unknown as DataTransfer

    await fireEvent.dragStart(getByRole('button', { name: /Sepia Strobe/ }), { dataTransfer })

    expect(setData).toHaveBeenCalledWith(CLIP_LOOK_DRAG_MIME, JSON.stringify({ lookId: 'sepia-strobe' }))
    expect(dataTransfer.effectAllowed).toBe('copy')
  })
})
