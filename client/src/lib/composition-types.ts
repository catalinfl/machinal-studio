import type { Channel, Clip, EffectBlock, ProjectAspect, Resolution, TextItem, Transition } from '../stores/editor.svelte'
import type { ClipTransform, ClipTransformKeyframe } from './clip-transform'
import type { RenderClipPayload, RenderFormat, RenderQuality, RenderTextPayload } from './api'
import type { VideoFit } from './video-fit'

export const MAX_COMPOSITION_TEXT_ITEMS = 2000
export const MAX_PROJECT_BYTES = 128 * 1024 * 1024

export interface PreparedText {
  key: string
  overlays: RenderTextPayload[]
}

export interface PreparedTextReference {
  id: string
  key: string
}

export interface CompositionAsset {
  id: string
  version: string
  file: string
  kind: 'video' | 'audio' | 'image'
  duration: number
  width?: number
  height?: number
  hasAudio?: boolean
  local?: boolean
}

export interface Provenance {
  instanceId: string
  rule: string
}

export interface DocumentClip {
  id: string
  assetId: string
  start: number
  inPoint: number
  outPoint: number
  playbackRate: number
  volume: number
  linkedClipId?: string
  transform: ClipTransform
  transformKeyframes: ClipTransformKeyframe[]
  opacity: number
  fadeIn: number
  fadeOut: number
  look?: string
  motion?: string
  layerEntrance?: Clip['layerEntrance']
  layerExit?: Clip['layerExit']
  provenance?: Provenance
}

export type DocumentTrack = Omit<Channel, 'clips'> & { clips: DocumentClip[] }

export interface DocumentEffect {
  id: string
  trackId: string
  preset: string
  start: number
  duration: number
  params: EffectBlock['params']
  ramp?: NonNullable<EffectBlock['ramp']>
  ownerClipId?: string
  provenance?: Provenance
}

export type DocumentTransition = Omit<Transition, 'channelId' | 'effectId'> & {
  trackId: string
  preset: string
  duration: number
}

export interface CompositionSettings {
  aspect: ProjectAspect
  fit?: VideoFit
  resolution: Resolution
  fps: number
  format: RenderFormat
  quality: RenderQuality
}

export interface ClipOverride {
  target: string
  start?: number
  from?: number
  duration?: number
  rate?: number
  volume?: number
  opacity?: number
  fadeIn?: number
  fadeOut?: number
  transform?: ClipTransform
  keyframes?: ClipTransformKeyframe[]
  look?: string
  motion?: string
}

export interface EditDocument {
  version: 1 | 2 | 3
  catalogVersion?: string
  compilerVersion?: string
  revision?: string
  mode: 'assemble' | 'modify'
  instanceId?: string
  inputs?: Record<string, { kind: CompositionAsset['kind']; multiple?: boolean; optional?: boolean }>
  sequence?: {
    use: string
    order?: 'input' | 'reverse'
    each: { take: { from: number | string; duration: number | string }; source_audio?: 'keep' | 'remove'; rate?: number; volume?: number; look?: string; motion?: string }
    between?: { preset: string; duration: number | string; policy?: 'error' | 'shrink' }
  }
  montage?: {
    target: { kind: 'video'; ids?: string[]; selected?: boolean; trackId?: string; position?: 'all' | 'first' | 'last' | 'nth'; index?: number }
    ranges?: Array<{ clipId: string; from: number | string; to: number | string; score?: number }>
    candidates?: Array<{ clipId: string; from: number | string; to: number | string; score?: number }>
    targetDuration?: number | string
    tolerance?: number | string
    seed?: string
    between?: { preset?: string; random?: boolean; duration: number | string; policy?: 'error' | 'shrink' }
    motion?: { preset?: string; random?: boolean; family?: 'zoom' }
  }
  tracks?: DocumentTrack[]
  effects?: DocumentEffect[]
  transitions?: DocumentTransition[]
  texts?: Array<Partial<TextItem> & Pick<TextItem, 'id' | 'text' | 'start' | 'duration'> & { preset?: string }>
  audio?: Array<{ id: string; use: string; start: number; from: number; duration?: number; fit?: 'sequence' | 'source'; repeat?: boolean; volume?: number }>
  overrides?: ClipOverride[]
  commands?: unknown[]
  jobs?: Array<{ id: string; type: string; input?: string; assetId?: string; preset?: string; maxWords?: number; style?: Partial<TextItem>; resultAssetId?: string; resultAudioAssetId?: string; audioStart?: number | string; resultTextIds?: string[]; language?: string; instructions?: string; narrationJob?: string; narrationFrom?: number | string; prompt?: string; text?: string; voice?: string; model?: string; aspect?: string; referenceName?: string; referenceTranscript?: string; background?: string; imageStyle?: string; trackId?: string; start?: number | string; duration?: number | string; width?: number; height?: number; fps?: number; visualMode?: 'auto' | '2d' | '3d'; images?: Array<{ id: string; file?: string; job?: string; name: string; description?: string }> }>
  rules?: Array<{ id: string; target: { kind: 'video' | 'image'; trackId?: string; position?: 'all' | 'first' | 'last' | 'nth'; index?: number }; apply: { look?: string; motion?: string; effect?: { preset: string; params?: Record<string, number>; ramp?: NonNullable<EffectBlock['ramp']> } } }>
  before?: NonNullable<EditDocument['jobs']>
  placements?: Array<{ job: string; track: { type: 'video' | 'audio'; role: string }; start: number | string; duration?: number | string; transform?: ClipTransform }>
  after?: NonNullable<EditDocument['jobs']>
  output?: Partial<CompositionSettings>
}

export interface Composition {
  id: string
  documentRevision: string
  compilerVersion: string
  catalogVersion: string
  duration: number
  output: CompositionSettings
  assets: CompositionAsset[]
  tracks: DocumentTrack[]
  effects: DocumentEffect[]
  transitions: DocumentTransition[]
  textItems: TextItem[]
  textRenderKey: string
  preparedText?: PreparedText
  preparedTextRef?: PreparedTextReference
  segments: Record<string, RenderClipPayload['segments']>
}

export interface CompositionSnapshot {
  revision: string
  tracks: DocumentTrack[]
  effects: DocumentEffect[]
  transitions: DocumentTransition[]
  textItems: TextItem[]
  selectedIds: string[]
}

export interface CompositionInput {
  document: EditDocument | string
  recipe?: EditDocument | string
  bindings: Record<string, string[]>
  assets: CompositionAsset[]
  snapshot?: CompositionSnapshot
  preparedText?: PreparedText
}

export interface CompilationResult {
  document?: EditDocument
  composition?: Composition
  expectedRevision: string
  diagnostics: Array<{ code: string; path: string; line?: number; column?: number; message: string; severity: 'error' | 'warning' }>
  requirements: Array<{ id: string; kind: string; path: string; message: string }>
  summary: string
}

export interface DocumentProject {
  document: EditDocument
  recipe?: EditDocument | string
  bindings: Record<string, string[]>
  assets: CompositionAsset[]
  preparedText?: PreparedText
  preparedTextRef?: PreparedTextReference
}

export type DocumentSession = DocumentProject & (
  | { kind: 'ready'; composition: Composition }
  | { kind: 'dirty'; composition: Composition }
  | { kind: 'error'; composition: Composition; message: string }
)

export interface TimelineState {
  channels: Channel[]
  effectBlocks: EffectBlock[]
  transitions: Transition[]
  textItems: TextItem[]
  fps: number
  resolution: Resolution
  aspect: ProjectAspect
  fit?: VideoFit
}
