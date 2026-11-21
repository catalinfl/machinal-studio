import { appendGeneratedScene, cancelSceneJob, createSceneJob, getSceneJob, registerGeneratedScene, sceneRequest, sceneEditRequest, SceneRequestError, uploadSceneImages, uploadSceneVideos, uploadSceneVoice, waitForScenePoll, type SceneDraft, type SceneEditDraft, type SceneJob } from '../lib/scene-generation'
import { getMediaBinSources, subscribeMediaBinSources, subscribeMediaBinRemovals, type MediaBinSource } from '../lib/media-bin'
import { pb } from '../lib/pocketbase'
import { validateSceneImageFiles } from '../lib/scene-images'
import { forgetLiveScene } from '../lib/live-scene'
import { validateSceneVideoFiles } from '../lib/scene-videos'
import { savedJob } from '../lib/job-response'
import { peekProjectSessionId } from '../lib/session'

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'running'; id: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; jobId?: string }

type Insertion =
  | { kind: 'idle' }
  | { kind: 'adding'; id: string }
  | { kind: 'added'; id: string }
  | { kind: 'error'; message: string }

export class SceneGeneration {
  draft = $state<SceneDraft>({ mode: 'prompt', prompt: '', text: '', visualMode: 'auto', transparent: false, duration: 8, language: '', audioSource: '', voice: null, images: [], videos: [], aspect: 'project' })
  attachmentError = $state('')
  videoAttachmentError = $state('')
  phase = $state<Phase>({ kind: 'idle' })
  insertion = $state<Insertion>({ kind: 'idle' })
  job = $state<SceneJob | null>(null)
  selectedId = $state('')
  audioSources = $state<MediaBinSource[]>([])
  editDraft = $state<SceneEditDraft | null>(null)
  #editBase: { job: SceneJob; targetId: string } | null = null
  #controller: AbortController | null = null
  #registered = new Set<string>()
  #removed = new Set<string>()
  #owner = ''

  constructor() {
    this.#owner = pb.authStore.record?.id ?? ''
    const refresh = () => { this.audioSources = getMediaBinSources().filter(source => source.sourceMode === 'proxy' && source.kind === 'audio') }
    refresh()
    subscribeMediaBinSources(refresh)
    subscribeMediaBinRemovals(name => {
      refresh()
      forgetLiveScene(name)
      this.#removed.add(name)
      if (!this.job) return
      const removed = this.job.scenes.find(scene => scene.asset.file === name)
      if (!removed) return
      this.job = { ...this.job, scenes: this.job.scenes.filter(scene => scene.id !== removed.id) }
      this.#registered.delete(removed.id)
      if (this.selectedId === removed.id) {
        this.selectedId = this.job.scenes[0]?.id ?? ''
        this.editDraft = null
        this.insertion = { kind: 'idle' }
      }
    })
    pb.authStore.onChange(() => {
      const owner = pb.authStore.record?.id ?? ''
      if (owner !== this.#owner) { this.reset(); this.#owner = owner; void this.resume() }
    })
    queueMicrotask(() => { void this.resume() })
  }

  async resume(): Promise<void> {
    const id = savedJob('scene')
    if (!id || this.busy || this.job || !this.#owner) return
    const controller = new AbortController()
    this.#controller = controller
    await this.#watch(id, controller)
  }

  get busy(): boolean {
    return this.phase.kind === 'uploading' || this.phase.kind === 'running'
  }

  get editingScene(): boolean {
    return this.busy && this.#editBase !== null
  }

  get selected() {
    return this.job?.scenes.find(scene => scene.id === this.selectedId) ?? this.job?.scenes[0]
  }

  get canGenerate(): boolean {
    return !this.busy && !(this.phase.kind === 'error' && this.phase.jobId) && this.insertion.kind !== 'adding' && (this.draft.mode === 'prompt' ? !!this.draft.prompt.trim() || !!this.draft.text.trim() : !!this.draft.voice || !!this.draft.audioSource)
  }

  get canEdit(): boolean {
    return !this.busy && !(this.phase.kind === 'error' && this.phase.jobId) && this.insertion.kind !== 'adding' && !!this.editDraft?.prompt.trim() && this.editDraft.sceneId === this.selected?.id
  }

  beginEdit(): void {
    const scene = this.selected
    if (!scene?.source || this.busy || this.insertion.kind === 'adding') return
    this.editDraft = { sceneId: scene.id, prompt: '', duration: scene.asset.duration }
  }

  closeEdit(): void {
    if (!this.busy) this.editDraft = null
  }

  async editSelected(): Promise<void> {
    if (!this.canEdit || !this.selected || !this.editDraft || !this.job) return
    const scene = $state.snapshot(this.selected)
    const draft = $state.snapshot(this.editDraft)
    const controller = new AbortController()
    this.#controller = controller
    this.insertion = { kind: 'idle' }
    this.#editBase = { job: $state.snapshot(this.job), targetId: scene.id }
    try {
      const request = sceneEditRequest(scene, draft)
      this.phase = { kind: 'uploading' }
      const job = await createSceneJob(request, controller.signal)
      if (this.#controller !== controller) return
      this.#acceptJob(job)
      await this.#watch(job.id, controller)
    } catch (cause) {
      this.#reportFailure(cause, controller)
    } finally {
      if (this.#controller === controller) this.#controller = null
    }
  }

  attachImages(files: File[]): void {
    if (this.busy) return
    try {
      validateSceneImageFiles(files, this.draft.images.length)
      for (const file of files) {
        const id = crypto.randomUUID()
        const extension = file.name.split('.').pop()!.toLowerCase()
        this.draft.images.push({ id, file, uploadName: `scene_image_${id}.${extension}`, previewUrl: URL.createObjectURL(file), description: '' })
      }
      this.attachmentError = ''
    } catch (cause) {
      this.attachmentError = cause instanceof Error ? cause.message : 'Could not attach these images. Try again.'
    }
  }

  removeImage(id: string): void {
    if (this.busy) return
    const image = this.draft.images.find(image => image.id === id)
    if (image) URL.revokeObjectURL(image.previewUrl)
    this.draft.images = this.draft.images.filter(image => image.id !== id)
    this.attachmentError = ''
  }

  attachVideos(files: File[]): void {
    if (this.busy) return
    try {
      validateSceneVideoFiles(files, this.draft.videos.length)
      for (const file of files) {
        const id = crypto.randomUUID()
        const extension = file.name.split('.').pop()!.toLowerCase()
        this.draft.videos.push({ id, file, uploadName: `scene_video_${id}.${extension}`, previewUrl: URL.createObjectURL(file), description: '', look: 'original' })
      }
      this.videoAttachmentError = ''
    } catch (cause) {
      this.videoAttachmentError = cause instanceof Error ? cause.message : 'Could not attach these videos. Try again.'
    }
  }

  removeVideo(id: string): void {
    if (this.busy) return
    const video = this.draft.videos.find(video => video.id === id)
    if (video) URL.revokeObjectURL(video.previewUrl)
    this.draft.videos = this.draft.videos.filter(video => video.id !== id)
    this.videoAttachmentError = ''
  }

  async generate(): Promise<void> {
    if (!this.canGenerate) return
    const draft = { ...this.draft, images: this.draft.images.map(image => ({ ...image })), videos: this.draft.videos.map(video => ({ ...video })) }
    const controller = new AbortController()
    this.#controller = controller
    this.#owner = pb.authStore.record?.id ?? ''
    this.insertion = { kind: 'idle' }
    this.#editBase = null
    this.editDraft = null
    try {
      const request = sceneRequest(draft, draft.mode === 'voice' ? draft.voice?.name || draft.audioSource : undefined)
      this.phase = { kind: 'uploading' }
      this.attachmentError = ''
      this.videoAttachmentError = ''
      await uploadSceneImages(draft.images, controller.signal)
      await uploadSceneVideos(draft.videos, controller.signal)
      const audioFile = draft.mode === 'voice' && draft.voice ? await uploadSceneVoice(draft.voice, controller.signal) : draft.audioSource
      if (draft.mode === 'voice') request.audioFile = audioFile
      const job = await createSceneJob(request, controller.signal)
      if (this.#controller !== controller) return
      this.job = job
      this.selectedId = ''
      await this.#watch(job.id, controller)
    } catch (cause) {
      this.#reportFailure(cause, controller)
    } finally {
      if (this.#controller === controller) this.#controller = null
    }
  }

  async retryStatus(): Promise<void> {
    if (this.phase.kind !== 'error' || !this.phase.jobId) return
    const id = this.phase.jobId
    const controller = new AbortController()
    this.#controller = controller
    await this.#watch(id, controller)
  }

  async #watch(id: string, controller: AbortController): Promise<void> {
    const session = peekProjectSessionId()
    this.phase = { kind: 'running', id }
    try {
      while (!controller.signal.aborted) {
        const latest = await getSceneJob(id, controller.signal, this.job?.id === id ? this.job.revision : undefined)
        if (this.#controller !== controller) return
        if (session !== peekProjectSessionId()) {
          controller.abort()
          this.job = null
          this.phase = { kind: 'idle' }
          return
        }
        this.#acceptJob(latest)
        for (const scene of latest.scenes) {
          if (this.#removed.has(scene.asset.file) || this.#registered.has(scene.id)) continue
          registerGeneratedScene(scene)
          this.#registered.add(scene.id)
        }
        if (!this.selectedId && this.job?.scenes.length) this.selectedId = this.job.scenes[0].id
        if (latest.status === 'completed' || latest.status === 'cancelled') { this.phase = { kind: 'ready' }; break }
        if (latest.status === 'failed') throw new Error(latest.message)
        await waitForScenePoll(controller.signal)
      }
    } catch (cause) {
      this.#reportFailure(cause, controller, id)
    } finally {
      if (this.#controller === controller) this.#controller = null
    }
  }

  #acceptJob(job: SceneJob): void {
    job = { ...job, scenes: job.scenes.filter(scene => !this.#removed.has(scene.asset.file)) }
    if (!this.#editBase) {
      this.job = job
      return
    }
    const { job: base, targetId } = this.#editBase
    const edited = job.scenes[0]
    this.job = { ...job, transcript: base.transcript, scenes: base.scenes.filter(scene => !this.#removed.has(scene.asset.file)).map(scene => scene.id === targetId && edited ? edited : scene) }
    if (edited) {
      this.selectedId = edited.id
      this.editDraft = null
    }
  }

  #reportFailure(cause: unknown, controller: AbortController, jobId?: string): void {
    if (this.#controller !== controller) return
    const retryable = !(cause instanceof SceneRequestError) || cause.status >= 500 || cause.status === 429 || cause.status === 408
    const resumable = jobId && retryable && this.job?.status !== 'failed'
    this.phase = controller.signal.aborted ? { kind: 'idle' } : {
      kind: 'error',
      message: resumable ? 'The connection to your scene job was interrupted. Retry status to recover its results.' : cause instanceof Error ? cause.message : 'Scene generation failed. Try again.',
      ...(resumable ? { jobId } : {}),
    }
  }

  async cancel(): Promise<void> {
    const id = this.phase.kind === 'running' ? this.phase.id : this.phase.kind === 'error' ? this.phase.jobId : undefined
    if (!id) {
      this.#controller?.abort()
      return
    }
    try {
      await cancelSceneJob(id)
      if (this.phase.kind === 'error') await this.retryStatus()
    } catch (cause) {
      this.insertion = { kind: 'error', message: cause instanceof Error ? cause.message : 'Could not stop generation. Try again.' }
    }
  }

  async addSelected(): Promise<void> {
    const scene = $state.snapshot(this.selected)
    if (!scene || this.editingScene || this.insertion.kind === 'adding') return
    this.insertion = { kind: 'adding', id: scene.id }
    try {
      await appendGeneratedScene(scene)
      this.insertion = { kind: 'added', id: scene.id }
    } catch (cause) {
      this.insertion = { kind: 'error', message: cause instanceof Error ? cause.message : 'Could not add this scene. Try again.' }
    }
  }

  select(id: string): void {
    if (this.editingScene || this.insertion.kind === 'adding') return
    this.selectedId = id
    this.editDraft = null
    this.insertion = { kind: 'idle' }
  }

  reset(): void {
    this.#controller?.abort()
    this.#controller = null
    this.job = null
    this.selectedId = ''
    this.editDraft = null
    this.#editBase = null
    this.phase = { kind: 'idle' }
    this.insertion = { kind: 'idle' }
    this.#registered.clear()
    this.#removed.clear()
    this.#owner = ''
    for (const image of this.draft.images) URL.revokeObjectURL(image.previewUrl)
    for (const video of this.draft.videos) URL.revokeObjectURL(video.previewUrl)
    this.attachmentError = ''
    this.videoAttachmentError = ''
    this.draft = { mode: 'prompt', prompt: '', text: '', visualMode: 'auto', transparent: false, duration: 8, language: '', audioSource: '', voice: null, images: [], videos: [], aspect: 'project' }
  }
}

export const sceneGeneration = new SceneGeneration()
