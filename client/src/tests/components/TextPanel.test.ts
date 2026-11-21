import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import TextPanel from '../../components/TextPanel.svelte'
import CaptionDialogs from '../../components/CaptionDialogs.svelte'
import { editor } from '../../stores/editor.svelte'
import { resetCaptions } from '../../stores/captions.svelte'
import { TEXT_DRAG_MIME } from '../../lib/text-render'
import { generateCaptions } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  generateCaptions: vi.fn(),
}))

function dataTransfer(): DataTransfer {
  const data = new Map<string, string>()
  return {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    types: [],
    effectAllowed: 'copy',
  } as unknown as DataTransfer
}

describe('TextPanel', () => {
  beforeEach(() => {
    editor.clearTimeline()
    editor.resetProjectAspect()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.setCurrentTime(2)
    editor.clearHistory()
    resetCaptions()
    vi.mocked(generateCaptions).mockReset()
  })

  // Caption dialogs live in CaptionDialogs (mounted by Editor.svelte), so
  // dialog assertions query the whole document instead of one container.
  function renderPanelWithDialogs() {
    render(TextPanel)
    render(CaptionDialogs)
    return screen
  }

  it('places voice-to-text captions before the text presets', () => {
    const { container } = render(TextPanel)
    const sections = container.querySelectorAll('#text-panel .browser-panel-body > *')

    expect(sections[0]).toHaveClass('auto-captions')
    expect(sections[1]).toHaveClass('browser')
  })

  it('adds a preset at the playhead when clicked', async () => {
    const { getByRole } = render(TextPanel)
    await fireEvent.click(getByRole('button', { name: /Title/ }))

    expect(editor.textItems[0]).toMatchObject({ text: 'Your title', start: 2, fontWeight: 700 })
    expect(editor.selectedTextItemId).toBe(editor.textItems[0].id)
  })

  it('adds a colored animated lower-third preset', async () => {
    const { getByRole } = render(TextPanel)
    await fireEvent.click(getByRole('button', { name: /Cobalt rail/ }))

    expect(editor.textItems[0]).toMatchObject({
      text: 'NAME\nRole or description',
      bannerStyle: 'rail',
      accentColor: '#8b67e8',
      animation: 'slide-left',
      animationDuration: 0.45,
    })
  })

  it('adds short-form hooks and timed active-word captions', async () => {
    const { getByRole } = render(TextPanel)

    await fireEvent.click(getByRole('button', { name: /Hook pop/ }))
    expect(editor.textItems[0]).toMatchObject({
      text: 'DO NOT SKIP THIS',
      animation: 'pop',
      animationDuration: 0.28,
      fontFamily: 'montserrat',
    })

    await fireEvent.click(getByRole('button', { name: /^Active word/ }))
    expect(editor.textItems[1]).toMatchObject({
      text: 'MAKE EVERY SECOND COUNT',
      isCaption: true,
      highlightMode: 'word',
      highlightColor: '#f4ea58',
      highlightAnimation: 'pop',
      animation: 'rise',
    })
    expect(editor.textItems[1].words).toHaveLength(4)
  })

  it('adapts preset positions to portrait projects', async () => {
    editor.setProjectAspect('portrait')
    const { getByRole } = render(TextPanel)
    await fireEvent.click(getByRole('button', { name: /Watermark/ }))

    expect(editor.textItems[0].x).toBe(918)
    expect(editor.textItems[0].y).toBe(1555)
  })

  it('uses balanced frame margins for classic projects', async () => {
    editor.setProjectAspect('classic')
    const { getByRole } = render(TextPanel)
    await fireEvent.click(getByRole('button', { name: /Watermark/ }))

    expect(editor.textItems[0].x).toBe(1260)
    expect(editor.textItems[0].y).toBe(970)
  })

  it('exposes presets as text drag data', async () => {
    const transfer = dataTransfer()
    const { getByRole } = render(TextPanel)
    const subtitle = getByRole('button', { name: /Subtitle/ })
    expect(subtitle).toHaveAttribute('draggable', 'true')

    await fireEvent.dragStart(subtitle, { dataTransfer: transfer })

    const payload = JSON.parse(transfer.getData(TEXT_DRAG_MIME))
    expect(payload.values).toMatchObject({ text: 'Add a subtitle', backgroundOpacity: 0.68 })
  })

  it('offers common text styles with their typography', async () => {
    const { getByRole, queryByLabelText } = render(TextPanel)

    expect(getByRole('button', { name: /Social hook/ })).toBeInTheDocument()
    expect(queryByLabelText('Words per caption')).not.toBeInTheDocument()
    await fireEvent.click(getByRole('button', { name: /Breaking news/ }))
    expect(editor.textItems[0]).toMatchObject({ fontSize: 58, fontWeight: 700, backgroundColor: '#c81919', backgroundOpacity: 1 })

    await fireEvent.click(getByRole('button', { name: /Watermark/ }))
    expect(editor.textItems[1]).toMatchObject({ fontSize: 32, fontWeight: 700, opacity: 0.7 })
  })

  it('opens an audio source picker and only lists clips with usable audio', async () => {
    const audioChannel = editor.addChannel('audio')
    const video = editor.addClip(editor.channels[0].id, {
      fileName: 'interview.mp4', sourceMode: 'proxy', mediaKind: 'video', scrubBlobUrl: 'blob:video',
      sourceDuration: 8, inPoint: 0, outPoint: 8, start: 0,
    })
    const linkedAudio = editor.addClip(audioChannel.id, {
      fileName: 'interview.mp4', sourceMode: 'proxy', mediaKind: 'audio', scrubBlobUrl: 'blob:linked-audio',
      sourceDuration: 8, inPoint: 0, outPoint: 8, start: 0, linkedClipId: video.id,
    })
    video.linkedClipId = linkedAudio.id
    editor.addClip(audioChannel.id, {
      fileName: 'voice.wav', sourceMode: 'proxy', mediaKind: 'audio', scrubBlobUrl: 'blob:voice',
      sourceDuration: 4, inPoint: 0, outPoint: 4, start: 9,
    })
    editor.addClip(audioChannel.id, {
      fileName: 'local.wav', sourceMode: 'wasm', mediaKind: 'audio', scrubBlobUrl: 'blob:local',
      sourceDuration: 4, inPoint: 0, outPoint: 4, start: 14,
    })
    editor.addClip(editor.channels[0].id, {
      fileName: 'silent.mp4', sourceMode: 'proxy', mediaKind: 'video', scrubBlobUrl: 'blob:silent',
      sourceDuration: 3, inPoint: 0, outPoint: 3, start: 9,
    })

    const { getByRole, getByLabelText, getByText, queryByText } = renderPanelWithDialogs()
    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))

    expect(getByRole('dialog', { name: 'Select audio for captions' })).toBeInTheDocument()
    expect(getByLabelText('Select clip interview.mp4')).toBeInTheDocument()
    expect(getByLabelText('Select clip voice.wav')).toBeInTheDocument()
    expect(queryByText('silent.mp4')).not.toBeInTheDocument()
    expect(queryByText('local.wav')).not.toBeInTheDocument()

    await fireEvent.click(getByRole('tab', { name: /Audio channels/ }))
    expect(getByLabelText(`Select audio channel ${audioChannel.name}`)).toBeInTheDocument()
    expect(getByText('2 available clips')).toBeInTheDocument()
  })

  it('generates captions from every selectable clip on an audio channel', async () => {
    const audioChannel = editor.addChannel('audio')
    for (const [index, fileName] of ['first.wav', 'second.wav'].entries()) {
      editor.addClip(audioChannel.id, {
        fileName, sourceMode: 'proxy', mediaKind: 'audio', scrubBlobUrl: `blob:${fileName}`,
        sourceDuration: 2, inPoint: 0, outPoint: 2, start: index * 3,
      })
    }
    vi.mocked(generateCaptions).mockResolvedValue({
      cues: [{ start: 0, end: 1, text: 'Spoken line', words: [{ text: 'Spoken', start: 0, end: 0.5 }, { text: 'line', start: 0.5, end: 1 }] }],
    })

    const { getByRole, getByLabelText } = renderPanelWithDialogs()
    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))
    await fireEvent.click(getByRole('tab', { name: /Audio channels/ }))
    await fireEvent.click(getByLabelText(`Select audio channel ${audioChannel.name}`))
    await fireEvent.click(getByRole('button', { name: 'Generate from 2 clips' }))

    await waitFor(() => expect(generateCaptions).toHaveBeenCalledTimes(2))
    expect(vi.mocked(generateCaptions).mock.calls.map(([request]) => request.file)).toEqual(['first.wav', 'second.wav'])
    expect(getByRole('dialog', { name: 'Review captions' })).toBeInTheDocument()
  })

  it('keeps loading visible for at least three seconds for long audio', async () => {
    const audioChannel = editor.addChannel('audio')
    const clip = editor.addClip(audioChannel.id, {
      fileName: 'long-recording.wav',
      sourceMode: 'proxy',
      mediaKind: 'audio',
      scrubBlobUrl: 'blob:long-recording',
      sourceDuration: 20,
      inPoint: 0,
      outPoint: 20,
      start: 0,
    })
    editor.selectClip(clip.id)
    vi.mocked(generateCaptions).mockResolvedValue({
      cues: [{ start: 0, end: 1, text: 'Long audio line', words: [] }],
    })

    const { getByRole } = renderPanelWithDialogs()
    const startedAt = performance.now()
    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))
    await waitFor(() => expect(getByRole('button', { name: 'Transcribing speech...' })).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(getByRole('button', { name: 'Transcribing speech...' })).toBeInTheDocument()
    await waitFor(() => expect(getByRole('dialog', { name: 'Review captions' })).toBeInTheDocument(), { timeout: 5000 })

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(2800)
  })

  it('keeps selected overlapping audio clips checked and requires one choice', async () => {
    const audioChannel = editor.addChannel('audio')
    const first = editor.addClip(audioChannel.id, {
      fileName: 'first.wav', sourceMode: 'proxy', mediaKind: 'audio', scrubBlobUrl: 'blob:first',
      sourceDuration: 4, inPoint: 0, outPoint: 4, start: 0,
    })
    const second = editor.addClip(audioChannel.id, {
      fileName: 'second.wav', sourceMode: 'proxy', mediaKind: 'audio', scrubBlobUrl: 'blob:second',
      sourceDuration: 4, inPoint: 0, outPoint: 4, start: 2,
    })
    editor.selectClips([first.id, second.id])

    const { getByRole, getByLabelText, getByText } = renderPanelWithDialogs()
    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))

    const firstInput = getByLabelText('Select clip first.wav') as HTMLInputElement
    const secondInput = getByLabelText('Select clip second.wav') as HTMLInputElement
    expect(firstInput.checked).toBe(true)
    expect(secondInput.checked).toBe(true)
    expect(getByText('Choose one clip from each overlapping section.')).toBeInTheDocument()
    expect(getByRole('button', { name: 'Generate from 2 clips' })).toBeDisabled()

    await fireEvent.click(getByRole('tab', { name: /Audio channels/ }))
    expect((getByLabelText(`Select audio channel ${audioChannel.name}`) as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(getByRole('tab', { name: /Clips/ }))
    const currentFirstInput = getByLabelText('Select clip first.wav') as HTMLInputElement
    const currentSecondInput = getByLabelText('Select clip second.wav') as HTMLInputElement
    expect(currentFirstInput.checked).toBe(true)
    expect(currentSecondInput.checked).toBe(true)

    await fireEvent.click(currentSecondInput)
    expect(currentFirstInput.checked).toBe(true)
    expect(currentSecondInput.checked).toBe(false)
    expect(getByRole('button', { name: 'Generate from 1 clip' })).toBeEnabled()
  })

  it('maps generated captions onto the selected trimmed clip', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'speech.mp4',
      sourceMode: 'proxy',
      mediaKind: 'video',
      scrubBlobUrl: null,
      sourceDuration: 12,
      inPoint: 2,
      outPoint: 8,
      start: 5,
      playbackRate: 2,
    })
    editor.selectClip(clip.id)
    vi.mocked(generateCaptions).mockResolvedValue({
      cues: [{
        start: 1,
        end: 3,
        text: 'Hello world',
        words: [
          { text: 'Hello', start: 1, end: 1.8 },
          { text: 'world', start: 1.9, end: 3 },
        ],
      }],
    })

    const { getByRole, getByLabelText, getByText, queryByRole } = renderPanelWithDialogs()
    expect(queryByRole('button', { name: 'Edit selected captions' })).not.toBeInTheDocument()
    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))

    await waitFor(() => expect(getByRole('dialog', { name: 'Review captions' })).toBeInTheDocument())
    expect(getByLabelText('Words per caption')).toHaveValue(4)
    expect(editor.textItems).toHaveLength(0)
    expect(generateCaptions).toHaveBeenCalledWith({ file: 'speech.mp4', start: 2, duration: 6, language: 'ro' })
    expect(getByText(/00:00:05\.500/)).toBeInTheDocument()
    await fireEvent.click(getByRole('button', { name: 'Add selected captions' }))

    await waitFor(() => expect(editor.textItems).toHaveLength(1))
    expect(getByRole('button', { name: 'Edit selected captions' })).toBeInTheDocument()
    expect(editor.textItems[0]).toMatchObject({
      text: 'Hello world',
      start: 5.5,
      duration: 1,
      backgroundOpacity: 0,
      fontFamily: 'montserrat',
      fontWeight: 700,
      isCaption: true,
      highlightMode: 'word',
    })
    expect(editor.textItems[0].words).toHaveLength(2)
    expect(editor.textItems[0].words[0]).toMatchObject({ text: 'Hello', start: 0, end: 0.4 })
    expect(editor.textItems[0].words[1].text).toBe('world')
    expect(editor.textItems[0].words[1].start).toBeCloseTo(0.45)
    expect(editor.textItems[0].words[1].end).toBe(1)
    expect(getByText('Added 1 caption to the timeline.')).toBeInTheDocument()

    editor.clearSelection()
    await fireEvent.click(getByRole('button', { name: 'Edit selected captions' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Edit captions' })).toBeInTheDocument())
    expect(getByLabelText('Selected font preview')).toHaveTextContent('Hello world')
    await fireEvent.click(getByLabelText('Caption font'))
    await fireEvent.click(getByRole('button', { name: 'Palatino' }))
    expect(getByLabelText('Selected font preview').querySelector('strong')).toHaveStyle({ fontFamily: 'Palatino, "Palatino Linotype", Georgia, serif' })
    await fireEvent.click(getByRole('button', { name: 'Save caption changes' }))

    await waitFor(() => expect(editor.textItems[0].fontFamily).toBe('palatino'))
    expect(getByText('Updated 1 caption.')).toBeInTheDocument()
  })

  it('keeps an unadded review available from Edit generated captions', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'speech.mp4',
      sourceMode: 'proxy',
      mediaKind: 'video',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)
    vi.mocked(generateCaptions).mockResolvedValue({
      cues: [{ start: 0, end: 1, text: 'Pending caption', words: [] }],
    })

    const { getByRole, getByLabelText, queryByRole } = renderPanelWithDialogs()
    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Review captions' })).toBeInTheDocument())

    // Closing the review keeps the in-dialog edits for the next reopen.
    await fireEvent.input(getByLabelText('Caption 1 text'), { target: { value: 'Edited pending' } })
    await fireEvent.click(getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(queryByRole('dialog', { name: 'Review captions' })).not.toBeInTheDocument())
    expect(getByRole('button', { name: 'Edit generated captions' })).toBeInTheDocument()

    await fireEvent.click(getByRole('button', { name: 'Edit generated captions' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Review captions' })).toBeInTheDocument())
    expect(getByLabelText('Caption 1 text')).toHaveValue('Edited pending')
    await fireEvent.click(getByRole('button', { name: 'Add selected captions' }))

    await waitFor(() => expect(editor.textItems).toHaveLength(1))
    expect(editor.textItems[0].text).toBe('Edited pending')
    // While the new captions are selected the button edits the timeline.
    expect(getByRole('button', { name: 'Edit selected captions' })).toBeInTheDocument()

    // Deleting the timeline captions keeps the transcript available for re-adding.
    editor.clearSelection()
    editor.removeTextItem(editor.textItems[0].id)
    await waitFor(() => expect(getByRole('button', { name: 'Edit generated captions' })).toBeInTheDocument())

    await fireEvent.click(getByRole('button', { name: 'Edit generated captions' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Review captions' })).toBeInTheDocument())
    expect(getByLabelText('Caption 1 text')).toHaveValue('Edited pending')
    await fireEvent.click(getByRole('button', { name: 'Add selected captions' }))

    await waitFor(() => expect(editor.textItems).toHaveLength(1))
    expect(editor.textItems[0].text).toBe('Edited pending')
  })

  it('edits all generated captions when none are selected', async () => {
    const first = editor.addTextItem(0, { text: 'First caption', duration: 1, isCaption: true })
    editor.addTextItem(1, { text: 'Second caption', duration: 1, isCaption: true })
    const { getByRole, getByLabelText } = renderPanelWithDialogs()

    await fireEvent.click(getByRole('button', { name: 'Edit selected captions' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Edit captions' })).toBeInTheDocument())
    expect(getByLabelText('Caption 1 text')).toHaveValue('First caption')
    expect(getByLabelText('Caption 2 text')).toHaveValue('Second caption')
  })

  it('edits only the selected generated captions', async () => {
    const first = editor.addTextItem(0, { text: 'First caption', duration: 1, isCaption: true })
    editor.addTextItem(1, { text: 'Second caption', duration: 1, isCaption: true })
    editor.selectTextItem(first.id)
    const { getByRole, getByLabelText, queryByLabelText } = renderPanelWithDialogs()

    await fireEvent.click(getByRole('button', { name: 'Edit selected captions' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Edit captions' })).toBeInTheDocument())
    expect(getByLabelText('Caption 1 text')).toHaveValue('First caption')
    expect(queryByLabelText('Caption 2 text')).not.toBeInTheDocument()
  })

  it('edits selected text layers through the same text treatment editor', async () => {
    const text = editor.addTextItem(0, { text: 'Direct text layer', duration: 2, isCaption: false })
    editor.selectTextItem(text.id)
    const { getByRole, getByLabelText } = renderPanelWithDialogs()

    await fireEvent.click(getByRole('button', { name: 'Edit selected text' }))
    await waitFor(() => expect(getByRole('dialog', { name: 'Edit text' })).toBeInTheDocument())
    expect(getByLabelText('Text 1 content')).toHaveValue('Direct text layer')
    expect(getByLabelText('Text type')).toHaveAttribute('data-value', 'text')

    await fireEvent.click(getByLabelText('Text font'))
    await fireEvent.click(getByRole('button', { name: 'Oswald' }))
    await fireEvent.click(getByRole('button', { name: 'Save text changes' }))

    await waitFor(() => expect(editor.textItems[0].fontFamily).toBe('oswald'))
  })

  it('lets the user deselect generated lines to fit the project text limit', async () => {
    for (let index = 0; index < 99; index++) editor.addTextItem(index, { text: `Existing ${index}` })
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'speech.mp4', sourceMode: 'proxy', mediaKind: 'video', scrubBlobUrl: null,
      sourceDuration: 5, inPoint: 0, outPoint: 5, start: 0,
    })
    editor.selectClip(clip.id)
    vi.mocked(generateCaptions).mockResolvedValue({
      cues: [
        { start: 0, end: 1, text: 'First', words: [{ text: 'First', start: 0, end: 1 }] },
        { start: 1, end: 2, text: 'Second', words: [{ text: 'Second', start: 1, end: 2 }] },
      ],
    })
    const { getByRole, getByLabelText } = renderPanelWithDialogs()

    await fireEvent.click(getByRole('button', { name: 'Generate voice to text' }))
    const add = await waitFor(() => getByRole('button', { name: 'Add selected captions' }))
    await fireEvent.change(getByLabelText('Words per caption'), { target: { value: '1' } })
    expect(add).toBeDisabled()
    await fireEvent.click(getByLabelText('Include caption 2'))
    expect(add).toBeEnabled()
    await fireEvent.click(add)

    await waitFor(() => expect(editor.textItems).toHaveLength(100))
    expect(editor.textItems.at(-1)?.text).toBe('First')
  })
})
