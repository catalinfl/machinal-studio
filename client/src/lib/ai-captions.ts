import { generateCaptions, type AIEditOperation } from './api'
import { getMediaBinSources } from './media-bin'
import { splitCaptionCueByWords, type SubtitleCue } from './subtitles'
import { clipEnd, clipPlaybackRate, editor, type Clip, type TimedTextWord } from '../stores/editor.svelte'
import { captions as captionSettings } from '../stores/captions.svelte'

type CaptionOperation = Extract<AIEditOperation, { type: 'add_text' }>

const captionPresets = new Set([
  'active-word', 'clean-phrase', 'caption-bounce', 'keyword-punch', 'quote-pull',
  'payoff-line', 'color-block', 'tiktok-pop', 'tiktok-box', 'tiktok-glow',
])

interface CaptionSource {
  key: string
  file: string
  kind: 'video' | 'audio'
  sourceMode?: string
  start: number
  inPoint: number
  outPoint: number
  rate: number
}

interface PreparedCaption {
  source: CaptionSource
  operation: CaptionOperation
  cues: SubtitleCue[]
  transcriptionStart: number
}

export function isAICaption(operation: AIEditOperation): operation is CaptionOperation {
  return operation.type === 'add_text'
    && (captionPresets.has(operation.textPresetId ?? '') || operation.style?.isCaption === true)
}

function captionSources(operations: AIEditOperation[]): CaptionSource[] {
  const deleted = new Set(operations.filter((operation) => operation.type === 'delete_clip').map((operation) => operation.clipId))
  for (const channel of editor.channels) {
    for (const clip of channel.clips) {
      if (clip.linkedClipId && deleted.has(clip.linkedClipId)) deleted.add(clip.id)
    }
  }
  const existing = editor.channels.flatMap((channel) => channel.clips
    .filter((clip) => !deleted.has(clip.id))
    .filter((clip) => clip.mediaKind !== 'image' && (channel.type === 'video' || channel.type === 'audio'))
    .filter((clip) => !clip.linkedClipId || channel.type !== 'audio')
    .map((clip) => ({
      key: clip.id, file: clip.fileName, kind: channel.type, sourceMode: clip.sourceMode,
      start: clip.start, inPoint: clip.inPoint, outPoint: clip.outPoint,
      rate: clipPlaybackRate(clip),
    })))
  const added = operations.flatMap((operation): CaptionSource[] => {
    if (operation.type !== 'add_media') return []
    const channel = editor.channels.find((candidate) => candidate.id === operation.channelId)
    if (!channel || channel.type !== 'video' && channel.type !== 'audio') return []
    const source = getMediaBinSources().find((candidate) => candidate.id === operation.sourceId)
    if (!source || source.kind === 'image') return []
    return [{
      key: operation.resultId, file: source.name, kind: channel.type, sourceMode: source.sourceMode,
      start: operation.start, inPoint: operation.sourceIn, outPoint: operation.sourceOut,
      rate: operation.playbackRate ?? 1,
    }]
  })
  return [...existing, ...added]
}

function sourcesForCaption(operation: CaptionOperation, sources: CaptionSource[]): CaptionSource[] {
  const selected = new Set(editor.selectedClipIds)
  const overlapping = sources.filter((source) => source.start < operation.start + operation.duration
    && operation.start < source.start + (source.outPoint - source.inPoint) / source.rate)
  const chosen = overlapping.filter((source) => selected.has(source.key))
  if (chosen.length) return chosen
  const video = overlapping.filter((source) => source.kind === 'video')
  if (video.length) return video
  if (overlapping.length) return overlapping
  const selectedSources = sources.filter((source) => selected.has(source.key))
  return selectedSources.length ? selectedSources : sources.length === 1 ? sources : []
}

export async function prepareAICaptions(operations: AIEditOperation[], signal?: AbortSignal): Promise<{
  captions: PreparedCaption[]
  replaced: Set<CaptionOperation>
}> {
  const sources = captionSources(operations)
  const replaced = new Set<CaptionOperation>()
  const captions: PreparedCaption[] = []
  const transcripts = new Map<string, Promise<SubtitleCue[]>>()

  for (const operation of operations) {
    if (!isAICaption(operation) || sources.length === 0) continue
    const targets = sourcesForCaption(operation, sources)
    if (targets.length === 0) throw new Error('Could not identify the audio clip for AI captions.')
    for (const source of targets) {
      if (source.sourceMode === 'wasm') throw new Error('AI captions require media uploaded to the server.')
      const transcriptionStart = source.inPoint
      const transcriptionDuration = source.outPoint - source.inPoint
      if (transcriptionDuration <= 0) throw new Error('The selected audio clip has no duration.')
      const transcriptKey = `${source.file}\0${transcriptionStart}\0${transcriptionDuration}`
      if (!transcripts.has(transcriptKey)) {
        transcripts.set(transcriptKey, generateCaptions({
          file: source.file, start: transcriptionStart, duration: transcriptionDuration,
          ...(captionSettings.captionLanguage !== 'auto' ? { language: captionSettings.captionLanguage } : {}),
        }, signal).then((response) => response.cues.flatMap((cue) => splitCaptionCueByWords(cue, 4))))
      }
      const cues = await transcripts.get(transcriptKey)!
      captions.push({ source, operation, cues, transcriptionStart })
    }
    replaced.add(operation)
  }
  if (captions.length > 0 && captions.every((caption) => caption.cues.length === 0)) {
    throw new Error('No timestamped speech was found for AI captions.')
  }
  return { captions, replaced }
}

function captionWindow(clip: Clip): { start: number; end: number } {
  let start = clip.start
  let end = clipEnd(clip)
  for (const transition of editor.transitions) {
    if (transition.rightClipId === clip.id) {
      const left = editor.getClipById(transition.leftClipId)?.clip
      if (left) start = Math.max(start, clipEnd(left))
    }
    if (transition.leftClipId === clip.id) {
      const right = editor.getClipById(transition.rightClipId)?.clip
      if (right) end = Math.min(end, right.start)
    }
  }
  return { start, end }
}

export function applyPreparedAICaptions(
  captions: PreparedCaption[],
  clipResults: Map<string, string>,
  add: (operation: CaptionOperation, clip: Clip, start: number, duration: number, text: string, words: TimedTextWord[]) => void,
): number {
  let count = 0
  const seen = new Set<string>()
  for (const { source, operation, cues, transcriptionStart } of captions) {
    const clip = editor.getClipById(clipResults.get(source.key) ?? source.key)?.clip
    if (!clip) continue
    const { start: safeStart, end: safeEnd } = captionWindow(clip)
    const rate = clipPlaybackRate(clip)
    for (const cue of cues) {
      const words = (cue.words ?? []).map((word) => ({
        text: word.text,
        start: clip.start + (transcriptionStart + word.start - clip.inPoint) / rate,
        end: clip.start + (transcriptionStart + word.end - clip.inPoint) / rate,
      })).filter((word) => word.start >= safeStart - 0.001 && word.end <= safeEnd + 0.001 && word.end > word.start)
      const cueStart = words.length ? words[0].start : clip.start + (transcriptionStart + cue.start - clip.inPoint) / rate
      const cueEnd = words.length ? words.at(-1)!.end : clip.start + (transcriptionStart + cue.end - clip.inPoint) / rate
      if (cueStart < safeStart - 0.001 || cueEnd > safeEnd + 0.001 || cueEnd <= cueStart) continue
      const key = `${clip.id}:${cueStart}:${cueEnd}`
      if (seen.has(key)) continue
      seen.add(key)
      add(operation, clip, cueStart, cueEnd - cueStart, words.length ? words.map((word) => word.text).join(' ') : cue.text,
        words.map((word) => ({ text: word.text, start: word.start - cueStart, end: word.end - cueStart })))
      count += 1
    }
  }
  if (captions.length > 0 && count === 0) throw new Error('No spoken captions fit the final timeline outside its transitions.')
  return count
}
