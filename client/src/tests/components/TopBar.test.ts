import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import TopBar from '../../components/TopBar.svelte'
import { editor } from '../../stores/editor.svelte'

describe('TopBar', () => {
  beforeEach(() => {
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.selectClip(null)
    editor.setCurrentTime(0)
    editor.setPlaying(false)
    editor.setFps(30)
  })

  it('renders the menu bar with active panel controls', () => {
    const { getByRole, getByLabelText, queryByRole } = render(TopBar)
    expect(getByRole('link', { name: 'machinal home' })).toHaveAttribute('href', '/')
    expect(queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(getByRole('button', { name: 'AI Edit' })).toHaveAttribute('aria-pressed', 'false')
    expect(getByRole('button', { name: 'Media Bin' })).toHaveAttribute('aria-pressed', 'true')
    expect(getByRole('button', { name: 'Effects' })).toHaveAttribute('aria-pressed', 'true')
    expect(getByRole('button', { name: 'Styles' })).toHaveAttribute('aria-pressed', 'false')
    const textToSpeech = getByRole('button', { name: 'Text to Speech' })
    expect(textToSpeech).toHaveAttribute('aria-pressed', 'false')
    expect(getByRole('button', { name: 'Transitions' })).toHaveAttribute('aria-pressed', 'false')
    expect(getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'false')
    const controls = Array.from(getByLabelText('Editor panels').querySelectorAll('button'))
    expect(controls.at(-1)).toBe(getByRole('button', { name: 'AI Edit' }))
    expect(getByRole('button', { name: 'Styles' }).nextElementSibling).toBe(textToSpeech)
  })

  it('links the command bar brand to the homepage', () => {
    const { getByRole } = render(TopBar, { toolNavigation: false })
    const brand = getByRole('link', { name: 'machinal home' })
    expect(brand).toHaveAttribute('href', '/')
    expect(brand.querySelector('img')).toHaveAttribute('src', '/machinal-icon.svg')
    expect(brand.querySelector('img')).toHaveAttribute('alt', '')
    expect(brand.querySelector('.dot')).toBeNull()
  })

  it('toggles browser panels independently', async () => {
    const onToggleMediaBin = vi.fn()
    const onToggleEffects = vi.fn()
    const onTogglePresets = vi.fn()
    const onToggleTransitions = vi.fn()
    const onToggleSpeech = vi.fn()
    const onToggleImage = vi.fn()
    const { getByRole } = render(TopBar, {
      showMediaBin: true,
      showEffects: false,
      showPresets: false,
      onToggleMediaBin,
      onToggleEffects,
      onTogglePresets,
      onToggleTransitions,
      onToggleSpeech,
      onToggleImage,
    })
    const mediaBin = getByRole('button', { name: 'Media Bin' })
    const effects = getByRole('button', { name: 'Effects' })
    const presets = getByRole('button', { name: 'Styles' })
    const transitions = getByRole('button', { name: 'Transitions' })
    const textToSpeech = getByRole('button', { name: 'Text to Speech' })
    const image = getByRole('button', { name: 'Image' })
    expect(mediaBin).toHaveAttribute('aria-pressed', 'true')
    expect(effects).toHaveAttribute('aria-pressed', 'false')
    expect(presets).toHaveAttribute('aria-pressed', 'false')
    expect(transitions).toHaveAttribute('aria-pressed', 'false')
    expect(textToSpeech).toHaveAttribute('aria-pressed', 'false')
    expect(image).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.click(mediaBin)
    expect(onToggleMediaBin).toHaveBeenCalledOnce()
    expect(onToggleEffects).not.toHaveBeenCalled()
    await fireEvent.click(effects)
    expect(onToggleEffects).toHaveBeenCalledOnce()
    await fireEvent.click(presets)
    expect(onTogglePresets).toHaveBeenCalledOnce()
    await fireEvent.click(transitions)
    expect(onToggleTransitions).toHaveBeenCalledOnce()
    await fireEvent.click(textToSpeech)
    expect(onToggleSpeech).toHaveBeenCalledOnce()
    await fireEvent.click(image)
    expect(onToggleImage).toHaveBeenCalledOnce()
  })

  it('shows formatted current time / total duration', () => {
    editor.setFps(30)
    editor.setCurrentTime(2.5)
    const { getByText } = render(TopBar)
    expect(getByText('00:00:02:15')).toBeTruthy()
  })

  it('shows fps value', () => {
    editor.setFps(25)
    const { container } = render(TopBar)
    const fps = container.querySelector('.fps')
    expect(fps).toBeTruthy()
    expect(fps?.textContent).toContain('25')
    expect(fps?.textContent).toContain('fps')
  })

})
