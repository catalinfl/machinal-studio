import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/svelte'
import CaptionEditorDialog from '../../components/CaptionEditorDialog.svelte'
import { editor } from '../../stores/editor.svelte'
import type { CaptionDraft } from '../../lib/subtitles'

function captionDraft(): CaptionDraft {
  const item = editor.addTextItem(1, {
    text: 'Keep my words',
    duration: 2,
    isCaption: true,
    highlightMode: 'word',
    words: [
      { text: 'Keep', start: 0, end: 0.7 },
      { text: 'my', start: 0.7, end: 1.2 },
      { text: 'words', start: 1.2, end: 2 },
    ],
  })
  const { id, ...values } = item
  return { ...values, draftId: id, sourceLabel: 'Transcript', included: true }
}

describe('CaptionEditorDialog', () => {
  beforeEach(() => {
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
  })

  it('keeps the caption count and selection status in sync with selection actions', async () => {
    const { getByRole } = render(CaptionEditorDialog, {
      drafts: [captionDraft()],
      maxItems: 10,
      onCancel: vi.fn(),
      onAdd: vi.fn(),
    })
    const dialog = within(getByRole('dialog', { name: 'Review captions' }))

    expect(dialog.getByText('1 caption')).toBeInTheDocument()
    expect(dialog.getByText('All selected')).toBeInTheDocument()
    expect(dialog.getByLabelText('Start 00:00:01.000, end 00:00:03.000')).toBeInTheDocument()

    await fireEvent.click(dialog.getByRole('button', { name: 'Clear' }))
    expect(dialog.getByText('None selected')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Add selected captions' })).toBeDisabled()

    await fireEvent.click(dialog.getByRole('button', { name: 'Select all' }))
    expect(dialog.getByText('All selected')).toBeInTheDocument()
  })

  it('applies short-form essentials to selected captions without replacing their cue data', async () => {
    const onAdd = vi.fn()
    const { getByRole } = render(CaptionEditorDialog, {
      drafts: [captionDraft()],
      maxItems: 10,
      onCancel: vi.fn(),
      onAdd,
    })
    const dialog = within(getByRole('dialog', { name: 'Review captions' }))

    const presetPicker = dialog.getByRole('combobox', { name: 'Short-form caption preset' })
    expect(presetPicker).toHaveAttribute('data-value', '')
    await fireEvent.click(presetPicker)
    expect(within(dialog.getByRole('listbox', { name: 'Short-form caption preset' })).getAllByRole('option')).toHaveLength(22)
    await fireEvent.click(dialog.getByRole('button', { name: 'Hook pop' }))
    expect(presetPicker).toHaveAttribute('data-value', 'hook-pop')
    expect(dialog.getByRole('img', { name: 'Selected caption style preview' })).toHaveTextContent('Keep my words')
    await fireEvent.click(dialog.getByRole('button', { name: 'Add selected captions' }))

    const saved = onAdd.mock.calls[0][0][0] as CaptionDraft
    expect(saved).toMatchObject({
      text: 'Keep my words',
      start: 1,
      duration: 2,
      animation: 'pop',
      animationDuration: 0.28,
      fontFamily: 'montserrat',
      fontSize: 70,
      highlightMode: 'none',
    })
    expect(saved.words).toHaveLength(3)
  })

  it('offers every motion independently from the selected short-form style', async () => {
    const onAdd = vi.fn()
    const { getByRole } = render(CaptionEditorDialog, {
      drafts: [captionDraft()],
      maxItems: 10,
      onCancel: vi.fn(),
      onAdd,
    })
    const dialog = within(getByRole('dialog', { name: 'Review captions' }))
    const animation = dialog.getByLabelText('Caption animation')

    await fireEvent.click(animation)
    expect(within(dialog.getByRole('listbox', { name: 'Caption animation' })).getAllByRole('option')).toHaveLength(10)
    await fireEvent.click(dialog.getByRole('button', { name: 'Beat shake' }))
    await fireEvent.change(dialog.getByLabelText('Caption animation duration'), { target: { value: '0.6' } })
    await fireEvent.click(dialog.getByRole('button', { name: 'Add selected captions' }))

    expect(onAdd.mock.calls[0][0][0]).toMatchObject({ animation: 'shake', animationDuration: 0.6 })
  })

  it('previews the first caption live with motion and playback controls', async () => {
    const { getByRole } = render(CaptionEditorDialog, {
      drafts: [captionDraft()],
      maxItems: 10,
      onCancel: vi.fn(),
      onAdd: vi.fn(),
    })
    const dialog = within(getByRole('dialog', { name: 'Review captions' }))
    const preview = dialog.getByRole('img', { name: 'Selected caption style preview' })
    expect(preview).toHaveTextContent('Keep my words')

    await fireEvent.change(dialog.getByLabelText('Caption size'), { target: { value: '140' } })
    expect(preview.querySelector('.preview-caption')?.getAttribute('style')).toContain('font-size: 18px')

    const animation = dialog.getByLabelText('Caption animation')
    await fireEvent.click(animation)
    await fireEvent.click(dialog.getByRole('button', { name: 'Rise from below' }))
    expect(preview.querySelector('.preview-caption')?.className).toContain('enter-rise')

    await fireEvent.click(dialog.getByRole('button', { name: 'Pause caption preview' }))
    expect(dialog.getByRole('button', { name: 'Play caption preview' })).toBeInTheDocument()
    await fireEvent.click(dialog.getByRole('button', { name: 'Replay caption preview' }))
  })

  it('keeps the selected look and word motion when switching between styles', async () => {
    const onAdd = vi.fn()
    const { getByRole } = render(CaptionEditorDialog, {
      drafts: [captionDraft()],
      maxItems: 10,
      mode: 'edit',
      onCancel: vi.fn(),
      onAdd,
    })
    const dialog = within(getByRole('dialog', { name: 'Edit captions' }))
    const preset = dialog.getByRole('combobox', { name: 'Short-form caption preset' })

    await fireEvent.click(preset)
    await fireEvent.click(dialog.getByRole('button', { name: 'TikTok pop' }))
    expect(preset).toHaveAttribute('data-value', 'tiktok-pop')

    const wordMotion = dialog.getByRole('combobox', { name: 'Active word animation' })
    await fireEvent.click(wordMotion)
    await fireEvent.click(dialog.getByRole('button', { name: 'Slide up' }))
    expect(preset).toHaveAttribute('data-value', 'tiktok-pop')
    expect(dialog.getByRole('img', { name: 'Selected caption style preview' })).toHaveTextContent('Keep my words')

    await fireEvent.click(preset)
    await fireEvent.click(dialog.getByRole('button', { name: 'TikTok box' }))
    expect(preset).toHaveAttribute('data-value', 'tiktok-box')
    expect(wordMotion).toHaveAttribute('data-value', 'slide-up')
    await fireEvent.click(dialog.getByRole('button', { name: 'Save caption changes' }))

    expect(onAdd.mock.calls[0][0][0]).toMatchObject({
      text: 'Keep my words',
      highlightAnimation: 'slide-up',
      highlightBackgroundColor: '#f4ea58',
      highlightBackgroundOpacity: 1,
    })
  })
})
