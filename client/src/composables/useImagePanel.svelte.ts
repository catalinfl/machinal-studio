import { onDestroy, onMount } from 'svelte'
import { AI_IMAGE_MODELS, type AIImageAspect, type AIImageModel } from '../lib/api'
import { type AIImagePlacement, type AIImagePosition } from '../lib/ai-image'
import { IMAGE_STYLE_OPTIONS, type ImageStyle } from '../lib/image-panel'
import { getMediaBinSources, subscribeMediaBinSources, type MediaBinSource } from '../lib/media-bin'
import { loadUIDraft, saveUIDraft } from '../lib/ui-draft'
import type { TransformPreset } from '../lib/clip-transform'
import { editor } from '../stores/editor.svelte'
import { scrubSettings } from '../stores/scrub.svelte'
import { useImageGeneration } from './useImageGeneration.svelte'

const DRAFT_KEY = 'scrub-image-draft'

type ImageSettings = {
  mode: 'generate' | 'edit'
  prompt: string
  style: ImageStyle
  placement: AIImagePlacement
  position: AIImagePosition
  motion: 'auto' | TransformPreset
  model: AIImageModel
  aspect: AIImageAspect
  transparentBackground: boolean
  duration: number
  sourceName: string
}

export function useImagePanel() {
  const imageGeneration = useImageGeneration()

  let settings = $state<ImageSettings>({
    mode: 'generate',
    prompt: '',
    style: 'auto',
    placement: 'overlay',
    position: 'center',
    motion: 'auto',
    model: 'openai/gpt-image-2.6-sunburst',
    aspect: editor.effectiveProjectAspect === 'portrait' ? '9:16' : editor.effectiveProjectAspect === 'classic' ? '4:3' : '16:9',
    transparentBackground: true,
    duration: 5,
    sourceName: '',
  })

  let sources = $state<MediaBinSource[]>([])
  let fileInput = $state<HTMLInputElement>()
  let draftReady = $state(false)
  let unsubscribeSources: (() => void) | null = null
  const proxyImages = $derived(sources.filter((source) => source.kind === 'image' && source.sourceMode === 'proxy'))
  const selectedSource = $derived(proxyImages.find((source) => source.name === settings.sourceName))
  const working = $derived(imageGeneration.busy)
  const uploading = $derived(imageGeneration.phase.kind === 'uploading')
  const progress = $derived(imageGeneration.progress)
  const error = $derived(imageGeneration.error)
  const resultName = $derived(imageGeneration.resultName)
  const resultUrl = $derived(sources.find((source) => source.name === resultName)?.scrubBlobUrl ?? '')
  const proxyEditingAvailable = $derived(scrubSettings.mode === 'proxy')
  const selectedModel = $derived(AI_IMAGE_MODELS.find((option) => option.id === settings.model) ?? AI_IMAGE_MODELS[0])
  const availableModels = $derived(settings.transparentBackground ? AI_IMAGE_MODELS.filter((option) => option.transparent) : AI_IMAGE_MODELS)
  const start = $derived(editor.currentTime)

  function refreshSources(): void {
    sources = getMediaBinSources()
    const availableImages = sources.filter((source) => source.kind === 'image' && source.sourceMode === 'proxy')
    if (settings.mode === 'edit' && !availableImages.some((source) => source.name === settings.sourceName)) settings.sourceName = availableImages[0]?.name ?? ''
  }

  function restoreDraft(): void {
    const draft = loadUIDraft(DRAFT_KEY)
    if (draft.mode === 'generate' || draft.mode === 'edit') settings.mode = draft.mode
    if (typeof draft.prompt === 'string') settings.prompt = draft.prompt.slice(0, 4000)
    if (IMAGE_STYLE_OPTIONS.some((option) => option.value === draft.style)) settings.style = draft.style as ImageStyle
    if (draft.placement === 'media-bin' || draft.placement === 'overlay') settings.placement = draft.placement
    if (draft.position === 'left' || draft.position === 'center' || draft.position === 'right') settings.position = draft.position
    if (draft.motion === 'auto' || draft.motion === 'none' || draft.motion === 'ken-burns' || draft.motion === 'zoom-in' || draft.motion === 'drift') settings.motion = draft.motion
    if (typeof draft.transparentBackground === 'boolean') settings.transparentBackground = draft.transparentBackground

    const restoredModel = typeof draft.model === 'string'
      ? AI_IMAGE_MODELS.find((option) => option.id === draft.model && (!settings.transparentBackground || option.transparent))
      : undefined
    settings.model = restoredModel?.id ?? AI_IMAGE_MODELS.find((option) => !settings.transparentBackground || option.transparent)?.id ?? AI_IMAGE_MODELS[0].id
    const modelOption = AI_IMAGE_MODELS.find((option) => option.id === settings.model) ?? AI_IMAGE_MODELS[0]
    if (typeof draft.aspect === 'string' && modelOption.aspects.some((option) => option === draft.aspect)) settings.aspect = draft.aspect as AIImageAspect
    else if (!modelOption.aspects.some((option) => option === settings.aspect)) settings.aspect = modelOption.aspects[0]
    if (typeof draft.duration === 'number' && Number.isFinite(draft.duration)) settings.duration = Math.max(0.2, draft.duration)
    if (typeof draft.sourceName === 'string') settings.sourceName = draft.sourceName
  }

  function selectMode(next: 'generate' | 'edit'): void {
    settings.mode = next
    imageGeneration.clearError()
    if (next === 'edit' && !settings.sourceName && proxyImages.length > 0) settings.sourceName = proxyImages[0].name
  }

  function selectGenerateMode(): void {
    selectMode('generate')
  }

  function selectEditMode(): void {
    selectMode('edit')
  }

  function openFilePicker(): void {
    fileInput?.click()
  }

  function selectMediaBinPlacement(): void {
    settings.placement = 'media-bin'
  }

  function selectOverlayPlacement(): void {
    settings.placement = 'overlay'
  }

  function selectedStylePrompt(): string {
    return IMAGE_STYLE_OPTIONS.find((option) => option.value === settings.style)?.prompt ?? ''
  }

  function selectedMotion(): TransformPreset {
    return settings.motion === 'auto' ? 'none' : settings.motion
  }

  function selectModel(modelId: string): void {
    const option = AI_IMAGE_MODELS.find((candidate) => candidate.id === modelId) ?? AI_IMAGE_MODELS[0]
    if (settings.transparentBackground && !option.transparent) return
    settings.model = option.id
    if (!option.aspects.some((candidate) => candidate === settings.aspect)) settings.aspect = option.aspects[0]
  }

  function toggleTransparentBackground(event: Event): void {
    settings.transparentBackground = (event.target as HTMLInputElement).checked
    if (!settings.transparentBackground || selectedModel.transparent) return
    const transparentModel = AI_IMAGE_MODELS.find((option) => option.transparent)
    if (!transparentModel) return
    settings.model = transparentModel.id
    if (!transparentModel.aspects.some((candidate) => candidate === settings.aspect)) settings.aspect = transparentModel.aspects[0]
  }

  function updateStart(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber
    if (Number.isFinite(value)) editor.setCurrentTime(Math.max(0, value))
  }

  function submitForm(event: SubmitEvent): void {
    event.preventDefault()
    void imageGeneration.generate({
      mode: settings.mode,
      prompt: settings.prompt,
      ...(settings.mode === 'edit' ? { sourceName: settings.sourceName } : {}),
      model: settings.model,
      style: selectedStylePrompt(),
      placement: settings.placement,
      position: settings.position,
      start: Math.max(0, start),
      duration: Math.max(0.2, settings.duration),
      aspect: settings.aspect,
      background: settings.transparentBackground ? 'transparent' : 'opaque',
      motionPreset: selectedMotion(),
    })
  }

  async function uploadReference(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    const importedName = await imageGeneration.upload(file, proxyEditingAvailable)
    if (importedName) {
      settings.sourceName = importedName
      settings.mode = 'edit'
    }
  }

  $effect(() => {
    if (!draftReady) return
    saveUIDraft(DRAFT_KEY, { ...settings })
  })

  onMount(() => {
    restoreDraft()
    draftReady = true
    refreshSources()
    unsubscribeSources = subscribeMediaBinSources(() => refreshSources())
  })

  onDestroy(() => {
    // The shared generation keeps running on purpose when the panel closes.
    unsubscribeSources?.()
  })

  return {
    editor,
    imageGeneration,
    imageModels: AI_IMAGE_MODELS,
    styleOptions: IMAGE_STYLE_OPTIONS,
    get mode() { return settings.mode },
    get prompt() { return settings.prompt },
    set prompt(value: string) { settings.prompt = value },
    get style() { return settings.style },
    set style(value: ImageStyle) { settings.style = value },
    get placement() { return settings.placement },
    set placement(value: AIImagePlacement) { settings.placement = value },
    get position() { return settings.position },
    set position(value: AIImagePosition) { settings.position = value },
    get motion() { return settings.motion },
    set motion(value: 'auto' | TransformPreset) { settings.motion = value },
    get model() { return settings.model },
    get aspect() { return settings.aspect },
    set aspect(value: AIImageAspect) { settings.aspect = value },
    get transparentBackground() { return settings.transparentBackground },
    get duration() { return settings.duration },
    set duration(value: number) { settings.duration = value },
    get sourceName() { return settings.sourceName },
    set sourceName(value: string) { settings.sourceName = value },
    get fileInput() { return fileInput },
    set fileInput(value: HTMLInputElement | undefined) { fileInput = value },
    get proxyImages() { return proxyImages },
    get selectedSource() { return selectedSource },
    get working() { return working },
    get uploading() { return uploading },
    get progress() { return progress },
    get error() { return error },
    get resultUrl() { return resultUrl },
    get proxyEditingAvailable() { return proxyEditingAvailable },
    get selectedModel() { return selectedModel },
    get availableModels() { return availableModels },
    get start() { return start },
    selectMode,
    selectGenerateMode,
    selectEditMode,
    openFilePicker,
    selectModel,
    toggleTransparentBackground,
    updateStart,
    setPlacement(value: AIImagePlacement) { settings.placement = value },
    selectMediaBinPlacement,
    selectOverlayPlacement,
    submitForm,
    uploadReference,
  }
}
