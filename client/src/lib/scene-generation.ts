import { API_BASE, authHeader, downloadFile, friendlyHttpError, getAudioPreview } from './api'
import { withSession, sessionHeader } from './session'
import { editor, projectResolution, type ProjectAspect } from '../stores/editor.svelte'
import type { CompositionAsset } from './composition-types'
import { sceneMediaBinSource } from './scene-assets'
import { registerMediaBinSource } from './media-bin'
import { insertPreparedMedia, type PreparedMediaInsertion } from './drop'
import { isLiveSceneFile, rememberLiveScene, type LiveSceneSource } from './live-scene'
import { sceneImageInputs, type SceneImageDraft, type SceneImageInput } from './scene-images'
import { sceneVideoInputs, type SceneVideoDraft, type SceneVideoInput } from './scene-videos'
import { forgetPendingJob, jobFetch, savedJob } from './job-response'

export type SceneVisualMode = 'auto' | '2d' | '3d'

export interface GeneratedScene {
  id: string
  title: string
  brief: string
  start: number
  end: number
  component: string
  explanation?: string
  asset: CompositionAsset
  manifest: unknown
  source?: LiveSceneSource
}

export interface SceneJob {
  id: string
  status: 'queued' | 'claimed' | 'running' | 'transcribing' | 'planning' | 'generating' | 'compiling' | 'rendering' | 'completed' | 'failed' | 'cancelled'
  message: string
  progress: number
  transcript?: string
  scenes: GeneratedScene[]
  revision?: number
}

export interface SceneRequest {
  prompt: string
  text?: string
  visualMode?: SceneVisualMode
  transparent?: boolean
  duration: number
  width: number
  height: number
  fps: number
  audioFile?: string
  language?: string
  images?: SceneImageInput[]
  videos?: SceneVideoInput[]
  sourceFile?: string
}

export interface SceneDraft {
  mode: 'prompt' | 'voice'
  prompt: string
  text: string
  visualMode: SceneVisualMode
  transparent?: boolean
  duration: number
  language: string
  audioSource: string
  voice: File | null
  images: SceneImageDraft[]
  videos: SceneVideoDraft[]
  aspect?: ProjectAspect | 'project'
}

export interface SceneEditDraft {
  sceneId: string
  prompt: string
  duration: number
}

export class SceneRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function sceneRequest(draft: SceneDraft, audioFile?: string): SceneRequest {
  if (!draft.prompt.trim() && !draft.text.trim() && draft.mode === 'prompt') throw new Error('Describe the scene you want to animate or add its text.')
  if (Array.from(draft.prompt).length > 4000) throw new Error('Keep your prompt within 4,000 characters.')
  if (Array.from(draft.text).length > 4000) throw new Error('Keep your scene text within 4,000 characters.')
  if (!['auto', '2d', '3d'].includes(draft.visualMode)) throw new Error('Choose automatic, 2D or 3D scene design.')
  if (!Number.isFinite(draft.duration) || draft.duration < 1 || draft.duration > 60) throw new Error('Choose a scene length between 1 and 60 seconds.')
  if (draft.mode === 'voice' && !audioFile) throw new Error('Choose a voice recording first.')
  const aspect = draft.aspect && draft.aspect !== 'project' ? draft.aspect : editor.effectiveProjectAspect
  const { w: width, h: height } = projectResolution('1080p', aspect)
  const images = sceneImageInputs(draft.images)
  const videos = sceneVideoInputs(draft.videos)
  return {
    prompt: draft.prompt.trim(), duration: draft.duration, width, height, fps: editor.fps,
    ...(draft.text.trim() ? { text: draft.text } : {}),
    ...(draft.visualMode !== 'auto' ? { visualMode: draft.visualMode } : {}),
    ...(draft.transparent ? { transparent: true } : {}),
    ...(draft.mode === 'voice' ? { audioFile, language: draft.language } : {}),
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
  }
}

export function sceneEditRequest(scene: GeneratedScene, draft: SceneEditDraft): SceneRequest {
  if (!scene.source || !isLiveSceneFile(scene.asset.file) || draft.sceneId !== scene.id) throw new Error('Choose a live scene to edit.')
  if (!draft.prompt.trim()) throw new Error('Describe what you want to change in this scene.')
  if (Array.from(draft.prompt).length > 4000) throw new Error('Keep your edit within 4,000 characters.')
  if (!Number.isFinite(draft.duration) || draft.duration < 1 || draft.duration > 60) throw new Error('Choose a scene length between 1 and 60 seconds.')
  const { width, height, fps } = scene.source.config
  return { sourceFile: scene.asset.file, prompt: draft.prompt.trim(), duration: draft.duration, width, height, fps }
}

async function jobRequest(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const response = await (method === 'POST' ? jobFetch : fetch)(withSession(`${API_BASE}/ai/scenes${path}`), {
    method, signal, headers: { ...authHeader(), ...sessionHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new SceneRequestError(response.status, friendlyHttpError(response.status, await response.text(), 'scenes'))
  return response
}

export async function createSceneJob(request: SceneRequest, signal: AbortSignal): Promise<SceneJob> {
  const job = await (await jobRequest('', 'POST', request, signal)).json() as SceneJob
  savedJob('scene', job.id)
  return job
}

export async function getSceneJob(id: string, signal: AbortSignal, revision?: number): Promise<SceneJob> {
  const job = await (await jobRequest(`/${encodeURIComponent(id)}${revision === undefined ? '' : `?revision=${revision}`}`, 'GET', undefined, signal)).json() as SceneJob
  if (['completed', 'failed', 'cancelled'].includes(job.status)) forgetPendingJob(job.id)
  return job
}

export async function cancelSceneJob(id: string): Promise<void> {
  await jobRequest(`/${encodeURIComponent(id)}`, 'DELETE')
}

export async function uploadSceneVoice(file: File, signal: AbortSignal): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a recording smaller than 25 MB.')
  return uploadSceneFile(file, file.name, signal)
}

export async function uploadSceneImages(images: SceneImageDraft[], signal: AbortSignal): Promise<void> {
  sceneImageInputs(images)
  for (const image of images) await uploadSceneFile(image.file, image.uploadName, signal)
}

export async function uploadSceneVideos(videos: SceneVideoDraft[], signal: AbortSignal): Promise<void> {
  sceneVideoInputs(videos)
  for (const video of videos) await uploadSceneFile(video.file, video.uploadName, signal)
}

async function uploadSceneFile(file: File, name: string, signal: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', file, name)
  const response = await fetch(withSession(`${API_BASE}/upload`), { method: 'POST', headers: { ...authHeader(), ...sessionHeader() }, body: form, signal })
  if (!response.ok) throw new Error(friendlyHttpError(response.status, await response.text(), 'upload'))
  return name
}

export function registerGeneratedScene(scene: GeneratedScene): void {
  if (scene.source) {
    rememberLiveScene(scene.asset.file, scene.source)
    registerMediaBinSource({ id: scene.asset.id, name: scene.asset.file, kind: 'video', duration: scene.asset.duration, width: scene.asset.width, height: scene.asset.height, sourceId: scene.asset.id, sourceMode: 'proxy', sourceRevision: scene.asset.version, generated: true, isRender: false, scene: scene.source })
    return
  }
  const source = sceneMediaBinSource(scene.manifest, { id: scene.asset.id, file: scene.asset.file }, withSession(`${API_BASE}/download?file=${encodeURIComponent(scene.asset.file)}`))
  registerMediaBinSource({ ...source, generated: true, isRender: false })
}

export async function appendGeneratedScene(scene: GeneratedScene): Promise<string> {
  if (scene.source && isLiveSceneFile(scene.asset.file)) return appendLiveScene(scene)
  const blob = await downloadFile(scene.asset.file)
  const url = URL.createObjectURL(blob)
  let inserted = false
  try {
    const prepared: PreparedMediaInsertion = {
      parsed: { fileName: scene.asset.file, sourceId: scene.asset.id, sourceMode: 'proxy', mediaKind: 'video', scrubBlobUrl: url, sourceDuration: scene.asset.duration, sourceWidth: scene.asset.width, sourceHeight: scene.asset.height },
      mediaKind: 'video', scrubBlobUrl: url, audioBlobUrl: scene.asset.hasAudio ? url : null, sourceDuration: scene.asset.duration ?? 0,
    }
    const clip = editor.withHistoryTransaction(() => {
      const channel = editor.channels.find(candidate => candidate.type === 'video' && !candidate.locked) ?? editor.addChannel('video')
      return insertPreparedMedia(channel, prepared, editor.totalDuration, { includeAudio: !!scene.asset.hasAudio })?.primary
    })
    if (!clip) throw new Error('The scene could not be added. Try again.')
    inserted = true
    registerGeneratedScene(scene)
    registerMediaBinSource({ id: scene.asset.id, name: scene.asset.file, kind: 'video', duration: scene.asset.duration ?? 0, width: scene.asset.width, height: scene.asset.height, sourceMode: 'proxy', sourceId: scene.asset.id, scrubBlobUrl: url, previewUrl: url, generated: true })
    editor.selectClip(clip.id)
    return clip.id
  } finally {
    if (!inserted) URL.revokeObjectURL(url)
  }
}

async function appendLiveScene(scene: GeneratedScene): Promise<string> {
  const source = scene.source!
  const audioUrl = source.audio ? await getAudioPreview(source.audio.file) : null
  registerGeneratedScene(scene)
  const clip = editor.withHistoryTransaction(() => {
    if (editor.totalDuration === 0) {
      editor.setProjectAspect(source.config.height > source.config.width ? 'portrait' : source.config.width / source.config.height < 1.5 ? 'classic' : 'landscape')
      editor.setResolution('1080p')
    }
    const channel = source.config.transparent
      ? editor.addChannel('video')
      : editor.channels.find(candidate => candidate.type === 'video' && !candidate.locked) ?? editor.addChannel('video')
    return insertPreparedMedia(channel, {
      parsed: { fileName: scene.asset.file, sourceId: scene.asset.id, sourceMode: 'proxy', mediaKind: 'video', sourceWidth: scene.asset.width, sourceHeight: scene.asset.height },
      mediaKind: 'video', scrubBlobUrl: null, audioBlobUrl: audioUrl, sourceDuration: scene.asset.duration, sceneAudio: source.audio,
    }, source.config.transparent ? editor.currentTime : editor.totalDuration)?.primary
  })
  if (!clip) throw new Error('The scene could not be added. Try again.')
  editor.selectClip(clip.id)
  editor.setCurrentTime(clip.start)
  return clip.id
}

export function waitForScenePoll(signal: AbortSignal, delay = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delay)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
