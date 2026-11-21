import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import EffectsPanel from '../../components/EffectsPanel.svelte'
import TransitionsPanel from '../../components/TransitionsPanel.svelte'
import { EFFECTS } from '../../lib/effects'
import { editor } from '../../stores/editor.svelte'

describe('EffectsPanel', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    editor.selectClip(null)
    editor.setCurrentTime(0)
  })

  it('renders the panel title and subtitle', () => {
    const { getByLabelText, getByText } = render(EffectsPanel)
    expect(getByLabelText('Effects browser')).toBeTruthy()
    expect(getByText('Effects')).toBeTruthy()
    expect(getByText('Add effects at the playhead')).toBeTruthy()
  })

  it('renders Effects and Transitions in separate browsers without duplicate titles', () => {
    const effects = render(EffectsPanel)
    const transitions = render(TransitionsPanel)
    expect(effects.getAllByText('Effects')).toHaveLength(1)
    expect(transitions.getAllByText('Transitions')).toHaveLength(1)
    expect(effects.getByLabelText('Available effects')).toBeTruthy()
    expect(transitions.getByLabelText('Available transitions')).toBeTruthy()
    expect(effects.container.querySelector('[data-look-id]')).toBeNull()
  })

  it('renders visual cards for every effect and transition', () => {
    const effects = render(EffectsPanel)
    const transitions = render(TransitionsPanel)
    expect(effects.container.querySelectorAll('[data-effect-id]')).toHaveLength(
      EFFECTS.filter((item) => item.kind === 'effect').length,
    )
    expect(transitions.container.querySelectorAll('[data-transition-id]')).toHaveLength(
      EFFECTS.filter((item) => item.kind === 'transition').length,
    )
    expect(effects.container.querySelector('[data-effect-id="grayscale"] .effect-preview')).toBeTruthy()
    expect(transitions.container.querySelector('[data-transition-id="cross-dissolve"] .transition-preview')).toBeTruthy()
  })

  it('explains each effect result and its default controls in the card', () => {
    const { getByText, getByRole } = render(EffectsPanel)

    expect(getByText('Softens detail with an even, adjustable blur.')).toBeInTheDocument()
    const blurCard = getByRole('button', { name: /Blur\. Softens detail.*add at the playhead/i })
    expect(blurCard).toHaveTextContent('4 controls')
    expect(blurCard).toHaveTextContent('2 s default')
  })

  it('shows empty state when no video track', () => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    const { getByText } = render(EffectsPanel)
    expect(getByText(/Add a video track first/)).toBeTruthy()
  })

  it('transition chips are draggable and do NOT create effect blocks on click', async () => {
    const { getByText } = render(TransitionsPanel)
    const card = getByText('Cross Dissolve').closest('button') as HTMLButtonElement
    expect(card.draggable).toBe(true)
    await fireEvent.click(card)
    expect(editor.effectBlocks).toHaveLength(0)
  })

  it('clicking a transition applies it to adjacent selected clips', async () => {
    const channel = editor.channels.find((candidate) => candidate.type === 'video')!
    const clips = [0, 4, 8].map((start) => editor.addClip(channel.id, {
      fileName: `clip-${start}.mp4`,
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start,
    }))
    editor.selectClips(clips.map((clip) => clip.id))

    const { getByText } = render(TransitionsPanel)
    await fireEvent.click(getByText('Cross Dissolve'))

    expect(editor.transitions).toHaveLength(2)
    expect(editor.transitions.every((transition) => transition.effectId === 'cross-dissolve')).toBe(true)
  })

  it('dragging a transition chip sets the transition MIME data', async () => {
    const { getByText } = render(TransitionsPanel)
    const setData = vi.fn()
    await fireEvent.dragStart(getByText('Cross Dissolve'), {
      dataTransfer: { setData, effectAllowed: '' },
    })
    expect(setData).toHaveBeenCalledWith(
      'application/x-cineedit-transition',
      JSON.stringify({ effectId: 'cross-dissolve' }),
    )
  })

  it('dragging an effect chip sets the effect MIME data', async () => {
    const { getByText } = render(EffectsPanel)
    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: '' }
    await fireEvent.dragStart(getByText('Sepia'), { dataTransfer })
    expect(setData).toHaveBeenCalledWith(
      'application/x-cineedit-effect',
      JSON.stringify({ effectId: 'sepia' }),
    )
    expect(dataTransfer.effectAllowed).toBe('copy')
  })

  it('clicking an effect chip adds an effect block at playhead', async () => {
    editor.setCurrentTime(2)
    const { getByText } = render(EffectsPanel)
    await fireEvent.click(getByText('Sepia'))
    expect(editor.effectBlocks).toHaveLength(1)
    const block = editor.effectBlocks[0]
    expect(block.effectId).toBe('sepia')
    expect(block.start).toBe(2)
    expect(block.duration).toBe(2)
  })

  it('selects a newly added effect so its inspector can open', async () => {
    const { getByText } = render(EffectsPanel)
    await fireEvent.click(getByText('Sepia'))
    expect(editor.selectedEffectBlockIds).toEqual([editor.effectBlocks[0].id])
  })
})
