import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import TextInspector from '../../components/TextInspector.svelte'
import { editor } from '../../stores/editor.svelte'

describe('TextInspector', () => {
  beforeEach(() => {
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    const item = editor.addTextItem(0, { text: 'Caption' })
    editor.selectTextItem(item.id)
    editor.clearHistory()
  })

  it('enables and styles the text background', async () => {
    const { getByRole, getByLabelText } = render(TextInspector)
    const toggle = getByRole('button', { name: 'Off' })
    await fireEvent.click(toggle)
    await fireEvent.input(getByLabelText('Text background color'), { target: { value: '#336699' } })
    await fireEvent.input(getByLabelText('Text background opacity'), { target: { value: '0.45' } })
    await fireEvent.change(getByLabelText('Text background padding'), { target: { value: '32' } })
    await fireEvent.change(getByLabelText('Text background radius'), { target: { value: '14' } })

    expect(editor.textItems[0]).toMatchObject({
      backgroundColor: '#336699',
      backgroundOpacity: 0.45,
      backgroundPadding: 32,
      backgroundRadius: 14,
    })
  })

  it('edits banner color and slide transition', async () => {
    const { getByLabelText, getByRole } = render(TextInspector)

    await fireEvent.click(getByLabelText('Text banner style'))
    await fireEvent.click(getByRole('button', { name: 'Underline' }))
    await fireEvent.input(getByLabelText('Text banner accent color'), { target: { value: '#27c5e5' } })
    await fireEvent.click(getByLabelText('Text animation'))
    await fireEvent.click(getByRole('button', { name: 'Slide from right' }))
    await fireEvent.input(getByLabelText('Text animation duration'), { target: { value: '0.65' } })

    expect(editor.textItems[0]).toMatchObject({
      bannerStyle: 'underline',
      accentColor: '#27c5e5',
      animation: 'slide-right',
      animationDuration: 0.65,
    })
  })

  it('offers the expanded short-form motion library', async () => {
    const { getByLabelText, getByRole, getAllByRole } = render(TextInspector)
    const motion = getByLabelText('Text animation')

    await fireEvent.click(motion)
    expect(getAllByRole('option')).toHaveLength(9)
    await fireEvent.click(getByRole('button', { name: 'Caption bounce' }))

    expect(editor.textItems[0].animation).toBe('bounce')
    expect(getByLabelText('Text animation duration')).toBeInTheDocument()
  })

  it('offers and applies the expanded font library', async () => {
    const { getByLabelText, getByRole, getAllByRole } = render(TextInspector)
    const font = getByLabelText('Text font')

    await fireEvent.click(font)
    expect(getAllByRole('option')).toHaveLength(22)
    await fireEvent.click(getByRole('button', { name: 'Palatino' }))

    expect(editor.textItems[0].fontFamily).toBe('palatino')
  })

  it('shows word highlight controls only for voice-to-text captions', () => {
    const normalText = render(TextInspector)

    expect(normalText.queryByLabelText('Text active word highlight')).not.toBeInTheDocument()
    expect(normalText.queryByLabelText('Text active word color')).not.toBeInTheDocument()
    normalText.unmount()

    const caption = editor.addTextItem(0, {
      text: 'Voice caption',
      isCaption: true,
      highlightMode: 'word',
      words: [{ text: 'Voice', start: 0, end: 0.5 }],
    })
    editor.selectTextItem(caption.id)
    const voiceToText = render(TextInspector)

    expect(voiceToText.getByLabelText('Text active word highlight')).toBeInTheDocument()
    expect(voiceToText.getByLabelText('Text active word color')).toBeInTheDocument()
    expect(voiceToText.getByLabelText('Text active word animation')).toBeInTheDocument()
    expect(voiceToText.getByLabelText('Text active word background color')).toBeInTheDocument()
    expect(voiceToText.getByLabelText('Text active word background opacity')).toBeInTheDocument()
  })

  it('applies style changes to every selected text while keeping content independent', async () => {
    const first = editor.textItems[0]
    const second = editor.addTextItem(1, { text: 'Second caption', fontSize: 32 })
    editor.selectItems([], [], [first.id, second.id])
    const { getByLabelText, getByText, getByRole } = render(TextInspector)

    expect(getByText('2 text layers selected')).toBeInTheDocument()
    await fireEvent.click(getByLabelText('Text font'))
    await fireEvent.click(getByRole('button', { name: 'Montserrat' }))
    await fireEvent.change(getByLabelText('Text size'), { target: { value: '72' } })
    await fireEvent.input(getByLabelText('Text content'), { target: { value: 'Edited active caption' } })

    expect(editor.textItems[0]).toMatchObject({ text: 'Caption', fontFamily: 'montserrat', fontSize: 72 })
    expect(editor.textItems[1]).toMatchObject({ text: 'Edited active caption', fontFamily: 'montserrat', fontSize: 72 })
  })
})
