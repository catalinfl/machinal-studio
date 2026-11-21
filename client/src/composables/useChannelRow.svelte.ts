import {
  CLIP_AREA_HEIGHT,
  clipEnd,
  clipTimelineDuration,
  editor,
  FX_LANE_HEIGHT,
  type Channel,
  type Clip as ClipType,
} from '../stores/editor.svelte'
import { mediaProcessing } from '../stores/media-processing.svelte'
import { acceptsDropOnChannel, addDroppedClip, computeDropStart, type DropClipData } from '../lib/drop'
import { CLIP_LOOK_DRAG_MIME, CLIP_LOOKS } from '../lib/clip-looks'
import { TEXT_DRAG_MIME } from '../lib/text-render'

export interface ChannelRowOptions {
  getChannel: () => Channel
  getVisibleRange: () => { start: number; end: number } | null
  getOnClipRouted: () => ((clipId: string) => void) | undefined
  getOnPaletteDragPreview: () => ((preview: {
    kind: 'effect' | 'transition'
    time: number
    leftClipName?: string
    rightClipName?: string
  }) => void) | undefined
  getOnPaletteDragEnd: () => (() => void) | undefined
}

export function useChannelRow(options: ChannelRowOptions) {
  let trackEl: HTMLDivElement | undefined
  let dropActive = $state(false)
  let dropTargetClipId = $state<string | null>(null)
  let lastDragX = -1
  let processing = $state(false)

  const lanes = $derived(
    options.getChannel().type === 'video' ? editor.getEffectLanes(options.getChannel().id) : [],
  )

  const trackHeight = $derived(CLIP_AREA_HEIGHT + lanes.length * FX_LANE_HEIGHT)
  const clipOverlaps = $derived(editor.getClipOverlaps(options.getChannel().id))

  const preservedClipIds = $derived(new Set([
    ...editor.selectedClipIds,
    ...editor.clipDragPreviewIds,
  ]))

  const visibleClips = $derived.by(() => {
    const channel = options.getChannel()
    const range = options.getVisibleRange()
    if (!range) return channel.clips
    return channel.clips.filter((clip) => (
      preservedClipIds.has(clip.id)
      || (clipEnd(clip) >= range.start && clip.start <= range.end)
    ))
  })

  const visibleClipIds = $derived(new Set(visibleClips.map((clip) => clip.id)))

  const visibleTransitions = $derived.by(() => {
    const range = options.getVisibleRange()
    const channelTransitions = editor.getTransitionsForChannel(options.getChannel().id)
    if (!range) return channelTransitions
    return channelTransitions.filter((transition) => (
      visibleClipIds.has(transition.leftClipId) || visibleClipIds.has(transition.rightClipId)
    ))
  })

  const preservedEffectIds = $derived(new Set([
    ...editor.selectedEffectBlockIds,
    ...editor.effectDragPreviewIds,
  ]))

  const visibleEffects = $derived.by(() => {
    const range = options.getVisibleRange()
    return lanes.flatMap((lane, laneIndex) => lane
      .filter((block) => !range
        || preservedEffectIds.has(block.id)
        || (block.start + block.duration >= range.start && block.start <= range.end))
      .map((block) => ({ block, laneIndex })))
  })

  function acceptsDrag(dataTransfer: DataTransfer | null): boolean {
    const channel = options.getChannel()
    const types = Array.from(dataTransfer?.types ?? [])
    if (types.includes(TEXT_DRAG_MIME)) return false
    const videoOnly = types.includes('application/x-cineedit-effect')
      || types.includes('application/x-cineedit-transition')
      || types.includes(CLIP_LOOK_DRAG_MIME)
    if (videoOnly) return channel.type === 'video'
    const mediaData = dataTransfer?.getData('application/x-cineedit-clip')
    if (!mediaData) return true
    try {
      return acceptsDropOnChannel(channel, JSON.parse(mediaData) as DropClipData)
    } catch {
      return true
    }
  }

  function findNearestJunction(time: number): { left: ClipType; right: ClipType } | null {
    let best: { left: ClipType; right: ClipType } | null = null
    let bestDist = Infinity
    const clips = options.getChannel().clips
    for (let i = 0; i < clips.length - 1; i++) {
      const left = clips[i]
      const right = clips[i + 1]
      const leftEnd = clipEnd(left)
      if (leftEnd < right.start - 0.05) continue
      const junction = (right.start + Math.max(leftEnd, right.start)) / 2
      const distance = Math.abs(time - junction)
      if (distance < bestDist) {
        best = { left, right }
        bestDist = distance
      }
    }
    return bestDist <= 1.5 ? best : null
  }

  function findNearestClip(time: number): ClipType | null {
    let nearest: ClipType | null = null
    let nearestDistance = Infinity
    for (const clip of options.getChannel().clips) {
      const end = clipEnd(clip)
      const distance = time < clip.start ? clip.start - time : time > end ? time - end : 0
      if (distance < nearestDistance) {
        nearest = clip
        nearestDistance = distance
      }
    }
    return nearest
  }

  function findEffectTarget(time: number, eventTarget: EventTarget | null): ClipType | null {
    const clips = options.getChannel().clips
    const target = eventTarget instanceof HTMLElement
      ? eventTarget.closest<HTMLElement>('[data-timeline-clip-id]')
      : null
    return clips.find((clip) => clip.id === target?.dataset.timelineClipId)
      ?? [...clips].reverse().find((clip) => time >= clip.start && time < clipEnd(clip))
      ?? null
  }

  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault()
    const channel = options.getChannel()
    const types = Array.from(event.dataTransfer?.types ?? [])
    const paletteDrop = types.includes('application/x-cineedit-effect')
      || types.includes(CLIP_LOOK_DRAG_MIME)
    const dropClientX = lastDragX > 0 ? lastDragX : event.clientX
    const dropTime = Math.max(0, (dropClientX - trackEl!.getBoundingClientRect().left) / editor.pixelsPerSecond)
    const nearestClip = paletteDrop ? findNearestClip(dropTime) : null
    dropActive = false
    dropTargetClipId = null
    options.getOnPaletteDragEnd()?.()
    const dataTransfer = event.dataTransfer

    const rect = trackEl!.getBoundingClientRect()
    const clientX = lastDragX > 0 ? lastDragX : event.clientX
    const rawX = clientX - rect.left
    lastDragX = -1

    const lookData = dataTransfer?.getData(CLIP_LOOK_DRAG_MIME)
    if (lookData) {
      if (channel.type !== 'video' || channel.locked) return
      let parsed: { lookId?: string }
      try { parsed = JSON.parse(lookData) } catch { return }
      if (!parsed || typeof parsed.lookId !== 'string') return
      const look = CLIP_LOOKS.find((candidate) => candidate.id === parsed.lookId)
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-timeline-clip-id]')
        : null
      const targetId = target?.dataset.timelineClipId ?? nearestClip?.id
      if (!look || !targetId) return

      const targetFound = editor.getClipById(targetId)
      if (!targetFound || targetFound.channel.type !== 'video') return
      const targetIds = editor.selectedClipIds.includes(targetId)
        ? editor.selectedClipIds
        : [targetId]
      const targetClips = targetIds.flatMap((id) => {
        const found = editor.getClipById(id)
        return found?.channel.type === 'video' ? [found] : []
      })
      if (targetClips.length === 0 || targetClips.some(({ channel: targetChannel }) => targetChannel.locked)) return

      editor.beginHistory()
      try {
        for (const { clip } of targetClips) editor.applyClipLook(clip.id, look.id)
      } finally {
        editor.endHistory()
      }
      return
    }

    const effectData = dataTransfer?.getData('application/x-cineedit-effect')
    if (effectData) {
      if (channel.type !== 'video' || channel.locked) return
      let parsed: { effectId: string; duration?: number }
      try { parsed = JSON.parse(effectData) } catch { return }
      if (!parsed || typeof parsed.effectId !== 'string' || !parsed.effectId) return
      const targetClip = findEffectTarget(dropTime, event.target)
      const duration = targetClip
        ? clipTimelineDuration(targetClip)
        : Number.isFinite(parsed.duration) ? Math.max(0.1, Math.min(30, parsed.duration!)) : 2
      editor.beginHistory()
      try {
        const block = editor.addEffectBlock(channel.id, parsed.effectId, targetClip?.start ?? dropTime, duration)
        if (block) {
          const added = editor.effectBlocks.find((candidate) => candidate.id === block.id)!
          added.ownerClipId = targetClip?.id
          if (targetClip) added.duration = duration
          editor.selectEffectBlock(block.id)
        }
      } finally {
        editor.endHistory()
      }
      return
    }

    const transitionData = dataTransfer?.getData('application/x-cineedit-transition')
    if (transitionData) {
      if (channel.type !== 'video' || channel.locked) return
      let parsed: { effectId: string }
      try { parsed = JSON.parse(transitionData) } catch { return }
      const pair = findNearestJunction(dropTime)
      if (pair) {
        // Preserve each overlap the user already sized instead of replacing it
        // with the store's default 1s.
        editor.beginHistory()
        try {
          const existingOverlap = Math.max(0, clipEnd(pair.left) - pair.right.start)
          const duration = existingOverlap > 0.001 ? existingOverlap : 1
          editor.addTransition(channel.id, pair.left.id, pair.right.id, parsed.effectId, duration)
        } finally {
          editor.endHistory()
        }
      }
      return
    }

    const data = dataTransfer?.getData('application/x-cineedit-clip')
    if (!data) return
    let parsed: DropClipData
    try { parsed = JSON.parse(data) } catch { return }
    if (!acceptsDropOnChannel(channel, parsed)) return

    const startSec = computeDropStart(rawX, parsed.dragOffsetX)
    processing = true
    editor.beginHistory()
    try {
      const added = await addDroppedClip(channel, parsed, startSec)
      if (added) {
        editor.selectClip(added.primary.id)
        const destination = editor.getClipById(added.primary.id)?.channel
        if (destination && destination.id !== channel.id) options.getOnClipRouted()?.(added.primary.id)
      }
    } finally {
      editor.endHistory()
      processing = false
    }
  }

  function onDragOver(event: DragEvent): void {
    const channel = options.getChannel()
    if (channel.locked || !acceptsDrag(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    if (!dropActive) dropActive = true
    lastDragX = event.clientX

    const types = Array.from(event.dataTransfer?.types ?? [])
    const time = Math.max(0, (event.clientX - trackEl!.getBoundingClientRect().left) / editor.pixelsPerSecond)
    if (!Number.isFinite(time)) return
    if (types.includes('application/x-cineedit-effect')) {
      options.getOnPaletteDragPreview()?.({ kind: 'effect', time })
      dropTargetClipId = findEffectTarget(time, event.target)?.id ?? null
    } else if (types.includes(CLIP_LOOK_DRAG_MIME)) {
      dropTargetClipId = findNearestClip(time)?.id ?? null
    } else if (types.includes('application/x-cineedit-transition')) {
      const pair = findNearestJunction(time)
      if (pair) {
        const leftEnd = clipEnd(pair.left)
        options.getOnPaletteDragPreview()?.({
          kind: 'transition',
          time: (pair.right.start + Math.max(leftEnd, pair.right.start)) / 2,
          leftClipName: pair.left.fileName,
          rightClipName: pair.right.fileName,
        })
      } else {
        options.getOnPaletteDragEnd()?.()
      }
    }
  }

  function onDragEnter(event: DragEvent): void {
    const channel = options.getChannel()
    if (channel.locked || !acceptsDrag(event.dataTransfer)) return
    event.preventDefault()
    if (!dropActive) dropActive = true
  }

  function onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null
    if (related && trackEl && trackEl.contains(related)) return
    dropActive = false
    dropTargetClipId = null
    options.getOnPaletteDragEnd()?.()
  }

  return {
    mediaProcessing,
    clipAreaHeight: CLIP_AREA_HEIGHT,
    get trackEl() { return trackEl },
    set trackEl(value: HTMLDivElement | undefined) { trackEl = value },
    get channel() { return options.getChannel() },
    get lanes() { return lanes },
    get trackHeight() { return trackHeight },
    get clipOverlaps() { return clipOverlaps },
    get visibleClips() { return visibleClips },
    get visibleTransitions() { return visibleTransitions },
    get visibleEffects() { return visibleEffects },
    get dropActive() { return dropActive },
    get dropTargetClipId() { return dropTargetClipId },
    get processing() { return processing },
    onDrop,
    onDragOver,
    onDragEnter,
    onDragLeave,
  }
}
