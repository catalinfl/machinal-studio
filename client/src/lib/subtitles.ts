import type { TextItem, TimedTextWord } from '../stores/editor.svelte'

export interface SubtitleCue {
  start: number
  end: number
  text: string
  words?: TimedTextWord[]
}

export interface CaptionDraft extends Omit<TextItem, 'id'> {
  draftId: string
  sourceLabel: string
  included: boolean
}

const TIME_RANGE_RE =
  /^\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})(?:\s+.*)?$/

function timestampSeconds(
  match: RegExpMatchArray,
  offset: number,
): number {
  const hours = Number(match[offset])
  const minutes = Number(match[offset + 1])
  const seconds = Number(match[offset + 2])
  const milliseconds = Number(
    match[offset + 3].padEnd(3, '0').slice(0, 3),
  )

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
}

export function parseSRT(source: string): SubtitleCue[] {
  const normalized = source
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim()

  if (!normalized) return []

  const cues: SubtitleCue[] = []

  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const timestampIndex = lines.findIndex((line) => line.includes('-->'))
    if (timestampIndex < 0) continue

    const match = TIME_RANGE_RE.exec(lines[timestampIndex])
    if (!match) continue

    const start = timestampSeconds(match, 1)
    const end = timestampSeconds(match, 5)
    const text = lines.slice(timestampIndex + 1).join('\n').trim()

    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue
    }

    cues.push({ start, end, text })
  }

  return cues.sort((a, b) => a.start - b.start)
}

export function wrapSubtitleText(
  text: string,
  maxCharacters = 42,
): string {
  const output: string[] = []

  for (const paragraph of text.split(/\n+/)) {
    let line = ''

    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && candidate.length > maxCharacters) {
        output.push(line)
        line = word
      } else {
        line = candidate
      }
    }

    if (line) output.push(line)
  }

  return output.join('\n')
}

function timedWordsForCue(cue: SubtitleCue): TimedTextWord[] {
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || cue.end <= cue.start) return []

  if (cue.words?.length === tokens.length && cue.words.every(word => word.text.trim().split(/\s+/).length === 1)) return cue.words

  return []
}

export function splitCaptionCueByWords(
  cue: SubtitleCue,
  wordsPerCaption: number,
): SubtitleCue[] {
  const chunkSize = Number.isFinite(wordsPerCaption)
    ? Math.max(1, Math.floor(wordsPerCaption))
    : 1
  const timedWords = timedWordsForCue(cue)
  if (timedWords.length === 0) return [cue.words?.length ? { ...cue, words: [] } : cue]

  const chunks: SubtitleCue[] = []
  for (let index = 0; index < timedWords.length; index += chunkSize) {
    const words = timedWords.slice(index, index + chunkSize)
    chunks.push({
      start: words[0].start,
      end: words.at(-1)!.end,
      text: words.map((word) => word.text).join(' '),
      words,
    })
  }
  return chunks
}

export function groupCaptionCuesByWords(
  cues: SubtitleCue[],
  wordsPerCaption: number,
): SubtitleCue[] {
  const words = cues
    .flatMap(timedWordsForCue)
    .sort((left, right) => left.start - right.start)

  const phrases = cues.filter(cue => timedWordsForCue(cue).length === 0)
    .map(cue => cue.words?.length ? { ...cue, words: [] } : cue)
  if (words.length === 0) return phrases

  const chunkSize = Number.isFinite(wordsPerCaption)
    ? Math.max(1, Math.floor(wordsPerCaption))
    : 1
  const groupedCues: SubtitleCue[] = []

  for (let index = 0; index < words.length; index += chunkSize) {
    const group = words.slice(index, index + chunkSize)
    groupedCues.push({
      start: group[0].start,
      end: group.at(-1)!.end,
      text: group.map((word) => word.text).join(' '),
      words: group,
    })
  }

  return [...groupedCues, ...phrases].sort((left, right) => left.start - right.start)
}

export function groupCaptionDraftsByWords(
  drafts: CaptionDraft[],
  wordsPerCaption: number,
): CaptionDraft[] {
  const chunkSize = Number.isFinite(wordsPerCaption)
    ? Math.max(1, Math.floor(wordsPerCaption))
    : 1
  const draftsByClip = new Map<string, CaptionDraft[]>()

  for (const draft of drafts) {
    const separator = draft.draftId.lastIndexOf(':')
    // Timeline items edited via "Edit captions" use raw text-item ids without
    // a clip prefix. Bucket them together so re-chunking can merge/split
    // across the whole selection instead of dropping a character per id.
    const clipId = separator > 0 ? draft.draftId.slice(0, separator) : '__timeline__'
    const clipDrafts = draftsByClip.get(clipId) ?? []
    clipDrafts.push(draft)
    draftsByClip.set(clipId, clipDrafts)
  }

  const groupedDrafts: CaptionDraft[] = []
  const wordlessDrafts: CaptionDraft[] = []
  for (const [clipId, clipDrafts] of draftsByClip) {
    const timedWords = clipDrafts
      .flatMap((draft) => draft.words.map((word) => ({
        draft,
        text: word.text,
        start: draft.start + word.start,
        end: draft.start + word.end,
      })))
      .sort((left, right) => left.start - right.start)

    // Text layers without word timing cannot be re-chunked: keep them as-is
    // so a regroup never deletes them.
    if (timedWords.length === 0) {
      wordlessDrafts.push(...clipDrafts)
      continue
    }
    wordlessDrafts.push(...clipDrafts.filter(draft => draft.words.length === 0))

    for (let index = 0; index < timedWords.length; index += chunkSize) {
      const group = timedWords.slice(index, index + chunkSize)
      const start = group[0].start
      const end = group.at(-1)!.end
      const template = group[0].draft
      groupedDrafts.push({
        ...template,
        draftId: `${clipId}:${index}-${index + group.length - 1}`,
        included: group.every((word) => word.draft.included),
        start,
        duration: Number((end - start).toFixed(9)),
        text: group.map((word) => word.text).join(' '),
        words: group.map((word) => ({
          text: word.text,
          start: Number((word.start - start).toFixed(9)),
          end: Number((word.end - start).toFixed(9)),
        })),
      })
    }
  }

  return [...groupedDrafts, ...wordlessDrafts].sort((left, right) => left.start - right.start)
}

export function captionWordsForText(
  text: string,
  duration: number,
  current: TimedTextWord[] = [],
): TimedTextWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || duration <= 0) return []
  if (tokens.length === current.length && current.every(word => word.text.trim().split(/\s+/).length === 1)) {
    return current.map((word, index) => ({
      text: tokens[index],
      start: Math.max(0, Math.min(duration, word.start)),
      end: Math.max(0, Math.min(duration, word.end)),
    })).filter((word) => word.end > word.start)
  }
  return []
}

export function scaleCaptionWords(
  words: TimedTextWord[],
  previousDuration: number,
  duration: number,
): TimedTextWord[] {
  if (previousDuration <= 0 || duration <= 0) return []
  const scale = duration / previousDuration
  return words.map((word) => ({
    ...word,
    start: Math.max(0, Math.min(duration, word.start * scale)),
    end: Math.max(0, Math.min(duration, word.end * scale)),
  })).filter((word) => word.end > word.start)
}

export function formatCaptionTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor(milliseconds / 60_000) % 60
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60
  const millis = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}
