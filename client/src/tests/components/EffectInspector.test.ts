import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import EffectInspector from '../../components/EffectInspector.svelte'
import { editor } from '../../stores/editor.svelte'

describe('EffectInspector', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    editor.selectClip(null)
    editor.setFps(30)
    editor.clearHistory()
  })

  it('shows editable timing for one selected effect', () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 2, 3)!
    editor.selectEffectBlock(block.id)

    const { getByLabelText, getByText, queryByText } = render(EffectInspector)

    expect(getByText('Blur')).toBeInTheDocument()
    expect(getByLabelText('Effect position')).toHaveValue(2)
    expect(getByLabelText('Effect duration')).toHaveValue(3)
    expect(queryByText('Range')).not.toBeInTheDocument()
  })

  it('updates the position of one selected effect', async () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 2, 3)!
    editor.selectEffectBlock(block.id)
    const { getByLabelText } = render(EffectInspector)

    await fireEvent.change(getByLabelText('Effect position'), { target: { value: '5' } })

    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)!.start).toBe(5)
  })

  it('edits and resets the selected effect parameters', async () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 2, 3)!
    editor.selectEffectBlock(block.id)
    const { getByLabelText, getByRole, getByText } = render(EffectInspector)

    expect(getByText('Effect Settings')).toBeInTheDocument()
    expect(getByText('4 adjustable parameters')).toBeInTheDocument()
    expect(getByText('Softens detail with an even, adjustable blur.')).toBeInTheDocument()
    expect(getByText('How it works')).toBeInTheDocument()
    expect(getByLabelText('Luma radius value')).toHaveValue(8)

    await fireEvent.change(getByLabelText('Luma radius value'), { target: { value: '20' } })
    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)!.params.lumaRadius).toBe(20)

    await fireEvent.click(getByRole('button', { name: 'Reset' }))
    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)!.params.lumaRadius).toBe(8)
  })

  it('configures an eased intensity ramp for the selected effect', async () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 2, 4)!
    editor.selectEffectBlock(block.id)
    const { getByLabelText, getByRole } = render(EffectInspector)
    const current = () => editor.effectBlocks.find((candidate) => candidate.id === block.id)!

    await fireEvent.click(getByRole('button', { name: 'Fade In' }))
    expect(current().ramp).toEqual({ mode: 'in', curve: 'ease-in-out', amount: 0.25 })

    await fireEvent.click(getByRole('button', { name: 'Ease Out' }))
    await fireEvent.input(getByLabelText('Intensity ramp length'), { target: { value: '40' } })
    expect(current().ramp).toEqual({ mode: 'in', curve: 'ease-out', amount: 0.4 })

    await fireEvent.click(getByRole('button', { name: 'Constant' }))
    expect(current().ramp).toBeNull()
  })

  it('moves a multi-selection rigidly and applies one duration to every effect', async () => {
    const first = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
    const second = editor.addEffectBlock(editor.channels[0].id, 'sepia', 4, 3)!
    editor.selectItems([], [first.id, second.id])
    const { getByLabelText, getByText } = render(EffectInspector)
    const duration = getByLabelText('Effect duration') as HTMLInputElement

    expect(getByText('2 effects')).toBeInTheDocument()
    expect(duration.value).toBe('')
    expect(duration.placeholder).toBe('Mixed')

    await fireEvent.change(getByLabelText('Effect position'), { target: { value: '3' } })
    expect(editor.effectBlocks.find((block) => block.id === first.id)!.start).toBe(3)
    expect(editor.effectBlocks.find((block) => block.id === second.id)!.start).toBe(6)

    await fireEvent.change(duration, { target: { value: '4' } })
    expect(editor.effectBlocks.find((block) => block.id === first.id)!.duration).toBe(4)
    expect(editor.effectBlocks.find((block) => block.id === second.id)!.duration).toBe(4)

    await fireEvent.change(getByLabelText('Effect 2 position'), { target: { value: '9' } })
    expect(editor.effectBlocks.find((block) => block.id === second.id)!.start).toBe(9)
  })

  it('moves selected clips and effects together from the shared position control', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 4, start: 2,
    })
    const secondClip = editor.addClip(editor.channels[0].id, {
      fileName: 'second-video.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 8,
    })
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 5, 2)!
    editor.selectItems([clip.id, secondClip.id], [block.id])
    const { getByLabelText } = render(EffectInspector)

    expect(getByLabelText('Effect position')).toHaveValue(2)
    await fireEvent.change(getByLabelText('Effect position'), { target: { value: '4' } })

    expect(editor.getClipById(clip.id)!.clip.start).toBe(4)
    expect(editor.getClipById(secondClip.id)!.clip.start).toBe(10)
    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)!.start).toBe(7)
  })

  it('disables timing controls when an affected track is locked', () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
    editor.selectEffectBlock(block.id)
    editor.toggleLock(editor.channels[0].id)

    const { getByLabelText, getByText } = render(EffectInspector)

    expect(getByLabelText('Effect position')).toBeDisabled()
    expect(getByLabelText('Effect duration')).toBeDisabled()
    expect(getByText('Unlock every affected track to edit timing.')).toBeInTheDocument()
  })

  it('changes clip speed and keeps linked audio synchronized', async () => {
    const values = {
      fileName: 'linked.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 0,
    }
    const video = editor.addClip(editor.channels[0].id, values)
    const audio = editor.addClip(editor.channels[1].id, values)
    video.linkedClipId = audio.id
    audio.linkedClipId = video.id
    editor.selectClip(video.id)
    const { getByLabelText, getAllByText, getByText } = render(EffectInspector)

    await fireEvent.change(getByLabelText('Clip playback speed'), { target: { value: '2' } })

    expect(editor.getClipById(video.id)!.clip.playbackRate).toBe(2)
    expect(editor.getClipById(audio.id)!.clip.playbackRate).toBe(2)
    expect(getAllByText('2.50 s').length).toBeGreaterThanOrEqual(1)
    expect(getByText('Linked audio and video use the same speed.')).toBeInTheDocument()
  })

  it('does not repeat selected clip timing in a passive Range section', () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'a.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 2, outPoint: 8, start: 3, playbackRate: 2,
    })!
    editor.selectClip(clip.id)
    const { queryByText } = render(EffectInspector)

    expect(queryByText('Range')).not.toBeInTheDocument()
    expect(queryByText('Position')).not.toBeInTheDocument()
  })

  it('closes by clearing the effect selection', async () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
    editor.selectEffectBlock(block.id)
    const { getByLabelText } = render(EffectInspector)

    await fireEvent.click(getByLabelText('Close inspector'))

    expect(editor.selectedEffectBlockIds).toEqual([])
  })
})
