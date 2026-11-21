import { BANNER_TEXT_PRESETS, SHORT_FORM_TEXT_PRESETS, TEXT_PANEL_PRESETS, textPresetSampleStyle, type TextPanelPreset } from '../lib/text-presets'
import { fitTextItemPosition, TEXT_DRAG_MIME } from '../lib/text-render'
import { snapTime } from '../lib/snap'
import { collectTimelineSnapEdges } from '../lib/timeline-selection'
import { editor as defaultEditor, textDesignSize, type TextItem } from '../stores/editor.svelte'
import { captions as textCaptions } from '../stores/captions.svelte'

type TextEditor = typeof defaultEditor

export function useTextPanel(textEditor: TextEditor = defaultEditor) {
  const generatedCaptions = $derived(textEditor.textItems.filter((item) => item.isCaption))
  const selectedItems = $derived(textEditor.selectedTextItemIds.flatMap((id) => {
    const item = textEditor.textItems.find((candidate) => candidate.id === id)
    return item ? [item] : []
  }))
  const hasPendingCaptionReview = $derived(textCaptions.captionDialogMode === 'create' && textCaptions.captionDrafts.length > 0)
  const hasTranscript = $derived(textCaptions.hasTranscript)
  const captionsToEdit = $derived(selectedItems.length > 0 ? selectedItems : generatedCaptions)
  // An explicit timeline selection always wins so the stored transcript can
  // stay available for re-adding without hijacking the edit button.
  const editButtonLabel = $derived(selectedItems.some((item) => !item.isCaption)
    ? 'Edit selected text'
    : selectedItems.length > 0
      ? 'Edit selected captions'
      : hasPendingCaptionReview || hasTranscript
        ? 'Edit generated captions'
        : captionsToEdit.some((item) => !item.isCaption)
          ? 'Edit selected text'
          : 'Edit selected captions')

  function valuesForCurrentAspect(values: Partial<TextItem>): Partial<TextItem> {
    const design = textDesignSize(textEditor.effectiveProjectAspect)
    return {
      ...values,
      ...(values.x === undefined ? {} : { x: values.x * design.w / 1920 }),
      ...(values.y === undefined ? {} : { y: values.y * design.h / 1080 }),
    }
  }

  function addText(preset: TextPanelPreset): void {
    const start = snapTime(
      textEditor.currentTime,
      textEditor.pixelsPerSecond,
      3,
      collectTimelineSnapEdges(textEditor),
    )
    let item!: TextItem
    textEditor.withHistoryTransaction(() => {
      item = textEditor.addTextItem(start, valuesForCurrentAspect(preset.values))
      textEditor.updateTextItem(item.id, fitTextItemPosition(item, textEditor.effectiveProjectAspect))
    })
    textEditor.selectTextItem(item.id)
  }

  function startTextDrag(event: DragEvent, preset: TextPanelPreset): void {
    event.dataTransfer?.setData(TEXT_DRAG_MIME, JSON.stringify({ values: valuesForCurrentAspect(preset.values), fitToSafeArea: true }))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  function addShortFormText(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement
    const preset = SHORT_FORM_TEXT_PRESETS.find((candidate) => candidate.id === target.dataset.presetId)
    if (preset) addText(preset)
  }

  function addBannerText(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement
    const preset = BANNER_TEXT_PRESETS.find((candidate) => candidate.label === target.dataset.presetLabel)
    if (preset) addText(preset)
  }

  function addPanelText(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement
    const preset = TEXT_PANEL_PRESETS.find((candidate) => candidate.label === target.dataset.presetLabel)
    if (preset) addText(preset)
  }

  function dragShortFormText(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    const preset = SHORT_FORM_TEXT_PRESETS.find((candidate) => candidate.id === target.dataset.presetId)
    if (preset) startTextDrag(event, preset)
  }

  function dragBannerText(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    const preset = BANNER_TEXT_PRESETS.find((candidate) => candidate.label === target.dataset.presetLabel)
    if (preset) startTextDrag(event, preset)
  }

  function dragPanelText(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    const preset = TEXT_PANEL_PRESETS.find((candidate) => candidate.label === target.dataset.presetLabel)
    if (preset) startTextDrag(event, preset)
  }

  function editGeneratedCaptions(): void {
    if (selectedItems.length > 0) {
      textCaptions.editSelectedText(selectedItems)
      return
    }
    if (hasPendingCaptionReview) {
      textCaptions.openCaptionDialog()
      return
    }
    if (captionsToEdit.length > 0) {
      textCaptions.editSelectedText(captionsToEdit)
      return
    }
    textCaptions.openTranscriptReview()
  }

  function generateSubtitlesEvent(): void {
    void textCaptions.generateSubtitles()
  }

  return {
    editor: textEditor,
    captions: textCaptions,
    shortFormPresets: SHORT_FORM_TEXT_PRESETS,
    bannerPresets: BANNER_TEXT_PRESETS,
    presets: TEXT_PANEL_PRESETS,
    sampleStyle: textPresetSampleStyle,
    get generatedCaptions() { return generatedCaptions },
    get selectedItems() { return selectedItems },
    get hasPendingCaptionReview() { return hasPendingCaptionReview },
    get hasTranscript() { return hasTranscript },
    get captionsToEdit() { return captionsToEdit },
    get editButtonLabel() { return editButtonLabel },
    get generatingSubtitles() { return textCaptions.generatingSubtitles },
    get subtitleError() { return textCaptions.subtitleError },
    get subtitleStatus() { return textCaptions.subtitleStatus },
    get captionDrafts() { return textCaptions.captionDrafts },
    get captionDialogMode() { return textCaptions.captionDialogMode },
    get captionDialogKind() { return textCaptions.captionDialogKind },
    get captionDialogOpen() { return textCaptions.captionDialogOpen },
    get captionSourceDialogOpen() { return textCaptions.captionSourceDialogOpen },
    get captionSourceSelection() { return textCaptions.captionSourceSelection },
    get captionLanguage() { return textCaptions.captionLanguage },
    generateSubtitles: textCaptions.generateSubtitles,
    generateSubtitlesEvent,
    setCaptionLanguage: textCaptions.setCaptionLanguage,
    addCaptionDrafts: textCaptions.addCaptionDrafts,
    saveCaptionDrafts: textCaptions.saveCaptionDrafts,
    dismissCaptionDialog: textCaptions.dismissCaptionDialog,
    generateFromSources: textCaptions.generateFromSources,
    cancelSourceSelection: textCaptions.cancelSourceSelection,
    editGeneratedCaptions,
    addShortFormText,
    addBannerText,
    addPanelText,
    dragShortFormText,
    dragBannerText,
    dragPanelText,
  }
}
