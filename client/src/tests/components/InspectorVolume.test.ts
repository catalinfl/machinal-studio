import { describe, expect, it, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import EffectInspector from '../../components/EffectInspector.svelte'
import { editor } from '../../stores/editor.svelte'

beforeEach(() => {
  cleanup()
  editor.clearHistory()
  for (const ch of [...editor.channels]) editor.removeChannel(ch.id)
  editor.selectClip(null)
  const ch = editor.addChannel('audio')
  const clip = editor.addClip(ch.id, {
    fileName: 'audio.mp3',
    scrubBlobUrl: 'blob:audio',
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
  })
  editor.selectClip(clip.id)
})

describe('inspector volume slider', () => {
  it('dragging the slider updates the clip volume', async () => {
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const { getByLabelText } = render(EffectInspector)

    const slider = getByLabelText('Clip volume') as HTMLInputElement
    await fireEvent.input(slider, { target: { value: '40' } })
    expect(clip.volume).toBe(40)
  })

  it('stores slider values as whole percentages', async () => {
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const { getByLabelText } = render(EffectInspector)

    const slider = getByLabelText('Clip volume') as HTMLInputElement
    await fireEvent.input(slider, { target: { value: '105.5235235' } })

    expect(clip.volume).toBe(106)
  })

  it('follows volume changes made elsewhere', async () => {
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const { getByLabelText, getByText, container } = render(EffectInspector)

    const slider = getByLabelText('Clip volume') as HTMLInputElement
    expect(slider.value).toBe('100')

    editor.setClipVolume(clip.id, 75)
    await tick()
    expect(getByText('75.00%')).toBeTruthy()
    expect(slider.value).toBe('75')
  })
})
