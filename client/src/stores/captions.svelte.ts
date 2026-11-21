import { generateCaptions } from '../lib/api'
import { MAX_COMPOSITION_TEXT_ITEMS } from '../lib/composition-types'
import { groupCaptionCuesByWords, wrapSubtitleText, type CaptionDraft } from '../lib/subtitles'
import {
  clipPlaybackRate,
  clipTimelineDuration,
  editor,
  textDesignSize,
  type Clip,
  type TextItem,
} from './editor.svelte'

export type SubtitleState =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; message: string }

const longAudioThresholdSeconds = 10
const longAudioMinimumLoadingMs = 3000

const captionLanguageStorageKey = 'scrub-caption-language'

export interface CaptionLanguageOption {
  code: string
  label: string
}

export const CAPTION_LANGUAGES: CaptionLanguageOption[] = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'ar', label: 'العربية' },
  { code: 'az', label: 'Azərbaycan dili' },
  { code: 'be', label: 'Беларуская' },
  { code: 'bg', label: 'Български' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'bs', label: 'Bosanski' },
  { code: 'ca', label: 'Català' },
  { code: 'cs', label: 'Čeština' },
  { code: 'cy', label: 'Cymraeg' },
  { code: 'da', label: 'Dansk' },
  { code: 'de', label: 'Deutsch' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'es', label: 'Español' },
  { code: 'et', label: 'Eesti' },
  { code: 'fa', label: 'فارسی' },
  { code: 'fi', label: 'Suomi' },
  { code: 'fr', label: 'Français' },
  { code: 'gl', label: 'Galego' },
  { code: 'he', label: 'עברית' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'hr', label: 'Hrvatski' },
  { code: 'hu', label: 'Magyar' },
  { code: 'hy', label: 'Հայերեն' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'is', label: 'Íslenska' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'kk', label: 'Қазақша' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ko', label: '한국어' },
  { code: 'lt', label: 'Lietuvių' },
  { code: 'lv', label: 'Latviešu' },
  { code: 'mk', label: 'Македонски' },
  { code: 'mi', label: 'Māori' },
  { code: 'mr', label: 'मराठी' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'ne', label: 'नेपाली' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'no', label: 'Norsk' },
  { code: 'pl', label: 'Polski' },
  { code: 'pt', label: 'Português' },
  { code: 'ro', label: 'Română' },
  { code: 'ru', label: 'Русский' },
  { code: 'sk', label: 'Slovenčina' },
  { code: 'sl', label: 'Slovenščina' },
  { code: 'sr', label: 'Српски' },
  { code: 'sv', label: 'Svenska' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'th', label: 'ไทย' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
  { code: 'ur', label: 'اردو' },
  { code: 'vi', label: 'Tiếng Việt' },
]

function loadCaptionLanguage(): string {
  // Default to Romanian: without an explicit language hint Whisper
  // auto-detection is English-biased and short Romanian clips are often
  // transcribed/translated as English.
  if (typeof localStorage === 'undefined') return 'ro'
  try {
    const stored = (localStorage.getItem(captionLanguageStorageKey) ?? '').trim().toLowerCase()
    if (stored === 'auto') return 'auto'
    if (/^[a-z]{2}$/.test(stored)) return stored
  } catch {
    // Ignore storage errors and fall back to the default.
  }
  return 'ro'
}

function persistCaptionLanguage(language: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(captionLanguageStorageKey, language)
  } catch {
    // Persistence is best-effort only.
  }
}

let subtitleState = $state<SubtitleState>({ kind: 'idle' })
let captionDrafts = $state<CaptionDraft[]>([])
let lastTranscript = $state<CaptionDraft[]>([])
let captionDialogMode = $state<'create' | 'edit'>('create')
let captionDialogKind = $state<'caption' | 'text'>('caption')
let captionDialogOpen = $state(false)
let captionSourceDialogOpen = $state(false)
let captionSourceSelection = $state<Clip[]>([])
let captionLanguage = $state<string>(loadCaptionLanguage())

function setCaptionLanguage(language: string): void {
  const normalized = (language ?? '').trim().toLowerCase()
  if (normalized !== 'auto' && !/^[a-z]{2}$/.test(normalized)) return
  if (normalized === captionLanguage) return
  captionLanguage = normalized
  persistCaptionLanguage(normalized)
}

function isAudioClip(clip: Clip): boolean {
  return clip.mediaKind === 'audio' || editor.getClipById(clip.id)?.channel.type === 'audio'
}

function selectedMediaClips(): Clip[] {
  const selectedIds = new Set(editor.selectedClipIds)
  const selected = editor.channels
    .flatMap((channel) => channel.clips)
    .filter((clip) => selectedIds.has(clip.id))
  return selected.filter((clip) => {
    if (!clip.linkedClipId || !selectedIds.has(clip.linkedClipId)) return true
    const linked = selected.find((candidate) => candidate.id === clip.linkedClipId)
    return clip.mediaKind === 'video' || linked?.mediaKind !== 'video'
  })
}

function hasOverlappingSelectedAudio(clips: Clip[]): boolean {
  const audioClips = clips.filter((clip) => {
    if (isAudioClip(clip)) return true
    const linked = clip.linkedClipId ? editor.getClipById(clip.linkedClipId) : null
    return linked?.channel.type === 'audio'
  })
  for (let leftIndex = 0; leftIndex < audioClips.length; leftIndex++) {
    const left = audioClips[leftIndex]
    const leftEnd = left.start + clipTimelineDuration(left)
    for (let rightIndex = leftIndex + 1; rightIndex < audioClips.length; rightIndex++) {
      const right = audioClips[rightIndex]
      const rightEnd = right.start + clipTimelineDuration(right)
      if (left.start < rightEnd - 0.001 && right.start < leftEnd - 0.001) return true
    }
  }
  return false
}

function cloneDraft(draft: CaptionDraft): CaptionDraft {
  return { ...draft, words: draft.words.map((word) => ({ ...word })) }
}

async function generateSubtitles(sourceClips?: Clip[]): Promise<void> {
  subtitleState = { kind: 'idle' }
  const selected = sourceClips ?? selectedMediaClips()

  if (selected.length === 0 || (!sourceClips && hasOverlappingSelectedAudio(selected))) {
    captionSourceSelection = selected
    captionSourceDialogOpen = true
    return
  }
  const clips = selected.filter((clip) => clip.mediaKind !== 'image')
  if (clips.length === 0) {
    subtitleState = { kind: 'error', message: 'Subtitles cannot be generated from an image.' }
    return
  }
  if (clips.some((clip) => clip.sourceMode === 'wasm')) {
    subtitleState = { kind: 'error', message: 'Automatic subtitles currently require media uploaded to the server.' }
    return
  }

  const hasLongAudio = clips.some((clip) => isAudioClip(clip) && clip.outPoint - clip.inPoint > longAudioThresholdSeconds)
  const loadingStartedAt = Date.now()
  let readyDrafts: CaptionDraft[] | null = null
  subtitleState = { kind: 'generating' }
  try {
    const design = textDesignSize(editor.effectiveProjectAspect)
    const lineLength = editor.effectiveProjectAspect === 'portrait' ? 28 : 44
    const drafts: CaptionDraft[] = []

    for (const clip of clips) {
      const sourceDuration = clip.outPoint - clip.inPoint
      const response = await generateCaptions({
        file: clip.fileName,
        start: clip.inPoint,
        duration: sourceDuration,
        ...(captionLanguage !== 'auto' ? { language: captionLanguage } : {}),
      })
      const rate = clipPlaybackRate(clip)
      const captionCues = groupCaptionCuesByWords(response.cues, 1)
      for (const [cueIndex, cue] of captionCues.entries()) {
        const cueStart = Math.max(0, Math.min(sourceDuration, cue.start))
        const cueEnd = Math.max(cueStart, Math.min(sourceDuration, cue.end))
        if (cueEnd <= cueStart) continue

        const duration = (cueEnd - cueStart) / rate
        const cueWords = cue.words ?? []
        drafts.push({
          draftId: `${clip.id}:${cueIndex}`,
          sourceLabel: clip.fileName,
          included: true,
          sourceClipId: clip.id,
          start: clip.start + cueStart / rate,
          duration,
          text: wrapSubtitleText(cue.text, lineLength),
          x: design.w / 2,
          y: Math.round(design.h * 0.82),
          fontFamily: 'montserrat',
          fontSize: 54,
          align: 'center',
          color: '#ffffff',
          backgroundColor: '#000000',
          backgroundOpacity: 0,
          backgroundPadding: 18,
          backgroundRadius: 8,
          bannerStyle: 'none',
          accentColor: '#7047c7',
          animation: 'none',
          animationDuration: 0.45,
          strokeColor: '#000000',
          strokeWidth: 4,
          fontWeight: 700,
          italic: false,
          opacity: 1,
          rotation: 0,
          isCaption: true,
          highlightMode: cueWords.length > 0 ? 'word' : 'none',
          highlightColor: '#fff36d',
          highlightBackgroundColor: '#000000',
          highlightBackgroundOpacity: 0,
          highlightAnimation: 'pop',
          words: cueWords.flatMap((word) => {
            const start = Math.max(0, Math.min(duration, (word.start - cueStart) / rate))
            const end = Math.max(start, Math.min(duration, (word.end - cueStart) / rate))
            return word.text.trim() && end > start ? [{ text: word.text.trim(), start, end }] : []
          }),
        })
      }
    }

    drafts.sort((left, right) => left.start - right.start)
    if (drafts.length === 0) throw new Error('The transcription did not contain timestamped speech in the selected clips.')
    readyDrafts = drafts
  } catch (cause) {
    subtitleState = { kind: 'error', message: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    const remainingLoadingMs = longAudioMinimumLoadingMs - (Date.now() - loadingStartedAt)
    if (hasLongAudio && remainingLoadingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingLoadingMs))
    }
    if (subtitleState.kind === 'generating') subtitleState = { kind: 'idle' }
  }
  if (readyDrafts) {
    captionDialogMode = 'create'
    captionDrafts = readyDrafts
    lastTranscript = readyDrafts.map(cloneDraft)
    captionDialogOpen = true
    subtitleState = { kind: 'ready', message: 'Transcription ready for review.' }
  }
}

function addCaptionDrafts(drafts: CaptionDraft[]): void {
  if (editor.textItems.length + drafts.length > MAX_COMPOSITION_TEXT_ITEMS) {
    subtitleState = { kind: 'error', message: `The selected captions would exceed the ${MAX_COMPOSITION_TEXT_ITEMS} text item project limit.` }
    return
  }
  const ids: string[] = []
  editor.withHistoryTransaction(() => {
    for (const draft of drafts) {
      const { draftId: _draftId, sourceLabel: _sourceLabel, included: _included, start, ...values } = draft
      ids.push(editor.addTextItem(start, values).id)
    }
  })
  editor.selectItems([], [], ids)
  // The active review is consumed, but the added (already user-edited) drafts
  // stay in the transcript so the captions can be re-added without a new
  // transcription when they are deleted from the timeline.
  captionDrafts = []
  lastTranscript = drafts.map((draft) => ({ ...cloneDraft(draft), included: true }))
  captionDialogOpen = false
  subtitleState = { kind: 'ready', message: `Added ${ids.length} caption${ids.length === 1 ? '' : 's'} to the timeline.` }
}

function editSelectedText(captionsToEdit: TextItem[]): void {
  if (captionsToEdit.length === 0) return
  captionDialogMode = 'edit'
  captionDialogKind = captionsToEdit.every((item) => item.isCaption) ? 'caption' : 'text'
  captionDrafts = captionsToEdit.map((item) => ({
    ...item,
    words: item.words.map((word) => ({ ...word })),
    draftId: item.id,
    sourceLabel: 'Timeline caption',
    included: true,
  }))
  captionDialogOpen = true
}

function openCaptionDialog(): void {
  if (captionDrafts.length === 0) return
  captionDialogOpen = true
}

function saveCaptionDrafts(drafts: CaptionDraft[]): void {
  const originalIds = new Set(captionDrafts.map((draft) => draft.draftId))
  const regrouped = drafts.some((draft) => !originalIds.has(draft.draftId))
  if (!regrouped) {
    editor.withHistoryTransaction(() => {
      for (const draft of drafts) {
        const { draftId, sourceLabel: _sourceLabel, included: _included, ...updates } = draft
        editor.updateTextItem(draftId, updates)
      }
    })
    captionDrafts = []
    captionDialogOpen = false
    subtitleState = { kind: 'ready', message: `Updated ${drafts.length} caption${drafts.length === 1 ? '' : 's'}.` }
    return
  }
  // Words-per-caption changed in the edit dialog: the cue list was
  // re-chunked, so ids no longer map 1:1. Replace the whole edited set.
  const removedCount = captionDrafts.length
  if (editor.textItems.length - removedCount + drafts.length > MAX_COMPOSITION_TEXT_ITEMS) {
    subtitleState = { kind: 'error', message: `The regrouped captions would exceed the ${MAX_COMPOSITION_TEXT_ITEMS} text item project limit.` }
    return
  }
  const ids: string[] = []
  editor.withHistoryTransaction(() => {
    for (const original of captionDrafts) editor.removeTextItem(original.draftId)
    for (const draft of drafts) {
      const { draftId: _draftId, sourceLabel: _sourceLabel, included: _included, start, ...values } = draft
      ids.push(editor.addTextItem(start, values).id)
    }
  })
  editor.selectItems([], [], ids)
  captionDrafts = []
  captionDialogOpen = false
  subtitleState = { kind: 'ready', message: `Updated ${ids.length} caption${ids.length === 1 ? '' : 's'}.` }
}

function openTranscriptReview(): void {
  if (lastTranscript.length === 0) return
  captionDialogMode = 'create'
  captionDialogKind = 'caption'
  captionDrafts = lastTranscript.map(cloneDraft)
  captionDialogOpen = true
}

function dismissCaptionDialog(snapshot?: CaptionDraft[]): void {
  if (captionDialogMode === 'edit') {
    // Timeline stays the source of truth for explicit caption edits.
    captionDrafts = []
  } else if (snapshot && snapshot.length > 0) {
    // Closing the review with X/Cancel keeps the in-dialog edits so they can
    // be reopened from "Edit generated captions" without re-transcribing.
    captionDrafts = snapshot.map(cloneDraft)
    lastTranscript = snapshot.map(cloneDraft)
  }
  captionDialogOpen = false
}

function generateFromSources(clips: Clip[]): void {
  captionSourceDialogOpen = false
  captionSourceSelection = []
  void generateSubtitles(clips)
}

function cancelSourceSelection(): void {
  captionSourceDialogOpen = false
  captionSourceSelection = []
}

/** Test-only reset so caption state never leaks between test cases. */
export function resetCaptions(): void {
  subtitleState = { kind: 'idle' }
  captionDrafts = []
  lastTranscript = []
  captionDialogMode = 'create'
  captionDialogKind = 'caption'
  captionDialogOpen = false
  captionSourceDialogOpen = false
  captionSourceSelection = []
  captionLanguage = 'ro'
  persistCaptionLanguage('ro')
}

export const captions = {
  get subtitleState() { return subtitleState },
  get generatingSubtitles() { return subtitleState.kind === 'generating' },
  get subtitleError() { return subtitleState.kind === 'error' ? subtitleState.message : '' },
  get subtitleStatus() { return subtitleState.kind === 'ready' ? subtitleState.message : '' },
  get captionDrafts() { return captionDrafts },
  get captionDialogMode() { return captionDialogMode },
  get captionDialogKind() { return captionDialogKind },
  get captionDialogOpen() { return captionDialogOpen },
  get captionSourceDialogOpen() { return captionSourceDialogOpen },
  get captionSourceSelection() { return captionSourceSelection },
  get captionLanguage() { return captionLanguage },
  get hasTranscript() { return lastTranscript.length > 0 },
  generateSubtitles,
  addCaptionDrafts,
  editSelectedText,
  openCaptionDialog,
  openTranscriptReview,
  saveCaptionDrafts,
  dismissCaptionDialog,
  generateFromSources,
  cancelSourceSelection,
  setCaptionLanguage,
}
