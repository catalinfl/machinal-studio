import { onDestroy } from 'svelte'
import { clipEnd, editor, type TextItem } from '../stores/editor.svelte'

interface Options {
  getItem: () => TextItem
  getOnTextDragMove: () => ((clientX: number, clientY: number, onScroll: (deltaX: number) => void, allowVerticalScroll: boolean) => void) | undefined
  getOnTextDragEnd: () => (() => void) | undefined
}

type MoveState =
  | { kind: 'idle' }
  | {
      kind: 'moving'
      originX: number
      originStart: number
      scrollX: number
      pointerX: number
      selection: string[]
      clipIds: string[]
      effectBlockIds: string[]
    }
  | {
      kind: 'resizing'
      edge: 'left' | 'right'
      originX: number
      originStart: number
      originDuration: number
      scrollX: number
      pointerX: number
      selection: string[]
      resizeOrigins: { id: string; start: number; duration: number }[]
    }

export function useTextBlock(options: Options) {
  let moveState = $state<MoveState>({ kind: 'idle' })

  const selected = $derived(editor.selectedTextItemIds.includes(options.getItem().id))
  const dragPreviewOffsetY = $derived(editor.textDragPreviewIds.includes(options.getItem().id) ? editor.textDragPreviewOffsetY : 0)
  const left = $derived(options.getItem().start * editor.pixelsPerSecond)
  const width = $derived(options.getItem().duration * editor.pixelsPerSecond)

  const mode = $derived(moveState.kind === 'moving' ? 'move' : moveState.kind === 'resizing' ? 'resize' : 'idle')

  const nearestSnap = (start: number, end: number, resize: 'left' | 'right' | null = null, disableSnap = false): number => {
    const state = moveState
    if (state.kind !== 'moving' && state.kind !== 'resizing') return resize === 'right' ? end : start
    if (disableSnap) return resize === 'right' ? end : start

    let result = resize === 'right' ? end : start
    let distance = 3 / editor.pixelsPerSecond
    const movingEdges = resize === 'left' ? [start] : resize === 'right' ? [end] : [start, end]
    const targets = [editor.currentTime]

    const excludedClipIds = state.kind === 'moving' ? state.clipIds : []
    const excludedEffectIds = state.kind === 'moving' ? state.effectBlockIds : []
    const excludedSelection = state.kind === 'moving' ? state.selection : state.kind === 'resizing' ? state.selection : []

    for (const channel of editor.channels) {
      for (const clip of channel.clips) {
        if (!excludedClipIds.includes(clip.id)) {
          targets.push(clip.start, clipEnd(clip))
        }
      }
    }

    for (const block of editor.effectBlocks) {
      if (!excludedEffectIds.includes(block.id)) {
        targets.push(block.start, block.start + block.duration)
      }
    }

    for (const other of editor.textItems) {
      if (!excludedSelection.includes(other.id)) {
        targets.push(other.start, other.start + other.duration)
      }
    }

    for (const moving of movingEdges) {
      for (const target of targets) {
        const nextDistance = Math.abs(moving - target)
        if (nextDistance <= distance) {
          distance = nextDistance
          result = resize === null ? start + target - moving : target
        }
      }
    }

    return result
  }

  const applyMove = (disableSnap = false): void => {
    const state = moveState
    if (state.kind === 'moving') {
      const item = options.getItem()
      const delta = (state.pointerX - state.originX + state.scrollX) / editor.pixelsPerSecond
      const current = editor.textItems.find((candidate) => candidate.id === item.id)
      if (!current) return

      const target = nearestSnap(state.originStart + delta, state.originStart + delta + item.duration, null, disableSnap)
      const moveDelta = target - current.start

      if (state.clipIds.length > 0 || state.effectBlockIds.length > 0) {
        editor.moveSelection(state.clipIds, state.effectBlockIds, state.selection, moveDelta)
      } else {
        editor.moveTextItems(state.selection, moveDelta)
      }
      return
    }

    if (state.kind === 'resizing') {
      const delta = (state.pointerX - state.originX + state.scrollX) / editor.pixelsPerSecond
      if (state.edge === 'right') {
        const end = nearestSnap(state.originStart, state.originStart + state.originDuration + delta, 'right', disableSnap)
        const resizeDelta = Math.max(
          end - state.originStart - state.originDuration,
          ...state.resizeOrigins.map((origin) => 0.2 - origin.duration),
        )
        for (const origin of state.resizeOrigins) {
          editor.resizeTextItem(origin.id, origin.duration + resizeDelta)
        }
      } else {
        const start = nearestSnap(state.originStart + delta, state.originStart + state.originDuration, 'left', disableSnap)
        const resizeDelta = Math.min(
          Math.max(start - state.originStart, ...state.resizeOrigins.map((origin) => -origin.start)),
          ...state.resizeOrigins.map((origin) => origin.duration - 0.2),
        )
        for (const origin of state.resizeOrigins) {
          const current = editor.textItems.find((candidate) => candidate.id === origin.id)
          if (!current) continue
          editor.resizeTextItem(origin.id, origin.duration - resizeDelta)
          editor.moveTextItems([origin.id], origin.start + resizeDelta - current.start)
        }
      }
    }
  }

  const handleScroll = (deltaX: number): void => {
    if (moveState.kind === 'idle') return

    moveState.scrollX += deltaX
    applyMove()
  }

  const onMove = (event: MouseEvent): void => {
    if (moveState.kind === 'idle') return

    moveState.pointerX = event.clientX
    options.getOnTextDragMove()?.(event.clientX, event.clientY, handleScroll, false)
    applyMove(event.altKey)
  }

  const removeDragListeners = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', finish)
  }

  const finish = (): void => {
    if (moveState.kind === 'idle') return

    moveState = { kind: 'idle' }
    removeDragListeners()
    options.getOnTextDragEnd()?.()
    editor.endHistory()
  }

  const startMove = (event: MouseEvent): void => {
    const item = options.getItem()
    event.preventDefault()
    event.stopPropagation()
    const additive = event.ctrlKey || event.metaKey

    if (additive) {
      editor.selectTextItem(item.id, true)
      if (!editor.selectedTextItemIds.includes(item.id)) return
    } else if (!selected) {
      editor.selectTextItem(item.id)
    }

    editor.beginHistory()

    moveState = {
      kind: 'moving',
      originX: event.clientX,
      originStart: item.start,
      scrollX: 0,
      pointerX: event.clientX,
      selection: [...editor.selectedTextItemIds],
      clipIds: [...editor.selectedClipIds],
      effectBlockIds: [...editor.selectedEffectBlockIds],
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finish)
  }

  const startResize = (event: MouseEvent, edge: 'left' | 'right'): void => {
    const item = options.getItem()
    event.preventDefault()
    event.stopPropagation()
    if (!selected) editor.selectTextItem(item.id)
    const selection = [...editor.selectedTextItemIds]
    const resizeOrigins = selection.flatMap((id) => {
      const selectedItem = editor.textItems.find((candidate) => candidate.id === id)
      return selectedItem ? [{ id, start: selectedItem.start, duration: selectedItem.duration }] : []
    })
    editor.beginHistory()
    moveState = {
      kind: 'resizing',
      edge,
      originX: event.clientX,
      originStart: item.start,
      originDuration: item.duration,
      scrollX: 0,
      pointerX: event.clientX,
      selection,
      resizeOrigins,
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', finish)
  }

  onDestroy(() => {
    if (moveState.kind !== 'idle') {
      moveState = { kind: 'idle' }
      options.getOnTextDragEnd()?.()
      editor.cancelHistory()
    }

    removeDragListeners()
  })

  return {
    startMove,
    startResize,
    startResizeLeft: (event: MouseEvent) => startResize(event, 'left'),
    startResizeRight: (event: MouseEvent) => startResize(event, 'right'),
    get mode() { return mode },
    get selected() { return selected },
    get dragPreviewOffsetY() { return dragPreviewOffsetY },
    get left() { return left },
    get width() { return width },
  }
}
