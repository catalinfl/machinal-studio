import { onMount, untrack } from 'svelte'
import type { TextAnimation, TextHighlightAnimation } from '../stores/editor.svelte'
import { captionWordsForText, groupCaptionDraftsByWords, scaleCaptionWords, type CaptionDraft } from '../lib/subtitles'
import { captionStyleForPreset, BEST_TEXT_PRESETS, MORE_TEXT_PRESETS, SHORT_FORM_TEXT_PRESETS, TEXT_ANIMATION_OPTIONS, WORD_ANIMATION_OPTIONS, textAnimationOption, type ShortFormTextPreset } from '../lib/text-presets'
import { TEXT_FONT_CATEGORIES, TEXT_FONTS } from '../lib/text-render'
import { commonCaptionValue, liveCaptionPreviewPosition, liveCaptionPreviewSubtitleStyle, liveCaptionPreviewTextStyle, type CaptionStyleKey } from '../lib/caption-editor'

// Live preview loop: the active word advances every tick, the entrance
// motion replays every loop, so motion is visible "per second" in the dialog.
const PREVIEW_TICK_MS = 400
const PREVIEW_TICKS_PER_LOOP = 6

interface Options {
  getDrafts: () => CaptionDraft[]
  getMaxItems: () => number
  getMode: () => 'create' | 'edit'
  getKind: () => 'caption' | 'text'
  getOnCancel: () => (drafts: CaptionDraft[]) => void
  getOnAdd: () => (drafts: CaptionDraft[]) => void
}

export function useCaptionEditorDialog(options: Options) {
  let dialogEl = $state<HTMLDialogElement>()
  let workingDrafts = $state<CaptionDraft[]>([])
  let wordsPerCaption = $state(4)
  let captionLanguage = $state('auto')
  let selectedPresetId = $state<string | null>(null)
  let wordMotionOverride: TextHighlightAnimation | null = null
  let initialized = $state(false)
  let previewPlaying = $state(true)
  let previewTick = $state(0)
  const includedDrafts = $derived(workingDrafts.filter((draft) => draft.included))
  const exceedsLimit = $derived(
    options.getMode() === 'create'
      ? includedDrafts.length > options.getMaxItems()
      : includedDrafts.length - options.getDrafts().length > options.getMaxItems(),
  )
  const styleReference = $derived(includedDrafts[0] ?? workingDrafts[0] ?? null)
  const commonValue = (key: CaptionStyleKey): string | number | boolean => commonCaptionValue(includedDrafts, key)
  const selectedPreset = $derived(SHORT_FORM_TEXT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? null)
  const selectedFont = $derived(TEXT_FONTS.find((font) => font.id === commonValue('fontFamily')) ?? null)
  const selectedAnimation = $derived(textAnimationOption((commonValue('animation') || undefined) as TextAnimation | undefined))
  const fontPreviewText = $derived(styleReference?.text.replace(/\s+/g, ' ').trim() || (options.getKind() === 'text' ? 'Your text preview' : 'Your caption preview'))

  // Live preview reads the FIRST included caption, so size, font, color,
  // treatment and motion edits show instantly on real text.
  const previewWords = $derived.by((): string[] => {
    const text = (includedDrafts[0] ?? workingDrafts[0])?.text.replace(/\s+/g, ' ').trim() ?? ''
    const words = text.split(' ').filter(Boolean)
    return words.length > 0 ? words.slice(0, 12) : ['Your', 'caption', 'preview']
  })
  const previewCycle = $derived(Math.floor(previewTick / PREVIEW_TICKS_PER_LOOP))
  const previewActiveWordIndex = $derived(previewWords.length > 0 ? previewTick % previewWords.length : 0)
  const livePreviewPosition = $derived(liveCaptionPreviewPosition(styleReference))
  const livePreviewTextStyle = $derived(liveCaptionPreviewTextStyle(styleReference))
  const livePreviewSubtitleStyle = $derived(liveCaptionPreviewSubtitleStyle(styleReference))
  const livePreviewAnimation = $derived(styleReference?.animation ?? 'none')
  const livePreviewMotionDuration = $derived(
    styleReference && Number.isFinite(styleReference.animationDuration) && styleReference.animationDuration > 0
      ? styleReference.animationDuration
      : 0.45,
  )
  const livePreviewHighlightOn = $derived(styleReference?.highlightMode === 'word')
  const livePreviewHighlightAnimation = $derived(styleReference?.highlightAnimation ?? 'pop')
  const livePreviewWordMotionClass = $derived(
    livePreviewHighlightAnimation === 'pop'
      ? 'motion-pop'
      : livePreviewHighlightAnimation === 'bounce'
        ? 'motion-bounce'
        : livePreviewHighlightAnimation === 'slide-up'
          ? 'motion-slide-up'
          : '',
  )
  const previewHeadingLabel = $derived(selectedPreset?.label ?? 'Custom style')

  $effect(() => {
    if (!previewPlaying) return
    if (typeof window === 'undefined') return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      untrack(() => { previewTick += 1 })
    }, PREVIEW_TICK_MS)
    return () => window.clearInterval(id)
  })

  const togglePreviewPlaying = (): void => {
    previewPlaying = !previewPlaying
  }
  const replayPreview = (): void => {
    previewTick = (Math.floor(previewTick / PREVIEW_TICKS_PER_LOOP) + 1) * PREVIEW_TICKS_PER_LOOP
  }

  $effect.pre(() => {
    if (initialized) return
    const sourceDrafts = options.getDrafts().map((draft) => ({ ...draft, words: draft.words.map((word) => ({ ...word })) }))
    if (options.getMode() === 'edit') {
      // Infer the current chunking so the control reflects the timeline
      // selection (e.g. 1 word/caption for TikTok pop) instead of resetting
      // to 4 on every edit.
      const wordCounts = sourceDrafts.map((draft) => draft.words.length > 0 ? draft.words.length : draft.text.trim().split(/\s+/).filter(Boolean).length)
      const total = wordCounts.reduce((sum, count) => sum + count, 0)
      if (wordCounts.length > 0 && total > 0) {
        wordsPerCaption = Math.min(12, Math.max(1, Math.round(total / wordCounts.length)))
      }
      workingDrafts = sourceDrafts
    } else {
      workingDrafts = groupCaptionDraftsByWords(sourceDrafts, wordsPerCaption)
    }
    initialized = true
  })

  const inputValue = (event: Event): string => (event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
  const numberValue = (event: Event): number | null => {
    const parsed = Number(inputValue(event))
    return Number.isFinite(parsed) ? parsed : null
  }

  const applyStyle = <K extends CaptionStyleKey>(key: K, value: CaptionDraft[K]): void => {
    for (const draft of includedDrafts) draft[key] = value
    if (key === 'highlightAnimation') wordMotionOverride = value as TextHighlightAnimation
    if (key !== 'highlightAnimation' && key !== 'highlightMode' && key !== 'animation' && key !== 'animationDuration') {
      selectedPresetId = null
    }
  }

  const applyPreset = (preset: ShortFormTextPreset): void => {
    const style = captionStyleForPreset(preset)
    if (wordMotionOverride !== null) style.highlightAnimation = wordMotionOverride
    for (const draft of includedDrafts) Object.assign(draft, style)
    selectedPresetId = preset.id
  }

  const selectPresetById = (id: string): void => {
    const preset = SHORT_FORM_TEXT_PRESETS.find((candidate) => candidate.id === id)
    if (preset) applyPreset(preset)
  }

  const clearPreset = (): void => { selectedPresetId = null }
  const toggleFontWeight = (): void => applyStyle('fontWeight', commonValue('fontWeight') === 700 ? 400 : 700)
  const toggleItalic = (): void => applyStyle('italic', commonValue('italic') !== true)
  const styleNumber = (key: CaptionStyleKey) => (event: Event): void => {
    const next = numberValue(event)
    if (next !== null) applyStyle(key, next as CaptionDraft[typeof key])
  }
  const styleValue = (key: CaptionStyleKey) => (event: Event): void => {
    setStyleValue(key, inputValue(event))
  }
  const setStyleValue = (key: CaptionStyleKey, value: string): void => {
    const next = key === 'isCaption'
      ? value === 'caption'
      : value as CaptionDraft[typeof key]
    applyStyle(key, next as CaptionDraft[typeof key])
  }
  const updateDraftStartFor = (draft: CaptionDraft) => (event: Event): void => updateDraftStart(draft, event)
  const updateDraftEndFor = (draft: CaptionDraft) => (event: Event): void => updateDraftEnd(draft, event)
  const updateDraftTextFor = (draft: CaptionDraft) => (event: Event): void => updateDraftText(draft, event)

  const updateDraftText = (draft: CaptionDraft, event: Event): void => {
    draft.text = inputValue(event)
    draft.words = captionWordsForText(draft.text, draft.duration, draft.words)
    if (draft.words.length === 0) draft.highlightMode = 'none'
  }
  const updateDraftStart = (draft: CaptionDraft, event: Event): void => {
    const start = numberValue(event)
    if (start !== null) draft.start = Math.max(0, start)
  }
  const updateDraftEnd = (draft: CaptionDraft, event: Event): void => {
    const end = numberValue(event)
    if (end === null) return
    const duration = Math.max(0.2, end - draft.start)
    draft.words = scaleCaptionWords(draft.words, draft.duration, duration)
    draft.duration = duration
  }
  const setAll = (included: boolean): void => {
    for (const draft of workingDrafts) draft.included = included
    selectedPresetId = null
  }
  const selectAll = (): void => setAll(true)
  const clearAll = (): void => setAll(false)
  const updateWordsPerCaption = (event: Event): void => {
    wordsPerCaption = Math.min(12, Math.max(1, Math.round(numberValue(event) ?? 4)))
    // Regroup from the current working drafts (not the pristine source) so
    // text/style edits made before changing the chunking are preserved.
    // Flattening is lossless: absolute word times survive grouping.
    const source = workingDrafts.length > 0 ? workingDrafts : options.getDrafts()
    const regrouped = groupCaptionDraftsByWords(source, wordsPerCaption)
    // groupCaptionDraftsByWords keeps wordless text layers as-is; if nothing
    // had word timing there is nothing to re-chunk.
    if (regrouped.length > 0) workingDrafts = regrouped
    selectedPresetId = null
  }
  const setWordsPerCaption = (value: number): void => {
    wordsPerCaption = Math.min(12, Math.max(1, Math.round(value)))
    const source = workingDrafts.length > 0 ? workingDrafts : options.getDrafts()
    const regrouped = groupCaptionDraftsByWords(source, wordsPerCaption)
    if (regrouped.length > 0) workingDrafts = regrouped
    selectedPresetId = null
  }
  const addSelected = (): void => {
    if (includedDrafts.length === 0 || exceedsLimit) return
    options.getOnAdd()(includedDrafts.map((draft) => {
      const words = captionWordsForText(draft.text, draft.duration, draft.words)
      return { ...draft, words, highlightMode: words.length ? draft.highlightMode : 'none' }
    }))
  }
  const snapshotDrafts = (): CaptionDraft[] =>
    workingDrafts.map((draft) => ({ ...draft, words: draft.words.map((word) => ({ ...word })) }))

  const closeDialog = (): void => {
    if (!dialogEl) return
    if (typeof dialogEl.close === 'function') {
      dialogEl.close()
      return
    }
    dialogEl.removeAttribute('open')
    options.getOnCancel()(snapshotDrafts())
  }

  onMount(() => {
    if (!dialogEl || dialogEl.open) return
    if (dialogEl.showModal) dialogEl.showModal()
    else dialogEl.setAttribute('open', '')
  })

  const canRegroup = $derived(
    workingDrafts.some((draft) => draft.words.length > 0) ||
      options.getDrafts().some((draft) => draft.words.length > 0),
  )

  const presetOption = (preset: ShortFormTextPreset) => ({ value: preset.id, label: preset.label })

  const shortFormPresetGroups = $derived([
    { label: 'Best for text', options: BEST_TEXT_PRESETS.map(presetOption) },
    { label: 'More styles', options: MORE_TEXT_PRESETS.map(presetOption) },
  ])

  return {
    get dialogEl() { return dialogEl },
    set dialogEl(value: HTMLDialogElement | undefined) { dialogEl = value },
    get workingDrafts() { return workingDrafts },
    get wordsPerCaption() { return wordsPerCaption },
    get captionLanguage() { return captionLanguage },
    set captionLanguage(value: string) { captionLanguage = value },
    get canRegroup() { return canRegroup },
    get selectedPresetId() { return selectedPresetId },
    get includedDrafts() { return includedDrafts },
    get exceedsLimit() { return exceedsLimit },
    get styleReference() { return styleReference },
    get selectedPreset() { return selectedPreset },
    get selectedFont() { return selectedFont },
    get selectedAnimation() { return selectedAnimation },
    get fontPreviewText() { return fontPreviewText },
    get shortFormPresetGroups() { return shortFormPresetGroups },
    commonValue,
    inputValue,
    numberValue,
    applyStyle,
    applyPreset,
    selectPresetById,
    clearPreset,
    selectAll,
    clearAll,
    toggleFontWeight,
    toggleItalic,
    styleNumber,
    styleValue,
    setStyleValue,
    updateDraftStartFor,
    updateDraftEndFor,
    updateDraftTextFor,
    get previewWords() { return previewWords },
    get previewCycle() { return previewCycle },
    get previewActiveWordIndex() { return previewActiveWordIndex },
    get previewPlaying() { return previewPlaying },
    togglePreviewPlaying,
    replayPreview,
    get livePreviewPosition() { return livePreviewPosition },
    get livePreviewTextStyle() { return livePreviewTextStyle },
    get livePreviewSubtitleStyle() { return livePreviewSubtitleStyle },
    get livePreviewAnimation() { return livePreviewAnimation },
    get livePreviewMotionDuration() { return livePreviewMotionDuration },
    get livePreviewHighlightOn() { return livePreviewHighlightOn },
    get livePreviewHighlightAnimation() { return livePreviewHighlightAnimation },
    get livePreviewWordMotionClass() { return livePreviewWordMotionClass },
    get previewHeadingLabel() { return previewHeadingLabel },
    updateDraftText,
    updateDraftStart,
    updateDraftEnd,
    snapshotDrafts,
    setAll,
    updateWordsPerCaption,
    setWordsPerCaption,
    addSelected,
    closeDialog,
    shortFormTextPresets: SHORT_FORM_TEXT_PRESETS,
    shortFormBestPresets: BEST_TEXT_PRESETS,
    textAnimationOptions: TEXT_ANIMATION_OPTIONS,
    wordAnimationOptions: WORD_ANIMATION_OPTIONS,
    textFontCategories: TEXT_FONT_CATEGORIES,
    textFonts: TEXT_FONTS,
    textAnimationOption,
  }
}
