import { isAlias, isNode, parseDocument, stringify, visit } from 'yaml'
import { MAX_PROJECT_BYTES, type CompositionAsset, type CompositionInput, type EditDocument } from './composition-types'
import { cloneJSON } from './composition-adapter'
import { DEFAULT_CLIP_TRANSFORM } from './clip-transform'
import { normalizeDocumentTimeline } from './composition-timing'

type AnyRecord = Record<string, any>

// Server-side defaults (api/editengine/document/defaults.go + compiler normalize).
// Missing keys are filled on import, so the exported YAML omits everything
// that already equals its default.
const OUTPUT_DEFAULTS: AnyRecord = { aspect: 'landscape', fit: 'contain', resolution: '1080p', fps: 30, format: 'mp4', quality: 'normal' }

function pruneTransform(transform: AnyRecord | undefined | null): AnyRecord | undefined {
  if (!transform || typeof transform !== 'object') return undefined
  const pruned: AnyRecord = {}
  for (const key of Object.keys(DEFAULT_CLIP_TRANSFORM) as Array<keyof typeof DEFAULT_CLIP_TRANSFORM>) {
    const value = transform[key]
    if (value !== undefined && value !== DEFAULT_CLIP_TRANSFORM[key]) pruned[key] = value
  }
  return Object.keys(pruned).length ? pruned : undefined
}

function pruneClip(clip: AnyRecord): AnyRecord {
  const out: AnyRecord = { id: clip.id, assetId: clip.assetId, start: clip.start, inPoint: clip.inPoint, outPoint: clip.outPoint }
  if (clip.playbackRate !== undefined && clip.playbackRate !== 1) out.playbackRate = clip.playbackRate
  if (clip.volume !== undefined && clip.volume !== 100) out.volume = clip.volume
  if (clip.linkedClipId) out.linkedClipId = clip.linkedClipId
  const transform = pruneTransform(clip.transform)
  if (transform) out.transform = transform
  if (Array.isArray(clip.transformKeyframes) && clip.transformKeyframes.length) {
    out.transformKeyframes = clip.transformKeyframes.map((frame: AnyRecord) => {
      const frameTransform = pruneTransform(frame.transform)
      return frameTransform ? { time: frame.time, transform: frameTransform } : { time: frame.time }
    })
  }
  if (clip.opacity !== undefined && clip.opacity !== 1) out.opacity = clip.opacity
  if (clip.fadeIn) out.fadeIn = clip.fadeIn
  if (clip.fadeOut) out.fadeOut = clip.fadeOut
  for (const key of ['look', 'motion', 'layerEntrance', 'layerExit', 'provenance'] as const) {
    if (clip[key] !== undefined && clip[key] !== null && clip[key] !== '') out[key] = clip[key]
  }
  return out
}

function pruneTrack(track: AnyRecord): AnyRecord {
  const out: AnyRecord = { id: track.id, type: track.type }
  if (track.name) out.name = track.name
  out.clips = (track.clips ?? []).map(pruneClip)
  if (track.muted) out.muted = true
  if (track.hidden) out.hidden = true
  if (track.locked) out.locked = true
  return out
}

function pruneEffect(effect: AnyRecord): AnyRecord {
  const out: AnyRecord = { id: effect.id, trackId: effect.trackId, preset: effect.preset, start: effect.start, duration: effect.duration }
  if (effect.params && Object.keys(effect.params).length) out.params = effect.params
  if (effect.ramp) out.ramp = effect.ramp
  if (effect.ownerClipId) out.ownerClipId = effect.ownerClipId
  if (effect.provenance) out.provenance = effect.provenance
  return out
}

export function minimizeDocument(document: EditDocument, assets: CompositionAsset[] = []): EditDocument {
  const source = normalizeDocumentTimeline(document, assets) as unknown as AnyRecord
  const out: AnyRecord = { ...(source.version === 2 ? {} : { version: source.version ?? 1 }), mode: source.mode ?? 'assemble' }
  if (source.catalogVersion && source.catalogVersion !== '1') out.catalogVersion = source.catalogVersion
  if (source.compilerVersion && source.compilerVersion !== '1') out.compilerVersion = source.compilerVersion
  // Revision is recomputed by the server on every compile; never export it.
  if (source.instanceId && source.instanceId !== 'sequence') out.instanceId = source.instanceId
  if (source.inputs && Object.keys(source.inputs).length) out.inputs = source.inputs
  if (source.sequence) out.sequence = source.sequence
  if (source.montage) out.montage = source.montage
  if (Array.isArray(source.tracks) && source.tracks.length) out.tracks = source.tracks.map(pruneTrack)
  if (Array.isArray(source.effects) && source.effects.length) out.effects = source.effects.map(pruneEffect)
  if (Array.isArray(source.transitions) && source.transitions.length) out.transitions = source.transitions
  if (Array.isArray(source.texts) && source.texts.length) out.texts = source.texts
  if (Array.isArray(source.audio) && source.audio.length) out.audio = source.audio
  if (Array.isArray(source.overrides) && source.overrides.length) out.overrides = source.overrides
  if (Array.isArray(source.commands) && source.commands.length) out.commands = source.commands
  if (Array.isArray(source.jobs) && source.jobs.length) out.jobs = source.jobs
  if (Array.isArray(source.rules) && source.rules.length) out.rules = source.rules
  if (Array.isArray(source.before) && source.before.length) out.before = source.before
  if (Array.isArray(source.placements) && source.placements.length) out.placements = source.placements
  if (Array.isArray(source.after) && source.after.length) out.after = source.after
  if (source.output && typeof source.output === 'object') {
    const prunedOutput: AnyRecord = {}
    for (const [key, value] of Object.entries(source.output)) {
      if (value !== undefined && value !== OUTPUT_DEFAULTS[key]) prunedOutput[key] = value
    }
    if (Object.keys(prunedOutput).length) out.output = prunedOutput
  }
  return out as unknown as EditDocument
}

export function documentSource(document: EditDocument | string, assets: CompositionAsset[] = []): string {
  if (typeof document === 'string') return document
  return stringify(cloneJSON(minimizeDocument(document, assets)), { lineWidth: 0 })
}

export function repairLegacyTimelineSource(source: string, assets: CompositionAsset[]): EditDocument | string {
  const parsed = parseDocument(source)
  if (parsed.errors.length) return source
  let hasAlias = false
  visit(parsed, (_, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) hasAlias = true
  })
  if (hasAlias) return source
  const document = parsed.toJS() as EditDocument
  if (!document || !Array.isArray(document.tracks)
    || !document.tracks.every((track) => track && Array.isArray(track.clips))) return source
  const clips = document.tracks.flatMap((track) => track.clips)
  if (!clips.every((clip) => clip && typeof clip === 'object')) return source
  if (!clips.every((clip) => typeof clip.start === 'number' && typeof clip.inPoint === 'number'
    && typeof clip.outPoint === 'number' && (clip.transformKeyframes ?? []).every((frame) => typeof frame.time === 'number'))) return source
  const staleKeyframes = clips.some((clip) => (clip.transformKeyframes ?? [])
    .some((frame) => frame.time > (clip.outPoint - clip.inPoint) / (clip.playbackRate ?? 1)))
  return staleKeyframes ? normalizeDocumentTimeline(document, assets) : source
}

export function referencedProjectAssets(project: CompositionInput): CompositionAsset[] {
  const ids = new Set(Object.values(project.bindings).flat())
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (['assetId', 'resultAssetId', 'resultAudioAssetId', 'use', 'input'].includes(key) && typeof child === 'string') ids.add(child)
      else collect(child)
    }
  }
  for (const source of [project.document, project.recipe]) {
    if (typeof source !== 'string') {
      collect(source)
      continue
    }
    const parsed = parseDocument(source)
    if (parsed.errors.length) return project.assets
    collect(parsed.toJS())
  }
  return project.assets.filter((asset) => ids.has(asset.id))
}

export function projectFile(project: CompositionInput): string {
  const document = typeof project.document === 'string' ? project.document : minimizeDocument(project.document, project.assets)
  const recipe = typeof project.recipe === 'string' ? project.recipe : project.recipe ? minimizeDocument(project.recipe, project.assets) : undefined
  return stringify(cloneJSON({ document, ...(recipe ? { recipe } : {}), bindings: project.bindings, assets: referencedProjectAssets(project), preparedText: project.preparedText }), { lineWidth: 0 })
}

export function bindAssetInProjectSource(source: string, assetId: string, assets: CompositionAsset[] = []): string {
  const project = parseProjectFile(source)
  if (typeof project.document === 'string' && project.document === source) throw new Error('Add a document, bindings and assets project before binding media')
  const parsed = parseDocument(source)
  const slot = Object.keys(project.bindings)[0] ?? 'shots'
  const ids = project.bindings[slot] ?? []
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new Error('Bindings must map slot names to arrays of asset IDs')
  if (!ids.includes(assetId)) parsed.setIn(['bindings', slot], [...ids, assetId])
  const asset = assets.find((asset) => asset.id === assetId)
  if (asset && !project.assets.some((asset) => asset.id === assetId)) parsed.setIn(['assets'], [...project.assets, asset])
  return parsed.toString({ lineWidth: 0 })
}

export function availableProjectAssets(declared: CompositionAsset[], available: CompositionAsset[]): CompositionAsset[] {
  const files = new Set(available.map((asset) => asset.file.toLowerCase()))
  const assets = declared.filter((asset) => files.has(asset.file.toLowerCase()))
  const declaredFiles = new Set(assets.map((asset) => asset.file.toLowerCase()))
  return [...assets, ...available.filter((asset) => !declaredFiles.has(asset.file.toLowerCase()))]
}

export function parseProjectFile(source: string, assets: CompositionAsset[] = []): CompositionInput {
  if (new TextEncoder().encode(source).length > MAX_PROJECT_BYTES) throw new Error('Project exceeds 128 MiB')
  const parsed = parseDocument(source)
  if (parsed.errors.length) throw new Error(parsed.errors[0].message)
  visit(parsed, (_, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) throw new Error('YAML anchors and aliases are not supported')
  })
  const value = parsed.toJS() as Record<string, unknown>
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Project must be a mapping')
  if (!('document' in value)) return { document: source, bindings: {}, assets }
  return {
    document: value.document as EditDocument | string,
    ...('recipe' in value ? { recipe: value.recipe as EditDocument | string } : {}),
    bindings: (value.bindings ?? {}) as CompositionInput['bindings'],
    assets: (value.assets ?? assets) as CompositionAsset[],
    ...(value.preparedText ? { preparedText: value.preparedText as CompositionInput['preparedText'] } : {}),
  }
}
