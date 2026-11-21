// Effect blocks are composited in insertion order: later blocks render on top.
// The timeline is split at effect boundaries, and every child node consumes its
// parent's output. Preview selects the deepest ready node for a source time.
// The original scrub remains unchanged throughout this process.

import {
  renderSegment,
  renderTransition,
  renderAudioTransition,
  getFFmpeg,
  type RenderTransitionSegment,
} from '../lib/wasm'
import {
  buildFilter,
  effectParamsKey,
  xfadeName,
  type EffectParams,
  type RampTiming,
} from '../lib/effects'
import { isPixiPreviewEffect } from '../lib/effects-pixi'
import {
  clipEnd,
  clipPlaybackRate,
  clipSourceTimeAt,
  clipTimelineDuration,
  editor,
  type EffectBlock,
  type Clip,
} from './editor.svelte'
import { blockOverlapsClip, computeEffectRegions, flattenEffectRegions, mergeFlatSegments, type EffectRegion, type FlatSegment } from '../lib/render-segments'
import { useWasmLoader } from '../composables/useWasmLoader.svelte'
export type { FlatSegment } from '../lib/render-segments'

export type NodeState = 'queued' | 'rendering' | 'ready' | 'error'

export interface EffectNode {
  id: string
  blockId: string
  clipId: string
  parentId: string | null
  // Absolute seconds in the original scrub video.
  srcStart: number
  srcEnd: number
  // Included in node identity because root output has this speed baked in.
  playbackRate: number
  effectId: string
  params: EffectParams
  // Intensity-ramp timing relative to the whole block; null = constant.
  ramp: RampTiming | null
  outputBlobUrl: string | null
  outputBlob?: Blob | null
  state: NodeState
  errorMsg?: string
  // Creation order; higher = newer = wins ties.
  seq: number
}

// A rendered clip-overlap: the region where two clips on the same channel
// overlap is a transition, rendered through ffmpeg-wasm (xfade for video
// channels, acrossfade for audio channels) so the preview matches the server
// compile exactly.
export interface TransitionNode {
  id: string
  channelId: string
  leftClipId: string
  rightClipId: string
  // Timeline overlap region [start, end).
  start: number
  end: number
  // Source time in the left clip where its transition tail begins.
  srcA: number
  // Source time in the right clip where its transition head begins.
  srcB: number
  playbackRateA: number
  playbackRateB: number
  // xfade transition name (video channels); unused for audio.
  xfade: string
  isAudio: boolean
  // Includes source, effect-stack, transform, aspect, and frame-rate state.
  signature: string
  outputBlobUrl: string | null
  outputBlob?: Blob | null
  state: NodeState
  errorMsg?: string
}

type RenderNode = EffectNode | TransitionNode

let nodes = $state<EffectNode[]>([])
let transitionNodes = $state<TransitionNode[]>([])
let queue = $state<string[]>([])
let processing = $state(false)
const wasm = useWasmLoader(getFFmpeg, (ratio, message) => {
  if (!renderingForPlayback) return
  renderProgressMsg = message
  renderProgressRatio = ratio
})

// Playback-preparation state (drives the "Please wait" overlay).
let renderingForPlayback = $state(false)
let renderProgressVisible = $state(false)
let renderProgressMsg = $state('')
let renderProgressRatio = $state(0)
let renderError = $state('')
let renderProgressTotal = $state(0)
let renderProgressCompleted = $state(0)
let renderProgressCurrent = $state(0)
let renderProgressTimer: ReturnType<typeof setTimeout> | null = null
let deferPump = false

const RENDER_PROGRESS_DELAY_MS = 300

let seqCounter = 0
let idCounter = 0

function nextId(): string {
  idCounter += 1
  return `node_${idCounter}_${Math.random().toString(36).slice(2, 6)}`
}

function getNode(id: string): EffectNode | undefined {
  return nodes.find((n) => n.id === id)
}

function descendantsOf(id: string): EffectNode[] {
  const out: EffectNode[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of nodes) {
      if (n.parentId === cur) {
        out.push(n)
        stack.push(n.id)
      }
    }
  }
  return out
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function clearRenderProgressTimer() {
  if (renderProgressTimer !== null) {
    clearTimeout(renderProgressTimer)
    renderProgressTimer = null
  }
}

function beginPlaybackProgress() {
  clearRenderProgressTimer()
  renderProgressVisible = false
  renderProgressTimer = setTimeout(() => {
    renderProgressVisible = true
    renderProgressTimer = null
  }, RENDER_PROGRESS_DELAY_MS)
}

function resetPlaybackProgress() {
  clearRenderProgressTimer()
  renderProgressVisible = false
  renderProgressMsg = ''
  renderProgressRatio = 0
  renderProgressTotal = 0
  renderProgressCompleted = 0
  renderProgressCurrent = 0
}

function setRenderProgressJobs(ids: string[]) {
  const uniqueIds = [...new Set(ids)]
  const pendingIds = uniqueIds.filter((id) => {
    const node = getNode(id) ?? getTransitionNode(id)
    return node?.state !== 'ready'
  })
  renderProgressTotal = pendingIds.length
  renderProgressCompleted = 0
  renderProgressCurrent = 0
  renderProgressRatio = pendingIds.length > 0 ? 0 : 1
}

function beginRenderJob(message: string) {
  renderProgressCurrent = 0
  renderProgressMsg = message
  renderProgressRatio = renderProgressTotal > 0
    ? renderProgressCompleted / renderProgressTotal
    : 0
}

function updateRenderJobProgress(ratio: number, message: string) {
  renderProgressCurrent = Math.max(0, Math.min(1, ratio))
  renderProgressMsg = message
  renderProgressRatio = renderProgressTotal > 0
    ? (renderProgressCompleted + renderProgressCurrent) / renderProgressTotal
    : renderProgressCurrent
}

function completeRenderJob() {
  if (renderProgressTotal <= 0) return
  renderProgressCompleted = Math.min(renderProgressTotal, renderProgressCompleted + 1)
  renderProgressCurrent = 0
  renderProgressRatio = renderProgressCompleted / renderProgressTotal
}

function revokeOutput(node: RenderNode) {
  if (node.outputBlobUrl) {
    const blobUrl = node.outputBlobUrl
    node.outputBlobUrl = null
    // Let reactive preview consumers detach their media elements first.
    setTimeout(() => {
      try { URL.revokeObjectURL(blobUrl) } catch {}
    }, 0)
  }
  node.outputBlob = null
}

function depthOf(n: EffectNode): number {
  let d = 0
  let cur: EffectNode | undefined = n
  while (cur && cur.parentId) {
    cur = getNode(cur.parentId)
    if (!cur) break
    d += 1
  }
  return d
}

// The deepest ready node is the top layer and includes every effect below it.
function findTopNodeAtStack(clipId: string, srcTime: number, readyOnly: boolean): EffectNode | null {
  const clip = editor.getClipById(clipId)?.clip
  const playbackRate = clip ? clipPlaybackRate(clip) : null
  let best: EffectNode | null = null
  let bestDepth = -1
  for (const n of nodes) {
    if (n.clipId !== clipId) continue
    if (readyOnly && (n.state !== 'ready' || !n.outputBlobUrl)) continue
    if (playbackRate !== null && Math.abs(n.playbackRate - playbackRate) >= EPS) continue
    if (srcTime < n.srcStart || srcTime >= n.srcEnd) continue
    const d = depthOf(n)
    if (d > bestDepth || (d === bestDepth && best && n.seq > best.seq)) {
      best = n
      bestDepth = d
    }
  }
  return best
}

export function getTopNodeAtStack(clipId: string, srcTime: number): EffectNode | null {
  return findTopNodeAtStack(clipId, srcTime, true)
}

export function getNodesForClip(clipId: string): EffectNode[] {
  return nodes.filter((n) => n.clipId === clipId)
}

function computeSegments(clipId: string): EffectRegion[] {
  const found = editor.getClipById(clipId)
  return found ? computeEffectRegions(found.clip, found.channel.id, editor.effectBlocks) : []
}

// Resolve the stack for a clip into a flat, non-overlapping segment list with
// comma-joined filter chains. Used by the server compile route.
export function flatten(clipId: string): FlatSegment[] {
  const clip = editor.getClipById(clipId)?.clip
  if (!clip) return []
  const regions = computeSegments(clipId)
  if (regions.length === 0) return []

  const segments = flattenEffectRegions(clip, regions).map(segment => {
    if (segment.effects.length === 0) return segment
    const top = getTopNodeAtStack(clipId, (segment.srcStart + segment.srcEnd) / 2)
    return { ...segment, effectId: top?.effectId ?? segment.effectId, nodeId: top?.id ?? null }
  })
  return mergeFlatSegments(segments)
}


export const PIXI_LIVE_NODE_PREFIX = 'pixi-live:'

export function pixiLiveNodeId(blockId: string): string {
  return `${PIXI_LIVE_NODE_PREFIX}${blockId}`
}

export function isPixiLiveNodeId(nodeId: string | null | undefined): boolean {
  return typeof nodeId === 'string' && nodeId.startsWith(PIXI_LIVE_NODE_PREFIX)
}

function markPixiBlocksReady(): void {
  for (const block of editor.effectBlocks) {
    if (!isPixiPreviewEffect(block.effectId)) continue
    if (block.nodeId !== pixiLiveNodeId(block.id)) {
      editor.setEffectBlockNode(block.id, pixiLiveNodeId(block.id))
    }
  }
}

function pruneVideoNodes(): void {
  for (const n of nodes) revokeOutput(n)
  if (nodes.length > 0) {
    nodes = []
    queue = queue.filter((id) => getTransitionNode(id) !== undefined)
  }
  // All transitions are live (video in Pixi, audio as WebAudio crossfade):
  // drop any prerendered transition nodes left from older sessions.
  for (const n of transitionNodes) revokeOutput(n)
  if (transitionNodes.length > 0) {
    transitionNodes = []
    queue = queue.filter((id) => getNode(id) !== undefined)
  }
}

// --- node creation / reuse ---

const EPS = 0.01

// Find an existing node matching (clip, block, range, effect, parent) so
// unchanged regions are reused instead of re-rendered. A region whose layer
// chain is unchanged reuses every node and triggers zero ffmpeg work.
function upsertNode(
  clipId: string,
  blockId: string,
  srcStart: number,
  srcEnd: number,
  playbackRate: number,
  effectId: string,
  params: EffectParams,
  ramp: RampTiming | null,
  parentId: string | null,
): EffectNode {
  const paramsKey = effectParamsKey(effectId, params)
  const rampKey = JSON.stringify(ramp ?? null)
  const existing = nodes.find(
    (node) => {
      return (
        node.clipId === clipId &&
        node.blockId === blockId &&
        Math.abs(node.srcStart - srcStart) < EPS &&
        Math.abs(node.srcEnd - srcEnd) < EPS &&
        Math.abs(node.playbackRate - playbackRate) < EPS &&
        node.effectId === effectId &&
        effectParamsKey(node.effectId, node.params) === paramsKey &&
        JSON.stringify(node.ramp ?? null) === rampKey &&
        (node.parentId ?? null) === (parentId ?? null)
      )
    },
  )
  if (existing) {
    existing.ramp = ramp ? { ...ramp } : null
    if (existing.state === 'error' || existing.state === 'queued') {
      existing.state = 'queued'
      existing.errorMsg = undefined
      enqueue(existing.id)
    } else if (existing.state === 'rendering' && !processing) {
      // A 'rendering' node while the pump is idle is wedged (its exec never
      // settled); requeue it instead of letting waitForNodes time out.
      existing.state = 'queued'
      existing.errorMsg = undefined
      enqueue(existing.id)
    }
    return existing
  }

  const node: EffectNode = {
    id: nextId(),
    blockId,
    clipId,
    parentId,
    srcStart,
    srcEnd,
    playbackRate,
    effectId,
    params: { ...params },
    ramp: ramp ? { ...ramp } : null,
    outputBlobUrl: null,
    state: 'queued',
    seq: ++seqCounter,
  }
  nodes.push(node)
  enqueue(node.id)
  return node
}

// Build (or refresh) the per-region node chains for a clip. Returns the kept
// node ids. Unchanged layers are reused; changed/orphan nodes are dropped.
function buildStackForClip(clipId: string): string[] {
  const clip = editor.getClipById(clipId)?.clip
  if (!clip) return []
  const self = editor.getClipById(clipId)
  if (self) {
    for (const b of editor.effectBlocks) {
      if (!blockOverlapsClip(b, self.channel.id, self.clip)) continue
      if (isPixiPreviewEffect(b.effectId) && b.nodeId !== pixiLiveNodeId(b.id)) {
        editor.setEffectBlockNode(b.id, pixiLiveNodeId(b.id))
      }
    }
  }
  const playbackRate = clipPlaybackRate(clip)
  const regions = computeSegments(clipId)
  const kept = new Set<string>()
  const repNode = new Map<string, string>()

  for (const r of regions) {
    let parentId: string | null = null
    for (const item of r.stack) {
      if (isPixiPreviewEffect(item.effectId)) continue
      const node = upsertNode(
        clipId,
        item.blockId,
        r.start,
        r.end,
        playbackRate,
        item.effectId,
        item.params,
        item.ramp,
        parentId,
      )
      kept.add(node.id)
      repNode.set(item.blockId, node.id)
      parentId = node.id
    }
  }

  // Drop orphan nodes for this clip (ranges that changed / blocks removed).
  for (const n of nodes.filter((x) => x.clipId === clipId && !kept.has(x.id))) {
    revokeOutput(n)
  }
  nodes = nodes.filter((n) => !(n.clipId === clipId && !kept.has(n.id)))
  queue = queue.filter((id) => {
    const n = getNode(id)
    return !(n && n.clipId === clipId && !kept.has(n.id))
  })

  // Point each block at a representative node so the UI's nonRendered state reflects
  // reality; degenerate blocks (zero range after clamping) stay nonRendered.
  const clipBlockIds = new Set(
    editor.effectBlocks
      .filter((b) => (self ? blockOverlapsClip(b, self.channel.id, self.clip) : false))
      .filter((b) => !isPixiPreviewEffect(b.effectId))
      .map((b) => b.id),
  )
  for (const blockId of clipBlockIds) {
    editor.setEffectBlockNode(blockId, repNode.get(blockId) ?? null)
  }

  return [...kept]
}

function enqueue(id: string) {
  if (!queue.includes(id)) queue.push(id)
  if (deferPump) return
  // Fire-and-forget: pump() is async; without .catch an escape from the loop
  // body would surface as an unhandled rejection and silently stall the queue.
  void pump().catch((err) => console.error('render pump failed', err))
}

// --- transition nodes (clip overlaps rendered as xfade/acrossfade) ---

function getTransitionNode(id: string): TransitionNode | undefined {
  return transitionNodes.find((n) => n.id === id)
}

function clipTransitionSignature(clip: Clip, start: number, end: number): object {
  const sourceStart = clipSourceTimeAt(clip, start)
  const sourceEnd = clipSourceTimeAt(clip, end)
  const regions = computeSegments(clip.id)
    .filter((region) => region.start < sourceEnd - EPS && region.end > sourceStart + EPS)
    .map((region) => ({
      start: Math.max(sourceStart, region.start),
      end: Math.min(sourceEnd, region.end),
      stack: region.stack.map((item) => ({
        effectId: item.effectId,
        params: effectParamsKey(item.effectId, item.params),
        ramp: item.ramp,
      })),
    }))
  return {
    scrubBlobUrl: clip.scrubBlobUrl,
    fileName: clip.fileName,
    mediaKind: clip.mediaKind,
    sourceStart,
    sourceEnd,
    transform: clip.transform ?? null,
    transformKeyframes: clip.transformKeyframes ?? [],
    regions,
  }
}

function overlapSignature(
  left: Clip,
  right: Clip,
  start: number,
  end: number,
  xfade: string,
  isAudio: boolean,
): string {
  if (isAudio) {
    return JSON.stringify({
      left: left.scrubBlobUrl,
      right: right.scrubBlobUrl,
      sourceA: clipSourceTimeAt(left, start),
      sourceB: clipSourceTimeAt(right, start),
    })
  }
  return JSON.stringify({
    aspect: editor.effectiveProjectAspect,
    fit: editor.videoFit,
    fps: editor.fps,
    xfade,
    left: clipTransitionSignature(left, start, end),
    right: clipTransitionSignature(right, start, end),
  })
}

// Side-effect-free check: true when any effect would need wasm work on Play.
// Both video (Pixi) and audio (live WebAudio crossfade) transitions are live,
// so preview never loads the wasm core. Lets prepareForPlayback skip loading
// the core entirely when there is nothing to render.
function hasPendingWork(): boolean {
  return getNonRenderedClips().size > 0
}

// Preview transitions are fully live (video in Pixi, audio as a WebAudio
// crossfade matching the ffmpeg acrossfade export), so no transition nodes
// are built. Any legacy nodes are revoked. Returns the ids of all live nodes.
function buildTransitions(): string[] {
  for (const n of transitionNodes) revokeOutput(n)
  if (transitionNodes.length > 0) transitionNodes = []
  queue = queue.filter((id) => getNode(id) !== undefined)
  return []
}

// Ready transition node covering `time` on `channelId`, validated against the
// live timeline so a stale render (clips moved since) never shows up.
export function getTransitionAt(channelId: string, time: number): TransitionNode | null {
  for (const n of transitionNodes) {
    if (n.channelId !== channelId || n.state !== 'ready' || !n.outputBlobUrl) continue
    if (time < n.start || time >= n.end) continue
    const left = editor.getClipById(n.leftClipId)?.clip
    const right = editor.getClipById(n.rightClipId)?.clip
    if (!left || !right) continue
    const leftEnd = clipEnd(left)
    const transition = n.isAudio ? undefined : editor.getTransitionBetween(left.id, right.id)
    const currentXfade = xfadeName(transition?.effectId)
    if (
      Math.abs(right.start - n.start) > EPS ||
      Math.abs(leftEnd - n.end) > EPS ||
      Math.abs(clipPlaybackRate(left) - n.playbackRateA) > EPS ||
      Math.abs(clipPlaybackRate(right) - n.playbackRateB) > EPS ||
      currentXfade !== n.xfade ||
      overlapSignature(left, right, n.start, n.end, currentXfade, n.isAudio) !== n.signature
    ) continue
    return n
  }
  return null
}

// Node state for a junction, used by the timeline UI to show pending renders.
export function getTransitionNodeFor(leftClipId: string, rightClipId: string): TransitionNode | null {
  return transitionNodes.find((n) => n.leftClipId === leftClipId && n.rightClipId === rightClipId) ?? null
}

interface TransitionSegments {
  segments: RenderTransitionSegment[]
  pending: EffectNode[]
  error?: string
}

function resolveTransitionSegments(clip: Clip, start: number, end: number): TransitionSegments {
  const playbackRate = clipPlaybackRate(clip)
  const sourceStart = clipSourceTimeAt(clip, start)
  const sourceEnd = clipSourceTimeAt(clip, end)
  const segments: RenderTransitionSegment[] = []
  const pending: EffectNode[] = []

  for (const region of computeSegments(clip.id)) {
    const partStart = Math.max(sourceStart, region.start)
    const partEnd = Math.min(sourceEnd, region.end)
    if (partEnd - partStart <= EPS) continue
    const durationSec = (partEnd - partStart) / playbackRate

    if (region.stack.length === 0) {
      if (!clip.scrubBlobUrl) return { segments, pending, error: 'scrub proxy not loaded' }
      segments.push({
        input: clip.scrubBlobUrl,
        start: partStart,
        durationSec,
        playbackRate,
        mediaKind: clip.mediaKind,
        fileName: clip.fileName,
      })
      continue
    }

    const effectNode = findTopNodeAtStack(clip.id, (partStart + partEnd) / 2, false)
    if (!effectNode) return { segments, pending, error: 'transition effect segment missing' }
    if (effectNode.state === 'error') {
      return { segments, pending, error: effectNode.errorMsg ?? 'transition effect render failed' }
    }
    if (effectNode.state !== 'ready' || (!effectNode.outputBlob && !effectNode.outputBlobUrl)) {
      pending.push(effectNode)
      continue
    }
    segments.push({
      input: effectNode.outputBlob ?? effectNode.outputBlobUrl!,
      start: (partStart - effectNode.srcStart) / effectNode.playbackRate,
      durationSec,
      playbackRate: 1,
      mediaKind: 'video',
      fileName: 'effect.mp4',
    })
  }

  if (pending.length === 0 && segments.length === 0) return { segments, pending, error: 'empty transition range' }
  return { segments, pending }
}

async function renderTransitionNode(node: TransitionNode): Promise<void> {
  const left = editor.getClipById(node.leftClipId)?.clip
  const right = editor.getClipById(node.rightClipId)?.clip
  if (!left || !right) {
    node.state = 'error'
    node.errorMsg = 'clip removed'
    completeRenderJob()
    return
  }
  if (!left.scrubBlobUrl || !right.scrubBlobUrl) {
    node.state = 'error'
    node.errorMsg = 'scrub proxy not loaded'
    completeRenderJob()
    return
  }
  const leftSegments = node.isAudio ? null : resolveTransitionSegments(left, node.start, node.end)
  const rightSegments = node.isAudio ? null : resolveTransitionSegments(right, node.start, node.end)
  const segmentError = leftSegments?.error ?? rightSegments?.error
  if (segmentError) {
    node.state = 'error'
    node.errorMsg = segmentError
    completeRenderJob()
    return
  }
  const pendingEffects = [...(leftSegments?.pending ?? []), ...(rightSegments?.pending ?? [])]
  if (pendingEffects.length > 0) {
    node.state = 'queued'
    for (const effectNode of pendingEffects) enqueue(effectNode.id)
    enqueue(node.id)
    return
  }
  node.state = 'rendering'
  node.errorMsg = undefined
  revokeOutput(node)
  const dur = node.end - node.start
  const progressLabel = node.isAudio ? 'rendering audio transition' : 'rendering video transition'
  beginRenderJob(progressLabel)
  try {
    const result = node.isAudio
      ? await renderAudioTransition({
          inputA: left.scrubBlobUrl,
          startA: node.srcA,
          inputB: right.scrubBlobUrl,
          startB: node.srcB,
          durationSec: dur,
          playbackRateA: node.playbackRateA,
          playbackRateB: node.playbackRateB,
          onProgress: (r) => {
            updateRenderJobProgress(r, progressLabel)
          },
        })
      : await renderTransition({
          inputA: left.scrubBlobUrl,
          startA: node.srcA,
          mediaKindA: left.mediaKind,
          fileNameA: left.fileName,
          inputB: right.scrubBlobUrl,
          startB: node.srcB,
          mediaKindB: right.mediaKind,
          fileNameB: right.fileName,
          durationSec: dur,
          playbackRateA: node.playbackRateA,
          playbackRateB: node.playbackRateB,
          segmentsA: leftSegments!.segments,
          segmentsB: rightSegments!.segments,
          transformA: left.transform,
          transformKeyframesA: left.transformKeyframes,
          transformOffsetA: node.start - left.start,
          transformB: right.transform,
          transformKeyframesB: right.transformKeyframes,
          transformOffsetB: node.start - right.start,
          xfade: node.xfade,
          aspect: editor.effectiveProjectAspect,
          fit: editor.videoFit,
          fps: editor.fps,
          onProgress: (r) => {
            updateRenderJobProgress(r, progressLabel)
          },
        })
    node.outputBlobUrl = result.blobUrl
    node.outputBlob = result.blob
    node.state = 'ready'
  } catch (cause) {
    node.state = 'error'
    node.errorMsg = errorMessage(cause)
  } finally {
    completeRenderJob()
  }
}

async function pump(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      const tNode = getTransitionNode(id)
      if (tNode) {
        if (tNode.state === 'ready') continue
        await renderTransitionNode(tNode)
        continue
      }
      const node = getNode(id)
      if (!node) continue
      if (node.state === 'ready') continue

      if (node.parentId) {
        const parent = getNode(node.parentId)
        if (!parent || parent.state === 'error') {
          node.state = 'error'
          node.errorMsg = parent ? 'parent render failed' : 'parent missing'
          completeRenderJob()
          continue
        }
        if (parent.state !== 'ready' || !parent.outputBlobUrl) {
          queue.unshift(id)
          const parentPending =
            parent.state === 'queued' || parent.state === 'rendering'
          if (parentPending) {
            break
          } else {
            parent.state = 'queued'
            queue.unshift(parent.id)
            continue
          }
        }
      }

      await renderNode(node)
    }
  } finally {
    processing = false
  }
}

async function renderNode(node: EffectNode): Promise<void> {
  const found = editor.getClipById(node.clipId)
  if (!found) {
    node.state = 'error'
    node.errorMsg = 'clip removed'
    completeRenderJob()
    return
  }
  const { clip } = found

  let input: string | Blob
  let startSec: number
  const sourceDurationSec = node.srcEnd - node.srcStart
  const timelineDurationSec = clipTimelineDuration({
    ...clip,
    inPoint: node.srcStart,
    outPoint: node.srcEnd,
    playbackRate: node.playbackRate,
  })
  if (sourceDurationSec <= 0) {
    node.state = 'error'
    node.errorMsg = 'empty range'
    completeRenderJob()
    return
  }

  if (node.parentId) {
    const parent = getNode(node.parentId)!
    if (!parent.outputBlob && !parent.outputBlobUrl) {
      node.state = 'error'
      node.errorMsg = 'parent output unavailable'
      completeRenderJob()
      return
    }
    // Parent output already covers exactly [srcStart, srcEnd], so the child
    // reads the whole parent clip from t=0.
    input = parent.outputBlob ?? parent.outputBlobUrl!
    startSec = (node.srcStart - parent.srcStart) / node.playbackRate
  } else {
    if (!clip.scrubBlobUrl) {
      node.state = 'error'
      node.errorMsg = 'scrub proxy not loaded'
      completeRenderJob()
      return
    }
    input = clip.scrubBlobUrl
    startSec = node.srcStart
  }

  node.state = 'rendering'
  node.errorMsg = undefined
  revokeOutput(node)

  try {
    const progressLabel = `rendering effect ${node.effectId}`
    beginRenderJob(progressLabel)
    const filter = buildFilter(
      node.effectId,
      timelineDurationSec,
      node.params,
      node.ramp,
    )
    const result = await renderSegment({
      input,
      startSec,
      durationSec: node.parentId ? timelineDurationSec : sourceDurationSec,
      playbackRate: node.parentId ? undefined : node.playbackRate,
      mediaKind: node.parentId ? undefined : clip.mediaKind,
      fileName: node.parentId ? undefined : clip.fileName,
      filter,
      onProgress: (r) => {
        updateRenderJobProgress(r, progressLabel)
      },
    })
    node.outputBlobUrl = result.blobUrl
    node.outputBlob = result.blob
    node.state = 'ready'
  } catch (cause) {
    node.state = 'error'
    node.errorMsg = errorMessage(cause)
  } finally {
    completeRenderJob()
  }
}

// --- removal / reconciliation ---

// Remove every node owned by `blockId` plus the descendant nodes (other blocks'
// layers that were composited on top of them). Those other blocks are marked
// nonRendered so they rebuild on the next Play.
function removeNodesForBlock(blockId: string) {
  const blockNodes = nodes.filter((n) => n.blockId === blockId)
  if (blockNodes.length === 0) return
  const kill = new Set<string>(blockNodes.map((m) => m.id))
  for (const m of blockNodes) {
    for (const descendant of descendantsOf(m.id)) kill.add(descendant.id)
  }
  for (const id of kill) {
    const n = getNode(id)
    if (n) {
      revokeOutput(n)
      if (n.blockId !== blockId) editor.setEffectBlockNode(n.blockId, null)
    }
  }
  nodes = nodes.filter((n) => !kill.has(n.id))
  queue = queue.filter((id) => !kill.has(id))
}

// Remove all nodes for a block. Looks up the block via any of its nodes so the
// existing `render.removeNode(block.nodeId)` call sites keep working even though
// a block now maps to several nodes across regions.
export function removeNode(nodeId: string) {
  if (isPixiLiveNodeId(nodeId)) return
  const target = getNode(nodeId)
  if (!target) return
  removeNodesForBlock(target.blockId)
}

export function clearForClip(clipId: string) {
  for (const n of nodes.filter((x) => x.clipId === clipId)) revokeOutput(n)
  nodes = nodes.filter((n) => n.clipId !== clipId)
  queue = queue.filter((id) => {
    const n = getNode(id)
    return n && n.clipId !== clipId
  })
}

// Drop nodes whose block was deleted or moved to another clip.
function reconcileBlocks() {
  const live = new Map<string, EffectBlock>()
  for (const block of editor.effectBlocks) live.set(block.id, block)
  const toRemove = new Set<string>()
  for (const node of nodes) {
    if (!node.blockId) continue
    const block = live.get(node.blockId)
    if (!block) { // deleted
      toRemove.add(node.blockId)
      continue
    }
    const t = editor.getClipById(node.clipId) // moved
    if (!t || !blockOverlapsClip(block, t.channel.id, t.clip)) toRemove.add(node.blockId)
  }
  for (const blockId of toRemove) removeNodesForBlock(blockId)
}

// --- playback preparation ---

// Clips that need rebuilding: any block with no representative node yet, or any
// existing node not in a ready state (error/queued).
function getNonRenderedClips(): Set<string> {
  const out = new Set<string>()
  for (const block of editor.effectBlocks) {
    if (isPixiPreviewEffect(block.effectId)) continue
    if (isPixiLiveNodeId(block.nodeId)) continue
    if (!block.nodeId) {
      for (const ch of editor.channels) {
        for (const clip of ch.clips) {
          if (blockOverlapsClip(block, ch.id, clip)) out.add(clip.id)
        }
      }
    }
  }
  for (const node of nodes) {
    const clip = editor.getClipById(node.clipId)?.clip
    if (
      node.state !== 'ready' ||
      !clip ||
      Math.abs(node.playbackRate - clipPlaybackRate(clip)) >= EPS
    ) out.add(node.clipId)
  }
  return out
}

async function waitForNodes(nodeIds: string[], timeoutMs = 180000): Promise<boolean> {
  const stateOf = (id: string): NodeState | undefined =>
    getNode(id)?.state ?? getTransitionNode(id)?.state
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const allDone = nodeIds.every((id) => {
      const s = stateOf(id)
      return s === 'ready' || s === 'error'
    })
    if (allDone) return nodeIds.every((id) => stateOf(id) === 'ready')
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

// Render every nonRendered block, then resolve. Video (Pixi) and audio
// (live WebAudio crossfade) transitions need no prerender. Drives the
// "Please wait" overlay only when effect work remains. Returns true when playback may proceed.
export async function prepareForPlayback(): Promise<boolean> {
  reconcileBlocks()
  pruneVideoNodes()
  markPixiBlocksReady()
  renderError = ''
  // Skip the whole pipeline (including the core load) when nothing needs
  // rendering — an empty or fully-rendered timeline starts playing instantly.
  if (!hasPendingWork()) return true

  renderingForPlayback = true
  beginPlaybackProgress()
  renderProgressTotal = 0
  renderProgressCompleted = 0
  renderProgressCurrent = 0
  renderProgressRatio = 0
  renderProgressMsg = 'loading ffmpeg-wasm'
  try {
    // Load the wasm core BEFORE building/enqueueing nodes: the first getFFmpeg
    // call owns the progress callback, so letting transitions kick off the load
    // first would leave the overlay with no progress feedback. Nodes also never
    // start rendering before the core is confirmed ready.
    await ensureWasm()
    if (wasm.state !== 'ready') return false

    deferPump = true
    let ids: string[] = []
    try {
      const nonRendered = getNonRenderedClips()
      for (const clipId of nonRendered) ids.push(...buildStackForClip(clipId))
      // Transition inputs may consume the effect outputs above, so enqueue the
      // transitions only after every required clip stack has been reconciled.
      const transitionIds = buildTransitions()
      const transitionsPending = transitionIds.filter((id) => getTransitionNode(id)?.state !== 'ready')
      if (nonRendered.size === 0 && transitionsPending.length === 0) return true

      ids.push(...transitionIds)
    } finally {
      deferPump = false
    }

    setRenderProgressJobs(ids)
    if (renderProgressTotal === 0) return true
    renderProgressMsg = `rendering preview (0/${renderProgressTotal})`
    void pump().catch((err) => console.error('render pump failed', err))
    const ok = await waitForNodes(ids)
    if (!ok) {
      const failed = ids
        .map((id) => getNode(id) ?? getTransitionNode(id))
        .find((node) => node?.state === 'error')
      renderError = failed?.errorMsg ?? 'Preview render timed out'
    }
    return ok
  } catch (err) {
    renderError = err instanceof Error ? err.message : String(err)
    return false
  } finally {
    renderingForPlayback = false
    resetPlaybackProgress()
  }
}

// Called by the Play buttons: render nonRendered blocks, then start playback.
let playbackPreparationInFlight: Promise<boolean> | null = null

export async function startPlayback(): Promise<void> {
  if (editor.playing) {
    editor.setPlaying(false)
    return
  }
  if (!playbackPreparationInFlight) {
    playbackPreparationInFlight = prepareForPlayback().finally(() => {
      playbackPreparationInFlight = null
    })
  }
  const ok = await playbackPreparationInFlight
  if (ok) editor.setPlaying(true)
}

export const ensureWasm = wasm.ensure

export const render = {
  get nodes() { return nodes },
  get transitionNodes() { return transitionNodes },
  get queue() { return queue },
  get processing() { return processing },
  get wasmLoadState() { return wasm.state },
  get wasmLoadMsg() { return wasm.message },
  get wasmLoadRatio() { return wasm.ratio },
  get wasmError() { return wasm.error },
  get renderingForPlayback() { return renderingForPlayback },
  get renderProgressVisible() { return renderProgressVisible },
  get renderProgressMsg() { return renderProgressMsg },
  get renderProgressRatio() { return renderProgressRatio },
  get renderProgressTotal() { return renderProgressTotal },
  get renderProgressCompleted() { return renderProgressCompleted },
  get renderError() { return renderError },

  removeNode,
  clearForClip,
  getTopNodeAtStack,
  getNodesForClip,
  getTransitionAt,
  getTransitionNodeFor,
  flatten,
  ensureWasm,
  prepareForPlayback,
  startPlayback,
  pixiLiveNodeId,
  isPixiLiveNodeId,
}
