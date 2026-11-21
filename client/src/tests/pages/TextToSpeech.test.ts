import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/svelte'
import TextToSpeech from '../../components/TextToSpeechPanel.svelte'
import { clearMediaBinSources, registerMediaBinSource } from '../../lib/media-bin'
import { editor } from '../../stores/editor.svelte'

const speech = vi.hoisted(() => ({
  generate: vi.fn(),
  list: vi.fn(),
  upload: vi.fn(),
}))

const metadata = vi.hoisted(() => ({
  audio: vi.fn(),
  video: vi.fn(),
}))

vi.mock('../../lib/speech', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/speech')>(),
  generateSpeech: speech.generate,
  listSpeechReferences: speech.list,
  uploadSpeechReference: speech.upload,
}))

vi.mock('../../lib/video-metadata', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/video-metadata')>(),
  readAudioMetadata: metadata.audio,
  readVideoMetadata: metadata.video,
}))

async function renderCloningSpeech(): Promise<RenderResult<typeof TextToSpeech>> {
  const page = render(TextToSpeech)
  await fireEvent.click(page.getByRole('combobox', { name: /Model/ }))
  await fireEvent.click(page.getByText('Fish Audio S2.1 Pro'))
  return page
}

describe('TextToSpeech', () => {
  beforeEach(() => {
    localStorage.clear()
    editor.clearTimeline()
    editor.clearHistory()
    speech.list.mockReset().mockResolvedValue(['my-voice.mp3'])
    speech.upload.mockReset().mockResolvedValue('new-voice.mp3')
    speech.generate.mockReset().mockResolvedValue({
      asset: { id: 'voice-1', name: 'voice_buna_aceasta_a1b2c3d4.mp3', mediaType: 'audio/mpeg', sourceMode: 'proxy' },
      blobUrl: 'blob:voice-result',
      duration: 4.2,
    })
    metadata.audio.mockReset().mockResolvedValue({ duration: 12 })
    metadata.video.mockReset().mockResolvedValue({ duration: 80, width: 1920, height: 1080 })
    clearMediaBinSources()
    vi.unstubAllGlobals()
  })

  it('requires consent and generates with a Media Bin voice sample', async () => {
    const page = await renderCloningSpeech()
    await waitFor(() => expect(page.container.querySelector('#voice-reference')).toHaveAttribute('data-value', 'my-voice.mp3'))
    await fireEvent.input(page.getByLabelText('Script'), { target: { value: 'Buna, aceasta este vocea mea.' } })
    expect(page.getByRole('button', { name: 'Generate at Playhead' })).toBeDisabled()
    await fireEvent.click(page.getByLabelText(/I have permission/))
    editor.setCurrentTime(3)
    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))

    await waitFor(() => expect(speech.generate).toHaveBeenCalledOnce())
    expect(speech.generate).toHaveBeenCalledWith({
      input: 'Buna, aceasta este vocea mea.',
      language: 'auto',
      model: 'fish-audio/s2.1-pro',
      referenceName: 'my-voice.mp3',
    }, expect.any(AbortSignal))
    expect(await page.findByText('Speech generated and added to the Media Bin and timeline.')).toBeTruthy()
    expect(page.getByText('voice_buna_aceasta_a1b2c3d4.mp3')).toBeTruthy()
    expect(page.getByRole('button', { name: 'Play voice_buna_aceasta_a1b2c3d4.mp3' })).toBeTruthy()
    expect(page.container.querySelector('audio[controls]')).toBeNull()
    expect(editor.channels.find((channel) => channel.type === 'audio')?.clips[0]).toMatchObject({
      fileName: 'voice_buna_aceasta_a1b2c3d4.mp3',
      mediaKind: 'audio',
      start: 3,
      outPoint: 4.2,
    })
  })

  it('switches to a built-in Voxtral voice without requiring consent', async () => {
    const page = render(TextToSpeech)
    await fireEvent.click(page.getByRole('combobox', { name: /Model/ }))
    await fireEvent.click(page.getByText('Voxtral Mini TTS'))
    await fireEvent.click(page.getByRole('button', { name: 'Built-in voice' }))
    await fireEvent.input(page.getByLabelText('Script'), { target: { value: 'Hello from Voxtral.' } })
    expect(page.container.querySelector('#preset-voice')).toHaveAttribute('data-value', 'en_paul_sad')
    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))

    await waitFor(() => expect(speech.generate).toHaveBeenCalledWith({
      input: 'Hello from Voxtral.',
      language: 'auto',
      model: 'mistralai/voxtral-mini-tts-2603',
      voice: 'en_paul_sad',
    }, expect.any(AbortSignal)))
  })

  it('can retry after failure and generate again after success', async () => {
    speech.generate.mockRejectedValueOnce(new Error('Please try again'))
    const page = await renderCloningSpeech()
    await waitFor(() => expect(page.container.querySelector('#voice-reference')).toHaveAttribute('data-value', 'my-voice.mp3'))
    await fireEvent.input(page.getByLabelText('Script'), { target: { value: 'A retryable request.' } })
    await fireEvent.click(page.getByLabelText(/I have permission/))
    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))
    expect(await page.findByRole('alert')).toHaveTextContent('Please try again')
    expect(page.getByRole('button', { name: 'Generate at Playhead' })).toBeEnabled()

    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))
    await page.findByText('Speech generated and added to the Media Bin and timeline.')
    expect(page.queryByRole('alert')).toBeNull()
    expect(page.getByRole('button', { name: 'Choose audio or video' })).toBeEnabled()

    editor.setCurrentTime(5)
    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))
    await waitFor(() => expect(editor.channels.find((channel) => channel.type === 'audio')?.clips).toHaveLength(2))
    expect(speech.generate).toHaveBeenCalledTimes(3)
  })

  it('clears the generating status when the request is aborted', async () => {
    speech.generate.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
    const page = await renderCloningSpeech()
    await waitFor(() => expect(page.container.querySelector('#voice-reference')).toHaveAttribute('data-value', 'my-voice.mp3'))
    await fireEvent.input(page.getByLabelText('Script'), { target: { value: 'A cancelled request.' } })
    await fireEvent.click(page.getByLabelText(/I have permission/))
    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))
    await waitFor(() => expect(page.getByRole('button', { name: 'Generate at Playhead' })).toBeEnabled())
    expect(page.queryByRole('status')).toBeNull()
    expect(page.queryByRole('alert')).toBeNull()
  })

  it('uploads a new voice sample', async () => {
    const page = await renderCloningSpeech()
    const file = new File(['voice'], 'new-voice.mp3', { type: 'audio/mpeg' })
    await fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await fireEvent.click(await page.findByRole('button', { name: 'Upload selected segment' }))
    await waitFor(() => expect(speech.upload).toHaveBeenCalledWith(file, 0, 12))
    expect(page.container.querySelector('#voice-reference')).toHaveAttribute('data-value', 'new-voice.mp3')
  })

  it('extracts a user-selected segment from video and limits it to 30 seconds', async () => {
    const page = await renderCloningSpeech()
    const file = new File(['video'], 'interview.mp4', { type: 'video/mp4' })
    await fireEvent.change(page.container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(await page.findByText('1:20 available')).toBeTruthy()
    expect(page.getByText('Trim this sample to 30 seconds')).toBeTruthy()
    expect(page.getByLabelText('Voice sample start')).toHaveValue('0')
    expect(page.getByLabelText('Duration (seconds)')).toHaveValue(30)
    await fireEvent.input(page.getByLabelText('Start (seconds)'), { target: { value: '65' } })
    expect(page.getByLabelText('Duration (seconds)')).toHaveValue(15)
    await fireEvent.input(page.getByLabelText('Duration (seconds)'), { target: { value: '8.5' } })
    await fireEvent.click(page.getByRole('button', { name: 'Upload selected segment' }))
    await waitFor(() => expect(speech.upload).toHaveBeenCalledWith(file, 65, 8.5))
  })

  it('restores the saved script and voice settings after reopening', async () => {
    const first = render(TextToSpeech)
    await fireEvent.click(first.getByRole('combobox', { name: /Model/ }))
    await fireEvent.click(first.getByText('Voxtral Mini TTS'))
    await fireEvent.click(first.getByRole('button', { name: 'Built-in voice' }))
    await fireEvent.input(first.getByLabelText('Script'), { target: { value: 'Draft narration' } })
    await waitFor(() => expect(localStorage.getItem('scrub-text-to-speech-draft')).toContain('Draft narration'))
    first.unmount()

    const reopened = render(TextToSpeech)
    expect(reopened.getByLabelText('Script')).toHaveValue('Draft narration')
    expect(reopened.container.querySelector('#speech-model')).toHaveAttribute('data-value', 'mistralai/voxtral-mini-tts-2603')
    expect(reopened.getByRole('button', { name: 'Built-in voice' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clones from a Proxy audio already in the Media Bin', async () => {
    registerMediaBinSource({
      id: 'interview.mp3', name: 'interview.mp3', kind: 'audio', duration: 80,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:interview',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { 'Content-Type': 'audio/mpeg' },
    })))
    metadata.audio.mockResolvedValue({ duration: 80 })
    const page = await renderCloningSpeech()

    await fireEvent.click(page.getByLabelText('Media Bin audio'))
    await fireEvent.click(page.getByRole('button', { name: /interview\.mp3/ }))

    expect(await page.findByLabelText('Voice sample segment')).toHaveTextContent('interview.mp3')
    expect(page.getByText('Trim this sample to 30 seconds')).toBeTruthy()
    await fireEvent.click(page.getByRole('button', { name: 'Upload selected segment' }))
    await waitFor(() => expect(speech.upload).toHaveBeenCalledOnce())
    const uploaded = speech.upload.mock.calls[0][0] as File
    expect(uploaded).toBeInstanceOf(File)
    expect(uploaded.name).toBe('interview.mp3')
    expect(page.container.querySelector('#voice-reference')).toHaveAttribute('data-value', 'new-voice.mp3')
  })

  it('shows an empty state when the Media Bin has no Proxy audio', async () => {
    const page = await renderCloningSpeech()

    expect(page.getByLabelText('Media Bin audio')).toBeDisabled()
    expect(page.getByLabelText('Media Bin audio')).toHaveTextContent('No server audio in Media Bin')
  })

  it('defaults to a multilingual built-in voice and sends Romanian explicitly', async () => {
    const page = render(TextToSpeech)
    expect(page.getByRole('button', { name: 'Built-in voice' })).toHaveAttribute('aria-pressed', 'true')
    await fireEvent.click(page.getByRole('combobox', { name: 'Narration language' }))
    await fireEvent.click(page.getByText('Română · Romanian'))
    await fireEvent.input(page.getByLabelText('Script'), { target: { value: 'În copilărie, Eminescu descoperă poezia.' } })
    await fireEvent.click(page.getByRole('button', { name: 'Generate at Playhead' }))
    await waitFor(() => expect(speech.generate).toHaveBeenCalledWith({
      input: 'În copilărie, Eminescu descoperă poezia.', language: 'ro',
      model: 'google/gemini-3.8-flash-tts', voice: 'Kore',
    }, expect.any(AbortSignal)))
  })
})
