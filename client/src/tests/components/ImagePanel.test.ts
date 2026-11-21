import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import ImagePanel from '../../components/ImagePanel.svelte'
import { clearMediaBinSources, registerMediaBinSource } from '../../lib/media-bin'
import { scrubSettings } from '../../stores/scrub.svelte'
import { editor } from '../../stores/editor.svelte'
import { resetImageGeneration } from '../../composables/useImageGeneration.svelte'

const image = vi.hoisted(() => ({
  execute: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('../../lib/ai-image', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ai-image')>(),
  executeAIImageJob: image.execute,
  importProxyImage: image.upload,
}))

describe('ImagePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    resetImageGeneration()
    image.execute.mockReset().mockResolvedValue({
      asset: { id: 'generated', name: 'generated.png', mediaType: 'image/png', width: 1920, height: 1080, sourceMode: 'proxy' },
      clip: { id: 'clip-generated' },
    })
    image.upload.mockReset().mockResolvedValue('reference.png')
    clearMediaBinSources()
    scrubSettings.setMode('proxy')
    editor.setCurrentTime(3)
  })

  it('generates a real transparent overlay with the project aspect', async () => {
    const panel = render(ImagePanel)
    expect(panel.queryByRole('button', { name: 'B-roll' })).toBeNull()
    expect(panel.getByLabelText('Transparent background')).toBeChecked()
    expect(panel.getByLabelText('Model')).toHaveAttribute('data-value', 'openai/gpt-image-2.5-sunburst')
    await fireEvent.click(panel.getByLabelText('Model'))
    expect(panel.getAllByRole('option', { name: /GPT Image/i })).toHaveLength(2)
    expect(panel.getAllByRole('option')).toHaveLength(2)
    expect(panel.queryByRole('button', { name: /Recraft|Grok|Seedream|Gemini|Qwen/i })).toBeNull()
    await fireEvent.input(panel.getByLabelText('Describe the image'), { target: { value: 'A calendar and clock' } })
    await fireEvent.click(panel.getByRole('button', { name: 'Generate overlay' }))

    await waitFor(() => expect(image.execute).toHaveBeenCalledOnce())
    expect(image.execute).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'A calendar and clock',
      placement: 'overlay',
      position: 'center',
      start: 3,
      duration: 5,
      model: 'openai/gpt-image-2.5-sunburst',
      aspect: '16:9',
      background: 'transparent',
      motionPreset: 'none',
      style: expect.stringContaining('Choose and apply a coherent visual style'),
    }), expect.any(AbortSignal))
    expect(await panel.findByRole('status')).toHaveTextContent('Overlay added')
  })

  it('uses Riverflow Fast and the other low-cost models for opaque backgrounds', async () => {
    const panel = render(ImagePanel)
    await fireEvent.click(panel.getByLabelText('Transparent background'))
    await fireEvent.click(panel.getByLabelText('Model'))
    expect(panel.getAllByRole('option')).toHaveLength(11)
    expect(panel.getByRole('button', { name: 'Recraft V4.1' })).toBeEnabled()
    expect(panel.getByRole('button', { name: 'Grok Imagine Image 2.0' })).toBeEnabled()
    await fireEvent.click(panel.getByRole('button', { name: 'Riverflow V2.5 Fast' }))
    expect(panel.getByLabelText('Model')).toHaveAttribute('data-value', 'sourceful/riverflow-v2.5-fast')
    await fireEvent.click(panel.getByLabelText('Model'))
    await fireEvent.click(panel.getByRole('button', { name: 'Krea 2 Medium Turbo' }))
    await fireEvent.click(panel.getByLabelText('Aspect ratio'))
    await fireEvent.click(panel.getByRole('button', { name: '9:16' }))
    await fireEvent.input(panel.getByLabelText('Describe the image'), { target: { value: 'A calendar in a studio' } })
    await fireEvent.click(panel.getByRole('button', { name: 'Generate overlay' }))

    await waitFor(() => expect(image.execute).toHaveBeenCalledWith(expect.objectContaining({
      model: 'krea/krea-2-medium-turbo',
      aspect: '9:16',
      background: 'opaque',
    }), expect.any(AbortSignal)))
  })

  it('offers Flare for transparent images and keeps its aspect ratio', async () => {
    const panel = render(ImagePanel)
    await fireEvent.click(panel.getByLabelText('Model'))
    await fireEvent.click(panel.getByRole('button', { name: 'GPT Image 2.5 Flare' }))
    expect(panel.getByLabelText('Model')).toHaveAttribute('data-value', 'openai/gpt-image-2.5-flare')
    expect(panel.getByLabelText('Aspect ratio')).toHaveAttribute('data-value', '16:9')
    await fireEvent.input(panel.getByLabelText('Describe the image'), { target: { value: 'A transparent icon' } })
    await fireEvent.click(panel.getByRole('button', { name: 'Generate overlay' }))

    await waitFor(() => expect(image.execute).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-image-2.5-flare', background: 'transparent', aspect: '16:9',
    }), expect.any(AbortSignal)))
  })

  it('displays an opaque fallback instead of treating it as an error', async () => {
    image.execute.mockResolvedValueOnce({
      asset: {
        id: 'generated', name: 'generated.png', mediaType: 'image/png', width: 1024, height: 1024, sourceMode: 'proxy',
        warning: 'The provider returned an opaque image, so it was kept without transparency.',
      },
      clip: { id: 'clip-generated' },
    })
    const panel = render(ImagePanel)
    await fireEvent.input(panel.getByLabelText('Describe the image'), { target: { value: 'An isolated icon' } })
    await fireEvent.click(panel.getByRole('button', { name: 'Generate overlay' }))

    expect(await panel.findByRole('status')).toHaveTextContent('Overlay added to the timeline. The provider returned an opaque image')
    expect(panel.queryByRole('alert')).toBeNull()
  })

  it('accepts fractional timing values from the playhead and input', async () => {
    editor.setCurrentTime(0.75)
    const panel = render(ImagePanel)
    const start = panel.getByLabelText('Start') as HTMLInputElement
    const duration = panel.getByLabelText('Duration') as HTMLInputElement

    expect(start).toHaveValue(0.75)
    expect(start.validity.valid).toBe(true)

    editor.setCurrentTime(1.234)
    await waitFor(() => expect(start.value).toBe('1.23'))

    await fireEvent.change(start, { target: { value: '2.5' } })
    expect(editor.currentTime).toBe(2.5)
    expect(start.value).toBe('2.50')

    await fireEvent.input(duration, { target: { value: '0.75' } })
    expect(duration.validity.valid).toBe(true)
  })

  it('uses an existing Proxy image as an image-to-image reference', async () => {
    registerMediaBinSource({
      id: 'reference.png', name: 'reference.png', kind: 'image', duration: 10, sourceMode: 'proxy', scrubBlobUrl: 'blob:reference',
    })
    const panel = render(ImagePanel)
    await fireEvent.click(panel.getByRole('combobox', { name: 'Image mode' }))
    await fireEvent.click(panel.getByRole('button', { name: 'Edit image' }))
    expect(panel.getByRole('img', { name: 'Preview of reference.png' })).toHaveAttribute('src', 'blob:reference')
    await fireEvent.input(panel.getByLabelText('Describe the changes'), { target: { value: 'Turn it into watercolor' } })
    await fireEvent.click(panel.getByRole('button', { name: 'Edit image' }))

    await waitFor(() => expect(image.execute).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Turn it into watercolor', sourceName: 'reference.png',
    }), expect.any(AbortSignal)))
  })

  it('disables image-to-image generation when the Media Bin uses WASM', async () => {
    scrubSettings.setMode('wasm')
    const panel = render(ImagePanel)
    await fireEvent.click(panel.getByRole('combobox', { name: 'Image mode' }))
    await fireEvent.click(panel.getByRole('button', { name: 'Edit image' }))

    expect(panel.getByText(/Switch the Media Bin to Server mode/)).toBeTruthy()
    expect(panel.getByRole('button', { name: 'Edit image' })).toBeDisabled()
  })

  it('restores the saved prompt and generation settings after reopening', async () => {
    const first = render(ImagePanel)
    await fireEvent.input(first.getByLabelText('Describe the image'), { target: { value: 'A saved image draft' } })
    await fireEvent.click(first.getByLabelText('Transparent background'))
    await fireEvent.click(first.getByLabelText('Model'))
    await fireEvent.click(first.getByRole('button', { name: 'Krea 2 Medium Turbo' }))
    await fireEvent.click(first.getByLabelText('Aspect ratio'))
    await fireEvent.click(first.getByRole('button', { name: '16:9' }))
    await fireEvent.click(first.getByRole('button', { name: 'Media Bin' }))
    await waitFor(() => expect(localStorage.getItem('scrub-image-draft')).toContain('A saved image draft'))
    first.unmount()

    const reopened = render(ImagePanel)
    expect(reopened.getByRole('dialog', { name: 'Image' })).toBeTruthy()
    expect(reopened.getByLabelText('Describe the image')).toHaveValue('A saved image draft')
    expect(reopened.getByLabelText('Transparent background')).not.toBeChecked()
    expect(reopened.getByLabelText('Model')).toHaveAttribute('data-value', 'krea/krea-2-medium-turbo')
    expect(reopened.getByLabelText('Aspect ratio')).toHaveAttribute('data-value', '16:9')
    expect(reopened.getByRole('button', { name: 'Generate to Media Bin' })).toBeTruthy()
  })

  it('notifies the editor when the dialog is closed', async () => {
    const onClose = vi.fn()
    const panel = render(ImagePanel, { props: { onClose } })

    await fireEvent.click(panel.getByRole('button', { name: 'Close Image' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
