import { onDestroy } from 'svelte'
import { clipEnd, editor, type Channel, type Clip, type Transition } from '../stores/editor.svelte'
import { getEffect } from '../lib/effects'

export function useTransitionMarker(getTransition: () => Transition, getChannel: () => Channel) {
  const left = $derived<Clip | undefined>(getChannel().clips.find((clip) => clip.id === getTransition().leftClipId))
  const right = $derived<Clip | undefined>(getChannel().clips.find((clip) => clip.id === getTransition().rightClipId))
  const lo = $derived(right ? right.start : 0)
  const hi = $derived(left ? clipEnd(left) : 0)
  const duration = $derived(Math.max(0, hi - lo))
  const leftPx = $derived(lo * editor.pixelsPerSecond)
  const widthPx = $derived(Math.max(duration * editor.pixelsPerSecond, 14))
  const dragPreview = $derived(Boolean(left && right && editor.clipDragPreviewIds.includes(left.id) && editor.clipDragPreviewIds.includes(right.id)))
  const dragPreviewOffsetY = $derived(dragPreview ? editor.clipDragPreviewOffsetY : 0)
  const effect = $derived(getEffect(getTransition().effectId))
  // All transitions (video in Pixi, audio as live WebAudio crossfade) render
  // live, so the marker never waits for a prerender.
  const pending = $derived(false)
  let mode = $state<'idle' | 'roll' | 'left' | 'right'>('idle')
  let lastX = 0
  const onMove = (event: MouseEvent): void => {
    if (mode === 'idle' || !left || !right) return
    const delta = (event.clientX - lastX) / editor.pixelsPerSecond
    lastX = event.clientX
    if (delta === 0) return
    if (mode === 'roll') {
      const before = clipEnd(left)
      editor.trimClip(left.id, 'right', delta)
      const effective = clipEnd(left) - before
      if (effective !== 0) editor.trimClip(right.id, 'left', effective)
    } else if (mode === 'left') editor.trimClip(right.id, 'left', delta)
    else editor.trimClip(left.id, 'right', delta)
  }
  const onUp = (): void => {
    mode = 'idle'
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    editor.endHistory()
  }
  const start = (nextMode: 'roll' | 'left' | 'right', event: MouseEvent): void => {
    event.stopPropagation()
    if (nextMode !== 'roll') event.preventDefault()
    if (getChannel().locked || !left || !right) return
    editor.beginHistory()
    mode = nextMode
    lastX = event.clientX
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const onBodyDown = (event: MouseEvent): void => start('roll', event)
  const onLeftDown = (event: MouseEvent): void => start('left', event)
  const onRightDown = (event: MouseEvent): void => start('right', event)
  const onDelete = (event: MouseEvent): void => {
    event.stopPropagation()
    editor.removeTransition(getTransition().id)
  }
  onDestroy(() => {
    if (mode !== 'idle') onUp()
  })

  return {
    onBodyDown,
    onLeftDown,
    onRightDown,
    onDelete,
    get left() { return left },
    get right() { return right },
    get duration() { return duration },
    get leftPx() { return leftPx },
    get widthPx() { return widthPx },
    get dragPreview() { return dragPreview },
    get dragPreviewOffsetY() { return dragPreviewOffsetY },
    get effect() { return effect },
    get pending() { return pending },
    get mode() { return mode },
  }
}
