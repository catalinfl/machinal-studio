import { defaultEffectParams, getEffect, normalizeEffectParams, normalizeRamp, type EffectParams, type EffectRamp } from '../lib/effects'
import { resolveClipLook, type ClipLookId } from '../lib/clip-looks'
import { clipTransform, clipTransformAt, layerMotionKeyframes, normalizeClipTransform, normalizeClipTransformKeyframe, type ClipTransform, type ClipTransformKeyframe, type LayerEntranceEffect, type LayerExitEffect, type TransformPreset } from '../lib/clip-transform'
import { clipFadeIn, clipFadeOut, clipOpacity } from '../lib/clip-compositing'
import { textDesignSize, textSafeInsets } from '../lib/text-geometry'
import { cloneJSON, recordDocumentEdit } from '../lib/composition-adapter'
import { compactSessionText } from '../lib/project-text-assets'
import type { DocumentSession, TimelineState } from '../lib/composition-types'
import type { Clip, Channel, EffectBlock, TextItem, TimedTextWord, Transition, Resolution, ProjectAspect } from '../lib/editor-types'
import { useEditorHistory } from '../composables/useEditorHistory.svelte'
import { activeTimedItems, indexTimedItems } from '../lib/timed-index'
import type { VideoFit } from '../lib/video-fit'
import { clipPlaybackRate, clipTimelineDuration, clipEnd, clipSourceTimeAt } from '../lib/clip-time'
import { MIN_CLIP_LEN, maxClipTransitionOverlap, edgeBounds, packEffectLanes, packTextLanes, clipOverlapInChannel, clipOverlapsInChannel, clampClipStart } from '../lib/timeline-geometry'

export type { MediaKind, Clip, Channel, EffectBlock, TextFontFamily, TextAlign, TextHighlightMode, TextHighlightAnimation, TextBannerStyle, TextAnimation, TimedTextWord, TextItem, Transition, Resolution, ProjectAspect } from '../lib/editor-types'
export { MIN_CLIP_LEN, maxTransitionOverlap, packEffectLanes, packTextLanes } from '../lib/timeline-geometry'
export { clipPlaybackRate, clipTimelineDuration, clipEnd, clipSourceTimeAt } from '../lib/clip-time'
export { textDesignSize, textSafeInsets } from '../lib/text-geometry'

function retimeTextWords(text: string, current: TimedTextWord[]): TimedTextWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  if (tokens.length === current.length && current.every(word => word.text.trim().split(/\s+/).length === 1)) {
    return current.map((word, index) => ({ ...word, text: tokens[index] }))
  }
  return []
}

function scaleTextWords(words: TimedTextWord[], previousDuration: number, duration: number): TimedTextWord[] {
  if (previousDuration <= 0) return words
  const scale = duration / previousDuration
  return words.map((word) => ({ ...word, start: word.start * scale, end: word.end * scale }))
}

export const RES_PRESETS: Record<Resolution, { w: number; h: number }> = {
  '480p': { w: 854, h: 480 },
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '2k': { w: 2560, h: 1440 },
  '4k': { w: 3840, h: 2160 },
}

export const CLASSIC_RES_PRESETS: Record<Resolution, { w: number; h: number }> = {
  '480p': { w: 640, h: 480 },
  '720p': { w: 960, h: 720 },
  '1080p': { w: 1440, h: 1080 },
  '2k': { w: 1920, h: 1440 },
  '4k': { w: 3840, h: 2880 },
}

export const PROJECT_ASPECT_ORDER: ProjectAspect[] = ['landscape', 'portrait', 'classic']

export function aspectLabel(aspect: ProjectAspect): string {
  return aspect === 'portrait' ? '9:16' : aspect === 'classic' ? '4:3' : '16:9'
}

export function projectResolution(resolution: Resolution, aspect: ProjectAspect): { w: number; h: number } {
  const preset = RES_PRESETS[resolution]
  if (aspect === 'portrait') return { w: preset.h, h: preset.w }
  if (aspect === 'classic') return CLASSIC_RES_PRESETS[resolution]
  return preset
}

function remapTextPositions(items: TextItem[], from: ProjectAspect, to: ProjectAspect): void {
  if (from === to) return
  const source = textDesignSize(from)
  const target = textDesignSize(to)
  const safe = textSafeInsets(to)
  for (const item of items) {
    item.x = Math.max(safe.left, Math.min(target.w - safe.right, item.x * target.w / source.w))
    item.y = Math.max(safe.top, Math.min(target.h - safe.bottom, item.y * target.h / source.h))
  }
}

export const CLIP_AREA_HEIGHT = 64
export const FX_LANE_HEIGHT = 22
export const TEXT_LANE_HEIGHT = 28
export const TEXT_TRACK_MIN_HEIGHT = 42

interface CopiedClip {
  sourceId: string
  channelId: string
  clip: Omit<Clip, 'id'>
}

interface CopiedTransition {
  channelId: string
  leftSourceId: string
  rightSourceId: string
  effectId: string
}

interface CopiedEffectBlock {
  channelId: string
  block: Omit<EffectBlock, 'id' | 'nodeId'>
}

interface CopiedTextItem {
  item: Omit<TextItem, 'id'>
}

let channels = $state<Channel[]>([
  { id: 'v1', type: 'video', name: 'Video 1', clips: [], muted: false, hidden: false, locked: false },
  { id: 'a1', type: 'audio', name: 'Audio 1', clips: [], muted: false, hidden: false, locked: false },
])

let effectBlocks = $state<EffectBlock[]>([])
let transitions = $state<Transition[]>([])
let textItems = $state<TextItem[]>([])

let currentTime = $state(0)
let fps = $state(30)
let playing = $state(false)
let pixelsPerSecond = $state(40)
let selectedClipIds = $state<string[]>([])
let selectedClipId = $derived(selectedClipIds[selectedClipIds.length - 1] ?? null)
let selectedChannelIds = $state<string[]>([])
let selectedEffectBlockIds = $state<string[]>([])
let selectedEffectBlockId = $derived(selectedEffectBlockIds[selectedEffectBlockIds.length - 1] ?? null)
let selectedTextItemIds = $state<string[]>([])
let selectedTextItemId = $derived(selectedTextItemIds[selectedTextItemIds.length - 1] ?? null)
let clipDragPreviewIds = $state<string[]>([])
let clipDragPreviewOffsetY = $state(0)
let clipDragPreviewDetached = $state(false)
let effectDragPreviewIds = $state<string[]>([])
let effectDragPreviewOffsetY = $state(0)
let textDragPreviewIds = $state<string[]>([])
let textDragPreviewOffsetY = $state(0)
let resolution = $state<Resolution>('1080p')
let projectAspect = $state<ProjectAspect | null>(null)
let videoFit = $state<VideoFit>('contain')
let copiedClips: CopiedClip[] = []
let copiedTransitions: CopiedTransition[] = []
let copiedEffectBlocks: CopiedEffectBlock[] = []
let copiedTextItems: CopiedTextItem[] = []
let documentSession = $state<DocumentSession | null>(null)
let applyingComposition = false
const documentListeners = new Set<() => void>()

interface EditorSnapshot {
  channels: Channel[]
  effectBlocks: EffectBlock[]
  transitions: Transition[]
  textItems: TextItem[]
  selectedClipIds: string[]
  selectedEffectBlockIds: string[]
  selectedTextItemIds: string[]
  fps: number
  resolution: Resolution
  currentTime: number
  projectAspect: ProjectAspect | null
  videoFit?: VideoFit
  documentSession: DocumentSession | null
}

const textTimeIndex = $derived(indexTimedItems(textItems))
let stateRevision = 0

const history = useEditorHistory<EditorSnapshot>({
  capture: captureSnapshot,
  restore: restoreSnapshot,
  beforeCommit() {
    if (documentSession && !applyingComposition) {
      documentSession = recordDocumentEdit(documentSession, {
        channels, effectBlocks, transitions, textItems, fps, resolution, aspect: projectAspect ?? 'landscape', fit: videoFit,
      })
    }
  },
  changed() {
    for (const listener of documentListeners) listener()
  },
  getRevision: () => stateRevision,
  setRevision: (revision) => { stateRevision = revision },
})

const recordHistory = history.record

function captureSnapshot(): EditorSnapshot {
  return {
    channels: channels.map((channel) => ({
      ...channel,
      clips: channel.clips.map((clip) => ({
        ...clip,
        transform: clip.transform ? { ...clip.transform } : undefined,
        transformKeyframes: clip.transformKeyframes?.map((keyframe) => ({
          ...keyframe,
          transform: { ...keyframe.transform },
        })),
      })),
    })),
    effectBlocks: effectBlocks.map((block) => ({
      ...block,
      params: { ...block.params },
      ramp: block.ramp ? { ...block.ramp } : null,
    })),
    transitions: transitions.map((transition) => ({ ...transition })),
    textItems: textItems.map((item) => ({ ...item, words: item.words.map((word) => ({ ...word })) })),
    selectedClipIds: [...selectedClipIds],
    selectedEffectBlockIds: [...selectedEffectBlockIds],
    selectedTextItemIds: [...selectedTextItemIds],
    fps,
    resolution,
    currentTime,
    projectAspect,
    videoFit,
    documentSession: documentSession ? cloneJSON(documentSession) : null,
  }
}

function restoreSnapshot(snapshot: EditorSnapshot) {
  channels = snapshot.channels.map((channel) => ({
    ...channel,
    clips: channel.clips.map((clip) => ({
      ...clip,
      transform: clip.transform ? { ...clip.transform } : undefined,
      transformKeyframes: clip.transformKeyframes?.map((keyframe) => ({
        ...keyframe,
        transform: { ...keyframe.transform },
      })),
    })),
  }))

  effectBlocks = snapshot.effectBlocks.map((block) => ({
    ...block,
    params: { ...block.params },
    ramp: block.ramp ? { ...block.ramp } : null,
    nodeId: null,
  }))
  transitions = snapshot.transitions.map((transition) => ({ ...transition }))
  textItems = snapshot.textItems.map((item) => ({
    ...item,
    isCaption: item.isCaption ?? false,
    highlightMode: item.highlightMode ?? 'none',
    highlightColor: item.highlightColor ?? '#fff36d',
    highlightBackgroundColor: (item as Partial<TextItem>).highlightBackgroundColor ?? '#000000',
    highlightBackgroundOpacity: (item as Partial<TextItem>).highlightBackgroundOpacity ?? 0,
    highlightAnimation: (item as Partial<TextItem>).highlightAnimation ?? 'pop',
    words: item.words?.map((word) => ({ ...word })) ?? [],
  }))
  selectedClipIds = [...snapshot.selectedClipIds]
  selectedEffectBlockIds = [...snapshot.selectedEffectBlockIds]
  selectedTextItemIds = [...snapshot.selectedTextItemIds]
  fps = snapshot.fps
  resolution = snapshot.resolution
  currentTime = snapshot.currentTime
  projectAspect = snapshot.projectAspect
  videoFit = snapshot.videoFit ?? 'contain'
  documentSession = snapshot.documentSession ? cloneJSON(snapshot.documentSession) : null
}

let totalDuration = $derived(
  Math.max(
    0,
    ...channels.flatMap((ch) => ch.clips.map(clipEnd)),
    ...effectBlocks.map((b) => b.start + b.duration),
    ...textItems.map((item) => item.start + item.duration),
  )
)

let uid = 0
function nextId(prefix: string): string {
  uid += 1
  return `${prefix}_${uid}_${Math.random().toString(36).slice(2, 7)}`
}

function createChannel(type: 'video' | 'audio', index = channels.length): Channel {
  const count = channels.filter((channel) => channel.type === type).length + 1
  const channel: Channel = {
    id: nextId(type),
    type,
    name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`,
    clips: [],
    muted: false,
    hidden: false,
    locked: false,
  }
  channels.splice(Math.max(0, Math.min(index, channels.length)), 0, channel)
  return channel
}

function findClipById(clipId: string): { channel: Channel; clip: Clip } | null {
  for (const channel of channels) {
    const clip = channel.clips.find((candidate) => candidate.id === clipId)
    if (clip) return { channel, clip }
  }
  return null
}

function rebuildLayerMotion(clip: Clip): void {
  clip.transformKeyframes = layerMotionKeyframes({
    entrance: clip.layerEntrance ?? 'none',
    exit: clip.layerExit ?? 'none',
    base: clipTransform(clip),
    duration: clipTimelineDuration(clip),
    entranceDuration: clipFadeIn(clip) || 0.5,
    exitDuration: clipFadeOut(clip) || 0.5,
  })
  if (clip.transformKeyframes.length === 0) clip.transformKeyframes = undefined
}

function sortChannelClipsIfNeeded(channel: Channel) {
  for (let index = 1; index < channel.clips.length; index++) {
    if (channel.clips[index - 1].start <= channel.clips[index].start) continue
    channel.clips.sort((a, b) => a.start - b.start)
    return
  }
}

function prepareClipLook(
  found: { channel: Channel; clip: Clip },
  lookId: ClipLookId,
): { recipe: ReturnType<typeof resolveClipLook>; blocks: EffectBlock[] } | null {
  const clipDuration = clipTimelineDuration(found.clip)
  const recipe = resolveClipLook(lookId, clipDuration, fps)
  const blocks: EffectBlock[] = []

  // Each side of a transition keeps its own complete look. The transition is
  // applied afterward, between the two independently styled clip frames.
  for (const item of recipe.effects) {
    const definition = getEffect(item.effectId)
    if (!definition || definition.kind !== 'effect') return null
    const offset = Math.max(0, Math.min(clipDuration, item.offset))
    const duration = Math.max(0, Math.min(item.duration, clipDuration - offset))
    if (duration <= 0.001) continue
    blocks.push({
      id: nextId('fx'),
      channelId: found.channel.id,
      effectId: item.effectId,
      params: normalizeEffectParams(item.effectId, item.params),
      ramp: normalizeRamp(item.ramp),
      start: found.clip.start + offset,
      duration,
      nodeId: null,
      ownerClipId: found.clip.id,
      clipLookId: lookId,
    })
  }

  return { recipe, blocks }
}

function replaceClipLookEffects(clipId: string, blocks: EffectBlock[]) {
  const replacedIds = new Set(
    effectBlocks
      .filter((block) => block.ownerClipId === clipId && block.clipLookId !== undefined)
      .map((block) => block.id),
  )
  effectBlocks = effectBlocks.filter((block) => !replacedIds.has(block.id))
  effectBlocks.push(...blocks)
  selectedEffectBlockIds = selectedEffectBlockIds.filter((id) => !replacedIds.has(id))
}

function lastClipEnd(): number {
  let end = 0
  for (const channel of channels) {
    for (const clip of channel.clips) {
      end = Math.max(end, clipEnd(clip))
    }
  }
  return end
}

function clampPlayheadAfterLeftEdit(shouldClamp: boolean) {
  if (!shouldClamp) return
  const end = lastClipEnd()
  if (currentTime > end) currentTime = end
}

function removeLocatedClip(found: { channel: Channel; clip: Clip }) {
  recordHistory()
  const removed = [{ channel: found.channel, clip: found.clip }]
  const removedIds = new Set([found.clip.id])

  if (found.clip.linkedClipId) {
    const linked = findClipById(found.clip.linkedClipId)
    if (linked) {
      removed.push(linked)
      removedIds.add(linked.clip.id)
    }
  }

  const removedEffectIds = new Set(
    effectBlocks.filter((block) => block.ownerClipId && removedIds.has(block.ownerClipId)).map((block) => block.id),
  )
  effectBlocks = effectBlocks.filter((block) => !removedEffectIds.has(block.id))
  selectedEffectBlockIds = selectedEffectBlockIds.filter((id) => !removedEffectIds.has(id))

  const rippleByChannel = new Map<Channel, { followingIds: Set<string>; shift: number }>()
  for (const { channel, clip } of removed) {
    const index = channel.clips.indexOf(clip)
    const next = channel.clips[index + 1]
    if (!next) continue

    rippleByChannel.set(channel, {
      followingIds: new Set(channel.clips.slice(index + 1).map((candidate) => candidate.id)),
      shift: Math.min(clipTimelineDuration(clip), Math.max(0, next.start - clip.start)),
    })
  }

  if (rippleByChannel.size > 0) {
    const minRemovedStart = Math.min(...removed.map(({ clip }) => clip.start))
    let propagated = true
    while (propagated) {
      propagated = false
      const shiftByRipplingId = new Map<string, number>()
      const rippleByRipplingId = new Map<string, { followingIds: Set<string>; shift: number }>()
      for (const ripple of rippleByChannel.values()) {
        for (const id of ripple.followingIds) {
          if (!shiftByRipplingId.has(id)) {
            shiftByRipplingId.set(id, ripple.shift)
            rippleByRipplingId.set(id, ripple)
          }
        }
      }
      for (const [id, sourceShift] of shiftByRipplingId) {
        if (sourceShift <= 1e-9) continue
        const linkedId = findClipById(id)?.clip.linkedClipId
        if (!linkedId || removedIds.has(linkedId) || shiftByRipplingId.has(linkedId)) continue
        const linked = findClipById(linkedId)
        if (!linked || linked.channel.locked) continue
        if (linked.clip.start < minRemovedStart - 1e-9) continue
        const linkedIndex = linked.channel.clips.indexOf(linked.clip)
        if (linkedIndex < 0) continue
        const newStart = linked.clip.start - sourceShift
        if (newStart < -1e-9) continue
        let overlapsPrefix = false
        for (let i = 0; i < linkedIndex; i++) {
          const prefix = linked.channel.clips[i]
          if (removedIds.has(prefix.id) || shiftByRipplingId.has(prefix.id)) continue
          if (clipEnd(prefix) > newStart + 1e-9) { overlapsPrefix = true; break }
        }
        if (overlapsPrefix) continue
        const suffixIds = linked.channel.clips
          .slice(linkedIndex)
          .map((candidate) => candidate.id)
          .filter((candidateId) => !removedIds.has(candidateId) && !shiftByRipplingId.has(candidateId))
        if (suffixIds.length === 0) continue
        const existing = rippleByChannel.get(linked.channel)
        if (existing) {
          for (const candidateId of suffixIds) existing.followingIds.add(candidateId)
          const sourceRipple = rippleByRipplingId.get(id)
          const mergedShift = Math.max(existing.shift, sourceShift)
          if (mergedShift > existing.shift + 1e-9) {
            existing.shift = mergedShift
            propagated = true
          }
          if (sourceRipple && mergedShift > sourceRipple.shift + 1e-9) {
            sourceRipple.shift = mergedShift
            propagated = true
          }
          if (suffixIds.length > 0) propagated = true
        } else {
          rippleByChannel.set(linked.channel, {
            followingIds: new Set(suffixIds),
            shift: sourceShift,
          })
          propagated = true
        }
      }
    }
  }

  for (const entry of removed) {
    entry.channel.clips.splice(entry.channel.clips.indexOf(entry.clip), 1)
  }

  for (const [channel, ripple] of rippleByChannel) {
    for (const clip of channel.clips) {
      if (!ripple.followingIds.has(clip.id)) continue
      const nextStart = Math.max(0, clip.start - ripple.shift)
      const delta = nextStart - clip.start
      clip.start = nextStart
      moveOwnedClipBlocks(new Set([clip.id]), delta)
      moveOwnedClipText(new Set([clip.id]), delta)
    }
    channel.clips.sort((a, b) => a.start - b.start)
  }

  clampPlayheadAfterLeftEdit(true)

  selectedClipIds = selectedClipIds.filter((id) => !removedIds.has(id))
  reconcileTransitions()
}

function expandLinkedClipIds(clipIds: string[]): string[] {
  const expanded = new Set(clipIds)
  const pending = [...clipIds]
  while (pending.length > 0) {
    const found = findClipById(pending.pop()!)
    const linkedId = found?.clip.linkedClipId
    if (linkedId && !expanded.has(linkedId) && findClipById(linkedId)) {
      expanded.add(linkedId)
      pending.push(linkedId)
    }
  }
  return [...expanded]
}

function markClipBlocksDirty(clipId: string) {
  for (const ch of channels) {
    const clip = ch.clips.find((c) => c.id === clipId)
    if (!clip) continue
    for (const b of effectBlocks) {
      if (b.channelId !== ch.id) continue
      if (b.ownerClipId && b.ownerClipId !== clipId) continue
      // Overlap (not just anchored at start): effects stretched across a cut
      // must also re-render when any covered segment changes.
      if (b.start < clipEnd(clip) && b.start + b.duration > clip.start) {
        b.nodeId = null
      }
    }
    return
  }
}

function moveOwnedClipBlocks(clipIds: Set<string>, delta: number) {
  if (Math.abs(delta) <= 1e-9) return
  for (const block of effectBlocks) {
    if (!block.ownerClipId || !clipIds.has(block.ownerClipId)) continue
    block.start = Math.max(0, block.start + delta)
    block.nodeId = null
  }
}

function refreshEffectOwnership(block: EffectBlock): void {
  if (block.clipLookId) return
  const ch = channels.find((candidate) => candidate.id === block.channelId)
  if (!ch) return
  const overlapping = ch.clips.filter(
    (clip) => block.start < clipEnd(clip) && block.start + block.duration > clip.start,
  )
  if (overlapping.length >= 2) {
    if (block.ownerClipId) {
      block.ownerClipId = undefined
      block.nodeId = null
    }
    return
  }
  const center = block.start + block.duration / 2
  const owner = [...ch.clips].reverse().find((clip) => center >= clip.start && center < clipEnd(clip))
  if (!owner) {
    if (block.ownerClipId) {
      block.ownerClipId = undefined
      block.nodeId = null
    }
    return
  }
  if (block.ownerClipId !== owner.id) {
    block.ownerClipId = owner.id
    block.nodeId = null
  }
}

function trimOwnedClipBlocks(clipId: string, oldStart: number, oldEnd: number, newStart: number, newEnd: number) {
  const EPS = 1e-6
  const shift = newStart - oldStart
  const removedIds = new Set<string>()
  for (const block of effectBlocks) {
    if (block.ownerClipId !== clipId) continue
    const oldBs = block.start
    const oldBe = block.start + block.duration
    const anchoredLeft = Math.abs(oldBs - oldStart) <= EPS
    const anchoredRight = Math.abs(oldBe - oldEnd) <= EPS
    let newBs = oldBs + shift
    let newBe = oldBe + shift
    if (anchoredLeft) newBs = newStart
    if (anchoredRight) newBe = newEnd
    newBs = Math.max(newBs, newStart)
    newBe = Math.min(newBe, newEnd)
    if (newBe - newBs <= EPS) {
      removedIds.add(block.id)
      continue
    }
    block.start = newBs
    block.duration = newBe - newBs
    block.nodeId = null
  }
  if (removedIds.size > 0) {
    effectBlocks = effectBlocks.filter((block) => !removedIds.has(block.id))
    selectedEffectBlockIds = selectedEffectBlockIds.filter((id) => !removedIds.has(id))
  }
}

function splitOwnedClipBlocks(sourceClipId: string, rightClipId: string, time: number) {
  const EPS = 1e-9
  const owned = effectBlocks.filter((block) => block.ownerClipId === sourceClipId)
  for (const block of owned) {
    const blockEnd = block.start + block.duration
    if (block.start >= time - EPS) {
      block.ownerClipId = rightClipId
      block.nodeId = null
      continue
    }
    if (blockEnd <= time + EPS) continue
    const leftDuration = time - block.start
    const rightDuration = blockEnd - time
    block.duration = leftDuration
    block.nodeId = null
    const right: EffectBlock = {
      ...block,
      id: nextId('fx'),
      ownerClipId: rightClipId,
      params: { ...block.params },
      ramp: block.ramp ? { ...block.ramp } : null,
      start: time,
      duration: rightDuration,
      nodeId: null,
    }
    effectBlocks.push(right)
    if (selectedEffectBlockIds.includes(block.id)) selectedEffectBlockIds.push(right.id)
  }
}

function moveOwnedClipText(clipIds: Set<string>, delta: number) {
  if (Math.abs(delta) <= 1e-9) return
  for (const item of textItems) {
    if (item.sourceClipId && clipIds.has(item.sourceClipId)) item.start += delta
  }
}

function splitOwnedClipText(sourceClipId: string, rightClipId: string, time: number) {
  const anchoredItems = textItems.filter((item) => item.sourceClipId === sourceClipId)
  for (const item of anchoredItems) {
    const itemEnd = item.start + item.duration
    if (item.start >= time - 1e-9) {
      item.sourceClipId = rightClipId
      continue
    }
    if (itemEnd <= time + 1e-9) continue

    const leftDuration = time - item.start
    const rightDuration = itemEnd - time
    const wordsInRange = (from: number, to: number) => item.words.flatMap((word) => {
      const start = Math.max(from, word.start)
      const end = Math.min(to, word.end)
      return end > start ? [{ ...word, start: start - from, end: end - from }] : []
    })
    const leftWords = wordsInRange(0, leftDuration)
    const rightWords = wordsInRange(leftDuration, item.duration)
    const right: TextItem = {
      ...item,
      id: nextId('text'),
      sourceClipId: rightClipId,
      start: time,
      duration: rightDuration,
      text: item.isCaption && rightWords.length > 0
        ? rightWords.map((word) => word.text).join(' ')
        : item.text,
      words: rightWords,
    }

    item.duration = leftDuration
    item.text = item.isCaption && leftWords.length > 0
      ? leftWords.map((word) => word.text).join(' ')
      : item.text
    item.words = leftWords
    textItems.push(right)
    if (selectedTextItemIds.includes(item.id)) selectedTextItemIds.push(right.id)
  }
}

function sliceClipTransformKeyframes(clip: Clip, from: number, to: number): ClipTransformKeyframe[] | undefined {
  if (!clip.transformKeyframes?.length) return undefined
  const duration = Math.max(0, to - from)
  const keyframes: ClipTransformKeyframe[] = [{ time: 0, transform: clipTransformAt(clip, from) }]
  for (const keyframe of clip.transformKeyframes) {
    if (keyframe.time <= from + 1e-9 || keyframe.time >= to - 1e-9) continue
    keyframes.push({ time: keyframe.time - from, transform: { ...keyframe.transform } })
  }
  if (duration > 1e-9) keyframes.push({ time: duration, transform: clipTransformAt(clip, to) })
  return keyframes
}

function reconcileTransitions() {
  for (let i = transitions.length - 1; i >= 0; i--) {
    const t = transitions[i]
    const ch = channels.find((c) => c.id === t.channelId)
    const left = ch?.clips.find((c) => c.id === t.leftClipId)
    const right = ch?.clips.find((c) => c.id === t.rightClipId)
    if (!ch || !left || !right) {
      transitions.splice(i, 1)
      continue
    }
    const leftEnd = clipEnd(left)
    if (left.start >= right.start || leftEnd <= right.start + 0.001) transitions.splice(i, 1)
  }
}

function moveClipGroup(
  clipIds: string[],
  deltaSec: number,
  resolveCollisions = false,
  minimumDelta = -Infinity,
  ignoreCollisions = false,
): number {
  if (!resolveCollisions && Math.abs(deltaSec) <= 1e-9) return 0
  const movingIds = new Set(expandLinkedClipIds(clipIds))
  const moving = [...movingIds]
    .map((id) => findClipById(id))
    .filter((found): found is { channel: Channel; clip: Clip } => found !== null)
  if (moving.length === 0 || moving.some(({ channel }) => channel.locked)) return 0

  const minDelta = Math.max(minimumDelta, ...moving.map(({ clip }) => -clip.start))
  let appliedDelta = Math.max(deltaSec, minDelta)
  if (!ignoreCollisions) {
    const forbidden: { start: number; end: number }[] = []
    for (const { channel, clip } of moving) {
      const clipLength = clipTimelineDuration(clip)
      const end = clipEnd(clip)
      for (const other of channel.clips) {
        if (movingIds.has(other.id)) continue
        const otherLength = clipTimelineDuration(other)
        const overlap = maxClipTransitionOverlap(clip, other, clipLength, otherLength)
        forbidden.push({
          start: other.start + overlap - end,
          end: other.start + otherLength - overlap - clip.start,
        })
      }
    }

    forbidden.sort((a, b) => a.start - b.start)
    const merged: { start: number; end: number }[] = []
    for (const interval of forbidden) {
      const last = merged[merged.length - 1]
      if (last && interval.start <= last.end + 1e-9) last.end = Math.max(last.end, interval.end)
      else merged.push({ ...interval })
    }
    for (const interval of merged) {
      if (appliedDelta <= interval.start + 1e-9 || appliedDelta >= interval.end - 1e-9) continue
      const midpoint = (interval.start + interval.end) / 2
      const lowerSide = appliedDelta < midpoint
        || (Math.abs(appliedDelta - midpoint) <= 1e-9 && Math.abs(interval.start) <= Math.abs(interval.end))
      appliedDelta = lowerSide && interval.start >= minDelta ? interval.start : interval.end
      break
    }
  }

  if (Math.abs(appliedDelta) <= 1e-9) return 0
  recordHistory()
  const affectedChannels = new Set<Channel>()
  for (const { channel, clip } of moving) {
    clip.start += appliedDelta
    affectedChannels.add(channel)
  }
  moveOwnedClipBlocks(movingIds, appliedDelta)
  moveOwnedClipText(movingIds, appliedDelta)
  for (const channel of affectedChannels) sortChannelClipsIfNeeded(channel)
  reconcileTransitions()
  clampPlayheadAfterLeftEdit(appliedDelta < -1e-9)
  return appliedDelta
}

export const editor = {
  relinkMediaSource(sourceId: string, preview: string) {
    for (const channel of channels) {
      for (const clip of channel.clips) {
        if (clip.sourceId === sourceId) clip.scrubBlobUrl = preview
      }
    }
    stateRevision += 1
    for (const listener of documentListeners) listener()
  },

  captureProjectState(includeTextAssets = false) {
    return cloneJSON({ channels, effectBlocks, transitions, textItems, fps, resolution, projectAspect, videoFit, documentSession: includeTextAssets ? documentSession : compactSessionText(documentSession),
      currentTime: 0, selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [] })
  },

  restoreProjectState(snapshot: ReturnType<typeof captureSnapshot>) {
    this.clearHistory()
    restoreSnapshot(snapshot)
    selectedChannelIds = []
    copiedClips = []
    copiedTransitions = []
    copiedEffectBlocks = []
    copiedTextItems = []
    playing = false
    stateRevision += 1
    for (const listener of documentListeners) listener()
  },

  get channels() { return channels },
  get currentTime() { return currentTime },
  get fps() { return fps },
  get playing() { return playing },
  get pixelsPerSecond() { return pixelsPerSecond },
  get selectedClipId() { return selectedClipId },
  get selectedClipIds() { return selectedClipIds },
  get selectedChannelIds() { return selectedChannelIds },
  get selectedEffectBlockId() { return selectedEffectBlockId },
  get selectedEffectBlockIds() { return selectedEffectBlockIds },
  get selectedTextItemId() { return selectedTextItemId },
  get selectedTextItemIds() { return selectedTextItemIds },
  get clipDragPreviewIds() { return clipDragPreviewIds },
  get clipDragPreviewOffsetY() { return clipDragPreviewOffsetY },
  get effectDragPreviewIds() { return effectDragPreviewIds },
  get effectDragPreviewOffsetY() { return effectDragPreviewOffsetY },
  get textDragPreviewIds() { return textDragPreviewIds },
  get textDragPreviewOffsetY() { return textDragPreviewOffsetY },
  get totalDuration() { return totalDuration },
  get resolution() { return resolution },
  get projectAspect() { return projectAspect },
  get videoFit() { return videoFit },
  get effectiveProjectAspect(): ProjectAspect { return projectAspect ?? 'landscape' },
  get projectResolution() { return projectResolution(resolution, projectAspect ?? 'landscape') },
  get canUndo() { return history.canUndo },
  get canRedo() { return history.canRedo },
  get stateRevision() { return stateRevision },
  get documentSession() { return documentSession },

  subscribeDocumentChanges(listener: () => void): () => void {
    documentListeners.add(listener)
    return () => { documentListeners.delete(listener) }
  },

  setDocumentError(message: string) {
    if (documentSession) documentSession = { ...documentSession, kind: 'error', message }
  },

  forgetDocumentAsset(fileName: string) {
    const name = fileName.toLowerCase()
    if (documentSession) {
      const removedIds = new Set(documentSession.assets.filter((asset) => asset.file.toLowerCase() === name).map((asset) => asset.id))
      documentSession = {
        kind: 'dirty',
        document: documentSession.document,
        recipe: documentSession.recipe,
        preparedText: documentSession.preparedText,
        assets: documentSession.assets.filter((asset) => asset.file.toLowerCase() !== name),
        bindings: Object.fromEntries(Object.entries(documentSession.bindings).map(([slot, ids]) => [slot, ids.filter((id) => !removedIds.has(id))])),
        composition: { ...documentSession.composition, assets: documentSession.composition.assets.filter((asset) => asset.file.toLowerCase() !== name) },
      }
    }
    stateRevision += 1
    for (const listener of documentListeners) listener()
  },

  applyCompiledTimeline(timeline: TimelineState, session: DocumentSession, expectedRevision: number, history = true, verify?: () => void) {
    if (stateRevision !== expectedRevision) throw new Error('Timeline changed while the document was compiling. Recompile it.')
    const apply = () => {
      if (history) recordHistory()
      channels = cloneJSON(timeline.channels)
      effectBlocks = cloneJSON(timeline.effectBlocks)
      transitions = cloneJSON(timeline.transitions)
      textItems = cloneJSON(timeline.textItems)
      fps = timeline.fps
      resolution = timeline.resolution
      projectAspect = timeline.aspect
      videoFit = timeline.fit ?? 'contain'
      documentSession = cloneJSON(session)
      if (history) this.clearSelection()
      else {
        const channelIds = selectedChannelIds.filter((id) => channels.some((channel) => channel.id === id))
        this.selectItems(selectedClipIds, selectedEffectBlockIds, selectedTextItemIds)
        selectedChannelIds = channelIds
      }
      playing = false
      verify?.()
    }
    applyingComposition = true
    try {
      this.withHistoryTransaction(apply)
    } finally {
      applyingComposition = false
    }
  },

  beginHistory: history.begin,
  endHistory: history.end,
  cancelHistory: history.cancel,
  withHistoryTransaction: history.transaction,
  clearHistory: history.clear,
  undo: history.undo,
  redo: history.redo,

  setFps(v: number) { recordHistory(); fps = v },
  setPixelsPerSecond(v: number) { pixelsPerSecond = v },
  setResolution(v: Resolution) { recordHistory(); resolution = v },

  setVideoFit(fit: VideoFit) {
    if (videoFit === fit) return
    recordHistory()
    videoFit = fit
  },

  initializeProjectAspect(width: number, height: number): ProjectAspect {
    if (projectAspect) return projectAspect
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'landscape'
    const ratio = width / height
    const nextAspect = ratio < 1 ? 'portrait' : ratio < 1.5 ? 'classic' : 'landscape'
    remapTextPositions(textItems, 'landscape', nextAspect)
    projectAspect = nextAspect
    stateRevision += 1
    if (projectAspect === 'portrait' && resolution !== '720p' && resolution !== '1080p') resolution = '1080p'
    return projectAspect
  },
  resetProjectAspect() {
    if (projectAspect !== null || videoFit !== 'contain') stateRevision += 1
    if (projectAspect) remapTextPositions(textItems, projectAspect, 'landscape')
    projectAspect = null
    videoFit = 'contain'
  },
  setProjectAspect(aspect: ProjectAspect) {
    if (projectAspect !== aspect) recordHistory()
    remapTextPositions(textItems, projectAspect ?? 'landscape', aspect)
    projectAspect = aspect
    if (aspect === 'portrait' && resolution !== '720p' && resolution !== '1080p') resolution = '1080p'
  },
  setCurrentTime(t: number) { currentTime = t },
  setPlaying(v: boolean) { playing = v },

  clearTimeline() {
    recordHistory()
    documentSession = null
    for (const channel of channels) channel.clips.splice(0)
    effectBlocks = []
    transitions = []
    textItems = []
    selectedClipIds = []
    selectedChannelIds = []
    selectedEffectBlockIds = []
    selectedTextItemIds = []
    currentTime = 0
    playing = false
  },

  deleteTimelineRange(rawStart: number, rawEnd: number, channelIds: string[] = []): boolean {
    const start = Math.max(0, rawStart)
    const end = Math.max(start, rawEnd)
    const amount = end - start
    if (!Number.isFinite(start) || !Number.isFinite(end) || amount < MIN_CLIP_LEN) return false

    const requested = new Set(channelIds)
    const targets = channels.filter((channel) => (
      !channel.locked && (requested.size === 0 || requested.has(channel.id))
    ))
    if (targets.length === 0) return false
    const targetIds = new Set(targets.map((channel) => channel.id))
    const rippleText = requested.size === 0
    const changesTimedItem = (itemEnd: number) => itemEnd > start
    const hasChanges = targets.some((channel) => channel.clips.some((clip) => changesTimedItem(clipEnd(clip))))
      || effectBlocks.some((block) => targetIds.has(block.channelId) && changesTimedItem(block.start + block.duration))
      || rippleText && textItems.some((item) => changesTimedItem(item.start + item.duration))
    if (!hasChanges) return false

    for (const channel of targets) for (const clip of channel.clips) {
      if (!clip.linkedClipId || clipEnd(clip) <= start) continue
      const partner = findClipById(clip.linkedClipId)
      if (partner && (!targetIds.has(partner.channel.id) || partner.channel.locked)) return false
    }
    for (const block of effectBlocks) {
      if (!targetIds.has(block.channelId) || !block.ramp) continue
      const blockEnd = block.start + block.duration
      const overlaps = block.start < end && blockEnd > start
      const fullyRemoved = block.start >= start && blockEnd <= end
      if (overlaps && !fullyRemoved) return false
    }

    recordHistory()
    if (currentTime >= end) currentTime -= amount
    else if (currentTime > start) currentTime = start
    const removedClipIds = new Set<string>()
    const rightClipByOriginal = new Map<string, Clip>()
    const originalLinkedIds = new Map<string, string | undefined>()

    for (const channel of targets) {
      const next: Clip[] = []
      for (const clip of channel.clips) {
        const clipStart = clip.start
        const clipFinish = clipEnd(clip)
        const linkedId = clip.linkedClipId
        originalLinkedIds.set(clip.id, linkedId)
        if (clipFinish <= start) {
          next.push(clip)
          continue
        }
        if (clipStart >= end) {
          clip.start -= amount
          next.push(clip)
          continue
        }
        if (clipStart < start && clipFinish > end) {
          const oldDuration = clipTimelineDuration(clip)
          const leftDuration = start - clipStart
          const rightOffset = end - clipStart
          const oldOutPoint = clip.outPoint
          const right: Clip = {
            ...clip,
            id: nextId('clip'),
            inPoint: clipSourceTimeAt(clip, end),
            outPoint: oldOutPoint,
            start,
            linkedClipId: undefined,
            transform: clip.transform ? { ...clip.transform } : undefined,
            transformKeyframes: sliceClipTransformKeyframes(clip, rightOffset, oldDuration),
          }
          clip.transformKeyframes = sliceClipTransformKeyframes(clip, 0, leftDuration)
          clip.outPoint = clipSourceTimeAt(clip, start)
          rightClipByOriginal.set(clip.id, right)
          next.push(clip, right)
          continue
        }
        if (clipStart < start && clipFinish > start) {
          clip.transformKeyframes = sliceClipTransformKeyframes(clip, 0, start - clipStart)
          clip.outPoint = clipSourceTimeAt(clip, start)
          next.push(clip)
          continue
        }
        if (clipStart < end && clipFinish > end) {
          const oldDuration = clipTimelineDuration(clip)
          clip.transformKeyframes = sliceClipTransformKeyframes(clip, end - clipStart, oldDuration)
          clip.inPoint = clipSourceTimeAt(clip, end)
          clip.start = start
          next.push(clip)
          continue
        }
        removedClipIds.add(clip.id)
      }
      channel.clips = next.sort((a, b) => a.start - b.start)
    }

    for (const [originalId, right] of rightClipByOriginal) {
      const linkedOriginalId = originalLinkedIds.get(originalId)
      right.linkedClipId = linkedOriginalId ? rightClipByOriginal.get(linkedOriginalId)?.id : undefined
    }
    for (const transition of transitions) {
      const right = rightClipByOriginal.get(transition.leftClipId)
      if (right) transition.leftClipId = right.id
    }
    const clipsById = new Map(channels.flatMap((channel) => channel.clips.map((clip) => [clip.id, clip] as const)))
    for (const clip of clipsById.values()) {
      if (!clip.linkedClipId) continue
      const partner = clipsById.get(clip.linkedClipId)
      const staysSynchronized = partner
        && partner.linkedClipId === clip.id
        && Math.abs(partner.start - clip.start) <= 1e-6
        && Math.abs(clipTimelineDuration(partner) - clipTimelineDuration(clip)) <= 1e-6
      if (staysSynchronized) continue
      clip.linkedClipId = undefined
      if (partner?.linkedClipId === clip.id) partner.linkedClipId = undefined
    }

    const adjustRange = (itemStart: number, itemDuration: number): { start: number; duration: number } | null => {
      const itemEnd = itemStart + itemDuration
      if (itemEnd <= start) return { start: itemStart, duration: itemDuration }
      if (itemStart >= end) return { start: itemStart - amount, duration: itemDuration }
      if (itemStart < start && itemEnd > end) return { start: itemStart, duration: itemDuration - amount }
      if (itemStart < start && itemEnd > start) return { start: itemStart, duration: start - itemStart }
      if (itemStart < end && itemEnd > end) return { start, duration: itemEnd - end }
      return null
    }

    const nextEffects: EffectBlock[] = []
    for (const block of effectBlocks) {
      if (!targetIds.has(block.channelId)) {
        nextEffects.push(block)
        continue
      }
      if (block.ownerClipId && removedClipIds.has(block.ownerClipId)) continue
      const splitOwner = block.ownerClipId ? rightClipByOriginal.get(block.ownerClipId) : undefined
      const blockEnd = block.start + block.duration
      if (splitOwner && block.start < start && blockEnd > end) {
        const leftDuration = start - block.start
        const rightDuration = blockEnd - end
        if (leftDuration >= 0.2) {
          block.duration = leftDuration
          block.nodeId = null
          nextEffects.push(block)
        }
        if (rightDuration >= 0.2) {
          nextEffects.push({
            ...block,
            id: nextId('fx'),
            ownerClipId: splitOwner.id,
            params: { ...block.params },
            ramp: block.ramp ? { ...block.ramp } : null,
            start,
            duration: rightDuration,
            nodeId: null,
          })
        }
        continue
      }
      const adjusted = adjustRange(block.start, block.duration)
      if (!adjusted || adjusted.duration < 0.2) continue
      block.start = adjusted.start
      block.duration = adjusted.duration
      if (splitOwner && block.start >= start) block.ownerClipId = splitOwner.id
      block.nodeId = null
      nextEffects.push(block)
    }
    effectBlocks = nextEffects

    if (rippleText) {
      textItems = textItems.flatMap((item) => {
        const adjusted = adjustRange(item.start, item.duration)
        if (!adjusted || adjusted.duration < 0.2) return []
        item.words = scaleTextWords(item.words, item.duration, adjusted.duration)
        item.start = adjusted.start
        item.duration = adjusted.duration
        return [item]
      })
    }

    const effectIds = new Set(effectBlocks.map((block) => block.id))
    const textIds = new Set(textItems.map((item) => item.id))
    selectedClipIds = selectedClipIds.filter((id) => clipsById.has(id))
    selectedEffectBlockIds = selectedEffectBlockIds.filter((id) => effectIds.has(id))
    selectedTextItemIds = selectedTextItemIds.filter((id) => textIds.has(id))
    reconcileTransitions()
    clampPlayheadAfterLeftEdit(true)
    return true
  },

  setClipDragPreview(clipIds: string[], offsetY: number, detached = false) {
    if (
      clipDragPreviewIds.length !== clipIds.length
      || clipDragPreviewIds.some((id, index) => id !== clipIds[index])
    ) clipDragPreviewIds = [...clipIds]
    clipDragPreviewOffsetY = offsetY
    clipDragPreviewDetached = detached
  },

  clearClipDragPreview() {
    if (clipDragPreviewIds.length > 0) clipDragPreviewIds = []
    clipDragPreviewOffsetY = 0
    clipDragPreviewDetached = false
  },

  setEffectDragPreview(blockIds: string[], offsetY: number) {
    if (
      effectDragPreviewIds.length !== blockIds.length
      || effectDragPreviewIds.some((id, index) => id !== blockIds[index])
    ) effectDragPreviewIds = [...blockIds]
    effectDragPreviewOffsetY = offsetY
  },

  clearEffectDragPreview() {
    if (effectDragPreviewIds.length > 0) effectDragPreviewIds = []
    effectDragPreviewOffsetY = 0
  },

  setTextDragPreview(itemIds: string[], offsetY: number) {
    if (
      textDragPreviewIds.length !== itemIds.length
      || textDragPreviewIds.some((id, index) => id !== itemIds[index])
    ) textDragPreviewIds = [...itemIds]
    textDragPreviewOffsetY = offsetY
  },

  clearTextDragPreview() {
    if (textDragPreviewIds.length > 0) textDragPreviewIds = []
    textDragPreviewOffsetY = 0
  },

  addChannel(type: 'video' | 'audio', afterChannelId?: string) {
    recordHistory()
    const afterIndex = afterChannelId
      ? channels.findIndex((candidate) => candidate.id === afterChannelId)
      : -1
    return createChannel(type, afterIndex >= 0 ? afterIndex + 1 : channels.length)
  },


  getEffectLanes(channelId: string): EffectBlock[][] {
    return packEffectLanes(effectBlocks.filter((b) => b.channelId === channelId))
  },

  getTextLanes(): TextItem[][] {
    return packTextLanes(textItems)
  },

  removeChannel(channelId: string) {
    const idx = channels.findIndex((c) => c.id === channelId)
    if (idx >= 0) {
      recordHistory()
      const removedIds = new Set(channels[idx].clips.map((clip) => clip.id))
      const removedEffectIds = new Set(
        effectBlocks.filter((block) => block.channelId === channelId).map((block) => block.id),
      )
      channels.splice(idx, 1)
      effectBlocks = effectBlocks.filter((block) => block.channelId !== channelId)
      selectedClipIds = selectedClipIds.filter((id) => !removedIds.has(id))
      selectedChannelIds = selectedChannelIds.filter((id) => id !== channelId)
      selectedEffectBlockIds = selectedEffectBlockIds.filter((id) => !removedEffectIds.has(id))
      clampPlayheadAfterLeftEdit(true)
    }
    reconcileTransitions()
  },

  toggleMute(channelId: string) {
    const ch = channels.find((c) => c.id === channelId)
    if (ch) { recordHistory(); ch.muted = !ch.muted }
  },

  toggleHidden(channelId: string) {
    const ch = channels.find((c) => c.id === channelId)
    if (ch) { recordHistory(); ch.hidden = !ch.hidden }
  },

  toggleLock(channelId: string) {
    const ch = channels.find((c) => c.id === channelId)
    if (ch) { recordHistory(); ch.locked = !ch.locked }
  },

  addClip(channelId: string, clip: Omit<Clip, 'id'>): Clip {
    const ch = channels.find((c) => c.id === channelId)
    if (!ch) throw new Error(`channel ${channelId} not found`)
    recordHistory()
    const full: Clip = {
      ...clip,
      id: nextId('clip'),
      transform: clip.transform ? normalizeClipTransform(clip.transform) : undefined,
      transformKeyframes: clip.transformKeyframes?.map(normalizeClipTransformKeyframe),
      opacity: clip.opacity === undefined ? undefined : clipOpacity(clip),
      fadeIn: clip.fadeIn === undefined ? undefined : clipFadeIn(clip),
      fadeOut: clip.fadeOut === undefined ? undefined : clipFadeOut(clip),
    }
    ch.clips.push(full)
    sortChannelClipsIfNeeded(ch)
    return full
  },

  addClipAtValidStart(channelId: string, clip: Omit<Clip, 'id'>): Clip {
    const full = this.addClip(channelId, clip)
    const channel = channels.find((candidate) => candidate.id === channelId)!
    full.start = clampClipStart(channel, full, full.start)
    channel.clips.sort((a, b) => a.start - b.start)
    return full
  },

  removeClip(channelId: string, clipId: string) {
    const channel = channels.find((candidate) => candidate.id === channelId)
    const clip = channel?.clips.find((candidate) => candidate.id === clipId)
    if (channel && clip) removeLocatedClip({ channel, clip })
  },

  // Per-clip volume in whole percent (0–200). Callers should wrap continuous
  // adjustments in beginHistory()/endHistory() to group them into one undo step.
  setClipVolume(clipId: string, volume: number) {
    const found = this.getClipById(clipId)
    if (!found || found.channel.locked) return
    const clamped = Math.round(Math.max(0, Math.min(200, volume)))
    if (Math.abs(clamped - (found.clip.volume ?? 100)) <= 1e-9) return
    recordHistory()
    found.clip.volume = clamped
  },

  setClipCompositing(
    clipId: string,
    patch: Pick<Clip, 'opacity' | 'fadeIn' | 'fadeOut'>,
  ): boolean {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return false
    const next = { ...found.clip, ...patch }
    const opacity = clipOpacity(next)
    const fadeIn = clipFadeIn(next)
    const fadeOut = clipFadeOut(next)
    if (
      Math.abs(clipOpacity(found.clip) - opacity) <= 1e-9
      && Math.abs(clipFadeIn(found.clip) - fadeIn) <= 1e-9
      && Math.abs(clipFadeOut(found.clip) - fadeOut) <= 1e-9
    ) return true

    recordHistory()
    found.clip.opacity = opacity
    found.clip.fadeIn = fadeIn
    found.clip.fadeOut = fadeOut
    if (patch.fadeIn !== undefined || patch.fadeOut !== undefined) {
      rebuildLayerMotion(found.clip)
    }
    return true
  },

  setClipLayerEntrance(clipId: string, effect: LayerEntranceEffect): boolean {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return false
    const duration = clipTimelineDuration(found.clip)
    const entranceDuration = effect === 'none' || effect === 'fade' ? (effect === 'fade' ? Math.min(duration, clipFadeIn(found.clip) || 0.5) : 0) : Math.min(duration, clipFadeIn(found.clip) || 0.5)
    const base = clipTransform(found.clip)
    recordHistory()
    found.clip.layerEntrance = effect
    found.clip.fadeIn = entranceDuration
    found.clip.transform = base
    rebuildLayerMotion(found.clip)
    found.clip.motionPreset = undefined
    return true
  },

  setClipLayerExit(clipId: string, effect: LayerExitEffect): boolean {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return false
    const duration = clipTimelineDuration(found.clip)
    const exitDuration = effect === 'none' || effect === 'fade' ? (effect === 'fade' ? Math.min(duration, clipFadeOut(found.clip) || 0.5) : 0) : Math.min(duration, clipFadeOut(found.clip) || 0.5)
    const base = clipTransform(found.clip)
    recordHistory()
    found.clip.layerExit = effect
    found.clip.fadeOut = exitDuration
    found.clip.transform = base
    rebuildLayerMotion(found.clip)
    found.clip.motionPreset = undefined
    return true
  },

  setClipTransform(clipId: string, patch: Partial<ClipTransform>, keyframeTime?: number) {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return
    const duration = clipTimelineDuration(found.clip)
    const time = keyframeTime === undefined
      ? undefined
      : Math.max(0, Math.min(duration, Number.isFinite(keyframeTime) ? keyframeTime : 0))
    const current = time === undefined
      ? clipTransform(found.clip)
      : clipTransformAt(found.clip, time)
    const next = normalizeClipTransform({ ...current, ...patch })
    recordHistory()
    found.clip.motionPreset = undefined
    found.clip.layerEntrance = undefined
    found.clip.layerExit = undefined
    if (time === undefined) {
      found.clip.transform = next
      return
    }
    const keyframes = [...(found.clip.transformKeyframes ?? [])]
      .map(normalizeClipTransformKeyframe)
      .sort((a, b) => a.time - b.time)
    const existing = keyframes.findIndex((keyframe) => Math.abs(keyframe.time - time) <= 1 / Math.max(1, fps) / 2)
    if (existing >= 0) keyframes[existing] = { time, transform: next }
    else keyframes.push({ time, transform: next })
    found.clip.transformKeyframes = keyframes.sort((a, b) => a.time - b.time)
  },

  setClipTransformKeyframes(
    clipId: string,
    transform: ClipTransform,
    keyframes: ClipTransformKeyframe[],
    motionPreset?: TransformPreset,
  ) {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return
    recordHistory()
    found.clip.transform = normalizeClipTransform(transform)
    found.clip.transformKeyframes = keyframes
      .map(normalizeClipTransformKeyframe)
      .sort((a, b) => a.time - b.time)
    found.clip.motionPreset = motionPreset
    found.clip.layerEntrance = undefined
    found.clip.layerExit = undefined
  },

  applyClipLook(clipId: string, lookId: ClipLookId): boolean {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return false
    const prepared = prepareClipLook(found, lookId)
    if (!prepared) return false

    recordHistory()
    found.clip.transform = normalizeClipTransform(prepared.recipe.transform)
    found.clip.transformKeyframes = prepared.recipe.transformKeyframes.map(normalizeClipTransformKeyframe)
    found.clip.motionPreset = undefined
    found.clip.layerEntrance = undefined
    found.clip.layerExit = undefined
    replaceClipLookEffects(clipId, prepared.blocks)
    return true
  },

  refreshClipLookEffects(clipId: string, lookId: ClipLookId): boolean {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return false
    const prepared = prepareClipLook(found, lookId)
    if (!prepared) return false
    recordHistory()
    replaceClipLookEffects(clipId, prepared.blocks)
    return true
  },

  removeClipTransformKeyframe(clipId: string, time: number) {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return
    const keyframes = found.clip.transformKeyframes ?? []
    const next = keyframes.filter((keyframe) => Math.abs(keyframe.time - time) > 1 / Math.max(1, fps) / 2)
    if (next.length === keyframes.length) return
    recordHistory()
    found.clip.transformKeyframes = next
    found.clip.motionPreset = undefined
    found.clip.layerEntrance = undefined
    found.clip.layerExit = undefined
  },

  resetClipTransform(clipId: string) {
    const found = findClipById(clipId)
    if (!found || found.channel.type !== 'video' || found.channel.locked) return
    if (!found.clip.transform && !(found.clip.transformKeyframes?.length) && !found.clip.motionPreset && !found.clip.layerEntrance && !found.clip.layerExit) return
    recordHistory()
    found.clip.transform = undefined
    found.clip.transformKeyframes = undefined
    found.clip.motionPreset = undefined
    found.clip.layerEntrance = undefined
    found.clip.layerExit = undefined
  },

  getClipTransformAt(clipId: string, time = 0): ClipTransform | null {
    const found = findClipById(clipId)
    return found?.channel.type === 'video' ? clipTransformAt(found.clip, time) : null
  },

  setClipPlaybackRate(clipId: string, playbackRate: number): boolean {
    const found = findClipById(clipId)
    if (!found || !Number.isFinite(playbackRate)) return false
    const rate = Math.max(0.25, Math.min(4, playbackRate))
    const linked = found.clip.linkedClipId ? findClipById(found.clip.linkedClipId) : null
    const affected = linked ? [found, linked] : [found]
    if (affected.some(({ channel }) => channel.locked)) return false
    if (affected.every(({ clip }) => Math.abs(clipPlaybackRate(clip) - rate) <= 1e-9)) return true

    const affectedIds = new Set(affected.map(({ clip }) => clip.id))
    for (const { channel, clip } of affected) {
      const nextDuration = (clip.outPoint - clip.inPoint) / rate
      for (const other of channel.clips) {
        if (affectedIds.has(other.id)) continue
        const overlap = Math.min(clip.start + nextDuration, clipEnd(other)) - Math.max(clip.start, other.start)
        if (overlap > maxClipTransitionOverlap(clip, other, nextDuration, clipTimelineDuration(other)) + 0.001) return false
      }
    }

    recordHistory()
    const oldEnds = new Map(affected.map(({ clip }) => [clip.id, clipEnd(clip)]))
    for (const { clip } of affected) markClipBlocksDirty(clip.id)
    for (const { clip } of affected) {
      const oldEnd = oldEnds.get(clip.id)!
      clip.playbackRate = rate
      markClipBlocksDirty(clip.id)
      // Rate changes only the right edge: full-span styles follow it,
      // overhang is clamped like a right trim.
      trimOwnedClipBlocks(clip.id, clip.start, oldEnd, clip.start, clipEnd(clip))
    }
    reconcileTransitions()
    return true
  },

  unlinkClip(clipId: string) {
    let linkedId: string | undefined
    let clipRef: Clip | undefined
    for (const ch of channels) {
      const c = ch.clips.find((x) => x.id === clipId)
      if (c) { clipRef = c; linkedId = c.linkedClipId; break }
    }
    if (!clipRef) return
    recordHistory()
    clipRef.linkedClipId = undefined
    if (linkedId) {
      for (const ch of channels) {
        const partner = ch.clips.find((x) => x.id === linkedId)
        if (partner) { partner.linkedClipId = undefined; break }
      }
    }
  },

  linkSelectedClips(): boolean {
    if (selectedClipIds.length !== 2) return false
    const first = findClipById(selectedClipIds[0])
    const second = findClipById(selectedClipIds[1])
    if (!first || !second || first.channel.type === second.channel.type) return false

    recordHistory()
    this.unlinkClip(first.clip.id)
    this.unlinkClip(second.clip.id)
    const video = first.channel.type === 'video' ? first.clip : second.clip
    const audio = first.channel.type === 'audio' ? first.clip : second.clip
    audio.playbackRate = clipPlaybackRate(video)
    first.clip.linkedClipId = second.clip.id
    second.clip.linkedClipId = first.clip.id
    return true
  },

  toggleLinkSelectedClips(): boolean {
    if (selectedClipIds.length === 1) {
      const selected = findClipById(selectedClipIds[0])
      if (!selected?.clip.linkedClipId) return false
      this.unlinkClip(selected.clip.id)
      return true
    }
    if (selectedClipIds.length !== 2) return false
    const first = findClipById(selectedClipIds[0])
    const second = findClipById(selectedClipIds[1])
    if (!first || !second || first.channel.type === second.channel.type) return false
    if (first.clip.linkedClipId === second.clip.id && second.clip.linkedClipId === first.clip.id) {
      this.unlinkClip(first.clip.id)
      return true
    }
    return this.linkSelectedClips()
  },

  moveClip(channelId: string, clipId: string, newStart: number) {
    const ch = channels.find((c) => c.id === channelId)
    if (!ch || ch.locked) return
    const movedClip = ch.clips.find((c) => c.id === clipId)
    if (!movedClip) return
    const linkedFound = movedClip.linkedClipId ? findClipById(movedClip.linkedClipId) : null
    if (linkedFound?.channel.locked) return
    const newMovedClipStart = clampClipStart(ch, movedClip, Math.max(0, newStart))
    const delta = newMovedClipStart - movedClip.start
    if (Math.abs(delta) <= 1e-9) return
    recordHistory()
    movedClip.start = newMovedClipStart
    moveOwnedClipBlocks(new Set([movedClip.id]), delta)
    moveOwnedClipText(new Set([movedClip.id]), delta)
    sortChannelClipsIfNeeded(ch)
    // Move linked clip together — same edge-overlap rules on its channel, so
    // a linked audio pair gets the same crossfade as the video.
    if (movedClip.linkedClipId) {
      for (const otherCh of channels) {
        if (otherCh.id === channelId) continue
        const linked = otherCh.clips.find((c) => c.id === movedClip.linkedClipId)
        if (linked) {
          const linkedOriginalStart = linked.start
          const linkedDesiredStart = linked.start + delta
          const linkedNewStart = clampClipStart(otherCh, linked, Math.max(0, linkedDesiredStart))
          linked.start = linkedNewStart
          moveOwnedClipBlocks(new Set([linked.id]), linkedNewStart - linkedOriginalStart)
          moveOwnedClipText(new Set([linked.id]), linkedNewStart - linkedOriginalStart)
          sortChannelClipsIfNeeded(otherCh)
          if (Math.abs(linkedNewStart - linkedDesiredStart) > 1e-9) {
            movedClip.linkedClipId = undefined
            linked.linkedClipId = undefined
          }
        }
      }
    }
    reconcileTransitions()
    clampPlayheadAfterLeftEdit(delta < -1e-9)
  },

  moveClips(clipIds: string[], deltaSec: number, ignoreCollisions = false): number {
    return moveClipGroup(clipIds, deltaSec, false, -Infinity, ignoreCollisions)
  },

  moveSelection(
    clipIds: string[],
    blockIds: string[],
    textItemIds: string[] = [],
    deltaSec: number,
    ignoreCollisions = false,
  ): number {
    const movingClipIds = new Set(expandLinkedClipIds(clipIds))
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
      .filter((block) => !block.ownerClipId || !movingClipIds.has(block.ownerClipId))
    const texts = [...new Set(textItemIds)]
      .map((id) => textItems.find((item) => item.id === id))
      .filter((item): item is TextItem => item !== undefined)
      .filter((item) => !item.sourceClipId || !movingClipIds.has(item.sourceClipId))
    if (blocks.some((block) => {
      const channel = channels.find((candidate) => candidate.id === block.channelId)
      return !channel || channel.locked
    })) return 0

    if (clipIds.length === 0) {
      if (texts.length === 0) return this.moveEffectBlocks(blockIds, deltaSec)
      const textMinimumDelta = Math.max(
        ...texts.map((item) => -item.start),
        ...(blocks.length > 0 ? blocks.map((block) => -block.start) : []),
      )
      const appliedDelta = Math.max(deltaSec, textMinimumDelta)
      if (Math.abs(appliedDelta) <= 1e-9) return 0
      recordHistory()
      for (const block of blocks) {
        block.start += appliedDelta
        block.nodeId = null
        refreshEffectOwnership(block)
      }
      for (const item of texts) item.start += appliedDelta
      return appliedDelta
    }
    const groupMinimumDelta = blocks.length > 0 || texts.length > 0
      ? Math.max(
          ...blocks.map((block) => -block.start),
          ...texts.map((item) => -item.start),
        )
      : -Infinity
    const appliedDelta = moveClipGroup(clipIds, deltaSec, false, groupMinimumDelta, ignoreCollisions)
    if (Math.abs(appliedDelta) <= 1e-9 || (blocks.length === 0 && texts.length === 0)) return appliedDelta

    recordHistory()
    for (const block of blocks) {
      block.start += appliedDelta
      block.nodeId = null
      refreshEffectOwnership(block)
    }
    for (const item of texts) item.start += appliedDelta
    return appliedDelta
  },

  moveClipsToChannel(
    sourceChannelId: string,
    targetChannelId: string | null,
    clipIds: string[],
    anchorClipId: string,
    desiredAnchorStart?: number,
    effectBlockIds: string[] = [],
    textItemIds: string[] = [],
  ): boolean {
    const anchor = findClipById(anchorClipId)
    if (!anchor || anchor.channel.id !== sourceChannelId) return false
    const target = targetChannelId
      ? channels.find((channel) => channel.id === targetChannelId)
      : null
    if (targetChannelId && (!target || target.type !== anchor.channel.type)) return false

    const requestedIds = new Set(clipIds)
    const moving = [...requestedIds]
      .map((id) => findClipById(id))
      .filter((found): found is { channel: Channel; clip: Clip } => found !== null)
    if (!requestedIds.has(anchorClipId) || moving.length === 0) return false
    if (target?.locked || moving.some(({ channel }) => channel.locked)) return false

    const temporalMoving = expandLinkedClipIds(moving.map(({ clip }) => clip.id))
      .map((id) => findClipById(id))
      .filter((found): found is { channel: Channel; clip: Clip } => found !== null)
    if (temporalMoving.some(({ channel }) => channel.locked)) return false

    const linkedAudio = anchor.channel.type === 'video'
      ? moving.flatMap((video) => {
          const { clip } = video
          if (video.channel.type !== 'video') return []
          if (!clip.linkedClipId) return []
          const linked = findClipById(clip.linkedClipId)
          return linked
            && linked.channel.type === 'audio'
            && linked.clip.linkedClipId === clip.id
            && !requestedIds.has(linked.clip.id)
            ? [{ ...linked, video }]
            : []
        })
      : []

    const desiredDelta = desiredAnchorStart === undefined
      ? 0
      : desiredAnchorStart - anchor.clip.start
    recordHistory()

    const sourceChannelIds = [...new Set(moving.map(({ channel }) => channel.id))]
      .sort((a, b) => (
        channels.findIndex((channel) => channel.id === a)
        - channels.findIndex((channel) => channel.id === b)
      ))
    const anchorSourceIndex = sourceChannelIds.indexOf(anchor.channel.id)
    const destinations = new Map<string, Channel>()
    const usedDestinations = new Set<string>()

    if (target) {
      destinations.set(anchor.channel.id, target)
      usedDestinations.add(target.id)

      let cursor = target
      for (let i = anchorSourceIndex + 1; i < sourceChannelIds.length; i++) {
        const source = channels.find((channel) => channel.id === sourceChannelIds[i])!
        const cursorIndex = channels.findIndex((channel) => channel.id === cursor.id)
        let destination = channels.slice(cursorIndex + 1).find((channel) => (
          channel.type === source.type
          && !channel.locked
          && !usedDestinations.has(channel.id)
        ))
        if (!destination) destination = createChannel(source.type)
        destinations.set(sourceChannelIds[i], destination)
        usedDestinations.add(destination.id)
        cursor = destination
      }

      cursor = target
      for (let i = anchorSourceIndex - 1; i >= 0; i--) {
        const source = channels.find((channel) => channel.id === sourceChannelIds[i])!
        const cursorIndex = channels.findIndex((channel) => channel.id === cursor.id)
        let destination = channels.slice(0, cursorIndex).reverse().find((channel) => (
          channel.type === source.type
          && !channel.locked
          && !usedDestinations.has(channel.id)
        ))
        if (!destination) destination = createChannel(source.type, cursorIndex)
        destinations.set(sourceChannelIds[i], destination)
        usedDestinations.add(destination.id)
        cursor = destination
      }
    } else {
      for (const sourceId of sourceChannelIds) {
        const source = channels.find((channel) => channel.id === sourceId)!
        const destination = createChannel(source.type)
        destinations.set(sourceId, destination)
        usedDestinations.add(destination.id)
      }
    }

    const audioSourceIds = [...new Set(linkedAudio.map(({ channel }) => channel.id))]
      .sort((a, b) => (
        channels.findIndex((channel) => channel.id === a)
        - channels.findIndex((channel) => channel.id === b)
      ))
    const audioDestinations = new Map<string, Channel>()
    const usedAudioDestinations = new Set(
      [...destinations.values()]
        .filter((channel) => channel.type === 'audio')
        .map((channel) => channel.id),
    )
    const audioCursors = new Map<string, Channel>()
    for (const sourceId of audioSourceIds) {
      const linked = linkedAudio.find(({ channel }) => channel.id === sourceId)!
      const selectedDestination = destinations.get(sourceId)
      if (selectedDestination?.type === 'audio') {
        audioDestinations.set(sourceId, selectedDestination)
        continue
      }
      const videoDestination = destinations.get(linked.video.channel.id)!
      const cursor = audioCursors.get(videoDestination.id) ?? videoDestination
      const cursorIndex = channels.findIndex((channel) => channel.id === cursor.id)
      const nextChannel = channels[cursorIndex + 1]
      const destination = nextChannel?.type === 'audio'
        && !nextChannel.locked
        && !usedAudioDestinations.has(nextChannel.id)
        ? nextChannel
        : createChannel('audio', cursorIndex + 1)
      audioDestinations.set(sourceId, destination)
      usedAudioDestinations.add(destination.id)
      audioCursors.set(videoDestination.id, destination)
    }

    const assignments = new Map<string, Channel>()
    for (const found of moving) assignments.set(found.clip.id, destinations.get(found.channel.id)!)
    for (const found of linkedAudio) assignments.set(found.clip.id, audioDestinations.get(found.channel.id)!)

    const movedById = new Map<string, { channel: Channel; clip: Clip }>()
    for (const found of [...moving, ...linkedAudio]) movedById.set(found.clip.id, found)
    const affectedChannels = new Set<Channel>(assignments.values())
    for (const found of movedById.values()) {
      affectedChannels.add(found.channel)
      const index = found.channel.clips.findIndex((candidate) => candidate.id === found.clip.id)
      if (index >= 0) found.channel.clips.splice(index, 1)
    }
    for (const found of movedById.values()) {
      const destination = assignments.get(found.clip.id)
      if (destination) destination.clips.push(found.clip)
    }
    for (const block of effectBlocks) {
      const destination = block.ownerClipId ? assignments.get(block.ownerClipId) : undefined
      if (destination?.type === 'video') block.channelId = destination.id
    }
    for (const channel of affectedChannels) {
      channel.clips.sort((a, b) => a.start - b.start)
    }

    const movedIds = new Set(movedById.keys())
    for (const transition of transitions) {
      if (!movedIds.has(transition.leftClipId) || !movedIds.has(transition.rightClipId)) continue
      const destination = assignments.get(transition.leftClipId)
      if (destination && assignments.get(transition.rightClipId) === destination) {
        transition.channelId = destination.id
      }
    }

    const appliedDelta = moveClipGroup(moving.map(({ clip }) => clip.id), desiredDelta, true)

    if (Math.abs(appliedDelta) > 1e-9) {
      const movableEffectIds = [...new Set(effectBlockIds)].filter((id) => {
        const block = effectBlocks.find((candidate) => candidate.id === id)
        return block !== undefined && destinations.has(block.channelId)
      })
      if (movableEffectIds.length > 0) this.moveEffectBlocks(movableEffectIds, appliedDelta)
      const independentlyMovedTextIds = textItemIds.filter((id) => {
        const item = textItems.find((candidate) => candidate.id === id)
        return item !== undefined && (!item.sourceClipId || !movedIds.has(item.sourceClipId))
      })
      if (independentlyMovedTextIds.length > 0) this.moveTextItems(independentlyMovedTextIds, appliedDelta)
    }

    const effectIdsByDestination = new Map<string, string[]>()
    for (const id of [...new Set(effectBlockIds)]) {
      const block = effectBlocks.find((candidate) => candidate.id === id)
      const destination = block ? destinations.get(block.channelId) : undefined
      if (!destination || destination.type !== 'video') continue
      const ids = effectIdsByDestination.get(destination.id) ?? []
      ids.push(id)
      effectIdsByDestination.set(destination.id, ids)
    }
    for (const [destinationId, ids] of effectIdsByDestination) {
      this.moveEffectBlocksToChannel(ids, destinationId)
    }

    reconcileTransitions()
    return true
  },

  moveClipToChannel(
    sourceChannelId: string,
    targetChannelId: string,
    clipId: string,
    desiredStart?: number,
  ): boolean {
    const source = channels.find((c) => c.id === sourceChannelId)
    const target = channels.find((c) => c.id === targetChannelId)
    if (!source || !target || source.type !== target.type || source.locked || target.locked) return false

    const clipIndex = source.clips.findIndex((c) => c.id === clipId)
    if (clipIndex < 0) return false
    const clip = source.clips[clipIndex]
    if (sourceChannelId === targetChannelId) {
      if (desiredStart !== undefined) this.moveClip(sourceChannelId, clipId, desiredStart)
      return true
    }

    const linkedFound = source.type === 'video' && clip.linkedClipId
      ? findClipById(clip.linkedClipId)
      : null
    const linkedAudio = linkedFound
      && linkedFound.channel.type === 'audio'
      && linkedFound.clip.linkedClipId === clip.id
      ? linkedFound
      : null

    const targetIndex = channels.findIndex((channel) => channel.id === target.id)
    let targetAudio = linkedAudio && channels[targetIndex + 1]?.type === 'audio'
      ? channels[targetIndex + 1]
      : null
    if (linkedAudio && (linkedAudio.channel.locked || targetAudio?.locked)) return false

    recordHistory()
    if (linkedAudio && !targetAudio) targetAudio = this.addChannel('audio', target.id)

    source.clips.splice(clipIndex, 1)
    target.clips.push(clip)
    target.clips.sort((a, b) => a.start - b.start)
    for (const block of effectBlocks) {
      if (block.ownerClipId === clip.id) block.channelId = target.id
    }

    if (linkedAudio && targetAudio && linkedAudio.channel.id !== targetAudio.id) {
      const audioIndex = linkedAudio.channel.clips.findIndex((candidate) => candidate.id === linkedAudio.clip.id)
      if (audioIndex >= 0) {
        linkedAudio.channel.clips.splice(audioIndex, 1)
        targetAudio.clips.push(linkedAudio.clip)
        targetAudio.clips.sort((a, b) => a.start - b.start)
      }
    }

    this.moveClip(target.id, clip.id, desiredStart ?? clip.start)
    reconcileTransitions()
    return true
  },
  
  trimClip(clipId: string, edge: 'left' | 'right', deltaSec: number) {
    const found = this.getClipById(clipId)
    if (!found || found.channel.locked) return
    const clip = found.clip
    const len = clipTimelineDuration(clip)
    const partnerFound = clip.linkedClipId ? this.getClipById(clip.linkedClipId) : null
    const partner = partnerFound?.clip
    const trimPartner = Boolean(
      partner
      && partnerFound
      && !partnerFound.channel.locked
      && Math.abs(clipTimelineDuration(partner) - len) <= 1e-6
    )

    const clampDelta = (targetFound: { channel: Channel; clip: Clip }, requested: number) => {
      const target = targetFound.clip
      const rate = clipPlaybackRate(target)
      const targetLen = clipTimelineDuration(target)
      const bounds = edgeBounds(targetFound.channel, target)
      const remainingSourceDuration = target.mediaKind === 'image'
        ? Number.POSITIVE_INFINITY
        : (target.sourceDuration - target.outPoint) / rate
      return edge === 'left'
        ? Math.min(
          Math.max(requested, -target.inPoint / rate, bounds.prevEnd - target.start, 2 * bounds.overlapHi + MIN_CLIP_LEN - targetLen),
          targetLen - MIN_CLIP_LEN,
        )
        : Math.min(
          Math.max(requested, MIN_CLIP_LEN - targetLen, 2 * bounds.overlapLo + MIN_CLIP_LEN - targetLen),
          remainingSourceDuration,
          bounds.nextStart - clipEnd(target),
        )
    }

    let delta = clampDelta(found, deltaSec)
    if (trimPartner && partnerFound) delta = clampDelta(partnerFound, delta)
    if (Math.abs(delta) <= 1e-9) return

    recordHistory()
    const oldStart = clip.start
    const oldEnd = clipEnd(clip)
    const oldDuration = clipTimelineDuration(clip)
    clip.transformKeyframes = edge === 'left'
      ? sliceClipTransformKeyframes(clip, delta, oldDuration)
      : sliceClipTransformKeyframes(clip, 0, oldDuration + delta)
    const sourceDelta = delta * clipPlaybackRate(clip)
    if (edge === 'left') {
      clip.inPoint += sourceDelta
      clip.start += delta
    } else {
      clip.outPoint += sourceDelta
    }
    trimOwnedClipBlocks(clip.id, oldStart, oldEnd, clip.start, clipEnd(clip))
    if (trimPartner && partner) {
      const partnerDuration = clipTimelineDuration(partner)
      partner.transformKeyframes = edge === 'left'
        ? sliceClipTransformKeyframes(partner, delta, partnerDuration)
        : sliceClipTransformKeyframes(partner, 0, partnerDuration + delta)
      const partnerSourceDelta = delta * clipPlaybackRate(partner)
      if (edge === 'left') {
        partner.inPoint += partnerSourceDelta
        partner.start += delta
        moveOwnedClipBlocks(new Set([partner.id]), delta)
      } else {
        partner.outPoint += partnerSourceDelta
      }
      markClipBlocksDirty(partner.id)
    }
    markClipBlocksDirty(clipId)
    reconcileTransitions()
  },

  splitClip(clipId: string, time: number): Clip | null {
    const found = this.getClipById(clipId)
    if (!found || found.channel.locked) return null
    const { channel, clip } = found
    const rel = time - clip.start
    if (rel < MIN_CLIP_LEN || rel > clipTimelineDuration(clip) - MIN_CLIP_LEN) return null
    // Refuse to cut inside a transition overlap — the halves would fight over
    // the crossfade region.
    const end = clipEnd(clip)
    for (const o of channel.clips) {
      if (o.id === clip.id) continue
      const lo = Math.max(clip.start, o.start)
      const hi = Math.min(end, clipEnd(o))
      if (time > lo + 0.001 && time < hi - 0.001) return null
    }

    recordHistory()
    const cutSrc = clipSourceTimeAt(clip, time)
    const originalDuration = clipTimelineDuration(clip)
    const leftKeyframes = sliceClipTransformKeyframes(clip, 0, rel)
    const rightKeyframes = sliceClipTransformKeyframes(clip, rel, originalDuration)
    const originalEntrance = clip.layerEntrance
    const originalExit = clip.layerExit
    const second: Clip = {
      ...clip,
      id: nextId('clip'),
      inPoint: cutSrc,
      start: time,
      linkedClipId: undefined,
      fadeIn: 0,
      layerEntrance: undefined,
      transformKeyframes: rightKeyframes,
    }
    clip.transformKeyframes = leftKeyframes
    clip.outPoint = cutSrc
    clip.fadeOut = 0
    clip.layerExit = undefined
    if (originalEntrance !== undefined || originalExit !== undefined) {
      rebuildLayerMotion(clip)
      rebuildLayerMotion(second)
    }

    const partner = clip.linkedClipId ? this.getClipById(clip.linkedClipId)?.clip : undefined
    let partnerSecond: Clip | undefined
    if (partner) {
      const prel = time - partner.start
      if (prel >= MIN_CLIP_LEN && prel <= clipTimelineDuration(partner) - MIN_CLIP_LEN) {
        const pcut = clipSourceTimeAt(partner, time)
        const partnerDuration = clipTimelineDuration(partner)
        partnerSecond = {
          ...partner,
          id: nextId('clip'),
          inPoint: pcut,
          start: time,
          linkedClipId: undefined,
          transformKeyframes: sliceClipTransformKeyframes(partner, prel, partnerDuration),
        }
        partner.transformKeyframes = sliceClipTransformKeyframes(partner, 0, prel)
        partner.outPoint = pcut
        const partnerCh = channels.find((c) => c.clips.some((x) => x.id === partner.id))
        partnerCh!.clips.push(partnerSecond)
        partnerCh!.clips.sort((a, b) => a.start - b.start)
        clip.linkedClipId = partner.id
        partner.linkedClipId = clip.id
        second.linkedClipId = partnerSecond.id
        partnerSecond.linkedClipId = second.id
        markClipBlocksDirty(partner.id)
      } else {
        partner.linkedClipId = undefined
        clip.linkedClipId = undefined
      }
    }

    channel.clips.push(second)
    channel.clips.sort((a, b) => a.start - b.start)
    splitOwnedClipText(clip.id, second.id, time)
    splitOwnedClipBlocks(clip.id, second.id, time)
    if (partnerSecond && partner) splitOwnedClipText(partner.id, partnerSecond.id, time)
    markClipBlocksDirty(clipId)
    markClipBlocksDirty(second.id)
    if (partnerSecond) markClipBlocksDirty(partnerSecond.id)
    return second
  },

  selectClip(clipId: string | null, additive = false) {
    if (clipId === null) {
      selectedClipIds = []
      selectedChannelIds = []
      selectedEffectBlockIds = []
      selectedTextItemIds = []
      return
    }
    if (!additive) {
      selectedClipIds = [clipId]
      selectedChannelIds = []
      selectedEffectBlockIds = []
      selectedTextItemIds = []
      return
    }
    const index = selectedClipIds.indexOf(clipId)
    if (index >= 0) selectedClipIds.splice(index, 1)
    else selectedClipIds.push(clipId)
  },

  selectChannel(channelId: string | null, additive = false) {
    if (channelId === null || !channels.some((channel) => channel.id === channelId)) {
      selectedChannelIds = []
      return
    }
    if (!additive) {
      selectedChannelIds = [channelId]
      return
    }
    const index = selectedChannelIds.indexOf(channelId)
    if (index >= 0) selectedChannelIds.splice(index, 1)
    else selectedChannelIds.push(channelId)
  },

  selectClips(clipIds: string[], preserveEffects = false) {
    const existingIds = new Set(channels.flatMap((channel) => channel.clips.map((clip) => clip.id)))
    selectedClipIds = [...new Set(clipIds)].filter((id) => existingIds.has(id))
    selectedChannelIds = []
    if (!preserveEffects) {
      selectedEffectBlockIds = []
      selectedTextItemIds = []
    }
  },

  selectEffectBlock(blockId: string | null, additive = false) {
    if (blockId === null) {
      selectedEffectBlockIds = []
      return
    }
    if (!effectBlocks.some((block) => block.id === blockId)) return
    if (!additive) {
      selectedClipIds = []
      selectedChannelIds = []
      selectedEffectBlockIds = [blockId]
      selectedTextItemIds = []
      return
    }
    const index = selectedEffectBlockIds.indexOf(blockId)
    if (index >= 0) selectedEffectBlockIds.splice(index, 1)
    else selectedEffectBlockIds.push(blockId)
  },

  selectTextItem(itemId: string | null, additive = false) {
    if (itemId === null) {
      selectedTextItemIds = []
      return
    }
    if (!textItems.some((item) => item.id === itemId)) return
    if (!additive) {
      selectedClipIds = []
      selectedEffectBlockIds = []
      selectedChannelIds = []
      selectedTextItemIds = [itemId]
      return
    }
    const index = selectedTextItemIds.indexOf(itemId)
    if (index >= 0) selectedTextItemIds.splice(index, 1)
    else selectedTextItemIds.push(itemId)
  },

  selectItems(clipIds: string[], blockIds: string[], itemIds: string[] = []) {
    const existingClipIds = new Set(channels.flatMap((channel) => channel.clips.map((clip) => clip.id)))
    const existingBlockIds = new Set(effectBlocks.map((block) => block.id))
    const existingTextItemIds = new Set(textItems.map((item) => item.id))
    selectedClipIds = [...new Set(clipIds)].filter((id) => existingClipIds.has(id))
    selectedChannelIds = []
    selectedEffectBlockIds = [...new Set(blockIds)].filter((id) => existingBlockIds.has(id))
    selectedTextItemIds = [...new Set(itemIds)].filter((id) => existingTextItemIds.has(id))
  },

  clearSelection() {
    selectedClipIds = []
    selectedChannelIds = []
    selectedEffectBlockIds = []
    selectedTextItemIds = []
  },

  selectAllClips() {
    selectedClipIds = channels.flatMap((channel) => channel.clips.map((clip) => clip.id))
    selectedChannelIds = []
    selectedEffectBlockIds = []
    selectedTextItemIds = []
  },

  copySelectedClips(): boolean {
    const ids = expandLinkedClipIds(selectedClipIds)
    copiedClips = ids.flatMap((id) => {
      const found = findClipById(id)
      if (!found) return []
      const { id: _id, ...clip } = found.clip
      return [{ sourceId: id, channelId: found.channel.id, clip }]
    })
    const copiedClipIds = new Set(copiedClips.map((entry) => entry.sourceId))
    copiedTransitions = transitions.flatMap((transition) => (
      copiedClipIds.has(transition.leftClipId) && copiedClipIds.has(transition.rightClipId)
        ? [{
            channelId: transition.channelId,
            leftSourceId: transition.leftClipId,
            rightSourceId: transition.rightClipId,
            effectId: transition.effectId,
          }]
        : []
    ))
    const copiedEffectIds = new Set(selectedEffectBlockIds)
    for (const block of effectBlocks) {
      if (block.ownerClipId && copiedClipIds.has(block.ownerClipId)) copiedEffectIds.add(block.id)
    }
    copiedEffectBlocks = [...copiedEffectIds].flatMap((id) => {
      const block = effectBlocks.find((candidate) => candidate.id === id)
      if (!block) return []
      const { id: _id, nodeId: _nodeId, ...copied } = block
      return [{
        channelId: block.channelId,
        block: { ...copied, params: { ...copied.params }, ramp: copied.ramp ? { ...copied.ramp } : null },
      }]
    })
    copiedTextItems = selectedTextItemIds.flatMap((id) => {
      const item = textItems.find((candidate) => candidate.id === id)
      if (!item) return []
      const { id: _id, ...copied } = item
      return [{ item: { ...copied, words: copied.words.map((word) => ({ ...word })) } }]
    })
    return copiedClips.length > 0 || copiedEffectBlocks.length > 0 || copiedTextItems.length > 0
  },

  pasteCopiedClips(atTime = currentTime): Clip[] {
    if (copiedClips.length === 0 && copiedEffectBlocks.length === 0 && copiedTextItems.length === 0) return []
    const targetChannelIds = new Set([
      ...copiedClips.map((entry) => entry.channelId),
      ...copiedEffectBlocks.map((entry) => entry.channelId),
    ])
    const targetChannels = [...targetChannelIds].map((id) => channels.find((channel) => channel.id === id))
    if (targetChannels.some((channel) => !channel || channel.locked)) return []

    const sourceOrigin = Math.min(
      ...(copiedClips.length > 0 ? copiedClips.map((entry) => entry.clip.start) : []),
      ...(copiedEffectBlocks.length > 0 ? copiedEffectBlocks.map((entry) => entry.block.start) : []),
      ...(copiedTextItems.length > 0 ? copiedTextItems.map((entry) => entry.item.start) : []),
    )
    let pasteOrigin = Math.max(0, atTime)
    const EPS = 0.000001
    for (let attempt = 0; attempt < 1000; attempt++) {
      let nextOrigin = pasteOrigin
      for (const entry of copiedClips) {
        const channel = channels.find((candidate) => candidate.id === entry.channelId)!
        const relativeStart = entry.clip.start - sourceOrigin
        const targetStart = pasteOrigin + relativeStart
        const targetEnd = targetStart + clipTimelineDuration(entry.clip)
        for (const existing of channel.clips) {
          const existingEnd = clipEnd(existing)
          if (targetStart < existingEnd - EPS && targetEnd > existing.start + EPS) {
            nextOrigin = Math.max(nextOrigin, existingEnd - relativeStart)
          }
        }
      }
      if (nextOrigin <= pasteOrigin + EPS) break
      pasteOrigin = nextOrigin
    }

    for (const entry of copiedEffectBlocks) {
      const channel = channels.find((candidate) => candidate.id === entry.channelId)
      if (!channel || channel.type !== 'video') return []
    }

    const pasted: Clip[] = []
    const pastedBlocks: EffectBlock[] = []
    const pastedTextItems: TextItem[] = []
    const idMap = new Map<string, string>()
    // Group the whole paste (clips, transitions, effects, captions) into one
    // undo step so Ctrl+V / Ctrl+Z round-trips generated voice-to-text.
    this.beginHistory()
    try {
    for (const entry of copiedClips) {
      const { linkedClipId: _linkedClipId, ...clip } = entry.clip
      const added = this.addClip(entry.channelId, {
        ...clip,
        start: pasteOrigin + entry.clip.start - sourceOrigin,
      })
      pasted.push(added)
      idMap.set(entry.sourceId, added.id)
    }
    for (let i = 0; i < copiedClips.length; i++) {
      const copiedLinkedId = copiedClips[i].clip.linkedClipId
      const pastedLinkedId = copiedLinkedId ? idMap.get(copiedLinkedId) : undefined
      if (pastedLinkedId) findClipById(pasted[i].id)!.clip.linkedClipId = pastedLinkedId
    }
    if (copiedTransitions.length > 0) recordHistory()
    for (const copied of copiedTransitions) {
      const leftClipId = idMap.get(copied.leftSourceId)
      const rightClipId = idMap.get(copied.rightSourceId)
      const channel = channels.find((candidate) => candidate.id === copied.channelId)
      if (!leftClipId || !rightClipId || !channel) continue
      const left = channel.clips.find((clip) => clip.id === leftClipId)
      const right = channel.clips.find((clip) => clip.id === rightClipId)
      if (!left || !right || left.start >= right.start || clipEnd(left) <= right.start + 0.001) continue
      transitions.push({
        id: nextId('trans'),
        channelId: channel.id,
        leftClipId,
        rightClipId,
        effectId: copied.effectId,
      })
    }
    for (const entry of copiedEffectBlocks) {
      const added = this.addEffectBlock(
        entry.channelId,
        entry.block.effectId,
        pasteOrigin + entry.block.start - sourceOrigin,
        entry.block.duration,
        entry.block.params,
      )
      if (added) {
        added.ramp = entry.block.ramp ? { ...entry.block.ramp } : null
        const pastedOwnerId = entry.block.ownerClipId ? idMap.get(entry.block.ownerClipId) : undefined
        added.ownerClipId = pastedOwnerId
        added.clipLookId = pastedOwnerId ? entry.block.clipLookId : undefined
        pastedBlocks.push(added)
      }
    }
    for (const entry of copiedTextItems) {
      const added = this.addTextItem(pasteOrigin + entry.item.start - sourceOrigin, entry.item)
      pastedTextItems.push(added)
    }
    selectedClipIds = pasted.map((clip) => clip.id)
    selectedEffectBlockIds = pastedBlocks.map((block) => block.id)
    selectedTextItemIds = pastedTextItems.map((item) => item.id)
    } finally {
      this.endHistory()
    }
    return pasted
  },

  removeSelectedClips() {
    for (const clipId of [...selectedClipIds]) this.removeClipById(clipId)
    selectedClipIds = []
  },

  removeSelectedItems() {
    this.beginHistory()
    try {
      for (const clipId of [...selectedClipIds]) this.removeClipById(clipId)
      for (const blockId of [...selectedEffectBlockIds]) this.removeEffectBlock(blockId)
      for (const itemId of [...selectedTextItemIds]) this.removeTextItem(itemId)
      selectedClipIds = []
      selectedEffectBlockIds = []
      selectedTextItemIds = []
    } finally {
      this.endHistory()
    }
  },

  get effectBlocks() { return effectBlocks },

  get textItems() { return textItems },

  addTextItem(start: number, initial: Partial<Omit<TextItem, 'id' | 'start'>> = {}): TextItem {
    recordHistory()
    const design = textDesignSize(projectAspect ?? 'landscape')
    const item: TextItem = {
      id: nextId('text'),
      sourceClipId: initial.sourceClipId,
      start: Number.isFinite(start) ? Math.max(0, start) : 0,
      duration: Math.max(0.2, initial.duration ?? 3),
      text: initial.text ?? 'Your text',
      x: initial.x ?? design.w / 2,
      y: initial.y ?? design.h / 2,
      anchor: initial.anchor ?? 'center',
      fontFamily: initial.fontFamily ?? 'sans',
      fontSize: Math.max(8, initial.fontSize ?? 40),
      fontWeight: initial.fontWeight === 700 ? 700 : 400,
      italic: initial.italic ?? false,
      align: initial.align ?? 'center',
      color: initial.color ?? '#ffffff',
      strokeColor: initial.strokeColor ?? '#000000',
      strokeWidth: Math.max(0, initial.strokeWidth ?? 0),
      backgroundColor: initial.backgroundColor ?? '#000000',
      backgroundOpacity: Math.max(0, Math.min(1, initial.backgroundOpacity ?? 0)),
      backgroundPadding: Math.max(0, Math.min(200, initial.backgroundPadding ?? 18)),
      backgroundRadius: Math.max(0, Math.min(200, initial.backgroundRadius ?? 8)),
      bannerStyle: initial.bannerStyle ?? 'none',
      accentColor: initial.accentColor ?? '#7047c7',
      animation: initial.animation ?? 'none',
      animationDuration: Math.max(0.1, Math.min(2, initial.animationDuration ?? 0.45)),
      opacity: Math.max(0, Math.min(1, initial.opacity ?? 1)),
      rotation: initial.rotation ?? 0,
      isCaption: initial.isCaption ?? false,
      highlightMode: initial.highlightMode ?? 'none',
      highlightColor: initial.highlightColor ?? '#fff36d',
      highlightBackgroundColor: initial.highlightBackgroundColor ?? '#000000',
      highlightBackgroundOpacity: Math.max(0, Math.min(1, initial.highlightBackgroundOpacity ?? 0)),
      highlightAnimation: initial.highlightAnimation ?? 'pop',
      words: (initial.words ?? []).flatMap((word) => {
        const text = word.text.trim()
        const wordStart = Math.max(0, word.start)
        const wordEnd = Math.min(Math.max(0.001, initial.duration ?? 3), word.end)
        return text && Number.isFinite(wordStart) && Number.isFinite(wordEnd) && wordEnd > wordStart
          ? [{ text, start: wordStart, end: wordEnd }]
          : []
      }),
    }
    textItems.push(item)
    return item
  },

  updateTextItem(itemId: string, updates: Partial<Omit<TextItem, 'id'>>) {
    const item = textItems.find((candidate) => candidate.id === itemId)
    if (!item) return
    recordHistory()
    if (updates.sourceClipId !== undefined) item.sourceClipId = updates.sourceClipId
    if (updates.start !== undefined) item.start = Math.max(0, updates.start)
    if (updates.duration !== undefined) {
      const duration = Math.max(0.2, updates.duration)
      item.words = scaleTextWords(item.words, item.duration, duration)
      item.duration = duration
    }
    if (updates.text !== undefined) {
      item.text = updates.text
      if (item.isCaption) {
        item.words = retimeTextWords(item.text, item.words)
        if (item.words.length === 0) item.highlightMode = 'none'
      }
    }
    const design = textDesignSize(projectAspect ?? 'landscape')
    if (updates.x !== undefined) item.x = Math.max(0, Math.min(design.w, updates.x))
    if (updates.y !== undefined) item.y = Math.max(0, Math.min(design.h, updates.y))
    if (updates.anchor !== undefined) item.anchor = updates.anchor
    if (updates.fontFamily !== undefined) item.fontFamily = updates.fontFamily
    if (updates.fontSize !== undefined) item.fontSize = Math.max(8, Math.min(600, updates.fontSize))
    if (updates.fontWeight !== undefined) item.fontWeight = updates.fontWeight === 700 ? 700 : 400
    if (updates.italic !== undefined) item.italic = updates.italic
    if (updates.align !== undefined) item.align = updates.align
    if (updates.color !== undefined) item.color = updates.color
    if (updates.strokeColor !== undefined) item.strokeColor = updates.strokeColor
    if (updates.strokeWidth !== undefined) item.strokeWidth = Math.max(0, Math.min(40, updates.strokeWidth))
    if (updates.backgroundColor !== undefined) item.backgroundColor = updates.backgroundColor
    if (updates.backgroundOpacity !== undefined) item.backgroundOpacity = Math.max(0, Math.min(1, updates.backgroundOpacity))
    if (updates.backgroundPadding !== undefined) item.backgroundPadding = Math.max(0, Math.min(200, updates.backgroundPadding))
    if (updates.backgroundRadius !== undefined) item.backgroundRadius = Math.max(0, Math.min(200, updates.backgroundRadius))
    if (updates.bannerStyle !== undefined) item.bannerStyle = updates.bannerStyle
    if (updates.accentColor !== undefined) item.accentColor = updates.accentColor
    if (updates.animation !== undefined) item.animation = updates.animation
    if (updates.animationDuration !== undefined) item.animationDuration = Math.max(0.1, Math.min(2, updates.animationDuration))
    if (updates.opacity !== undefined) item.opacity = Math.max(0, Math.min(1, updates.opacity))
    if (updates.rotation !== undefined) item.rotation = Math.max(-180, Math.min(180, updates.rotation))
    if (updates.isCaption !== undefined) item.isCaption = updates.isCaption
    if (updates.highlightMode !== undefined) item.highlightMode = updates.highlightMode
    if (updates.highlightColor !== undefined) item.highlightColor = updates.highlightColor
    if (updates.highlightBackgroundColor !== undefined) item.highlightBackgroundColor = updates.highlightBackgroundColor
    if (updates.highlightBackgroundOpacity !== undefined) item.highlightBackgroundOpacity = Math.max(0, Math.min(1, updates.highlightBackgroundOpacity))
    if (updates.highlightAnimation !== undefined) item.highlightAnimation = updates.highlightAnimation
    if (updates.words !== undefined) {
      item.words = updates.words.flatMap((word) => {
        const text = word.text.trim()
        const wordStart = Math.max(0, word.start)
        const wordEnd = Math.min(item.duration, word.end)
        return text && Number.isFinite(wordStart) && Number.isFinite(wordEnd) && wordEnd > wordStart
          ? [{ text, start: wordStart, end: wordEnd }]
          : []
      })
    }
  },

  removeTextItem(itemId: string) {
    const index = textItems.findIndex((item) => item.id === itemId)
    if (index < 0) return
    recordHistory()
    textItems.splice(index, 1)
    selectedTextItemIds = selectedTextItemIds.filter((id) => id !== itemId)
  },

  moveTextItems(itemIds: string[], deltaSec: number): number {
    const items = [...new Set(itemIds)]
      .map((id) => textItems.find((item) => item.id === id))
      .filter((item): item is TextItem => item !== undefined)
    if (items.length === 0) return 0
    const appliedDelta = Math.max(deltaSec, ...items.map((item) => -item.start))
    if (Math.abs(appliedDelta) <= 1e-9) return 0
    recordHistory()
    for (const item of items) item.start += appliedDelta
    return appliedDelta
  },

  resizeTextItem(itemId: string, duration: number) {
    const item = textItems.find((candidate) => candidate.id === itemId)
    if (!item) return
    const nextDuration = Math.max(0.2, duration)
    if (Math.abs(nextDuration - item.duration) <= 1e-9) return
    recordHistory()
    item.words = scaleTextWords(item.words, item.duration, nextDuration)
    item.duration = nextDuration
  },

  addEffectBlock(
    channelId: string,
    effectId: string,
    start: number,
    duration = 2,
    initialParams: Readonly<EffectParams> = defaultEffectParams(effectId),
  ): EffectBlock | null {
    const ch = channels.find((c) => c.id === channelId)
    if (!ch || ch.type !== 'video') return null
    recordHistory()
    const block: EffectBlock = {
      id: nextId('fx'),
      channelId,
      effectId,
      params: normalizeEffectParams(effectId, initialParams),
      ramp: null,
      start: Math.max(0, start),
      duration: Math.max(0.2, duration),
      nodeId: null,
    }
    effectBlocks.push(block)
    return block
  },

  removeEffectBlock(blockId: string) {
    const idx = effectBlocks.findIndex((b) => b.id === blockId)
    if (idx >= 0) {
      recordHistory()
      effectBlocks.splice(idx, 1)
      selectedEffectBlockIds = selectedEffectBlockIds.filter((id) => id !== blockId)
    }
  },

  moveEffectBlock(blockId: string, newStart: number) {
    const b = effectBlocks.find((x) => x.id === blockId)
    if (!b) return
    const start = Math.max(0, newStart)
    if (Math.abs(start - b.start) <= 1e-9) return
    recordHistory()
    b.start = start
    b.nodeId = null
    refreshEffectOwnership(b)
  },

  anchorEffectBlock(blockId: string, time: number): boolean {
    const b = effectBlocks.find((x) => x.id === blockId)
    const ch = b ? channels.find((candidate) => candidate.id === b.channelId) : undefined
    if (!b || !ch) return false
    if (!b.clipLookId) {
      const overlapping = ch.clips.filter((clip) => b.start < clipEnd(clip) && b.start + b.duration > clip.start)
      if (overlapping.length >= 2) {
        if (!b.ownerClipId) return false
        recordHistory()
        b.ownerClipId = undefined
        b.nodeId = null
        return true
      }
    }
    const owner = [...ch.clips].reverse().find((clip) => time >= clip.start && time < clipEnd(clip))
    if (!owner) {
      if (!b.ownerClipId || b.clipLookId !== undefined) return false
      recordHistory()
      b.ownerClipId = undefined
      b.nodeId = null
      return true
    }
    if (b.ownerClipId === owner.id) return false
    recordHistory()
    b.ownerClipId = owner.id
    b.nodeId = null
    return true
  },

  moveEffectBlocks(blockIds: string[], deltaSec: number): number {
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
    if (blocks.length === 0 || blocks.some((block) => {
      const channel = channels.find((candidate) => candidate.id === block.channelId)
      return !channel || channel.locked
    })) return 0

    const appliedDelta = Math.max(deltaSec, ...blocks.map((block) => -block.start))
    if (Math.abs(appliedDelta) <= 1e-9) return 0
    recordHistory()
    for (const block of blocks) {
      block.start += appliedDelta
      block.nodeId = null
      refreshEffectOwnership(block)
    }
    return appliedDelta
  },

  moveEffectBlocksToChannel(blockIds: string[], targetChannelId: string): boolean {
    const target = channels.find((channel) => channel.id === targetChannelId)
    if (!target || target.type !== 'video' || target.locked) return false
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
    if (blocks.length === 0 || blocks.some((block) => {
      const source = channels.find((channel) => channel.id === block.channelId)
      return !source || source.locked
    })) return false
    if (blocks.every((block) => block.channelId === targetChannelId)) return true

    recordHistory()
    for (const block of blocks) {
      block.channelId = targetChannelId
      if (block.ownerClipId && !target.clips.some((clip) => clip.id === block.ownerClipId)) {
        block.ownerClipId = undefined
      }
      block.nodeId = null
    }
    return true
  },

  resizeEffectBlock(blockId: string, newDuration: number) {
    const b = effectBlocks.find((x) => x.id === blockId)
    if (!b) return
    const duration = Math.max(0.2, newDuration)
    if (Math.abs(duration - b.duration) <= 1e-9) return
    recordHistory()
    b.duration = duration
    b.nodeId = null
    refreshEffectOwnership(b)
  },

  resizeEffectBlockRange(blockId: string, newStart: number, newDuration: number) {
    const b = effectBlocks.find((x) => x.id === blockId)
    if (!b) return
    const start = Math.max(0, newStart)
    const duration = Math.max(0.2, newDuration)
    if (Math.abs(start - b.start) <= 1e-9 && Math.abs(duration - b.duration) <= 1e-9) return
    recordHistory()
    b.start = start
    b.duration = duration
    b.nodeId = null
    refreshEffectOwnership(b)
  },

  resizeEffectBlocks(blockIds: string[], newDuration: number): boolean {
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
    if (blocks.length === 0 || blocks.some((block) => {
      const channel = channels.find((candidate) => candidate.id === block.channelId)
      return !channel || channel.locked
    })) return false

    const duration = Math.max(0.2, newDuration)
    if (blocks.every((block) => Math.abs(block.duration - duration) <= 1e-9)) return true
    recordHistory()
    for (const block of blocks) {
      block.duration = duration
      block.nodeId = null
      refreshEffectOwnership(block)
    }
    return true
  },

  setEffectParameter(blockIds: string[], key: string, value: number): boolean {
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
    if (blocks.length === 0 || blocks.some((block) => {
      const channel = channels.find((candidate) => candidate.id === block.channelId)
      return !channel || channel.locked
    })) return false

    const updates = blocks.map((block) => ({
      block,
      params: normalizeEffectParams(block.effectId, { ...block.params, [key]: value }),
    })).filter(({ block, params }) => JSON.stringify(params) !== JSON.stringify(block.params))
    if (updates.length === 0) return true

    recordHistory()
    for (const update of updates) {
      update.block.params = update.params
      update.block.nodeId = null
    }
    return true
  },

  resetEffectParameters(blockIds: string[]): boolean {
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
    if (blocks.length === 0 || blocks.some((block) => {
      const channel = channels.find((candidate) => candidate.id === block.channelId)
      return !channel || channel.locked
    })) return false

    const updates = blocks.map((block) => ({ block, params: defaultEffectParams(block.effectId) }))
      .filter(({ block, params }) => JSON.stringify(params) !== JSON.stringify(block.params))
    if (updates.length === 0) return true

    recordHistory()
    for (const update of updates) {
      update.block.params = update.params
      update.block.nodeId = null
    }
    return true
  },

  setEffectRamp(blockIds: string[], ramp: EffectRamp | null): boolean {
    const blocks = [...new Set(blockIds)]
      .map((id) => effectBlocks.find((block) => block.id === id))
      .filter((block): block is EffectBlock => block !== undefined)
    if (blocks.length === 0 || blocks.some((block) => {
      const channel = channels.find((candidate) => candidate.id === block.channelId)
      return !channel || channel.locked
    })) return false

    const next = normalizeRamp(ramp)
    const updates = blocks.filter((block) => (
      JSON.stringify(normalizeRamp(block.ramp)) !== JSON.stringify(next)
    ))
    if (updates.length === 0) return true

    recordHistory()
    for (const block of updates) {
      block.ramp = next ? { ...next } : null
      block.nodeId = null
    }
    return true
  },

  setEffectBlockNode(blockId: string, nodeId: string | null) {
    const b = effectBlocks.find((x) => x.id === blockId)
    if (b) b.nodeId = nodeId
  },

  getEffectBlocksForChannel(channelId: string): EffectBlock[] {
    return effectBlocks.filter((b) => b.channelId === channelId)
  },

  get transitions() { return transitions },

  addTransition(channelId: string, leftClipId: string, rightClipId: string, effectId: string, duration = 1): Transition | null {
    const ch = channels.find((c) => c.id === channelId)
    if (!ch || ch.locked || ch.type !== 'video') return null
    const left = ch.clips.find((c) => c.id === leftClipId)
    const right = ch.clips.find((c) => c.id === rightClipId)
    if (!left || !right) return null
    const leftLen = clipTimelineDuration(left)
    const rightLen = clipTimelineDuration(right)
    const leftEnd = clipEnd(left)
    // Must be a junction: overlapping or touching, left strictly before right.
    if (leftEnd < right.start - 0.05 || left.start >= right.start) return null

    const want = Math.min(duration, maxClipTransitionOverlap(left, right, leftLen, rightLen))
    const overlapNow = leftEnd - right.start
    if (overlapNow < want - 0.001) {
      let need = want - Math.max(0, overlapNow)
      const lBefore = clipEnd(left)
      this.trimClip(left.id, 'right', need / 2)
      need -= clipEnd(left) - lBefore
      if (need > 0.001) {
        const rBefore = right.start
        this.trimClip(right.id, 'left', -need)
        need -= rBefore - right.start
      }
      if (need > 0.001) {
        this.moveClip(channelId, right.id, right.start - need)
      }
    }
    const appliedOverlap = clipEnd(left) - right.start
    if (appliedOverlap > want + 0.001) {
      this.moveClip(channelId, right.id, clipEnd(left) - want)
    }

    const existing = transitions.find((t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId)
    if (existing) {
      recordHistory()
      existing.effectId = effectId
      return existing
    }
    recordHistory()
    const t: Transition = { id: nextId('trans'), channelId, leftClipId, rightClipId, effectId }
    transitions.push(t)
    return t
  },

  addTransitionToSelection(effectId: string, duration = 1): Transition[] {
    const selected = new Set(selectedClipIds)
    const pairs: Array<{ channelId: string; leftClipId: string; rightClipId: string }> = []
    for (const channel of channels) {
      if (channel.type !== 'video') continue
      const clips = [...channel.clips].sort((a, b) => a.start - b.start)
      for (let i = 0; i < clips.length - 1; i++) {
        const left = clips[i]
        const right = clips[i + 1]
        if (selected.has(left.id) && selected.has(right.id)) {
          pairs.push({ channelId: channel.id, leftClipId: left.id, rightClipId: right.id })
        }
      }
    }

    const applied: Transition[] = []
    this.beginHistory()
    try {
      for (const pair of pairs) {
        const transition = this.addTransition(
          pair.channelId,
          pair.leftClipId,
          pair.rightClipId,
          effectId,
          duration,
        )
        if (transition) applied.push(transition)
      }
    } finally {
      this.endHistory()
    }
    return applied
  },

  removeTransition(transitionId: string) {
    const idx = transitions.findIndex((t) => t.id === transitionId)
    if (idx >= 0) { recordHistory(); transitions.splice(idx, 1) }
  },

  getTransitionBetween(leftClipId: string, rightClipId: string): Transition | undefined {
    return transitions.find((t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId)
  },

  getTransitionsForChannel(channelId: string): Transition[] {
    return transitions.filter((t) => t.channelId === channelId)
  },

  getActiveClipsAt(time: number): { channel: Channel; clip: Clip }[] {
    const result: { channel: Channel; clip: Clip }[] = []
    for (const ch of channels) {
      if (ch.hidden) continue
      for (const clip of ch.clips) {
        const end = clipEnd(clip)
        if (time >= clip.start && time < end) {
          result.push({ channel: ch, clip })
        }
      }
    }
    return result
  },

  getActiveTextItemsAt(time: number): TextItem[] {
    return activeTimedItems(textTimeIndex, time)
  },

  getClipById(clipId: string): { channel: Channel; clip: Clip } | null {
    return findClipById(clipId)
  },

  getClipOverlap(channelId: string, clip: Clip): { left: number; right: number } {
    const ch = channels.find((c) => c.id === channelId)
    if (!ch) return { left: 0, right: 0 }
    const detachedIds = clipDragPreviewDetached ? new Set(clipDragPreviewIds) : null
    return clipOverlapInChannel(ch, clip, detachedIds)
  },

  getClipOverlaps(channelId: string): Map<string, { left: number; right: number }> {
    const ch = channels.find((c) => c.id === channelId)
    if (!ch) return new Map()
    const detachedIds = clipDragPreviewDetached ? new Set(clipDragPreviewIds) : null
    return clipOverlapsInChannel(ch, detachedIds)
  },

  removeClipById(clipId: string) {
    const found = findClipById(clipId)
    if (found) removeLocatedClip(found)
  },
}
