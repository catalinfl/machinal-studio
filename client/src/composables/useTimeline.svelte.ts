import { tick } from 'svelte'
import {
  CLIP_AREA_HEIGHT,
  FX_LANE_HEIGHT,
  TEXT_LANE_HEIGHT,
  TEXT_TRACK_MIN_HEIGHT,
  clipEnd,
  editor,
  type Channel,
  type Clip,
  type TextItem,
} from '../stores/editor.svelte'
import { render } from '../stores/render.svelte'
import { addDroppedClip, computeDropStart, resolveDropMediaKind, type DropClipData } from '../lib/drop'
import { fitTextItemPosition, TEXT_DRAG_MIME } from '../lib/text-render'
import { snapTime } from '../lib/snap'
import { addPointerDragListeners } from '../lib/pointer-drag'
import { collectTimelineSnapEdges, elementsInRect } from '../lib/timeline-selection'
import { buildChannelContextMenu, buildClipContextMenu, type TimelineContextMenuContent } from '../lib/timeline-context-menu'
import { mediaProcessing } from '../stores/media-processing.svelte'
import type { AIFeature } from '../lib/ai-access'

export interface TimelineProps {
  hideExport?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  inspectorOpen?: boolean
  onOpenClipInspector?: () => void
  onOpenEffectInspector?: () => void
  onOpenTextInspector?: () => void
  onRequireServerAccess?: (feature: AIFeature) => void
}

export interface TimelineContextMenu extends TimelineContextMenuContent {
  id: number
  x: number
  y: number
}

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

interface MarqueeState {
  rect: MarqueeRect | null
  clipPath: string
  startX: number
  startY: number
  clientX: number
  clientY: number
  dragging: boolean
  additive: boolean
  baseIds: string[]
  baseEffectIds: string[]
  baseTextIds: string[]
  pointerId: number | null
}

type NewTrackDropState =
  | { kind: 'idle' }
  | { kind: 'dragging' }
  | { kind: 'processing' }

const TIMELINE_OVERSCAN_PX = 600
const PLAYHEAD_SNAP_PX = 3
const MARQUEE_DRAG_THRESHOLD_PX = 3
const EDGE_PX = 64
const MAX_HORIZONTAL_SCROLL_STEP = 32
const MAX_VERTICAL_SCROLL_STEP = 28

export function useTimeline(props: TimelineProps) {
  const elements = {
    bodyEl: undefined as HTMLDivElement | undefined,
    timelineScrollEl: undefined as HTMLDivElement | undefined,
    horizontalScrollEl: undefined as HTMLDivElement | undefined,
    rulerEl: undefined as HTMLDivElement | undefined,
    newTrackEl: undefined as HTMLDivElement | undefined,
  }

  let horizontalScrollLeft = $state(0)
  let timelineViewportWidth = $state(0)
  let dragScrollActive = $state(false)
  let previousInspectorOpen = false
  let textDropActive = $state(false)
  let textDropTime = $state(0)
  let paletteDropGuide = $state<{
    kind: 'effect' | 'transition'
    time: number
    leftClipName?: string
    rightClipName?: string
  } | null>(null)
  let contextMenu = $state<TimelineContextMenu | null>(null)
  let contextMenuId = 0
  let showTrackHeaders = $state(true)

  const inspectorOpen = $derived(props.inspectorOpen ?? false)
  const onOpenClipInspector = $derived(props.onOpenClipInspector)
  const onOpenEffectInspector = $derived(props.onOpenEffectInspector)
  const onOpenTextInspector = $derived(props.onOpenTextInspector)
  const textTrackHeight = $derived(Math.max(TEXT_TRACK_MIN_HEIGHT, editor.getTextLanes().length * TEXT_LANE_HEIGHT))
  const trackWidth = $derived(Math.max(editor.totalDuration, 10) * editor.pixelsPerSecond + 120)
  const visibleTimeRange = $derived.by(() => {
    if (timelineViewportWidth <= 0) return null
    return {
      start: Math.max(0, (horizontalScrollLeft - TIMELINE_OVERSCAN_PX) / editor.pixelsPerSecond),
      end: (horizontalScrollLeft + timelineViewportWidth + TIMELINE_OVERSCAN_PX) / editor.pixelsPerSecond,
    }
  })

  const rulerMarks = $derived.by(() => {
    const marks: { t: number; major: boolean }[] = []
    const total = Math.max(editor.totalDuration, 10)
    const target = 70
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]
    let step = candidates[candidates.length - 1]
    for (const candidate of candidates) {
      if (candidate * editor.pixelsPerSecond >= target) { step = candidate; break }
    }
    for (let t = 0; t <= total + step; t += step) {
      marks.push({ t, major: t % (step * 5) === 0 })
    }
    return marks
  })
  const visibleRulerMarks = $derived(
    visibleTimeRange
      ? rulerMarks.filter((mark) => mark.t >= visibleTimeRange.start && mark.t <= visibleTimeRange.end)
      : rulerMarks,
  )

  function fmt(t: number): string {
    if (!isFinite(t)) return '00:00:00:00'
    const fps = editor.fps
    const f = Math.floor((t % 1) * fps)
    const s = Math.floor(t) % 60
    const m = Math.floor(t / 60) % 60
    const h = Math.floor(t / 3600)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
  }

  function fmtShort(t: number): string {
    const s = Math.floor(t) % 60
    const m = Math.floor(t / 60) % 60
    const h = Math.floor(t / 3600)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  }

  function rowHeight(channel: Channel): number {
    const lanes = channel.type === 'video' ? editor.getEffectLanes(channel.id).length : 0
    return CLIP_AREA_HEIGHT + lanes * FX_LANE_HEIGHT
  }

  function seekTo(seconds: number) {
    editor.setCurrentTime(Math.max(0, Math.min(seconds, editor.totalDuration)))
  }

  function snapToClipEdge(seconds: number): number {
    return snapTime(seconds, editor.pixelsPerSecond, PLAYHEAD_SNAP_PX, collectTimelineSnapEdges(editor))
  }

  function stepFrames(frames: number) {
    seekTo(editor.currentTime + frames * (1 / editor.fps))
  }

  function togglePlay() { render.startPlayback() }
  function goToStart() { editor.setCurrentTime(0) }
  function goToEnd() { editor.setCurrentTime(editor.totalDuration) }
  function stepBackward() { stepFrames(-1) }
  function stepForward() { stepFrames(1) }
  function toggleTrackHeaders() { showTrackHeaders = !showTrackHeaders }
  function addVideoChannel() { editor.addChannel('video') }
  function addAudioChannel() { editor.addChannel('audio') }
  function setZoom(event: Event) {
    editor.setPixelsPerSecond(Number((event.target as HTMLInputElement).value))
  }

  function channelIdFromEvent(event: Event): string | null {
    return (event.currentTarget as HTMLElement | null)?.dataset.channelId ?? null
  }

  function selectChannel(event: MouseEvent) {
    const channelId = channelIdFromEvent(event)
    if (!channelId || (event.target as HTMLElement | null)?.closest('button')) return
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    editor.selectChannel(channelId, additive)
  }

  function onChannelKey(event: KeyboardEvent) {
    const channelId = channelIdFromEvent(event)
    if (!channelId || (event.key !== 'Enter' && event.key !== ' ')) return
    if ((event.target as HTMLElement | null)?.closest('button')) return
    event.preventDefault()
    editor.selectChannel(channelId, event.ctrlKey || event.metaKey || event.shiftKey)
  }

  function toggleMute(event: MouseEvent) {
    const channelId = channelIdFromEvent(event)
    if (channelId) editor.toggleMute(channelId)
  }

  function toggleLock(event: MouseEvent) {
    const channelId = channelIdFromEvent(event)
    if (channelId) editor.toggleLock(channelId)
  }

  function removeChannel(event: MouseEvent) {
    const channelId = channelIdFromEvent(event)
    if (channelId) editor.removeChannel(channelId)
  }

  function menuPosition(event: MouseEvent): { x: number; y: number } {
    if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: rect.left + Math.min(28, rect.width / 2), y: rect.top + Math.min(28, rect.height / 2) }
  }

  function openClipContextMenu(event: MouseEvent, clip: Clip, channelId: string) {
    if (!editor.selectedClipIds.includes(clip.id)) editor.selectClip(clip.id)

    const channel = editor.channels.find((candidate) => candidate.id === channelId)
    if (!channel) return

    const position = menuPosition(event)
    contextMenu = {
      id: ++contextMenuId,
      ...position,
      ...buildClipContextMenu(clip, channel, onOpenClipInspector),
    }
  }

  function openChannelContextMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const channelId = channelIdFromEvent(event)
    const channel = channelId ? editor.channels.find((candidate) => candidate.id === channelId) : undefined
    if (!channel) return
    if (!editor.selectedChannelIds.includes(channel.id)) editor.selectChannel(channel.id)
    const position = menuPosition(event)
    contextMenu = {
      id: ++contextMenuId,
      ...position,
      ...buildChannelContextMenu(channel),
    }
  }

  function closeContextMenu() { contextMenu = null }

  function onRulerClick(event: MouseEvent) {
    const rulerEl = elements.rulerEl
    if (!rulerEl) return
    const rect = rulerEl.getBoundingClientRect()
    const x = event.clientX - rect.left
    seekTo(snapToClipEdge(x / editor.pixelsPerSecond))
  }

  function onRulerKey(event: KeyboardEvent) {
    // Preview.svelte also listens for these keys on window; stop propagation
    // so a focused ruler never steps/toggles twice per press.
    if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); stepFrames(-1) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); stepFrames(1) }
    else if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); goToStart() }
    else if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); goToEnd() }
    else if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); togglePlay() }
  }

  let draggingPlayhead = $state(false)
  let playheadGrabOffsetX = 0
  let stopPlayheadDrag: (() => void) | null = null
  let marquee = $state<MarqueeState>({
    rect: null,
    clipPath: 'none',
    startX: 0,
    startY: 0,
    clientX: 0,
    clientY: 0,
    dragging: false,
    additive: false,
    baseIds: [],
    baseEffectIds: [],
    baseTextIds: [],
    pointerId: null,
  })
  let stopMarqueeDrag: (() => void) | null = null

  function getTimeFromClientX(clientX: number): number {
    const rulerEl = elements.rulerEl
    if (!rulerEl) return 0
    const rect = rulerEl.getBoundingClientRect()
    const x = clientX - rect.left
    return Math.max(0, x / editor.pixelsPerSecond)
  }

  function onPlayheadPointerDown(event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    draggingPlayhead = true
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
    const rulerRect = elements.rulerEl?.getBoundingClientRect()
    const playheadClientX = (rulerRect?.left ?? 0) + editor.currentTime * editor.pixelsPerSecond
    playheadGrabOffsetX = event.clientX - playheadClientX
    stopPlayheadDrag?.()
    stopPlayheadDrag = addPointerDragListeners({
      onMove: onPlayheadPointerMove,
      onEnd: onPlayheadPointerUp,
    })
  }

  function onPlayheadPointerMove(event: PointerEvent) {
    if (!draggingPlayhead) return
    const bodyRect = elements.bodyEl?.getBoundingClientRect()
    const timelineRect = elements.timelineScrollEl?.getBoundingClientRect()
    const trackLeft = timelineRect?.left ?? bodyRect?.left
    const effectiveClientX = bodyRect && bodyRect.width > 0 && trackLeft !== undefined
      ? Math.max(trackLeft, Math.min(bodyRect.right, event.clientX - playheadGrabOffsetX))
      : event.clientX - playheadGrabOffsetX
    seekTo(snapToClipEdge(getTimeFromClientX(effectiveClientX)))
    updateAutoScroll(event.clientX, event.clientY, onPlayheadAutoScroll, false)
  }

  function onPlayheadAutoScroll(deltaX: number) {
    seekTo(snapToClipEdge(editor.currentTime + deltaX / editor.pixelsPerSecond))
  }

  function onPlayheadPointerUp() {
    draggingPlayhead = false
    playheadGrabOffsetX = 0
    stopAutoScroll()
    stopPlayheadDrag?.()
    stopPlayheadDrag = null
  }

  $effect(() => {
    const projectEnd = editor.totalDuration
    if (editor.currentTime < 0) editor.setCurrentTime(0)
    else if (editor.currentTime > projectEnd) editor.setCurrentTime(projectEnd)
  })

  function splitAtPlayhead() {
    if (mediaProcessing.active) return
    const time = editor.currentTime
    if (editor.selectedClipId) {
      const found = editor.getClipById(editor.selectedClipId)
      if (found && time > found.clip.start && time < clipEnd(found.clip)) {
        editor.splitClip(editor.selectedClipId, time)
        return
      }
    }
    for (const channel of editor.channels) {
      for (const clip of channel.clips.slice()) {
        const end = clipEnd(clip)
        if (time > clip.start && time < end) editor.splitClip(clip.id, time)
      }
    }
  }

  function onGlobalKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
    if (contextMenu) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        contextMenu = null
      }
      return
    }
    const modifier = event.ctrlKey || event.metaKey

    if (modifier && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault()
      if (event.shiftKey) editor.redo()
      else editor.undo()
      return
    }
    if (modifier && (event.key === 'u' || event.key === 'U' || event.key === 'y' || event.key === 'Y')) {
      event.preventDefault()
      editor.redo()
      return
    }

    if (event.key === 'Escape') {
      if (editor.selectedClipIds.length > 0 || editor.selectedEffectBlockIds.length > 0 || editor.selectedTextItemIds.length > 0) {
        event.preventDefault()
        editor.clearSelection()
      }
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (editor.selectedClipIds.length > 0 || editor.selectedEffectBlockIds.length > 0 || editor.selectedTextItemIds.length > 0) {
        event.preventDefault()
        editor.removeSelectedItems()
      }
      return
    }
    if (!modifier && !event.altKey && event.shiftKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      editor.selectAllClips()
      props.onOpenClipInspector?.()
      props.onOpenEffectInspector?.()
      props.onOpenTextInspector?.()
      return
    }

    if (modifier && (event.key === 'c' || event.key === 'C')) {
      if (editor.copySelectedClips()) event.preventDefault()
      return
    }
    if (modifier && (event.key === 'v' || event.key === 'V')) {
      event.preventDefault()
      editor.pasteCopiedClips()
      return
    }
    if (modifier && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      editor.toggleLinkSelectedClips()
      return
    }
    if (!modifier && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault()
      splitAtPlayhead()
    }
  }

  function updateMarqueeSelection(rect: MarqueeRect) {
    const enclosedIds = elementsInRect('[data-timeline-clip-id]', 'timelineClipId', rect)
    const enclosedEffectIds = elementsInRect('[data-timeline-effect-id]', 'timelineEffectId', rect)
    const enclosedTextIds = elementsInRect('[data-timeline-text-id]', 'timelineTextId', rect)

    editor.selectItems(
      marquee.additive ? [...marquee.baseIds, ...enclosedIds] : enclosedIds,
      marquee.additive ? [...marquee.baseEffectIds, ...enclosedEffectIds] : enclosedEffectIds,
      marquee.additive ? [...marquee.baseTextIds, ...enclosedTextIds] : enclosedTextIds,
    )
  }

  function isTextDrag(dataTransfer: DataTransfer | null): boolean {
    return Array.from(dataTransfer?.types ?? []).includes(TEXT_DRAG_MIME)
  }

  function onTextDragOver(event: DragEvent) {
    if (!isTextDrag(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    textDropActive = true
    const time = snapToClipEdge(getTimeFromClientX(event.clientX))
    if (Number.isFinite(time)) textDropTime = time
  }

  function onTextDragLeave(event: DragEvent) {
    const related = event.relatedTarget as Node | null
    if (related && (event.currentTarget as HTMLElement).contains(related)) return
    textDropActive = false
  }

  function stopTextDrop() { textDropActive = false }
  function stopPaletteDropGuide() { paletteDropGuide = null }
  function setPaletteDropGuide(preview: NonNullable<typeof paletteDropGuide>) { paletteDropGuide = preview }

  function onTextDrop(event: DragEvent) {
    const data = event.dataTransfer?.getData(TEXT_DRAG_MIME)
    if (!data) return
    event.preventDefault()
    event.stopPropagation()
    let parsed: { values?: Partial<Omit<TextItem, 'id' | 'start'>>; fitToSafeArea?: boolean }
    try { parsed = JSON.parse(data) } catch { return }
    if (!parsed.values || typeof parsed.values !== 'object') return
    const pointerTime = snapToClipEdge(getTimeFromClientX(event.clientX))
    let item!: TextItem
    editor.withHistoryTransaction(() => {
      item = editor.addTextItem(Number.isFinite(pointerTime) ? pointerTime : textDropTime, parsed.values)
      if (parsed.fitToSafeArea) editor.updateTextItem(item.id, fitTextItemPosition(item, editor.effectiveProjectAspect))
    })
    editor.selectTextItem(item.id)
    stopTextDrop()
    stopAutoScroll()
  }

  function onMarqueePointerMove(event: PointerEvent) {
    if (marquee.pointerId !== event.pointerId) return
    marquee.clientX = event.clientX
    marquee.clientY = event.clientY
    const dx = marquee.clientX - marquee.startX
    const dy = marquee.clientY - marquee.startY
    if (!marquee.dragging && Math.hypot(dx, dy) < MARQUEE_DRAG_THRESHOLD_PX) return
    marquee.dragging = true
    updateMarqueeRect()
    updateAutoScroll(marquee.clientX, marquee.clientY, onMarqueeAutoScroll)
  }

  function updateMarqueeRect() {
    const dx = marquee.clientX - marquee.startX
    const dy = marquee.clientY - marquee.startY
    marquee.rect = {
      left: Math.min(marquee.startX, marquee.clientX),
      top: Math.min(marquee.startY, marquee.clientY),
      width: Math.abs(dx),
      height: Math.abs(dy),
    }
    const bounds = elements.bodyEl?.getBoundingClientRect()
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const right = marquee.rect.left + marquee.rect.width
      const bottom = marquee.rect.top + marquee.rect.height
      marquee.clipPath = `inset(${Math.max(0, bounds.top - marquee.rect.top)}px ${Math.max(0, right - bounds.right)}px ${Math.max(0, bottom - bounds.bottom)}px ${Math.max(0, bounds.left - marquee.rect.left)}px)`
    } else {
      marquee.clipPath = 'none'
    }
    updateMarqueeSelection(marquee.rect)
  }

  function onMarqueeAutoScroll(deltaX: number, deltaY: number) {
    if (!marquee.dragging || marquee.pointerId === null) return
    marquee.startX -= deltaX
    marquee.startY -= deltaY
    updateMarqueeRect()
  }

  function stopMarquee(event?: PointerEvent) {
    if (event && marquee.pointerId !== event.pointerId) return
    marquee.rect = null
    marquee.clipPath = 'none'
    marquee.dragging = false
    marquee.pointerId = null
    stopAutoScroll()
    stopMarqueeDrag?.()
    stopMarqueeDrag = null
  }

  function onTimelinePointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 2) return
    const target = event.target as HTMLElement | null
    if (target?.closest('.clip')) return
    if (target?.closest('.playhead, .tl-ruler, .fxblock, .text-block, .transition-marker, button, input, select')) return

    event.preventDefault()
    // Clicking empty timeline space should not leave the previously focused
    // timeline item showing its native focus ring.
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)

    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    if (!additive) editor.clearSelection()
    marquee.startX = event.clientX
    marquee.startY = event.clientY
    marquee.clientX = event.clientX
    marquee.clientY = event.clientY
    marquee.additive = additive
    marquee.baseIds = marquee.additive ? [...editor.selectedClipIds] : []
    marquee.baseEffectIds = marquee.additive ? [...editor.selectedEffectBlockIds] : []
    marquee.baseTextIds = marquee.additive ? [...editor.selectedTextItemIds] : []
    marquee.pointerId = event.pointerId
    stopMarqueeDrag?.()
    stopMarqueeDrag = addPointerDragListeners({
      onMove: onMarqueePointerMove,
      onEnd: stopMarquee,
    })
  }

  function onTimelineContextMenu(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    if (!target?.closest('.clip')) event.preventDefault()
  }

  $effect.pre(() => {
    const openingInspector = inspectorOpen && !previousInspectorOpen
    previousInspectorOpen = inspectorOpen
    if (!openingInspector || !elements.bodyEl || !elements.timelineScrollEl) return

    const scrollLeft = elements.timelineScrollEl.scrollLeft
    tick().then(() => {
      if (elements.timelineScrollEl) elements.timelineScrollEl.scrollLeft = scrollLeft
    })
  })

  $effect(() => {
    const scrollElement = elements.timelineScrollEl
    if (!scrollElement) return
    // Ignore transient 0-width measures (mount/detach): with width 0 the
    // visible range becomes null and every row falls back to rendering ALL
    // clips/marks, i.e. a mount-everything -> measure -> cull-everything
    // flash that is brutal with many videos.
    const measure = () => {
      const width = scrollElement.clientWidth
      if (width > 0) timelineViewportWidth = width
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(scrollElement)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  })

  $effect(() => {
    window.addEventListener('keydown', onGlobalKey, true)
    return () => {
      window.removeEventListener('keydown', onGlobalKey, true)
      if (pendingScrollRaf !== null) {
        cancelAnimationFrame(pendingScrollRaf)
        pendingScrollRaf = null
      }
      stopMarquee()
    }
  })

  let newTrackDropState = $state<NewTrackDropState>({ kind: 'idle' })
  const newTrackActive = $derived(newTrackDropState.kind !== 'idle')
  const processingNewTrack = $derived(newTrackDropState.kind === 'processing')
  let lastDropX = -1
  let scrollVelocityX = 0
  let scrollVelocityY = 0
  let horizontalScrollPadding = $state(0)
  let dragContentMinWidth = $state(0)
  let autoScrollRaf: number | null = null
  let activeClipScrollHandler: ((deltaX: number, deltaY: number) => void) | undefined
  let maxAutoScrollTop = Infinity
  const timelineCanvasWidth = $derived(Math.max(
    trackWidth,
    horizontalScrollPadding,
    dragContentMinWidth,
  ))

  function onScrollDragOver(event: DragEvent) {
    lastDropX = event.clientX
    updateAutoScroll(event.clientX, event.clientY)
  }

  let pendingScrollRaf: number | null = null
  let latestScrollLeft = 0
  const mirroredScrollPositions = new WeakMap<HTMLElement, number>()

  function applyRulerTransform(scrollLeft: number) {
    elements.rulerEl?.style.setProperty('transform', `translateX(${-scrollLeft}px)`)
  }

  function commitPendingScroll() {
    pendingScrollRaf = null
    horizontalScrollLeft = latestScrollLeft
  }

  function scheduleHorizontalScrollUpdate(scrollLeft: number) {
    latestScrollLeft = scrollLeft
    // Align the ruler immediately; only virtualization waits for the next frame.
    applyRulerTransform(scrollLeft)
    if (pendingScrollRaf !== null) return
    pendingScrollRaf = requestAnimationFrame(commitPendingScroll)
  }

  function syncHorizontalScroll(source: HTMLElement | undefined, follower: HTMLElement | undefined) {
    if (!source || !follower) return
    const scrollLeft = source.scrollLeft
    const mirroredPosition = mirroredScrollPositions.get(source)
    mirroredScrollPositions.delete(source)
    // Mirrored scroll events arrive asynchronously, after the source may have moved again.
    if (scrollLeft === mirroredPosition) return

    if (follower.scrollLeft !== scrollLeft) {
      follower.scrollLeft = scrollLeft
      mirroredScrollPositions.set(follower, follower.scrollLeft)
    }
    scheduleHorizontalScrollUpdate(elements.timelineScrollEl?.scrollLeft ?? scrollLeft)
  }

  function syncHorizontalScrollbar() {
    syncHorizontalScroll(elements.timelineScrollEl, elements.horizontalScrollEl)
  }

  async function revealRoutedClip(clipId: string) {
    await tick()
    const clipEl = Array.from(elements.timelineScrollEl?.querySelectorAll<HTMLElement>('[data-timeline-clip-id]') ?? [])
      .find((element) => element.dataset.timelineClipId === clipId)
    if (!clipEl) return

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    clipEl.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }

  function onHorizontalScrollbarScroll() {
    syncHorizontalScroll(elements.horizontalScrollEl, elements.timelineScrollEl)
  }

  function edgeScrollVelocity(position: number, start: number, end: number, maxStep: number): number {
    if (position > end - EDGE_PX) {
      const depth = Math.min(EDGE_PX, position - (end - EDGE_PX))
      return maxStep * depth / EDGE_PX
    }
    if (position < start + EDGE_PX) {
      const depth = Math.min(EDGE_PX, start + EDGE_PX - position)
      return -maxStep * depth / EDGE_PX
    }
    return 0
  }

  function updateAutoScroll(
    clientX: number,
    clientY: number,
    onScroll?: (deltaX: number, deltaY: number) => void,
    allowVerticalScroll = true,
  ) {
    const bodyEl = elements.bodyEl
    const timelineScrollEl = elements.timelineScrollEl
    if (!bodyEl || !timelineScrollEl) return
    dragContentMinWidth = Math.max(
      dragContentMinWidth,
      timelineScrollEl.scrollWidth,
      timelineScrollEl.getBoundingClientRect().width,
    )
    dragScrollActive = true
    activeClipScrollHandler = onScroll
    const rect = bodyEl.getBoundingClientRect()
    const timelineRect = timelineScrollEl.getBoundingClientRect()
    const newTrackRect = elements.newTrackEl?.getBoundingClientRect()
    maxAutoScrollTop = newTrackRect && newTrackRect.height > 0
      ? bodyEl.scrollTop + Math.max(0, newTrackRect.bottom - rect.bottom)
      : Infinity

    scrollVelocityX = edgeScrollVelocity(clientX, timelineRect.left, timelineRect.right, MAX_HORIZONTAL_SCROLL_STEP)
    scrollVelocityY = allowVerticalScroll
      ? edgeScrollVelocity(clientY, rect.top, rect.bottom, MAX_VERTICAL_SCROLL_STEP)
      : 0
    if (scrollVelocityX > 0) {
      horizontalScrollPadding = Math.max(
        horizontalScrollPadding,
        timelineScrollEl.scrollLeft + timelineRect.width + scrollVelocityX,
      )
    }
    startAutoScroll()
  }

  function startAutoScroll() {
    if (autoScrollRaf !== null) return
    const frame = () => {
      const bodyEl = elements.bodyEl
      const timelineScrollEl = elements.timelineScrollEl
      if ((scrollVelocityX !== 0 || scrollVelocityY !== 0) && bodyEl && timelineScrollEl) {
        const previousScrollLeft = timelineScrollEl.scrollLeft
        const previousScrollTop = bodyEl.scrollTop
        if (scrollVelocityX > 0) {
          const viewportWidth = timelineScrollEl.getBoundingClientRect().width
          horizontalScrollPadding = Math.max(
            horizontalScrollPadding,
            previousScrollLeft + viewportWidth + scrollVelocityX,
          )
        }
        timelineScrollEl.scrollLeft = Math.max(0, previousScrollLeft + scrollVelocityX)
        syncHorizontalScrollbar()
        bodyEl.scrollTop = Math.max(
          0,
          Math.min(maxAutoScrollTop, previousScrollTop + scrollVelocityY),
        )
        const deltaX = timelineScrollEl.scrollLeft - previousScrollLeft
        const deltaY = bodyEl.scrollTop - previousScrollTop
        if (deltaX !== 0 || deltaY !== 0) activeClipScrollHandler?.(deltaX, deltaY)
      }
      autoScrollRaf = requestAnimationFrame(frame)
    }
    autoScrollRaf = requestAnimationFrame(frame)
  }

  function stopAutoScroll() {
    scrollVelocityX = 0
    scrollVelocityY = 0
    horizontalScrollPadding = 0
    dragContentMinWidth = 0
    dragScrollActive = false
    activeClipScrollHandler = undefined
    maxAutoScrollTop = Infinity
    if (autoScrollRaf !== null) {
      cancelAnimationFrame(autoScrollRaf)
      autoScrollRaf = null
    }
  }

  $effect(() => {
    window.addEventListener('dragend', stopAutoScroll)
    window.addEventListener('drop', stopAutoScroll)
    window.addEventListener('dragend', stopTextDrop)
    window.addEventListener('drop', stopTextDrop)
    window.addEventListener('dragend', stopPaletteDropGuide)
    window.addEventListener('drop', stopPaletteDropGuide)
    return () => {
      window.removeEventListener('dragend', stopAutoScroll)
      window.removeEventListener('drop', stopAutoScroll)
      window.removeEventListener('dragend', stopTextDrop)
      window.removeEventListener('drop', stopTextDrop)
      window.removeEventListener('dragend', stopPaletteDropGuide)
      window.removeEventListener('drop', stopPaletteDropGuide)
      stopAutoScroll()
      stopTextDrop()
      stopPaletteDropGuide()
    }
  })

  function onNewTrackDragOver(event: DragEvent) {
    if (isTextDrag(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    if (newTrackDropState.kind === 'idle') newTrackDropState = { kind: 'dragging' }
    lastDropX = event.clientX
  }

  function onNewTrackDragLeave(event: DragEvent) {
    const related = event.relatedTarget as Node | null
    if (related && elements.newTrackEl && elements.newTrackEl.contains(related)) return
    newTrackDropState = { kind: 'idle' }
  }

  async function onNewTrackDrop(event: DragEvent): Promise<void> {
    if (isTextDrag(event.dataTransfer)) return
    event.preventDefault()
    newTrackDropState = { kind: 'idle' }
    const data = event.dataTransfer?.getData('application/x-cineedit-clip')
    if (!data) return
    let parsed: DropClipData
    try { parsed = JSON.parse(data) } catch { return }

    // Use lastDropX from dragover (accurate) instead of event.clientX from drop.
    const rect = elements.rulerEl?.getBoundingClientRect()
    const clientX = lastDropX > 0 ? lastDropX : event.clientX
    const rawX = rect ? clientX - rect.left : 0
    lastDropX = -1

    newTrackDropState = { kind: 'processing' }
    editor.beginHistory()
    try {
      const channelType = resolveDropMediaKind(parsed) === 'audio' ? 'audio' : 'video'
      editor.addChannel(channelType)
      const channel = editor.channels[editor.channels.length - 1]
      const startSec = computeDropStart(rawX, parsed.dragOffsetX)
      await addDroppedClip(channel, parsed, startSec, { freshAudioChannel: channelType === 'video' })
    } finally {
      editor.endHistory()
      newTrackDropState = { kind: 'idle' }
    }
  }

  return {
    editor,
    mediaProcessing,
    elements,
    get inspectorOpen() { return inspectorOpen },
    get onOpenClipInspector() { return onOpenClipInspector },
    get onOpenEffectInspector() { return onOpenEffectInspector },
    get onOpenTextInspector() { return onOpenTextInspector },
    get contextMenu() { return contextMenu },
    get marquee() { return marquee },
    get horizontalScrollLeft() { return horizontalScrollLeft },
    get showTrackHeaders() { return showTrackHeaders },
    get textDropActive() { return textDropActive },
    get textDropTime() { return textDropTime },
    get paletteDropGuide() { return paletteDropGuide },
    get draggingPlayhead() { return draggingPlayhead },
    get dragScrollActive() { return dragScrollActive },
    get textTrackHeight() { return textTrackHeight },
    get visibleTimeRange() { return visibleTimeRange },
    get visibleRulerMarks() { return visibleRulerMarks },
    get timelineCanvasWidth() { return timelineCanvasWidth },
    get newTrackActive() { return newTrackActive },
    get processingNewTrack() { return processingNewTrack },
    fmt,
    fmtShort,
    rowHeight,
    goToStart,
    stepBackward,
    togglePlay,
    stepForward,
    goToEnd,
    splitAtPlayhead,
    setZoom,
    toggleTrackHeaders,
    addVideoChannel,
    addAudioChannel,
    selectChannel,
    onChannelKey,
    openChannelContextMenu,
    toggleMute,
    toggleLock,
    removeChannel,
    onScrollDragOver,
    onTimelinePointerDown,
    onTimelineContextMenu,
    onRulerClick,
    onRulerKey,
    syncHorizontalScrollbar,
    onTextDragOver,
    onTextDragLeave,
    onTextDrop,
    updateAutoScroll,
    stopAutoScroll,
    onHorizontalScrollbarScroll,
    revealRoutedClip,
    openClipContextMenu,
    setPaletteDropGuide,
    stopPaletteDropGuide,
    onNewTrackDragOver,
    onNewTrackDragLeave,
    onNewTrackDrop,
    onPlayheadPointerDown,
    closeContextMenu,
  }
}
