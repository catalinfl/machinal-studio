import type { Composition, EditDocument, PreparedTextReference } from './composition-types'
import type { ProjectState } from './project-state'
import { cloneJSON, compositionTimeline, revisionFingerprint } from './composition-adapter'
import type { MediaBinSource } from './media-bin'
import { projectMediaReference } from './project-media'

export interface PreparedComposition {
  jobId?: string
  updatedAt: string
  filename?: string
  compositionId?: string
  document?: EditDocument
  bindings?: Record<string, string[]>
  composition?: Composition
  preparedTextRef?: PreparedTextReference
}

export interface ProjectPresentation {
  prepared?: PreparedComposition
  lastRender?: PreparedComposition
}

function stateValue(state: ProjectState) {
  return { schemaVersion: state.schemaVersion, timeline: state.timeline, media: state.media }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') return ['object', Object.entries(value)
    .filter(([, value]) => value !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [key, canonicalValue(value)])]
  return value
}

export function projectStateFingerprint(state: ProjectState): string {
  const serialized = JSON.stringify(canonicalValue(stateValue(state))).replace(/[<>&\u2028\u2029]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `v2:${revisionFingerprint(serialized)}`
}

export function isPreparedProjectPristine(state: ProjectState): boolean {
  const fingerprint = state.preparedStateFingerprint
  return Boolean(fingerprint && fingerprint === (fingerprint.startsWith('v2:')
    ? projectStateFingerprint(state) : revisionFingerprint(JSON.stringify(stateValue(state)))))
}

export function preparedProjectState(prepared: PreparedComposition, media: MediaBinSource[] = []): ProjectState | null {
  if (!prepared.document || !prepared.composition) return null
  const references = media.map(projectMediaReference)
  const composition = cloneJSON(prepared.composition)
  if (prepared.preparedTextRef) composition.preparedTextRef = cloneJSON(prepared.preparedTextRef)
  const timeline = compositionTimeline(composition, () => null)
  const state: ProjectState = {
    schemaVersion: 1,
    preparedCompositionId: composition.id,
    timeline: {
      channels: timeline.channels, effectBlocks: timeline.effectBlocks, transitions: timeline.transitions,
      textItems: timeline.textItems, fps: timeline.fps, resolution: timeline.resolution,
      projectAspect: timeline.aspect, videoFit: timeline.fit ?? 'contain',
      documentSession: {
        kind: 'ready', document: cloneJSON(prepared.document), bindings: cloneJSON(prepared.bindings ?? {}),
        assets: composition.assets, composition, preparedText: composition.preparedText, preparedTextRef: composition.preparedTextRef,
      },
      currentTime: 0, selectedClipIds: [], selectedEffectBlockIds: [], selectedTextItemIds: [],
    },
    media: composition.assets.map(asset => ({
      ...cloneJSON(references.find(source => source.name.toLowerCase() === asset.file.toLowerCase()) ?? {}),
      id: asset.id, sourceId: asset.id, sourceRevision: asset.version, name: asset.file, kind: asset.kind,
      duration: asset.duration, width: asset.width, height: asset.height, sourceMode: asset.local ? 'wasm' : 'proxy',
      previewUrl: null, scrubBlobUrl: null, thumbnailUrl: null,
    })),
  }
  const used = new Set(state.media.map(source => source.name.toLowerCase()))
  state.media.push(...cloneJSON(references.filter(source => !used.has(source.name.toLowerCase()))))
  state.preparedStateFingerprint = projectStateFingerprint(state)
  return state
}

export function projectStateForOpen(state: ProjectState | null, presentation?: ProjectPresentation): ProjectState | null {
  if (state && (state.schemaVersion !== 1 || !Array.isArray(state.timeline?.channels) || !Array.isArray(state.media))) return state
  const prepared = presentation?.prepared ?? presentation?.lastRender
  if (state?.preparedCompositionId) {
    const session = state.timeline.documentSession
    if (prepared?.composition && prepared.composition.id !== state.preparedCompositionId
      && session?.kind === 'ready' && session.composition.id === state.preparedCompositionId
      && isPreparedProjectPristine(state)) return preparedProjectState(prepared, state.media) ?? state
    return state
  }
  // An existing document session also represents an intentionally cleared timeline.
  if (state && (state.timeline?.documentSession || state.timeline?.channels?.some(channel => channel.clips.length)
    || state.timeline?.textItems?.length || state.timeline?.effectBlocks?.length || state.timeline?.transitions?.length)) return state
  return prepared ? preparedProjectState(prepared, state?.media) ?? state : state
}

export function preparedCompositionJSON(prepared: PreparedComposition): string {
  if (!prepared.document || !prepared.composition) throw new Error('This older render has no retained editable snapshot.')
  if (prepared.preparedTextRef && !prepared.composition.preparedText) throw new Error('The saved caption images must be loaded before downloading this snapshot.')
  return JSON.stringify({
    document: prepared.document, bindings: prepared.bindings ?? {}, assets: prepared.composition.assets,
    preparedText: prepared.composition.preparedText,
  }, null, 2)
}
