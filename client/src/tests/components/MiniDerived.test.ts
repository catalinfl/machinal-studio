import { describe, expect, it, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import MiniDerived from './MiniDerived.svelte'
import { editor } from '../../stores/editor.svelte'

beforeEach(() => {
  cleanup()
  editor.clearHistory()
  for (const ch of [...editor.channels]) editor.removeChannel(ch.id)
  editor.selectClip(null)
  const ch = editor.addChannel('audio')
  const clip = editor.addClip(ch.id, {
    fileName: 'a.mp3',
    scrubBlobUrl: null,
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
  })
  editor.selectClip(clip.id)
})

describe('derived tracking through $state proxies', () => {
  it('derived reading channels directly updates', async () => {
    const { getByText } = render(MiniDerived)
    expect(getByText('100', { selector: '#via-channels' })).toBeTruthy()
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    editor.setClipVolume(clip.id, 40)
    await tick()
    expect(getByText('40', { selector: '#via-channels' })).toBeTruthy()
  })

  it('derived reading via selectedClipIds updates', async () => {
    const clip = editor.channels.find((c) => c.type === 'audio')!.clips[0]
    const { getByText } = render(MiniDerived, { props: { clipId: clip.id } })
    expect(getByText('100', { selector: '#via-selection' })).toBeTruthy()
    expect(getByText('100', { selector: '#via-find' })).toBeTruthy()
    expect(getByText('100', { selector: '#via-selid' })).toBeTruthy()
    expect(getByText('100', { selector: '#via-getter' })).toBeTruthy()
    editor.setClipVolume(clip.id, 40)
    await tick()
    expect(getByText('40', { selector: '#via-getter' })).toBeTruthy()
    expect(getByText('40', { selector: '#via-find' })).toBeTruthy()
    expect(getByText('40', { selector: '#via-selid' })).toBeTruthy()
    expect(getByText('40', { selector: '#via-selection' })).toBeTruthy()
  })
})
