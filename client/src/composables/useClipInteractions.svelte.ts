import { clipEnd, clipTimelineDuration, editor, type Clip as ClipType } from '../stores/editor.svelte'
import { onDestroy } from 'svelte'

type Point = { x: number; y: number }

type SnapCandidate = {
  start: number
  order: number
  maxAnchorStart?: number
  minAnchorStartExclusive?: number
}

export type TrimEdge = 'left' | 'right'

type DragSession = {
  origin: Point
  pointer: Point
  targetOffsetY: number
  scrollOffset: Point
  originalStart: number
  desiredStart: number
  clipIds: string[]
  effectBlockIds: string[]
  textItemIds: string[]
  clipSnapCandidates: SnapCandidate[]
  playheadSnapCandidates: SnapCandidate[]
  moved: boolean
  collapseSelectionOnClick: boolean
  verticalArmed: boolean
  moveTarget: HTMLElement | null
}

type TrimSession = {
  originX: number
  originEdge: number
  nextStart: number | null
  prevEnd: number | null
}

export type ClipDragMove = (
  clientX: number,
  clientY: number,
  onScroll: (deltaX: number, deltaY: number) => void,
  allowVerticalScroll: boolean,
) => void

export interface ClipInteractionsOptions {
  getClip: () => ClipType
  getChannelId: () => string
  getOnClipDragMove: () => ClipDragMove | undefined
  getOnClipDragEnd: () => (() => void) | undefined
  getOnOpenInspector: () => (() => void) | undefined
  getOnContextMenu: () => ((event: MouseEvent, clip: ClipType, channelId: string) => void) | undefined
}

const VERTICAL_DRAG_THRESHOLD_PX = 30
const PLAYHEAD_SNAP_PX = 7
const CLIP_SNAP_PX = 3
const TRIM_SNAP_PX = 3

export class ClipInteractions {
  dragging = $state(false)
  dragOffsetY = $state(0)
  trimming = $state<TrimEdge | null>(null)
  volumeDragging = $state(false)

  #dragSession: DragSession | null = null
  #trimSession: TrimSession | null = null
  #dragMoveFrame: number | null = null
  #pendingDragPoint: Point | null = null
  #trimMoveFrame: number | null = null
  #pendingTrimX: number | null = null
  #volumeMove: ((event: MouseEvent) => void) | null = null
  #volumeUp: ((event: MouseEvent) => void) | null = null
  #volumeMoveFrame: number | null = null
  #pendingVolumeY: number | null = null

  constructor(private readonly options: ClipInteractionsOptions) {}

  stopPropagation = (event: MouseEvent) => event.stopPropagation()

  startDrag = (event: MouseEvent) => {
    const clip = this.options.getClip()
    const channelId = this.options.getChannelId()
    if (event.button !== 0) return
    if (event.detail >= 2) {
      this.openInspector(event)
      return
    }
    event.stopPropagation()
    editor.clearClipDragPreview()
    editor.clearEffectDragPreview()
    editor.clearTextDragPreview()
    const additive = event.ctrlKey || event.metaKey
    const wasSelected = editor.selectedClipIds.includes(clip.id)
    if (additive) {
      editor.selectClip(clip.id, true)
      if (wasSelected) return
    } else if (!wasSelected) {
      editor.selectClip(clip.id)
    }
    const channel = editor.channels.find((candidate) => candidate.id === channelId)
    if (channel?.locked) return
    editor.beginHistory()
    const selectedIds = [...editor.selectedClipIds]
    const clipBounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const clipIds = this.expandLinkedDragIds(selectedIds)
    const effectBlockIds = [...new Set([
      ...editor.selectedEffectBlockIds,
      ...editor.effectBlocks
        .filter((block) => block.ownerClipId && clipIds.includes(block.ownerClipId))
        .map((block) => block.id),
    ])]
    const textItemIds = [...new Set([
      ...editor.selectedTextItemIds,
      ...editor.textItems
        .filter((item) => item.sourceClipId && clipIds.includes(item.sourceClipId))
        .map((item) => item.id),
    ])]
    const snapCandidates = this.buildDragSnapCandidates(clip.id, clipIds)
    this.#dragSession = {
      origin: { x: event.clientX, y: event.clientY },
      pointer: { x: event.clientX, y: event.clientY },
      targetOffsetY: clipBounds.height > 0
        ? clipBounds.top + clipBounds.height / 2 - event.clientY
        : 0,
      scrollOffset: { x: 0, y: 0 },
      originalStart: clip.start,
      desiredStart: clip.start,
      clipIds,
      effectBlockIds,
      textItemIds,
      clipSnapCandidates: snapCandidates.clips,
      playheadSnapCandidates: snapCandidates.playhead,
      moved: false,
      collapseSelectionOnClick: !additive
        && wasSelected
        && selectedIds.length + editor.selectedEffectBlockIds.length + editor.selectedTextItemIds.length > 1,
      verticalArmed: false,
      moveTarget: null,
    }
    this.dragging = true
    window.addEventListener('mousemove', this.handleDragMove)
    window.addEventListener('mouseup', this.finishDrag)
    window.addEventListener('blur', this.cancelDrag)
    document.addEventListener('visibilitychange', this.cancelDragWhenHidden)
  }

  openInspector = (event: MouseEvent) => {
    if ((event.target as HTMLElement | null)?.closest('.trim, .del, .vol-line')) return
    event.stopPropagation()
    const clip = this.options.getClip()
    if (!editor.selectedClipIds.includes(clip.id)) editor.selectClip(clip.id)
    this.options.getOnOpenInspector()?.()
  }

  onClipKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const clip = this.options.getClip()
    if (!editor.selectedClipIds.includes(clip.id)) editor.selectClip(clip.id)
    this.options.getOnOpenInspector()?.()
  }

  openContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    this.options.getOnContextMenu()?.(event, this.options.getClip(), this.options.getChannelId())
  }

  deleteClip = (event: MouseEvent) => {
    event.stopPropagation()
    const clip = this.options.getClip()
    const channelId = this.options.getChannelId()
    if (editor.selectedClipIds.length > 1 || editor.selectedEffectBlockIds.length > 0) editor.removeSelectedItems()
    else editor.removeClip(channelId, clip.id)
  }

  private handleDragMove = (event: MouseEvent) => {
    const point = { x: event.clientX, y: event.clientY }
    if (this.#dragMoveFrame !== null) {
      this.#pendingDragPoint = point
      this.updateDragPreview(point)
      return
    }
    this.applyDragMove(point)
    this.#dragMoveFrame = requestAnimationFrame(this.flushPendingDragMove)
  }

  private flushPendingDragMove = () => {
    this.#dragMoveFrame = null
    const point = this.#pendingDragPoint
    this.#pendingDragPoint = null
    if (!point || !this.#dragSession) return
    this.applyDragMove(point)
    this.#dragMoveFrame = requestAnimationFrame(this.flushPendingDragMove)
  }

  private applyDragMove(point: Point) {
    this.updateDragPreview(point)
    const session = this.#dragSession
    if (session) this.applyHorizontalDrag(session)
  }

  private updateDragPreview(point: Point) {
    const session = this.#dragSession
    if (!session) return
    const deltaY = point.y - session.origin.y
    session.pointer = point
    if (Math.abs(point.x - session.origin.x) >= 1 || Math.abs(deltaY) >= 1) session.moved = true
    if (!session.verticalArmed && Math.abs(deltaY) >= VERTICAL_DRAG_THRESHOLD_PX) session.verticalArmed = true
    this.setMoveTarget(
      session,
      session.verticalArmed ? this.findDragTarget(session, point.x, point.y) : null,
    )
    this.options.getOnClipDragMove()?.(point.x, point.y, this.applyAutoScroll, session.verticalArmed)

    if (!session.verticalArmed) {
      this.dragOffsetY = 0
      if (editor.effectDragPreviewIds.length > 0) editor.clearEffectDragPreview()
      if (editor.textDragPreviewIds.length > 0) editor.clearTextDragPreview()
      return
    }

    this.dragOffsetY = deltaY + session.scrollOffset.y
    editor.setClipDragPreview(session.clipIds, this.dragOffsetY, true)
    editor.setEffectDragPreview(session.effectBlockIds, this.dragOffsetY)
    editor.setTextDragPreview(session.textItemIds, this.dragOffsetY)
  }

  private applyHorizontalDrag(session: DragSession) {
    const clip = this.options.getClip()
    const channelId = this.options.getChannelId()
    const pointerDelta = session.pointer.x - session.origin.x + session.scrollOffset.x
    const deltaSec = pointerDelta / editor.pixelsPerSecond
    session.desiredStart = Math.max(0, this.snapDragStart(session.originalStart + deltaSec))
    const current = editor.getClipById(clip.id)?.clip
    if (!current) return
    const delta = session.desiredStart - current.start
    // Skip sub-pixel store updates: each one re-renders the timeline, and a
    // 100k-px-wide clip layer re-layouts on every write. Snaps that jump by
    // >= half a pixel still apply.
    if (Math.abs(delta) * editor.pixelsPerSecond < 0.5) return
    const detachedDrag = session.verticalArmed
    if (session.effectBlockIds.length > 0 || session.textItemIds.length > 0) {
      editor.moveSelection(
        session.clipIds,
        session.effectBlockIds,
        session.textItemIds,
        session.desiredStart - current.start,
        detachedDrag,
      )
    } else if (editor.selectedClipIds.length > 1 || detachedDrag) {
      editor.moveClips(session.clipIds, session.desiredStart - current.start, detachedDrag)
    } else {
      editor.moveClip(channelId, clip.id, session.desiredStart)
    }
  }

  private snapDragStart(start: number): number {
    const session = this.#dragSession
    if (!session) return start
    return this.nearestSnapCandidate(start, session.clipSnapCandidates, CLIP_SNAP_PX)
      ?? this.nearestSnapCandidate(start, session.playheadSnapCandidates, PLAYHEAD_SNAP_PX)
      ?? start
  }

  private nearestSnapCandidate(start: number, candidates: SnapCandidate[], tolerancePx: number): number | null {
    const tolerance = tolerancePx / editor.pixelsPerSecond
    const lower = start - tolerance
    let low = 0
    let high = candidates.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (candidates[mid].start < lower) low = mid + 1
      else high = mid
    }

    let closest: SnapCandidate | null = null
    let closestDistance = Infinity
    for (let index = low; index < candidates.length; index++) {
      const candidate = candidates[index]
      if (candidate.start > start + tolerance) break
      if (candidate.maxAnchorStart !== undefined && start > candidate.maxAnchorStart) continue
      if (candidate.minAnchorStartExclusive !== undefined && start <= candidate.minAnchorStartExclusive) continue
      const distance = Math.abs(start - candidate.start)
      if (
        distance < closestDistance
        || (Math.abs(distance - closestDistance) <= 1e-12 && candidate.order < (closest?.order ?? Infinity))
      ) {
        closest = candidate
        closestDistance = distance
      }
    }
    return closest?.start ?? null
  }

  private applyAutoScroll = (deltaX: number, deltaY: number) => {
    const session = this.#dragSession
    if (!session) return
    if (session.verticalArmed) this.setMoveTarget(session, this.findDragTarget(session, session.pointer.x, session.pointer.y))
    if (deltaX !== 0) {
      session.scrollOffset.x += deltaX
      session.moved = true
      this.applyHorizontalDrag(session)
    }
    if (deltaY !== 0 && session.verticalArmed) {
      session.scrollOffset.y += deltaY
      this.dragOffsetY = session.pointer.y - session.origin.y + session.scrollOffset.y
    }
    if (session.verticalArmed) {
      editor.setClipDragPreview(session.clipIds, this.dragOffsetY, true)
      editor.setEffectDragPreview(session.effectBlockIds, this.dragOffsetY)
    }
  }

  private findMoveTarget(clientX: number, clientY: number): HTMLElement | null {
    const selector = '[data-timeline-channel-id], [data-new-track-zone]'
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const target = candidates.find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.height > 0 && clientY >= rect.top && clientY < rect.bottom
    }) ?? document.elementFromPoint?.(clientX, clientY)?.closest<HTMLElement>(selector) ?? null
    if (!target?.hasAttribute('data-timeline-channel-id')) return target
    if (target.dataset.channelType !== (
      editor.channels.find((channel) => channel.id === this.options.getChannelId())?.type
    )) return null
    if (target.dataset.channelLocked === 'true') return null
    return target
  }

  private findDragTarget(session: DragSession, clientX: number, clientY: number): HTMLElement | null {
    return this.findMoveTarget(clientX, clientY + session.targetOffsetY)
  }

  private setMoveTarget(session: DragSession, target: HTMLElement | null) {
    if (session.moveTarget === target) return
    session.moveTarget?.classList.remove('drop-active')
    session.moveTarget = target
    session.moveTarget?.classList.add('drop-active')
  }

  private removeDragListeners() {
    window.removeEventListener('mousemove', this.handleDragMove)
    window.removeEventListener('mouseup', this.finishDrag)
    window.removeEventListener('blur', this.cancelDrag)
    document.removeEventListener('visibilitychange', this.cancelDragWhenHidden)
    if (this.#dragMoveFrame !== null) cancelAnimationFrame(this.#dragMoveFrame)
    this.#dragMoveFrame = null
    this.#pendingDragPoint = null
  }

  private cancelDragWhenHidden = () => {
    if (document.visibilityState === 'hidden') this.cancelDrag()
  }

  private cancelDrag = () => {
    const session = this.#dragSession
    if (!session) return
    this.dragging = false
    this.dragOffsetY = 0
    editor.clearClipDragPreview()
    editor.clearEffectDragPreview()
    editor.clearTextDragPreview()
    this.setMoveTarget(session, null)
    this.removeDragListeners()
    this.#dragSession = null
    this.options.getOnClipDragEnd()?.()
    editor.cancelHistory()
  }

  private finishDrag = (event: MouseEvent) => {
    if (this.#dragMoveFrame !== null) cancelAnimationFrame(this.#dragMoveFrame)
    this.#dragMoveFrame = null
    const pendingPoint = this.#pendingDragPoint
    this.#pendingDragPoint = null
    if (pendingPoint) this.applyDragMove(pendingPoint)
    const session = this.#dragSession
    if (!session) return
    const clip = this.options.getClip()
    const channelId = this.options.getChannelId()
    const target = session.verticalArmed ? this.findDragTarget(session, event.clientX, event.clientY) : null
    const selectOnlyThisClip = session.collapseSelectionOnClick && !session.moved

    this.dragging = false
    this.dragOffsetY = 0
    editor.clearClipDragPreview()
    editor.clearEffectDragPreview()
    editor.clearTextDragPreview()
    this.setMoveTarget(session, null)
    this.removeDragListeners()
    this.#dragSession = null
    this.options.getOnClipDragEnd()?.()
    if (selectOnlyThisClip) editor.selectClip(clip.id)

    if (target) {
      const targetChannelId = target.dataset.timelineChannelId
      if (targetChannelId) {
        editor.moveClipsToChannel(
          channelId,
          targetChannelId,
          session.clipIds,
          clip.id,
          session.desiredStart,
          session.effectBlockIds,
          session.textItemIds,
        )
      } else if (target.hasAttribute('data-new-track-zone')) {
        editor.moveClipsToChannel(
          channelId,
          null,
          session.clipIds,
          clip.id,
          session.desiredStart,
          session.effectBlockIds,
          session.textItemIds,
        )
      }
    } else if (session.verticalArmed) {
      editor.moveClipsToChannel(
        channelId,
        channelId,
        session.clipIds,
        clip.id,
        session.desiredStart,
        session.effectBlockIds,
        session.textItemIds,
      )
    }
    editor.endHistory()
  }

  startTrim(edge: TrimEdge, event: MouseEvent) {
    event.stopPropagation()
    const clip = this.options.getClip()
    const channelId = this.options.getChannelId()
    editor.selectClip(clip.id)
    const channel = editor.channels.find((candidate) => candidate.id === channelId)
    if (!channel || channel.locked) return
    const current = editor.getClipById(clip.id)?.clip
    if (!current) return

    editor.beginHistory()
    const end = clipEnd(current)
    let nextStart: number | null = null
    let prevEnd: number | null = null
    for (const other of channel.clips) {
      if (other.id === clip.id) continue
      const otherEnd = clipEnd(other)
      if (other.start >= current.start - 1e-9 && (nextStart === null || other.start < nextStart)) nextStart = other.start
      if (otherEnd <= end + 1e-9 && (prevEnd === null || otherEnd > prevEnd)) prevEnd = otherEnd
    }
    this.trimming = edge
    this.#trimSession = {
      originX: event.clientX,
      originEdge: edge === 'left' ? current.start : end,
      nextStart,
      prevEnd,
    }
    window.addEventListener('mousemove', this.handleTrimMove)
    window.addEventListener('mouseup', this.finishTrim)
  }

  startTrimLeft = (event: MouseEvent) => this.startTrim('left', event)

  startTrimRight = (event: MouseEvent) => this.startTrim('right', event)

  private handleTrimMove = (event: MouseEvent) => {
    if (this.#trimMoveFrame !== null) {
      this.#pendingTrimX = event.clientX
      return
    }
    this.applyTrimMove(event.clientX)
    this.#trimMoveFrame = requestAnimationFrame(this.flushPendingTrimMove)
  }

  private flushPendingTrimMove = () => {
    this.#trimMoveFrame = null
    const clientX = this.#pendingTrimX
    this.#pendingTrimX = null
    if (clientX === null || !this.#trimSession) return
    this.applyTrimMove(clientX)
    this.#trimMoveFrame = requestAnimationFrame(this.flushPendingTrimMove)
  }

  private applyTrimMove(clientX: number) {
    const edge = this.trimming
    const session = this.#trimSession
    const clip = this.options.getClip()
    if (!edge || !session) return
    const current = editor.getClipById(clip.id)?.clip
    if (!current) return
    const currentLen = clipTimelineDuration(current)
    const currentEdge = edge === 'left' ? current.start : current.start + currentLen
    const desiredEdge = session.originEdge + (clientX - session.originX) / editor.pixelsPerSecond
    let snapDelta = desiredEdge - currentEdge
    let closestPx = TRIM_SNAP_PX + 1e-9
    for (const candidate of [editor.currentTime, session.nextStart, session.prevEnd]) {
      if (candidate === null) continue
      const distancePx = Math.abs(desiredEdge - candidate) * editor.pixelsPerSecond
      if (distancePx <= closestPx) {
        closestPx = distancePx
        snapDelta = candidate - currentEdge
      }
    }
    editor.trimClip(clip.id, edge, snapDelta)

    const updated = editor.getClipById(clip.id)?.clip
    if (!updated) return
    const appliedEdge = edge === 'left' ? updated.start : clipEnd(updated)
    const requestedEdge = currentEdge + snapDelta
    if (Math.abs(appliedEdge - requestedEdge) > 1e-9) {
      session.originX = clientX
      session.originEdge = appliedEdge
    }
  }

  private finishTrim = () => {
    if (this.#trimMoveFrame !== null) cancelAnimationFrame(this.#trimMoveFrame)
    this.#trimMoveFrame = null
    if (this.#pendingTrimX !== null) this.applyTrimMove(this.#pendingTrimX)
    this.#pendingTrimX = null
    this.trimming = null
    this.#trimSession = null
    window.removeEventListener('mousemove', this.handleTrimMove)
    window.removeEventListener('mouseup', this.finishTrim)
    editor.endHistory()
  }

  startVolumeDrag = (event: MouseEvent) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const clip = this.options.getClip()
    const channel = editor.channels.find((candidate) => candidate.id === this.options.getChannelId())
    if (!channel || channel.locked) return
    editor.beginHistory()
    this.volumeDragging = true
    const targetIds = this.selectedAudioClipIds().includes(clip.id)
      ? this.selectedAudioClipIds()
      : [clip.id]
    const clipElement = (event.currentTarget as HTMLElement).closest('.clip') as HTMLElement
    const rect = clipElement.getBoundingClientRect()
    const originY = event.clientY
    const height = Math.max(1, rect.height)
    const initialVolumes = new Map(targetIds.map((id) => {
      const target = editor.getClipById(id)?.clip
      return [id, target?.volume ?? 100]
    }))
    const apply = (clientY: number) => {
      const delta = (originY - clientY) / height * 200
      for (const id of targetIds) {
        const targetInitialVolume = initialVolumes.get(id)
        if (targetInitialVolume !== undefined) editor.setClipVolume(id, targetInitialVolume + delta)
      }
    }
    const move = (moveEvent: MouseEvent) => {
      this.#pendingVolumeY = moveEvent.clientY
      if (this.#volumeMoveFrame !== null) return
      this.#volumeMoveFrame = requestAnimationFrame(() => {
        this.#volumeMoveFrame = null
        const clientY = this.#pendingVolumeY
        this.#pendingVolumeY = null
        if (clientY !== null) apply(clientY)
      })
    }
    const up = (upEvent: MouseEvent) => {
      if (this.#volumeMoveFrame !== null) cancelAnimationFrame(this.#volumeMoveFrame)
      this.#volumeMoveFrame = null
      apply(this.#pendingVolumeY ?? upEvent.clientY)
      this.#pendingVolumeY = null
      this.volumeDragging = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      this.#volumeMove = null
      this.#volumeUp = null
      editor.endHistory()
    }
    this.#volumeMove = move
    this.#volumeUp = up
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  onVolumeKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    const clip = this.options.getClip()
    const targetIds = this.selectedAudioClipIds().includes(clip.id)
      ? this.selectedAudioClipIds()
      : [clip.id]
    editor.beginHistory()
    const step = event.key === 'ArrowUp' ? 5 : -5
    for (const id of targetIds) {
      const found = editor.getClipById(id)
      if (found) editor.setClipVolume(id, (found.clip.volume ?? 100) + step)
    }
    editor.endHistory()
  }

  private selectedAudioClipIds(): string[] {
    return editor.selectedClipIds.filter((id) => editor.getClipById(id)?.channel.type === 'audio')
  }

  private expandLinkedDragIds(ids: string[]): string[] {
    const expanded = new Set(ids)
    const pending = [...ids]
    while (pending.length > 0) {
      const linkedId = editor.getClipById(pending.pop()!)?.clip.linkedClipId
      if (linkedId && !expanded.has(linkedId)) {
        expanded.add(linkedId)
        pending.push(linkedId)
      }
    }
    return [...expanded]
  }

  private buildDragSnapCandidates(anchorId: string, clipIds: string[]): {
    clips: SnapCandidate[]
    playhead: SnapCandidate[]
  } {
    const movingIds = new Set(clipIds)
    const anchor = editor.getClipById(anchorId)?.clip
    if (!anchor) return { clips: [], playhead: [] }
    const clipCandidates: SnapCandidate[] = []
    const playheadCandidates: SnapCandidate[] = []
    let order = 0
    for (const id of movingIds) {
      const found = editor.getClipById(id)
      if (!found) continue
      const offset = found.clip.start - anchor.start
      const movingLength = clipTimelineDuration(found.clip)
      for (const otherChannel of editor.channels) {
        for (const other of otherChannel.clips) {
          if (movingIds.has(other.id)) continue
          const otherLength = clipTimelineDuration(other)
          const otherEnd = clipEnd(other)
          if (otherChannel.id === found.channel.id) {
            const boundary = other.start + otherLength / 2 - offset - movingLength / 2
            clipCandidates.push({ start: other.start - movingLength - offset, order: order++, maxAnchorStart: boundary })
            clipCandidates.push({ start: otherEnd - offset, order: order++, minAnchorStartExclusive: boundary })
          } else {
            clipCandidates.push({ start: other.start - offset, order: order++ })
            clipCandidates.push({ start: otherEnd - offset, order: order++ })
            clipCandidates.push({ start: other.start - movingLength - offset, order: order++ })
            clipCandidates.push({ start: otherEnd - movingLength - offset, order: order++ })
          }
        }
      }
      playheadCandidates.push({ start: editor.currentTime - offset, order: order++ })
      playheadCandidates.push({ start: editor.currentTime - offset - movingLength, order: order++ })
    }
    const byStart = (a: SnapCandidate, b: SnapCandidate) => a.start - b.start || a.order - b.order
    clipCandidates.sort(byStart)
    playheadCandidates.sort(byStart)
    return { clips: clipCandidates, playhead: playheadCandidates }
  }

  destroy() {
    this.cancelDrag()
    if (this.#trimSession) {
      window.removeEventListener('mousemove', this.handleTrimMove)
      window.removeEventListener('mouseup', this.finishTrim)
      if (this.#trimMoveFrame !== null) cancelAnimationFrame(this.#trimMoveFrame)
      this.#trimMoveFrame = null
      this.#pendingTrimX = null
      this.trimming = null
      this.#trimSession = null
      editor.endHistory()
    }
    if (this.#volumeMove && this.#volumeUp) {
      window.removeEventListener('mousemove', this.#volumeMove)
      window.removeEventListener('mouseup', this.#volumeUp)
      if (this.#volumeMoveFrame !== null) cancelAnimationFrame(this.#volumeMoveFrame)
      this.#volumeMoveFrame = null
      this.#pendingVolumeY = null
      this.#volumeMove = null
      this.#volumeUp = null
      this.volumeDragging = false
      editor.endHistory()
    }
  }
}

export function useClipInteractions(options: ClipInteractionsOptions): ClipInteractions {
  const interactions = new ClipInteractions(options)
  onDestroy(() => interactions.destroy())
  return interactions
}
