import { DEFAULT_CLIP_TRANSFORM, type TransformPreset } from './clip-transform'
import { clipOpacity, clipFadeIn, clipFadeOut } from './clip-compositing'
import { normalizeDocumentTimeline } from './composition-timing'
import type { Clip, EffectBlock } from '../stores/editor.svelte'
import type { Composition, CompositionAsset, CompositionSnapshot, DocumentClip, DocumentSession, EditDocument, TimelineState } from './composition-types'
import { getMediaBinSource } from './media-bin'
import { isLiveSceneFile } from './live-scene'

export function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function revisionFingerprint(input: string): string {
  const hash = (seed: number) => {
    let value = seed >>> 0
    for (let index = 0; index < input.length; index++) value = Math.imul(value ^ input.charCodeAt(index), 0x01000193)
    return (value >>> 0).toString(16).padStart(8, '0')
  }
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, stableValue(value)]))
  return typeof value === 'number' ? Math.round(value * 1_000_000) / 1_000_000 : value
}

function sameDocumentValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

export function snapshotTimeline(timeline: TimelineState, assets: CompositionAsset[], revision: string): CompositionSnapshot {
  const source = (clip: Clip) => {
    const asset = assets.find((asset) => asset.id === clip.sourceId) ?? assets.find((asset) => asset.file === clip.fileName)
    if (!asset) throw new Error(`Asset metadata is missing for ${clip.fileName}`)
    return asset
  }
  const tracks = timeline.channels.map((channel) => ({
    ...channel,
    clips: channel.clips.map((clip): DocumentClip => ({
      id: clip.id,
      assetId: source(clip).id,
      start: clip.start,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      playbackRate: clip.playbackRate ?? 1,
      volume: clip.volume ?? 100,
      linkedClipId: clip.linkedClipId,
      transform: { ...DEFAULT_CLIP_TRANSFORM, ...clip.transform },
      transformKeyframes: clip.transformKeyframes?.map((frame) => ({ ...frame, transform: { ...frame.transform } })) ?? [],
      opacity: clipOpacity(clip),
      fadeIn: clipFadeIn(clip),
      fadeOut: clipFadeOut(clip),
      layerEntrance: clip.layerEntrance,
      layerExit: clip.layerExit,
      provenance: clip.provenance,
    })),
  }))
  const clips = tracks.flatMap((track) => track.clips)
  const effects = timeline.effectBlocks.map((block) => ({
    id: block.id, trackId: block.channelId, preset: block.effectId,
    start: block.start, duration: block.duration, params: { ...block.params },
    ...(block.ramp ? { ramp: { ...block.ramp } } : {}),
    ...(block.ownerClipId ? { ownerClipId: block.ownerClipId } : {}),
    ...(block.provenance ? { provenance: block.provenance } : {}),
  }))
  const transitions = timeline.transitions.map((transition) => {
    const left = clips.find((clip) => clip.id === transition.leftClipId)
    const right = clips.find((clip) => clip.id === transition.rightClipId)
    if (!left || !right) throw new Error(`Transition ${transition.id} has missing clips`)
    return {
      id: transition.id, trackId: transition.channelId,
      leftClipId: left.id, rightClipId: right.id, preset: transition.effectId,
      duration: left.start + (left.outPoint - left.inPoint) / left.playbackRate - right.start,
    }
  })
  const normalized = normalizeDocumentTimeline({ version: 1, mode: 'assemble', tracks, effects, transitions, texts: cloneJSON(timeline.textItems) }, assets)
  return { revision, tracks: normalized.tracks!, effects: normalized.effects!, transitions: normalized.transitions!,
    textItems: normalized.texts as TimelineState['textItems'], selectedIds: [] }
}

export function compositionTimeline(composition: Composition, resolvePreview: (asset: CompositionAsset, trackType: 'video' | 'audio') => string | null): TimelineState {
  const assetMap = new Map(composition.assets.map((asset) => [asset.id, asset]))
  return {
    channels: composition.tracks.map((track) => ({
      ...track,
      clips: (track.clips ?? []).map((clip): Clip => {
        const asset = assetMap.get(clip.assetId)
        if (!asset) throw new Error(`Unknown composition asset ${clip.assetId}`)
        return {
          id: clip.id, fileName: asset.file, sourceId: asset.id,
          sourceMode: asset.local ? 'wasm' : 'proxy', mediaKind: track.type === 'audio' ? 'audio' : asset.kind,
          sourceDuration: asset.duration, scrubBlobUrl: resolvePreview(asset, track.type),
          start: clip.start, inPoint: clip.inPoint, outPoint: clip.outPoint,
          playbackRate: clip.playbackRate, volume: clip.volume, linkedClipId: clip.linkedClipId,
          transform: { ...clip.transform }, transformKeyframes: cloneJSON(clip.transformKeyframes ?? []),
          motionPreset: clip.motion as TransformPreset | undefined,
          layerEntrance: clip.layerEntrance, layerExit: clip.layerExit,
          opacity: clip.opacity, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, provenance: clip.provenance,
        }
      }),
    })),
    effectBlocks: (composition.effects ?? []).map((block): EffectBlock => ({
      id: block.id, channelId: block.trackId, effectId: block.preset,
      params: { ...block.params }, ramp: block.ramp ? { ...block.ramp } : null,
      start: block.start, duration: block.duration, nodeId: null, ownerClipId: block.ownerClipId,
      provenance: block.provenance,
      ...(block.provenance?.rule.startsWith('look:') ? { clipLookId: block.provenance.rule.slice(5) } : {}),
    })),
    transitions: (composition.transitions ?? []).map((transition) => ({
      id: transition.id, channelId: transition.trackId, leftClipId: transition.leftClipId,
      rightClipId: transition.rightClipId, effectId: transition.preset,
    })),
    textItems: cloneJSON(composition.textItems ?? []),
    fps: composition.output.fps, resolution: composition.output.resolution, aspect: composition.output.aspect,
    fit: composition.output.fit ?? 'contain',
  }
}

export function explicitDocument(snapshot: CompositionSnapshot, output: EditDocument['output']): EditDocument {
  return {
    version: 1, catalogVersion: '1', compilerVersion: '1', mode: 'assemble',
    tracks: snapshot.tracks, effects: snapshot.effects, transitions: snapshot.transitions,
    texts: snapshot.textItems, output,
  }
}

function materializeNewAssets(timeline: TimelineState, assets: CompositionAsset[]): CompositionAsset[] {
  const result = assets.map((asset) => ({ ...asset }))
  for (const channel of timeline.channels) {
    for (const clip of channel.clips) {
      let asset = result.find((asset) => asset.id === clip.sourceId || asset.file === clip.fileName)
      if (!asset) {
        const source = getMediaBinSource(clip.fileName)
        asset = {
          id: clip.sourceId ?? clip.fileName, version: source?.sourceRevision?.startsWith('sha256:') ? source.sourceRevision : `unresolved:${clip.sourceId ?? clip.fileName}`,
          file: clip.fileName, duration: clip.sourceDuration, kind: clip.mediaKind ?? channel.type,
          width: source?.width, height: source?.height,
          local: clip.sourceMode === 'wasm', hasAudio: channel.type === 'audio' || Boolean(clip.linkedClipId && !isLiveSceneFile(clip.fileName)),
        }
        result.push(asset)
      }
      if (channel.type === 'audio' || clip.linkedClipId && !isLiveSceneFile(clip.fileName)) asset.hasAudio = true
    }
  }
  return result
}

export function recordDocumentEdit(session: DocumentSession, timeline: TimelineState): DocumentSession {
  const assets = materializeNewAssets(timeline, session.assets)
  const snapshot = snapshotTimeline(timeline, assets, '')
  const output = { ...session.document.output, fps: timeline.fps, resolution: timeline.resolution, aspect: timeline.aspect, fit: timeline.fit ?? 'contain' }
  const previous = session.composition
  const previousTracks = previous.tracks.map((track) => ({ ...track, clips: (track.clips ?? []).map((clip) => clip.id) }))
  const currentTracks = snapshot.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id) }))
  const managedEffectStyle = (block: Composition['effects'][number]) => block.provenance?.rule.startsWith('look:')
    ? { ...block, start: undefined, duration: undefined }
    : block
  const sequenceGeometryOnly = session.document.sequence && sameDocumentValue(previousTracks, currentTracks)
    && sameDocumentValue(previous.transitions ?? [], snapshot.transitions)
    && sameDocumentValue((previous.effects ?? []).map(managedEffectStyle), snapshot.effects.map(managedEffectStyle))
  let document: EditDocument
  if (sequenceGeometryOnly) {
    const overrides = new Map((session.document.overrides ?? []).map((override) => [override.target, override]))
    for (const track of snapshot.tracks) {
      for (const clip of track.clips) {
        const original = previous.tracks.flatMap((track) => track.clips ?? []).find((original) => original.id === clip.id)
        if (!original || sameDocumentValue({ ...original, look: undefined, motion: undefined }, clip)) continue
        overrides.set(clip.id, {
          target: clip.id, start: clip.start, from: clip.inPoint, duration: (clip.outPoint - clip.inPoint) / clip.playbackRate,
          rate: clip.playbackRate, volume: clip.volume, opacity: clip.opacity, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
          transform: clip.transform, keyframes: clip.transformKeyframes,
        })
      }
    }
    document = { ...session.document, revision: undefined, overrides: [...overrides.values()], texts: snapshot.textItems, output }
  } else {
    document = explicitDocument(snapshot, output)
    document.jobs = session.document.jobs
  }
  return { kind: 'dirty', document, recipe: session.recipe, assets, bindings: sequenceGeometryOnly ? session.bindings : {}, composition: previous }
}

export function assertExactTimeline(expected: CompositionSnapshot, actual: CompositionSnapshot): void {
  if (!sameDocumentValue({ ...expected, revision: '', selectedIds: [] }, { ...actual, revision: '', selectedIds: [] })) {
    throw new Error('The editor could not apply the compiled composition exactly.')
  }
}
