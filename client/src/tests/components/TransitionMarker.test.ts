import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import TransitionMarker from '../../components/TransitionMarker.svelte'
import { editor, type Clip } from '../../stores/editor.svelte'

function baseClip(over: Partial<Clip> = {}): Omit<Clip, 'id'> {
  return {
    fileName: 'test.mp4',
    scrubBlobUrl: null,
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
    ...over,
  }
}

describe('TransitionMarker', () => {
  beforeEach(() => {
    editor.clearClipDragPreview()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    while (editor.transitions.length > 0) editor.removeTransition(editor.transitions[0].id)
  })

  it('moves with both clips during a vertical drag preview', async () => {
    const channel = editor.channels[0]
    const left = editor.addClip(channel.id, baseClip({ start: 0 }))
    const right = editor.addClip(channel.id, baseClip({ start: 4 }))
    const transition = editor.addTransition(channel.id, left.id, right.id, 'wipe-left')!

    const { container } = render(TransitionMarker, { transition, channel })
    editor.setClipDragPreview([left.id, right.id], 86)
    await tick()
    const marker = container.querySelector('.transition-marker') as HTMLElement

    expect(marker).toHaveClass('drag-preview')
    expect(marker.style.transform).toBe('translateY(86px)')
  })
})
