import { getEffect } from './effects'
import { requestAIEdit, type AIEditOperation, type AIEditPlan, type AIEditSpeechJob, type AIProjectContext, type AITextStyle } from './api'
import { insertPreparedMedia, prepareMediaInsertion, type PreparedMediaInsertion } from './drop'
import { getMediaBinSources, waitForMediaBinLoads } from './media-bin'
import { clipEnd, clipPlaybackRate, clipTimelineDuration, editor, textDesignSize, type Channel, type Clip, type TextItem, type TimedTextWord } from '../stores/editor.svelte'
import { transformPreset, type ClipTransform, type TransformPreset } from './clip-transform'
import { applyPreparedAIImageJob, prepareAIImageJob, registerPreparedAIImageJob, type PreparedAIImageJob } from './ai-image'
import { captionStyleForPreset, SHORT_FORM_TEXT_PRESETS } from './text-presets'
import { prepareSpeech, registerGeneratedSpeech, SPEECH_MODELS, type GeneratedSpeech } from './speech'
import { executeDocumentEdit, planDocumentEdit } from './compositions'
import { applyPreparedAICaptions, prepareAICaptions } from './ai-captions'
import { MAX_COMPOSITION_TEXT_ITEMS } from './composition-types'

const TEXT_STYLE_KEYS = [
  'x', 'y', 'fontFamily', 'fontSize', 'fontWeight', 'italic', 'align', 'color',
  'strokeColor', 'strokeWidth', 'backgroundColor', 'backgroundOpacity',
  'backgroundPadding', 'backgroundRadius', 'bannerStyle', 'accentColor', 'animation',
  'animationDuration', 'opacity', 'rotation', 'isCaption', 'highlightMode', 'highlightColor',
  'highlightBackgroundColor', 'highlightBackgroundOpacity', 'highlightAnimation',
] as const satisfies ReadonlyArray<keyof AITextStyle>

function textStyle(item: TextItem): AITextStyle {
  return Object.fromEntries(TEXT_STYLE_KEYS.map((key) => [key, item[key]])) as AITextStyle
}

export function buildAIProjectContext(): AIProjectContext {
  const sources = getMediaBinSources()
  const sourceForClip = (clip: Clip, channel: Channel) => sources.find((source) => {
    const matchingKind = source.kind === clip.mediaKind
      || clip.mediaKind === undefined && source.kind === channel.type
    if (!matchingKind) return false
    return source.id === clip.sourceId
      || source.sourceId !== undefined && source.sourceId === clip.sourceId
      || source.name.toLowerCase() === clip.fileName.toLowerCase()
  })
  const timelineClipIds = new Map<string, string[]>()
  for (const channel of editor.channels) {
    for (const clip of channel.clips) {
      const source = sourceForClip(clip, channel)
      if (!source) continue
      timelineClipIds.set(source.id, [...(timelineClipIds.get(source.id) ?? []), clip.id])
    }
  }

  return {
    duration: editor.totalDuration,
    fps: editor.fps,
    aspect: editor.effectiveProjectAspect,
    focus: {
      playhead: Math.max(0, Math.min(editor.currentTime, editor.totalDuration)),
      selectedClipIds: [...editor.selectedClipIds],
      selectedTrackIds: [...editor.selectedChannelIds],
      selectedEffectIds: [...editor.selectedEffectBlockIds],
      selectedTextIds: [...editor.selectedTextItemIds],
    },
    tracks: editor.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      locked: channel.locked,
      muted: channel.muted,
      hidden: channel.hidden,
      clips: channel.clips.map((clip) => {
        const source = sourceForClip(clip, channel)
        return {
          id: clip.id,
          name: clip.fileName,
          sourceId: source?.id ?? clip.sourceId,
          sourceDuration: clip.sourceDuration,
          mediaKind: clip.mediaKind,
          start: clip.start,
          end: clipEnd(clip),
          sourceIn: clip.inPoint,
          sourceOut: clip.outPoint,
          rate: clipPlaybackRate(clip),
          volume: clip.volume,
          transform: clip.transform ? { ...clip.transform } : undefined,
          transformKeyframes: clip.transformKeyframes?.map((keyframe) => ({
            time: keyframe.time,
            transform: { ...keyframe.transform },
          })),
          motionPreset: clip.motionPreset,
          ...(clip.linkedClipId ? { linkedId: clip.linkedClipId } : {}),
        }
      }),
    })),
    effects: editor.effectBlocks.map((block) => ({
      id: block.id,
      trackId: block.channelId,
      preset: block.effectId,
      start: block.start,
      duration: block.duration,
      ...(Object.keys(block.params).length > 0 ? { params: { ...block.params } } : {}),
      ...(block.ownerClipId ? { ownerClipId: block.ownerClipId } : {}),
      ...(block.clipLookId ? { clipLookId: block.clipLookId } : {}),
      ...(block.ramp ? { ramp: { ...block.ramp } } : {}),
    })),
    transitions: editor.transitions.map((transition) => {
      const left = editor.getClipById(transition.leftClipId)?.clip
      const right = editor.getClipById(transition.rightClipId)?.clip
      return {
        id: transition.id,
        trackId: transition.channelId,
        leftClipId: transition.leftClipId,
        rightClipId: transition.rightClipId,
        preset: transition.effectId,
        duration: left && right ? Math.max(0, clipEnd(left) - right.start) : 0,
      }
    }),
    texts: editor.textItems.map((item) => ({
      id: item.id,
      start: item.start,
      duration: item.duration,
      text: item.text,
      style: textStyle(item),
    })),
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      ...(source.sourceMode ? { sourceMode: source.sourceMode } : {}),
      duration: source.duration,
      ...(source.width !== undefined ? { width: source.width } : {}),
      ...(source.height !== undefined ? { height: source.height } : {}),
      ...(timelineClipIds.has(source.id) ? { timelineClipIds: timelineClipIds.get(source.id) } : {}),
    })),
  }
}

// Two seeded FNV-1a passes keep revisions synchronous and compact. This is a
// stale-response guard, not a security boundary.
export function aiProjectRevision(project: AIProjectContext): string {
  // Selection and playhead ground ambiguous prompts but are not timeline edits.
  const input = JSON.stringify(project, (key, value) => key === 'focus' || key === 'sources' ? undefined : value)
  const hash = (seed: number) => {
    let value = seed >>> 0
    for (let index = 0; index < input.length; index += 1) {
      value ^= input.charCodeAt(index)
      value = Math.imul(value, 0x01000193)
    }
    return (value >>> 0).toString(16).padStart(8, '0')
  }
  return `${editor.stateRevision.toString(36)}-${hash(0x811c9dc5)}${hash(0x9e3779b9)}`
}

function assertCurrentRevision(revision: string) {
  if (aiProjectRevision(buildAIProjectContext()) !== revision) {
    throw new Error('Timeline changed while AI was planning. Submit the instruction again.')
  }
}

type AITextOperation = Extract<AIEditOperation, { type: 'add_text' | 'update_text' }>
type TextStylePatch = Partial<Omit<TextItem, 'id' | 'sourceClipId' | 'start' | 'duration' | 'text' | 'words'>>

function evenlyTimedWords(text: string, duration: number): TimedTextWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.map((word, index) => ({
    text: word,
    start: duration * index / words.length,
    end: duration * (index + 1) / words.length,
  }))
}

function resolvedTextStyle(operation: AITextOperation, text: string, duration: number, current?: TextItem): TextStylePatch & { words?: TimedTextWord[] } {
  const preset = operation.textPresetId
    ? SHORT_FORM_TEXT_PRESETS.find((candidate) => candidate.id === operation.textPresetId)
    : undefined
  if (operation.textPresetId && !preset) throw new Error(`Unknown short-form text preset: ${operation.textPresetId}`)

  let presetStyle: TextStylePatch = {}
  if (preset) {
    if (current) {
      presetStyle = captionStyleForPreset(preset)
    } else {
      const {
        id: _presetID,
        sourceClipId: _presetSourceClipID,
        start: _presetStart,
        text: _presetText,
        duration: _presetDuration,
        words: _presetWords,
        ...values
      } = preset.values
      presetStyle = values
    }
  }
  const design = textDesignSize(editor.effectiveProjectAspect)
  const style = {
    ...presetStyle,
    ...(presetStyle.x === undefined ? {} : { x: presetStyle.x * design.w / 1920 }),
    ...(presetStyle.y === undefined ? {} : { y: presetStyle.y * design.h / 1080 }),
    ...(operation.style ?? {}),
  }
  const highlightsWords = style.highlightMode === 'word'
    || style.highlightMode === undefined && current?.highlightMode === 'word'
  if (highlightsWords) {
    const activeWordStyle = { ...style, isCaption: true, highlightMode: 'word' as const }
    return !current || !current.isCaption || current.words.length === 0
      ? { ...activeWordStyle, words: evenlyTimedWords(text, duration) }
      : activeWordStyle
  }
  return style
}

function textUpdates(operation: Extract<AIEditOperation, { type: 'update_text' }>, current: TextItem): Partial<Omit<TextItem, 'id'>> {
  const text = operation.text ?? current.text
  const duration = operation.duration ?? current.duration
  return {
    ...(operation.start !== undefined ? { start: operation.start } : {}),
    ...(operation.duration !== undefined ? { duration: operation.duration } : {}),
    ...(operation.text !== undefined ? { text: operation.text } : {}),
    ...resolvedTextStyle(operation, text, duration, current),
  } as Partial<Omit<TextItem, 'id'>>
}

function transformPatch(patch: Extract<AIEditOperation, { type: 'update_clip' }>['transform']): Partial<ClipTransform> {
  return patch ? { ...patch } : {}
}

function transformKeyframes(patch: Extract<AIEditOperation, { type: 'update_clip' }>['transform']) {
  return (patch?.keyframes ?? []).map((keyframe) => ({
    time: keyframe.time,
    transform: { ...keyframe.transform } as ClipTransform,
  }))
}

function sourceForId(id: string) {
  return getMediaBinSources().find((source) => source.id === id)
    ?? getMediaBinSources().find((source) => source.id.toLowerCase() === id.toLowerCase())
}

type AddMediaOperation = Extract<AIEditOperation, { type: 'add_media' }>

async function prepareMediaOperations(operations: AIEditOperation[]): Promise<Map<AddMediaOperation, PreparedMediaInsertion>> {
  const prepared = new Map<AddMediaOperation, PreparedMediaInsertion>()
  for (const operation of operations) {
    if (operation.type !== 'add_media') continue
    const source = sourceForId(operation.sourceId)
    if (!source) throw new Error(`Media source ${operation.sourceId} is not available in the Media Bin`)
    const channel = editor.channels.find((candidate) => candidate.id === operation.channelId)
    if (!channel) throw new Error(`Channel ${operation.channelId} no longer exists`)
    if (typeof operation.includeAudio !== 'boolean') throw new Error(`AI did not specify the source-audio choice for ${source.name}`)
    const result = await prepareMediaInsertion(channel, {
      fileName: source.name,
      sourceId: source.sourceId,
      sourceMode: source.sourceMode,
      mediaKind: source.kind,
      scrubBlobUrl: source.scrubBlobUrl ?? undefined,
      sourceDuration: source.duration,
      sourceWidth: source.width,
      sourceHeight: source.height,
    }, { includeAudio: operation.includeAudio })
    if (!result) throw new Error(`Cannot prepare ${source.name} for the timeline`)
    prepared.set(operation, result)
  }
  return prepared
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.001
}

function resolvedClipId(clipId: string, clipResults: Map<string, string>): string {
  return clipResults.get(clipId) ?? clipId
}

function applyOperation(
  operation: Exclude<AIEditOperation, { type: 'delete_range' }>,
  preparedMedia: Map<AddMediaOperation, PreparedMediaInsertion>,
  clipResults: Map<string, string>,
): boolean {
  switch (operation.type) {
    case 'add_effect': {
      const definition = getEffect(operation.effectId)
      if (!definition || definition.kind !== 'effect') throw new Error(`Unknown effect preset: ${operation.effectId}`)
      const block = editor.addEffectBlock(operation.channelId, operation.effectId, operation.start, operation.duration, operation.params)
      if (!block) throw new Error(`Cannot add effect to channel ${operation.channelId}`)
      return true
    }
    case 'update_effect': {
      const block = editor.effectBlocks.find((candidate) => candidate.id === operation.blockId)
      if (!block) throw new Error(`Effect ${operation.blockId} no longer exists`)
      if (operation.start !== undefined) editor.moveEffectBlock(block.id, operation.start)
      if (operation.duration !== undefined) editor.resizeEffectBlock(block.id, operation.duration)
      for (const [key, value] of Object.entries(operation.params ?? {})) {
        if (!editor.setEffectParameter([block.id], key, value)) throw new Error(`Cannot update effect ${block.id}`)
      }
      return operation.start !== undefined || operation.duration !== undefined || Object.keys(operation.params ?? {}).length > 0
    }
    case 'delete_effect': {
      if (!editor.effectBlocks.some((block) => block.id === operation.blockId)) throw new Error(`Effect ${operation.blockId} no longer exists`)
      editor.removeEffectBlock(operation.blockId)
      return true
    }
    case 'add_text':
      editor.addTextItem(operation.start, {
        duration: operation.duration,
        text: operation.text,
        ...resolvedTextStyle(operation, operation.text, operation.duration),
      })
      return true
    case 'update_text': {
      const item = editor.textItems.find((candidate) => candidate.id === operation.textId)
      if (!item) throw new Error(`Text ${operation.textId} no longer exists`)
      editor.updateTextItem(operation.textId, textUpdates(operation, item))
      return true
    }
    case 'delete_text': {
      if (!editor.textItems.some((item) => item.id === operation.textId)) throw new Error(`Text ${operation.textId} no longer exists`)
      editor.removeTextItem(operation.textId)
      return true
    }
    case 'add_media': {
      const source = sourceForId(operation.sourceId)
      if (!source) throw new Error(`Media source ${operation.sourceId} is not available in the Media Bin`)
      const channel = editor.channels.find((candidate) => candidate.id === operation.channelId)
      if (!channel) throw new Error(`Channel ${operation.channelId} no longer exists`)
      const prepared = preparedMedia.get(operation)
      if (!prepared) throw new Error(`Media source ${source.name} was not prepared`)
      const added = insertPreparedMedia(channel, prepared, operation.start, {
        sourceIn: operation.sourceIn,
        sourceOut: operation.sourceOut,
        playbackRate: operation.playbackRate,
        volume: operation.volume,
        includeAudio: operation.includeAudio,
      })
      if (!added) throw new Error(`Cannot add ${source.name} to channel ${operation.channelId}`)
      const clip = added.primary
      if (
        !approximatelyEqual(clip.start, operation.start)
        || !approximatelyEqual(clip.inPoint, operation.sourceIn)
        || !approximatelyEqual(clip.outPoint, operation.sourceOut)
        || !approximatelyEqual(clipPlaybackRate(clip), operation.playbackRate ?? 1)
      ) {
        throw new Error(`Timeline did not apply the requested source range for ${source.name}`)
      }
      if (source.kind === 'video' && !operation.includeAudio && (clip.linkedClipId || added.linkedAudio)) {
        throw new Error(`Timeline kept source audio for ${source.name}`)
      }
      editor.selectClip(clip.id)
      clipResults.set(operation.resultId, clip.id)
      return true
    }
    case 'move_clip': {
      const clipId = resolvedClipId(operation.clipId, clipResults)
      const found = editor.getClipById(clipId)
      if (!found) throw new Error(`Clip ${operation.clipId} no longer exists`)
      if (operation.channelId && operation.channelId !== found.channel.id) {
        const desiredStart = operation.start ?? found.clip.start + (operation.delta ?? 0)
        if (!editor.moveClipToChannel(found.channel.id, operation.channelId, clipId, desiredStart)) {
          throw new Error(`Cannot move clip ${operation.clipId} to channel ${operation.channelId}`)
        }
        return true
      }
      const start = operation.start ?? found.clip.start + (operation.delta ?? 0)
      editor.moveClip(found.channel.id, clipId, start)
      return true
    }
    case 'update_clip': {
      const clipId = resolvedClipId(operation.clipId, clipResults)
      const found = editor.getClipById(clipId)
      if (!found) throw new Error(`Clip ${operation.clipId} no longer exists`)
      const clip = found.clip
      const changesSourceWindow = operation.inPoint !== undefined || operation.outPoint !== undefined
      const finalStart = operation.start ?? clip.start
      if (changesSourceWindow) {
        const nextIn = operation.inPoint ?? clip.inPoint
        const nextOut = operation.outPoint ?? clip.outPoint
        const inDelta = (nextIn - clip.inPoint) / clipPlaybackRate(clip)
        editor.trimClip(clip.id, 'left', inDelta)
        const live = editor.getClipById(clip.id)
        if (!live) throw new Error(`Clip ${operation.clipId} disappeared while trimming`)
        const outDelta = (nextOut - live.clip.outPoint) / clipPlaybackRate(live.clip)
        if (Math.abs(outDelta) > 1e-9) editor.trimClip(clip.id, 'right', outDelta)
      }
      if (operation.playbackRate !== undefined && !editor.setClipPlaybackRate(clip.id, operation.playbackRate)) {
        throw new Error(`Cannot set playback rate for clip ${operation.clipId}`)
      }
      if (operation.start !== undefined || changesSourceWindow) editor.moveClip(found.channel.id, clip.id, finalStart)
      if (operation.volume !== undefined) editor.setClipVolume(clip.id, operation.volume)
      if (operation.transform) {
        const keyframes = transformKeyframes(operation.transform)
        if (keyframes.length > 0) {
          editor.setClipTransformKeyframes(clip.id, clip.transform ? { ...clip.transform } : {} as ClipTransform, keyframes)
        } else {
          editor.setClipTransform(clip.id, transformPatch(operation.transform))
        }
      }
      if (operation.motionPreset !== undefined) {
        const preset = operation.motionPreset as TransformPreset
        const live = editor.getClipById(clip.id)
        if (!live) throw new Error(`Clip ${operation.clipId} no longer exists`)
        const result = transformPreset(preset, clipTimelineDuration(live.clip))
        editor.setClipTransformKeyframes(clip.id, result.transform, result.keyframes, preset)
      }
      const updated = editor.getClipById(clip.id)?.clip
      if (!updated) throw new Error(`Clip ${operation.clipId} no longer exists`)
      if (
        (operation.start !== undefined || changesSourceWindow) && !approximatelyEqual(updated.start, finalStart)
        || operation.inPoint !== undefined && !approximatelyEqual(updated.inPoint, operation.inPoint)
        || operation.outPoint !== undefined && !approximatelyEqual(updated.outPoint, operation.outPoint)
        || operation.playbackRate !== undefined && !approximatelyEqual(clipPlaybackRate(updated), operation.playbackRate)
      ) {
        throw new Error(`Timeline could not apply the requested trim or position to clip ${operation.clipId}`)
      }
      return true
    }
    case 'split_clip': {
      const clipId = resolvedClipId(operation.clipId, clipResults)
      if (!editor.getClipById(clipId)) throw new Error(`Clip ${operation.clipId} no longer exists`)
      const right = editor.splitClip(clipId, operation.time)
      if (!right || !approximatelyEqual(right.start, operation.time)) throw new Error(`Cannot split clip ${operation.clipId} at ${operation.time}s`)
      return true
    }
    case 'remove_source_audio': {
      const clipId = resolvedClipId(operation.clipId, clipResults)
      const found = editor.getClipById(clipId)
      if (!found || found.channel.type !== 'video') throw new Error(`Video clip ${operation.clipId} no longer exists`)
      const linkedId = found.clip.linkedClipId
      const linked = linkedId ? editor.getClipById(linkedId) : null
      if (!linked || linked.channel.type !== 'audio') throw new Error(`Video clip ${operation.clipId} has no linked source audio`)
      if (linked.channel.locked) throw new Error(`Source audio for clip ${operation.clipId} is on a locked channel`)
      editor.unlinkClip(found.clip.id)
      editor.removeClipById(linked.clip.id)
      const liveVideo = editor.getClipById(clipId)?.clip
      if (!liveVideo || liveVideo.linkedClipId || editor.getClipById(linked.clip.id)) {
        throw new Error(`Timeline could not remove source audio for clip ${operation.clipId}`)
      }
      return true
    }
    case 'delete_clip': {
      const clipId = resolvedClipId(operation.clipId, clipResults)
      if (!editor.getClipById(clipId)) throw new Error(`Clip ${operation.clipId} no longer exists`)
      editor.removeClipById(clipId)
      return true
    }
    case 'apply_preset': {
      const clipId = resolvedClipId(operation.clipId, clipResults)
      if (!editor.getClipById(clipId)) throw new Error(`Clip ${operation.clipId} no longer exists`)
      if (!editor.applyClipLook(clipId, operation.presetId as Parameters<typeof editor.applyClipLook>[1])) throw new Error(`Cannot apply preset ${operation.presetId}`)
      return true
    }
    case 'add_transition':
    case 'update_transition': {
      const leftClipId = resolvedClipId(operation.leftClipId, clipResults)
      const rightClipId = resolvedClipId(operation.rightClipId, clipResults)
      const transition = editor.addTransition(operation.channelId, leftClipId, rightClipId, operation.effectId, operation.duration)
      if (!transition) throw new Error(`Cannot apply transition ${operation.effectId}`)
      const left = editor.getClipById(leftClipId)?.clip
      const right = editor.getClipById(rightClipId)?.clip
      if (!left || !right || !approximatelyEqual(clipEnd(left) - right.start, operation.duration)) {
        throw new Error(`Timeline could not apply the requested ${operation.duration}s transition`)
      }
      return true
    }
  }

  throw new Error(`Unsupported AI operation: ${operation.type}`)
}

interface PreparedAISpeechJob {
  job: AIEditSpeechJob
  generated: GeneratedSpeech
}

async function prepareSpeechJobs(jobs: AIEditSpeechJob[], signal?: AbortSignal): Promise<PreparedAISpeechJob[]> {
  const prepared: PreparedAISpeechJob[] = []
  for (const job of jobs) {
    const model = SPEECH_MODELS.find((candidate) => candidate.id === job.model)
    if (!model || !model.voices.some((voice) => voice === job.voice)) {
      throw new Error(`Voice ${job.voice} is not available for ${job.model}`)
    }
    const generated = await prepareSpeech({ input: job.input, model: model.id, voice: job.voice, ...(job.language ? { language: job.language } : {}), ...(job.instructions ? { instructions: job.instructions } : {}) }, signal)
    prepared.push({ job, generated })
  }
  return prepared
}

function applyPreparedSpeechJob({ job, generated }: PreparedAISpeechJob): void {
  const channel = editor.channels.find((candidate) => candidate.type === 'audio' && !candidate.locked)
    ?? editor.addChannel('audio')
  const prepared: PreparedMediaInsertion = {
    parsed: {
      fileName: generated.asset.name,
      sourceMode: 'proxy',
      mediaKind: 'audio',
      scrubBlobUrl: generated.blobUrl,
      sourceDuration: generated.duration,
    },
    mediaKind: 'audio',
    scrubBlobUrl: generated.blobUrl,
    audioBlobUrl: null,
    sourceDuration: generated.duration,
  }
  const added = insertPreparedMedia(channel, prepared, job.start, {
    sourceIn: 0,
    sourceOut: generated.duration,
    includeAudio: false,
    volume: job.volume,
  })
  if (!added) throw new Error('The generated speech could not be added to the timeline')
  editor.selectClip(added.primary.id)
}

export async function applyAIEditPlan(plan: AIEditPlan, expectedRevision: string, signal?: AbortSignal): Promise<number> {
  if (plan.revision !== expectedRevision) throw new Error('AI response does not match this timeline revision.')
  assertCurrentRevision(expectedRevision)
  if (plan.documentEdit) {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const edit = plan.documentEdit
    await executeDocumentEdit(edit, signal)
    return 1
  }
  const undoOperations = plan.operations.filter((operation): operation is Extract<AIEditOperation, { type: 'undo' }> => operation.type === 'undo')
  if (undoOperations.length > 0) {
    if ((plan.imageJobs?.length ?? 0) > 0 || (plan.speechJobs?.length ?? 0) > 0) throw new Error('Undo cannot be combined with generated media.')
    if (undoOperations.length !== plan.operations.length) throw new Error('Undo must be a separate AI edit.')
    let applied = 0
    for (const operation of undoOperations) {
      const count = Math.max(1, Math.min(100, operation.count ?? 1))
      for (let index = 0; index < count; index += 1) {
        if (!editor.undo()) break
        applied += 1
      }
    }
    return applied
  }
  const preparedMedia = await prepareMediaOperations(plan.operations)
  const preparedCaptions = await prepareAICaptions(plan.operations, signal)
  const preparedImages: PreparedAIImageJob[] = []
  for (const imageJob of plan.imageJobs ?? []) {
    preparedImages.push(await prepareAIImageJob(imageJob, signal))
  }
  const preparedSpeech = await prepareSpeechJobs(plan.speechJobs ?? [], signal)
  assertCurrentRevision(expectedRevision)
  const applied = editor.withHistoryTransaction(() => {
    let applied = 0
    const clipResults = new Map<string, string>()
    const appliedLooks = new Map<string, Parameters<typeof editor.applyClipLook>[1]>()
    const deletions = plan.operations
      .filter((operation): operation is Extract<AIEditOperation, { type: 'delete_range' }> => operation.type === 'delete_range')
      .sort((a, b) => b.start - a.start)
    for (const operation of deletions) {
      if (editor.deleteTimelineRange(operation.start, operation.end, operation.channelIds)) {
        applied += 1
      } else {
        throw new Error('A delete range conflicts with a locked linked clip or a ramped effect.')
      }
    }
    for (const operation of plan.operations) {
      if (operation.type === 'delete_range' || operation.type === 'add_text' && preparedCaptions.replaced.has(operation)) continue
      if (applyOperation(operation, preparedMedia, clipResults)) {
        applied += 1
        if (operation.type === 'apply_preset') {
          appliedLooks.set(
            resolvedClipId(operation.clipId, clipResults),
            operation.presetId as Parameters<typeof editor.applyClipLook>[1],
          )
        }
      }
    }
    // The model may place presets before transitions or later clip geometry
    // updates. Rebuild only their effect blocks once the final timing is known.
    for (const [clipId, lookId] of appliedLooks) {
      if (editor.getClipById(clipId) && !editor.refreshClipLookEffects(clipId, lookId)) {
        throw new Error(`Cannot align preset ${lookId} with clip ${clipId}`)
      }
    }
    applied += applyPreparedAICaptions(preparedCaptions.captions, clipResults, (operation, clip, start, duration, text, words) => {
      if (editor.textItems.length >= MAX_COMPOSITION_TEXT_ITEMS) throw new Error('AI captions exceed the project text item limit.')
      const style = resolvedTextStyle(operation, text, duration)
      editor.addTextItem(start, {
        duration, text, sourceClipId: clip.id,
        ...style,
        isCaption: true, words, highlightMode: words.length ? style.highlightMode : 'none',
      })
    })
    for (const preparedImage of preparedImages) {
      applyPreparedAIImageJob(preparedImage)
      applied += 1
    }
    for (const speech of preparedSpeech) {
      applyPreparedSpeechJob(speech)
      applied += 1
    }
    return applied
  })
  for (const preparedImage of preparedImages) registerPreparedAIImageJob(preparedImage)
  for (const speech of preparedSpeech) registerGeneratedSpeech(speech.generated)
  return applied
}

export async function planAIEdit(instruction: string, signal?: AbortSignal, fast = false): Promise<{ plan: AIEditPlan; revision: string }> {
  await waitForMediaBinLoads()
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  const project = buildAIProjectContext()
  const revision = aiProjectRevision(project)
  if (!/^(undo|anuleaz[ăa])\b/i.test(instruction.trim())) {
    const documentEdit = await planDocumentEdit(instruction.trim(), signal, fast)
    return { plan: { revision, mode: documentEdit.mode, summary: documentEdit.result.summary, operations: [], documentEdit }, revision }
  }
  const plan = await requestAIEdit(instruction.trim(), revision, project, signal, { fast })
  if (plan.revision !== revision) throw new Error('AI response does not match this timeline revision.')
  return { plan, revision }
}
