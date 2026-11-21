import { clipEnd, editor, type EffectBlock as EffectBlockType } from '../stores/editor.svelte'
import { onDestroy } from 'svelte'
import { render } from '../stores/render.svelte'

type InteractionMode = 'idle' | 'move' | 'resize'
type ResizeSide = 'left' | 'right'

type InteractionState = {
  mode: InteractionMode
  resizeSide: ResizeSide
  origin: { x: number; y: number; start: number; duration: number }
  pointer: { x: number; y: number }
  targetOffsetY: number
  scroll: { x: number; y: number }
  verticalOffset: number
  verticalArmed: boolean
  moveTarget: HTMLElement | null
  moved: boolean
  collapseSelectionOnClick: boolean
  selection: { clipIds: string[]; effectBlockIds: string[]; textItemIds: string[] }
  resizeOrigins: { id: string; start: number; duration: number }[]
}

export type EffectBlockDragMove = (
  clientX: number,
  clientY: number,
  onScroll: (deltaX: number, deltaY: number) => void,
  allowVerticalScroll: boolean,
) => void

export interface EffectBlockInteractionsOptions {
  getBlock: () => EffectBlockType
  getOnEffectDragMove: () => EffectBlockDragMove | undefined
  getOnEffectDragEnd: () => (() => void) | undefined
}

const VERTICAL_DRAG_THRESHOLD_PX = 30
const CLIP_SNAP_PX = 5
const EFFECT_SNAP_PX = 3

export class EffectBlockInteractions {
  interaction = $state<InteractionState>({
    mode: 'idle',
    resizeSide: 'right',
    origin: { x: 0, y: 0, start: 0, duration: 0 },
    pointer: { x: 0, y: 0 },
    targetOffsetY: 0,
    scroll: { x: 0, y: 0 },
    verticalOffset: 0,
    verticalArmed: false,
    moveTarget: null,
    moved: false,
    collapseSelectionOnClick: false,
    selection: { clipIds: [], effectBlockIds: [], textItemIds: [] },
    resizeOrigins: [],
  })

  constructor(private readonly options: EffectBlockInteractionsOptions) {}

  startMove = (event: MouseEvent) => {
    const block = this.options.getBlock()
    event.stopPropagation()
    editor.clearEffectDragPreview()
    const additive = event.ctrlKey || event.metaKey
    const wasSelected = editor.selectedEffectBlockIds.includes(block.id)
    if (additive) {
      editor.selectEffectBlock(block.id, true)
      if (wasSelected) return
    } else if (!wasSelected) {
      editor.selectEffectBlock(block.id)
    }
    const channel = editor.channels.find((candidate) => candidate.id === block.channelId)
    if (channel?.locked) return
    editor.beginHistory()
    this.interaction.selection.clipIds = [...editor.selectedClipIds]
    this.interaction.selection.effectBlockIds = [...editor.selectedEffectBlockIds]
    this.interaction.selection.textItemIds = [...editor.selectedTextItemIds]
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    editor.setEffectDragPreview(this.interaction.selection.effectBlockIds, 0)
    this.interaction.mode = 'move'
    this.interaction.origin = { x: event.clientX, y: event.clientY, start: block.start, duration: 0 }
    this.interaction.pointer = { x: event.clientX, y: event.clientY }
    this.interaction.targetOffsetY = bounds.height > 0
      ? bounds.top + bounds.height / 2 - event.clientY
      : 0
    this.interaction.scroll = { x: 0, y: 0 }
    this.interaction.verticalOffset = 0
    this.interaction.verticalArmed = false
    this.interaction.moved = false
    this.interaction.collapseSelectionOnClick = !additive
      && wasSelected
      && this.interaction.selection.clipIds.length
        + this.interaction.selection.effectBlockIds.length
        + this.interaction.selection.textItemIds.length > 1
    window.addEventListener('mousemove', this.handleInteractionMove)
    window.addEventListener('mouseup', this.finishInteraction)
  }

  startResize = (event: MouseEvent, side: ResizeSide) => {
    const block = this.options.getBlock()
    event.stopPropagation()
    event.preventDefault()
    editor.clearEffectDragPreview()
    if (!editor.selectedEffectBlockIds.includes(block.id)) editor.selectEffectBlock(block.id)
    const channel = editor.channels.find((candidate) => candidate.id === block.channelId)
    if (channel?.locked) return
    editor.beginHistory()
    this.interaction.selection.effectBlockIds = [...editor.selectedEffectBlockIds]
    this.interaction.resizeOrigins = this.interaction.selection.effectBlockIds.flatMap((id) => {
      const selectedBlock = editor.effectBlocks.find((candidate) => candidate.id === id)
      return selectedBlock ? [{ id, start: selectedBlock.start, duration: selectedBlock.duration }] : []
    })
    this.interaction.mode = 'resize'
    this.interaction.resizeSide = side
    this.interaction.origin = { x: event.clientX, y: 0, start: block.start, duration: block.duration }
    this.interaction.scroll = { x: 0, y: 0 }
    this.interaction.verticalArmed = false
    this.interaction.collapseSelectionOnClick = false
    window.addEventListener('mousemove', this.handleInteractionMove)
    window.addEventListener('mouseup', this.finishInteraction)
  }

  startResizeLeft = (event: MouseEvent) => this.startResize(event, 'left')

  startResizeRight = (event: MouseEvent) => this.startResize(event, 'right')

  removeEffect = (event: MouseEvent) => {
    event.stopPropagation()
    const block = this.options.getBlock()
    const isSelected = editor.selectedEffectBlockIds.includes(block.id)
    if (isSelected) {
      for (const id of editor.selectedEffectBlockIds) {
        const selected = editor.effectBlocks.find((candidate) => candidate.id === id)
        if (selected?.nodeId) render.removeNode(selected.nodeId)
      }
      editor.removeSelectedItems()
    } else {
      if (block.nodeId) render.removeNode(block.nodeId)
      editor.removeEffectBlock(block.id)
    }
  }

  private snapMovedStart(start: number, end: number, disableSnap = false): number | null {
    if (disableSnap) return null
    const block = this.options.getBlock()
    const channel = editor.channels.find((candidate) => candidate.id === block.channelId)
    if (!channel) return null
    const clipSnapSeconds = CLIP_SNAP_PX / editor.pixelsPerSecond
    let snappedStart: number | null = null
    let closestDistance = Infinity
    const considerSnap = (movingEdge: number, targetEdge: number, maxDistance: number) => {
      const distance = Math.abs(movingEdge - targetEdge)
      if (distance <= maxDistance && distance < closestDistance) {
        snappedStart = start + targetEdge - movingEdge
        closestDistance = distance
      }
    }
    for (const clip of channel.clips) {
      if (this.interaction.selection.clipIds.includes(clip.id)) continue
      const clipEndTime = clipEnd(clip)
      considerSnap(start, clip.start, clipSnapSeconds)
      considerSnap(start, clipEndTime, clipSnapSeconds)
      considerSnap(end, clip.start, clipSnapSeconds)
      considerSnap(end, clipEndTime, clipSnapSeconds)
    }
    const effectSnapSec = EFFECT_SNAP_PX / editor.pixelsPerSecond
    for (const other of editor.effectBlocks) {
      if (
        other.channelId !== block.channelId
        || this.interaction.selection.effectBlockIds.includes(other.id)
      ) continue
      const otherEnd = other.start + other.duration
      considerSnap(start, other.start, effectSnapSec)
      considerSnap(start, otherEnd, effectSnapSec)
      considerSnap(end, other.start, effectSnapSec)
      considerSnap(end, otherEnd, effectSnapSec)
    }
    considerSnap(start, editor.currentTime, effectSnapSec)
    considerSnap(end, editor.currentTime, effectSnapSec)
    return snappedStart
  }

  private snapResizedEdge(end: number, disableSnap = false): number {
    if (disableSnap) return end
    const block = this.options.getBlock()
    const channel = editor.channels.find((candidate) => candidate.id === block.channelId)
    if (!channel) return end
    let snappedEnd = end
    let closestDistance = Infinity
    const considerSnap = (targetEdge: number, maxDistance: number) => {
      const distance = Math.abs(end - targetEdge)
      if (distance <= maxDistance && distance < closestDistance) {
        snappedEnd = targetEdge
        closestDistance = distance
      }
    }
    const clipSnapSec = CLIP_SNAP_PX / editor.pixelsPerSecond
    for (const clip of channel.clips) {
      considerSnap(clip.start, clipSnapSec)
      considerSnap(clipEnd(clip), clipSnapSec)
    }
    const effectSnapSec = EFFECT_SNAP_PX / editor.pixelsPerSecond
    for (const other of editor.effectBlocks) {
      if (
        other.channelId === block.channelId
        && !this.interaction.selection.effectBlockIds.includes(other.id)
      ) {
        considerSnap(other.start, effectSnapSec)
        considerSnap(other.start + other.duration, effectSnapSec)
      }
    }
    considerSnap(editor.currentTime, effectSnapSec)
    return snappedEnd
  }

  private moveSelectionTo(requestedStart: number, disableSnap = false) {
    const block = this.options.getBlock()
    const snappedStart = this.snapMovedStart(requestedStart, requestedStart + block.duration, disableSnap)
    const targetStart = snappedStart ?? requestedStart
    const currentBlock = editor.effectBlocks.find((candidate) => candidate.id === block.id)
    if (!currentBlock) return
    editor.moveSelection(
      this.interaction.selection.clipIds,
      this.interaction.selection.effectBlockIds,
      this.interaction.selection.textItemIds,
      targetStart - currentBlock.start,
    )
  }

  private updateVerticalDrag() {
    const verticalDelta = this.interaction.pointer.y - this.interaction.origin.y + this.interaction.scroll.y
    if (Math.abs(verticalDelta) >= VERTICAL_DRAG_THRESHOLD_PX) this.interaction.verticalArmed = true
    this.interaction.verticalOffset = this.interaction.verticalArmed ? verticalDelta : 0
    editor.setEffectDragPreview(
      this.interaction.selection.effectBlockIds,
      this.interaction.verticalOffset,
    )
    this.setMoveTarget(
      this.interaction.verticalArmed
        ? this.findMoveTarget(
            this.interaction.pointer.x,
            this.interaction.pointer.y + this.interaction.targetOffsetY,
          )
        : null,
    )
  }

  private handleInteractionMove = (event: MouseEvent) => {
    const block = this.options.getBlock()
    this.interaction.pointer = { x: event.clientX, y: event.clientY }
    const horizontalDelta = this.interaction.pointer.x - this.interaction.origin.x + this.interaction.scroll.x
    const deltaSeconds = horizontalDelta / editor.pixelsPerSecond
    if (this.interaction.mode === 'move') {
      if (
        Math.abs(this.interaction.pointer.x - this.interaction.origin.x) >= 1
        || Math.abs(this.interaction.pointer.y - this.interaction.origin.y) >= 1
      ) this.interaction.moved = true
      this.updateVerticalDrag()
      this.options.getOnEffectDragMove()?.(
        this.interaction.pointer.x,
        this.interaction.pointer.y,
        this.applyAutoScroll,
        this.interaction.verticalArmed,
      )
      // Holding Alt disables snapping so a block placed at the playhead (or on
      // a clip edge) can be nudged free pixel by pixel.
      this.moveSelectionTo(this.interaction.origin.start + deltaSeconds, event.altKey)
    } else if (this.interaction.mode === 'resize') {
      if (this.interaction.resizeSide === 'right') {
        const requestedDuration = this.interaction.origin.duration + deltaSeconds
        const snappedEnd = this.snapResizedEdge(this.interaction.origin.start + requestedDuration, event.altKey)
        const resizeDelta = Math.max(
          snappedEnd - this.interaction.origin.start - this.interaction.origin.duration,
          ...this.interaction.resizeOrigins.map((origin) => 0.2 - origin.duration),
        )
        for (const origin of this.interaction.resizeOrigins) {
          editor.resizeEffectBlock(origin.id, origin.duration + resizeDelta)
        }
      } else {
        const requestedStart = this.interaction.origin.start + deltaSeconds
        const snappedStart = this.snapResizedEdge(requestedStart, event.altKey)
        const resizeDelta = Math.min(
          Math.max(
            snappedStart - this.interaction.origin.start,
            ...this.interaction.resizeOrigins.map((origin) => -origin.start),
          ),
          ...this.interaction.resizeOrigins.map((origin) => origin.duration - 0.2),
        )
        for (const origin of this.interaction.resizeOrigins) {
          editor.resizeEffectBlockRange(
            origin.id,
            origin.start + resizeDelta,
            origin.duration - resizeDelta,
          )
        }
      }
    }
  }

  private applyAutoScroll = (deltaX: number, deltaY: number) => {
    if (this.interaction.mode !== 'move' || (deltaX === 0 && deltaY === 0)) return
    this.interaction.scroll.x += deltaX
    this.interaction.scroll.y += deltaY
    const requestedStart = this.interaction.origin.start
      + (this.interaction.pointer.x - this.interaction.origin.x + this.interaction.scroll.x)
        / editor.pixelsPerSecond
    this.moveSelectionTo(requestedStart)
    this.updateVerticalDrag()
  }

  private findMoveTarget(clientX: number, clientY: number): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-timeline-channel-id]'))
    return candidates.find((element) => {
      const bounds = element.getBoundingClientRect()
      return element.dataset.channelType === 'video'
        && element.dataset.channelLocked !== 'true'
        && bounds.height > 0
        && clientY >= bounds.top
        && clientY < bounds.bottom
    }) ?? null
  }

  private setMoveTarget(target: HTMLElement | null) {
    if (this.interaction.moveTarget === target) return
    this.interaction.moveTarget?.classList.remove('drop-active')
    this.interaction.moveTarget = target
    this.interaction.moveTarget?.classList.add('drop-active')
  }

  private finishInteraction = (event: MouseEvent) => {
    const block = this.options.getBlock()
    const wasMove = this.interaction.mode === 'move'
    const wasResize = this.interaction.mode === 'resize'
    const didMove = this.interaction.moved
    const target = wasMove && this.interaction.verticalArmed
      ? this.findMoveTarget(event.clientX, event.clientY + this.interaction.targetOffsetY)
      : null
    this.interaction.mode = 'idle'
    this.interaction.verticalOffset = 0
    editor.clearEffectDragPreview()
    this.setMoveTarget(null)
    window.removeEventListener('mousemove', this.handleInteractionMove)
    window.removeEventListener('mouseup', this.finishInteraction)
    if (target?.dataset.timelineChannelId) {
      editor.moveEffectBlocksToChannel(
        this.interaction.selection.effectBlockIds,
        target.dataset.timelineChannelId,
      )
    }
    if (wasMove && didMove) {
      // A block released over a clip belongs to that clip from now on, so a
      // later clip drag carries it along. Releasing over empty timeline (or
      // across a clip boundary) detaches regular blocks so they stop
      // following the previous clip and can continue over the next one.
      for (const id of this.interaction.selection.effectBlockIds) {
        const moved = editor.effectBlocks.find((candidate) => candidate.id === id)
        if (moved) editor.anchorEffectBlock(id, moved.start + moved.duration / 2)
      }
    }
    if (wasResize) {
      // Stretching a block across a cut must detach it so it renders on every
      // clip it touches; shrinking it back re-anchors it to the clip under
      // its center. The store already refreshes ownership on every resize
      // tick, this final pass only guarantees consistency for multi-select.
      const ids = this.interaction.resizeOrigins.map((origin) => origin.id)
      for (const id of ids.length > 0 ? ids : this.interaction.selection.effectBlockIds) {
        const resized = editor.effectBlocks.find((candidate) => candidate.id === id)
        if (resized) editor.anchorEffectBlock(id, resized.start + resized.duration / 2)
      }
    }
    if (this.interaction.collapseSelectionOnClick && !this.interaction.moved) editor.selectEffectBlock(block.id)
    this.options.getOnEffectDragEnd()?.()
    editor.endHistory()
  }

  destroy() {
    const active = this.interaction.mode !== 'idle'
    window.removeEventListener('mousemove', this.handleInteractionMove)
    window.removeEventListener('mouseup', this.finishInteraction)
    this.interaction.mode = 'idle'
    this.interaction.verticalOffset = 0
    editor.clearEffectDragPreview()
    this.setMoveTarget(null)
    if (active) editor.cancelHistory()
  }
}

export function useEffectBlockInteractions(options: EffectBlockInteractionsOptions): EffectBlockInteractions {
  const interactions = new EffectBlockInteractions(options)
  onDestroy(() => interactions.destroy())
  return interactions
}
