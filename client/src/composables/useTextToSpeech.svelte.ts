import { onDestroy, onMount } from 'svelte'
import {
  formatDuration,
  generateSpeech,
  listSpeechReferences,
  MAX_SPEECH_REFERENCE_SECONDS,
  SPEECH_MODELS,
  DEFAULT_SPEECH_MODEL,
  uploadSpeechReference,
  voiceLabel,
  type GeneratedSpeech,
  type SpeechModel,
} from '../lib/speech'
import { addDroppedClip } from '../lib/drop'
import {
  getMediaBinSources,
  subscribeMediaBinRemovals,
  subscribeMediaBinSources,
  type MediaBinSource,
} from '../lib/media-bin'
import { readAudioMetadata, readVideoMetadata } from '../lib/video-metadata'
import { editor } from '../stores/editor.svelte'
import { loadUIDraft, saveUIDraft } from '../lib/ui-draft'
import { buildSpeechRequest, resolveVoiceSettings, validateSpeech, type SpeechSettings } from '../lib/speech-settings'

export { resolveVoiceSettings } from '../lib/speech-settings'

const DRAFT_KEY = 'scrub-text-to-speech-draft'

type SpeechResult = {
  url: string
  name: string
  duration: number
}

export type SpeechPhase =
  | { kind: 'idle'; status: string; result: SpeechResult | null }
  | { kind: 'uploading'; status: string }
  | { kind: 'generating'; status: string }
  | { kind: 'success'; status: string; result: SpeechResult }
  | { kind: 'error'; message: string; result: SpeechResult | null }

type VoiceSample = {
  file: File | null
  duration: number
  start: number
  sampleDuration: number
}

export class TextToSpeech {
  models = SPEECH_MODELS
  maxReferenceSeconds = MAX_SPEECH_REFERENCE_SECONDS

  settings = $state<SpeechSettings>({
    input: '',
    language: 'auto',
    model: DEFAULT_SPEECH_MODEL,
    voiceMode: 'preset',
    voice: 'Kore',
    referenceName: '',
    referenceTranscript: '',
    permissionConfirmed: false,
  })

  references = $state<string[]>([])
  mediaBinSources = $state<MediaBinSource[]>([])
  mediaBinAudioName = $state('')
  phase = $state<SpeechPhase>({ kind: 'idle', status: '', result: null })

  voiceSample = $state<VoiceSample>({
    file: null,
    duration: 0,
    start: 0,
    sampleDuration: MAX_SPEECH_REFERENCE_SECONDS,
  })

  fileInput = $state<HTMLInputElement>()
  selectedModel = $derived(SPEECH_MODELS.find((candidate) => candidate.id === this.model) ?? SPEECH_MODELS[0])
  canClone = $derived(this.selectedModel.cloning)
  hasPresetVoices = $derived(this.selectedModel.voices.length > 0)
  characterCount = $derived(Array.from(this.input).length)
  requiresTrim = $derived(this.voiceSample.duration > MAX_SPEECH_REFERENCE_SECONDS)

  proxyAudios = $derived(this.mediaBinSources.filter(
    (source) => source.kind === 'audio' && source.sourceMode === 'proxy' && !!source.scrubBlobUrl,
  ))

  ready = $derived(validateSpeech(this.settings))
  #controller: AbortController | null = null
  #draftReady = $state(false)
  #unsubscribeMediaBin: (() => void) | null = null
  #unsubscribeMediaBinRemovals: (() => void) | null = null
  get input(): string { return this.settings.input }
  set input(value: string) { this.settings.input = value }
  get language(): string { return this.settings.language ?? 'auto' }
  set language(value: string) { this.settings.language = value }
  get model(): SpeechModel { return this.settings.model }
  set model(value: SpeechModel) { this.settings.model = value }
  get voiceMode(): 'clone' | 'preset' { return this.settings.voiceMode }
  set voiceMode(value: 'clone' | 'preset') { this.settings.voiceMode = value }
  get voice(): string { return this.settings.voice }
  set voice(value: string) { this.settings.voice = value }
  get referenceName(): string { return this.settings.referenceName }
  set referenceName(value: string) { this.settings.referenceName = value }
  get referenceTranscript(): string { return this.settings.referenceTranscript }
  set referenceTranscript(value: string) { this.settings.referenceTranscript = value }
  get permissionConfirmed(): boolean { return this.settings.permissionConfirmed }
  set permissionConfirmed(value: boolean) { this.settings.permissionConfirmed = value }

  get busy(): boolean {
    return this.phase.kind === 'uploading' || this.phase.kind === 'generating'
  }

  get status(): string {
    return this.phase.kind === 'error' ? '' : this.phase.status
  }

  get error(): string {
    return this.phase.kind === 'error' ? this.phase.message : ''
  }

  get result(): SpeechResult | null {
    return 'result' in this.phase ? this.phase.result : null
  }

  #setIdle(overrides: { status?: string; result?: SpeechResult | null } = {}): void {
    this.phase = {
      kind: 'idle',
      status: this.status,
      result: this.result,
      ...overrides,
    }
  }

  #setError(cause: unknown, fallback: string): void {
    this.phase = {
      kind: 'error',
      message: cause instanceof Error ? cause.message : fallback,
      result: this.result,
    }
  }

  constructor() {
    $effect(() => {
      if (!this.#draftReady) return
      saveUIDraft(DRAFT_KEY, {
        input: this.input,
        language: this.language,
        model: this.model,
        voiceMode: this.voiceMode,
        voice: this.voice,
        referenceName: this.referenceName,
        referenceTranscript: this.referenceTranscript,
      })
    })
  }

  initialize(): void {
    this.#restoreDraft()
    this.#draftReady = true
    this.#refreshMediaBinSources()
    this.#unsubscribeMediaBin?.()
    this.#unsubscribeMediaBinRemovals?.()
    this.#unsubscribeMediaBin = subscribeMediaBinSources(() => this.#refreshMediaBinSources())
    this.#unsubscribeMediaBinRemovals = subscribeMediaBinRemovals((name) => {
      if (this.mediaBinAudioName === name) this.mediaBinAudioName = ''
    })
    void this.#loadReferences()
  }

  destroy(): void {
    this.cancel()
    this.#unsubscribeMediaBin?.()
    this.#unsubscribeMediaBin = null
    this.#unsubscribeMediaBinRemovals?.()
    this.#unsubscribeMediaBinRemovals = null
  }

  #refreshMediaBinSources(): void {
    this.mediaBinSources = getMediaBinSources()
    if (this.mediaBinAudioName && !this.proxyAudios.some((source) => source.name === this.mediaBinAudioName)) {
      this.mediaBinAudioName = ''
    }
  }

  cancel(): void {
    this.#controller?.abort()
  }

  selectModel(model: SpeechModel): void {
    this.model = model
    const next = SPEECH_MODELS.find((candidate) => candidate.id === this.model) ?? SPEECH_MODELS[0]
    const settings = resolveVoiceSettings(next)
    this.voiceMode = settings.voiceMode
    this.voice = settings.voice
    this.clearError()
  }

  selectVoiceMode(mode: 'clone' | 'preset'): void {
    if (mode === 'clone' && !this.canClone || mode === 'preset' && !this.hasPresetVoices) return
    this.voiceMode = mode
    if (mode === 'preset' && !this.voice) this.voice = this.selectedModel.voices[0] ?? ''
    this.clearError()
  }

  clearError(): void {
    if (this.phase.kind === 'error') this.#setIdle()
  }

  selectCloneVoiceMode = (): void => {
    this.selectVoiceMode('clone')
  }

  selectPresetVoiceMode = (): void => {
    this.selectVoiceMode('preset')
  }

  async selectMediaBinAudio(name: string): Promise<void> {
    if (this.busy) return
    const source = this.proxyAudios.find((candidate) => candidate.name === name)
    if (!source?.scrubBlobUrl) {
      this.#setError(null, 'That audio is no longer in the Media Bin.')
      return
    }
    this.mediaBinAudioName = name
    this.#setIdle({ status: 'Loading audio from the Media Bin…' })
    try {
      const response = await fetch(source.scrubBlobUrl)
      if (!response.ok) throw new Error(`The Media Bin audio could not be loaded (HTTP ${response.status}).`)
      const blob = await response.blob()
      await this.selectReferenceFile(new File([blob], source.name, { type: blob.type || 'audio/mpeg' }))
    } catch (cause) {
      this.#setError(cause, 'The Media Bin audio could not be loaded.')
    }
  }

  async selectReferenceFile(file: File | undefined): Promise<void> {
    if (!file || this.busy) return
    this.#setIdle({ status: 'Reading sample duration…' })
    try {
      const video = file.type.startsWith('video/') || /\.(?:avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm)$/i.test(file.name)
      const metadata = video ? await readVideoMetadata(file) : await readAudioMetadata(file)
      if (metadata.duration <= 0) throw new Error('The selected file has no playable duration.')
      this.voiceSample = {
        ...this.voiceSample,
        file,
        duration: metadata.duration,
        start: 0,
        sampleDuration: Math.min(MAX_SPEECH_REFERENCE_SECONDS, metadata.duration),
      }
      this.#setIdle({ status: 'Choose the part of the file to use, then upload the MP3 sample.' })
    } catch (cause) {
      this.voiceSample = { ...this.voiceSample, file: null, duration: 0 }
      this.#setError(cause, 'The selected media file could not be read.')
    }
  }

  updateSampleStart(value: number): void {
    const start = Math.min(
      Math.max(0, Number.isFinite(value) ? value : 0),
      Math.max(0, this.voiceSample.duration - 0.1),
    )
    this.voiceSample = {
      ...this.voiceSample,
      start,
      sampleDuration: Math.min(this.voiceSample.sampleDuration, MAX_SPEECH_REFERENCE_SECONDS, this.voiceSample.duration - start),
    }
  }

  updateSampleDuration(value: number): void {
    this.voiceSample = {
      ...this.voiceSample,
      sampleDuration: Math.min(
        Math.max(0.1, Number.isFinite(value) ? value : 0.1),
        MAX_SPEECH_REFERENCE_SECONDS,
        this.voiceSample.duration - this.voiceSample.start,
      ),
    }
  }

  async uploadReference(): Promise<void> {
    if (!this.voiceSample.file || this.busy) return
    this.phase = { kind: 'uploading', status: 'Extracting the selected audio locally…' }
    try {
      const name = await uploadSpeechReference(this.voiceSample.file, this.voiceSample.start, this.voiceSample.sampleDuration)
      this.references = [...new Set([name, ...this.references])]
      this.referenceName = name
      this.voiceMode = 'clone'
      this.voiceSample = { ...this.voiceSample, file: null, duration: 0 }
      this.#setIdle({ status: 'MP3 voice sample uploaded. It is ready for this generation.' })
    } catch (cause) {
      this.#setError(cause, 'The voice sample could not be uploaded.')
    }
  }

  uploadReferenceEvent = (): void => {
    void this.uploadReference()
  }

  async submit(): Promise<void> {
    if (!this.ready || this.busy) return
    const insertionTime = editor.currentTime
    this.phase = {
      kind: 'generating',
      status: this.voiceMode === 'clone' ? 'Cloning the reference voice…' : 'Synthesizing speech…',
    }
    this.#controller?.abort()
    const requestController = new AbortController()
    this.#controller = requestController
    try {
      const generated = await generateSpeech(buildSpeechRequest(this.settings), requestController.signal)
      await this.#placeSpeech(generated, insertionTime)
      const result = {
        url: generated.blobUrl,
        name: generated.asset.name,
        duration: generated.duration,
      }
      this.phase = { kind: 'success', result, status: 'Speech generated and added to the Media Bin and timeline.' }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        this.#setError(cause, 'Speech generation failed. Try again.')
      } else {
        this.#setIdle({ status: '' })
      }
    } finally {
      if (this.#controller === requestController) this.#controller = null
    }
  }

  async #placeSpeech(generated: GeneratedSpeech, insertionTime: number): Promise<void> {
    const channel = editor.channels.find((candidate) => candidate.type === 'audio' && !candidate.locked)
    editor.beginHistory()
    try {
      const target = channel ?? editor.addChannel('audio')
      const added = await addDroppedClip(target, {
        fileName: generated.asset.name,
        sourceMode: 'proxy',
        mediaKind: 'audio',
        scrubBlobUrl: generated.blobUrl,
        sourceDuration: generated.duration,
      }, insertionTime)
      if (!added) throw new Error('Speech was added to the Media Bin, but could not be placed on the timeline.')
      editor.selectClip(added.primary.id)
    } finally {
      editor.endHistory()
    }
  }

  #restoreDraft(): void {
    const draft = loadUIDraft(DRAFT_KEY)
    if (typeof draft.input === 'string') this.input = draft.input.slice(0, 4000)
    if (typeof draft.language === 'string' && /^(auto|[a-z]{2})$/.test(draft.language)) this.language = draft.language
    if (typeof draft.model === 'string' && SPEECH_MODELS.some((candidate) => candidate.id === draft.model)) {
      this.model = draft.model as SpeechModel
    }
    const restoredModel = SPEECH_MODELS.find((candidate) => candidate.id === this.model) ?? SPEECH_MODELS[0]
    const settings = resolveVoiceSettings(
      restoredModel,
      draft.voiceMode === 'clone' || draft.voiceMode === 'preset' ? draft.voiceMode : undefined,
      typeof draft.voice === 'string' ? draft.voice : this.voice,
    )
    this.voiceMode = settings.voiceMode
    this.voice = settings.voice
    if (typeof draft.referenceName === 'string') this.referenceName = draft.referenceName
    if (typeof draft.referenceTranscript === 'string') this.referenceTranscript = draft.referenceTranscript.slice(0, 4000)
  }

  async #loadReferences(): Promise<void> {
    try {
      this.references = await listSpeechReferences()
      if (!this.references.includes(this.referenceName)) this.referenceName = this.references[0] ?? ''
    } catch (cause) {
      if (!this.busy) this.#setError(cause, 'Media Bin audio could not be loaded.')
    }
  }

  selectReferenceFileEvent = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''
    void this.selectReferenceFile(file)
  }

  updateSampleStartEvent = (event: Event): void => {
    this.updateSampleStart(Number((event.currentTarget as HTMLInputElement).value))
  }

  updateSampleDurationEvent = (event: Event): void => {
    this.updateSampleDuration(Number((event.currentTarget as HTMLInputElement).value))
  }

  openFilePicker = (): void => {
    this.fileInput?.click()
  }

  submitForm = (event: SubmitEvent): void => {
    event.preventDefault()
    void this.submit()
  }

  formatDuration(seconds: number): string {
    return formatDuration(seconds)
  }

  voiceLabel(voice: string): string {
    return voiceLabel(voice)
  }
}

export function useTextToSpeech(): TextToSpeech {
  const speech = new TextToSpeech()
  onMount(() => speech.initialize())
  onDestroy(() => speech.destroy())
  return speech
}
