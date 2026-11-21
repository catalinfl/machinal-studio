import type { MediaKind, ProjectAspect, TextAlign, TextAnimation, TextBannerStyle, TextFontFamily, TextHighlightAnimation, TextHighlightMode } from '../stores/editor.svelte'
import type { EffectInstance, EffectRamp } from './effects'
import type { ClipTransform, ClipTransformKeyframe, TransformPreset } from './clip-transform'
import type { WaveformData } from './waveform'
import type { VideoFit } from './video-fit'
import { withSession, sessionHeader } from './session'
import { pb } from './pocketbase'
import { PAID_REQUIRED_MESSAGE, PAID_SERVER_BODY } from './paid'
import type { CompilationResult, CompositionInput } from './composition-types'
import { jobFetch, resolveJobResponse } from './job-response'
export { API_BASE } from './api-origin'
import { API_BASE } from './api-origin'

// authHeader injects the logged-in PocketBase JWT. The project session id
// stays in the URL via withSession(); the user token travels in the header.
export function authHeader(): Record<string, string> {
  const token = pb.authStore.token?.trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type ApiErrorContext =
  | 'generic'
  | 'media'
  | 'audio'
  | 'upload'
  | 'image'
  | 'edit'
  | 'captions'
  | 'speech'
  | 'render'
  | 'scenes'

const FRIENDLY_SERVER_MESSAGES: Record<ApiErrorContext, string> = {
  generic: 'Something went wrong on the server. Please try again in a moment.',
  media: 'We could not prepare this media. Please try again.',
  audio: 'We could not prepare the audio preview. Please try again.',
  upload: 'We could not upload this file. Please check it and try again.',
  image: 'We could not generate the image right now. Please try again in a moment.',
  edit: 'The AI editor is temporarily unavailable. Please try again in a moment.',
  captions: 'We could not generate captions for this media. Please check that it has clear audio and try again.',
  speech: 'We could not generate the voice audio right now. Please try again in a moment.',
  render: 'We could not finish the export. Please try again.',
  scenes: 'We could not generate the scene right now. Please try again.',
}

const TECHNICAL_ERROR_RE = /openrouter|http\s+\d{3}|timestamped segments|no (?:image data|speech audio)|invalid (?:base64|mp3|pcm)|provider returned|ffmpeg|server render|render server|server closed|empty response/i

function friendlyDetail(detail: string): string {
  const message = detail.trim()
  if (!message || TECHNICAL_ERROR_RE.test(message)) return ''
  if (/^invalid json:/i.test(message)) return 'The request could not be understood. Please try again.'
  return message
}

export function friendlyHttpError(
  status: number,
  detail = '',
  context: ApiErrorContext = 'generic',
): string {
  if (status === 0) return 'We could not connect to the server. Check your connection and try again.'
  if (status === 413) return 'This file is too large. Please choose a smaller file and try again.'
  if (status === 408 && context === 'upload') return 'The upload timed out. Please try again.'
  if (status === 429) return 'The service is busy right now. Please try again in a moment.'
  // Server export is paid-only: 402 (or 403 carrying the paid body) means the
  // paywall dialog should open, not a generic permission error.
  if (status === 402 || detail.toLowerCase().includes(PAID_SERVER_BODY)) return PAID_REQUIRED_MESSAGE
  if (status === 401 || status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return context === 'media'
    ? 'We could not find this media file.'
    : 'We could not find the requested resource.'
  if (status >= 500 || TECHNICAL_ERROR_RE.test(detail)) return FRIENDLY_SERVER_MESSAGES[context]

  return friendlyDetail(detail) || FRIENDLY_SERVER_MESSAGES[context]
}

export function friendlyErrorMessage(
  cause: unknown,
  context: ApiErrorContext = 'generic',
): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (TECHNICAL_ERROR_RE.test(message)) return FRIENDLY_SERVER_MESSAGES[context]
  return message || FRIENDLY_SERVER_MESSAGES[context]
}

async function throwHttpError(response: Response, context: ApiErrorContext): Promise<never> {
  const detail = await response.text()
  throw new Error(friendlyHttpError(response.status, detail, context))
}

export interface FileEntry {
  name: string
  size: number
  // Present for session-scoped listings (media bin from S3): S3 is the
  // source of truth, "cached" means bytes are already warm on the volume.
  etag?: string
  s3Key?: string
  cached?: boolean
  // True for final exports (render_*.mp4/avi/mp3). They live in S3 under
  // "<user>/renders/<name>" and survive logout/GC eviction, unlike the flat
  // volume cache.
  render?: boolean
}

interface SessionListItem {
  name?: unknown
  size?: unknown
  etag?: unknown
  s3_key?: unknown
  cached?: unknown
  render?: unknown
}

export async function listFiles(): Promise<FileEntry[]> {
  // /list requires PB auth + owned session (was unauth BOLA).
  const resp = await fetch(withSession(`${API_BASE}/list`), { headers: { ...authHeader(), ...sessionHeader() } })
  if (!resp.ok) await throwHttpError(resp, 'generic')
  const contentType = resp.headers.get('content-type') ?? ''
  // Session media bins come back as JSON metadata (s3_key/size/etag);
  // legacy servers keep the tab-separated text format.
  if (contentType.includes('application/json')) {
    const items = await resp.json() as SessionListItem[]
    if (!Array.isArray(items)) return []
    return items.flatMap((item) => {
      if (typeof item?.name !== 'string') return []
      const name = item.name.trim()
      const size = typeof item.size === 'number' ? item.size : Number.NaN
      if (!name || !Number.isFinite(size) || size < 0) return []
      const entry: FileEntry = { name, size }
      if (typeof item.etag === 'string' && item.etag) entry.etag = item.etag
      if (typeof item.s3_key === 'string' && item.s3_key) entry.s3Key = item.s3_key
      if (typeof item.cached === 'boolean') entry.cached = item.cached
      if (item.render === true) entry.render = true
      else if (typeof item.s3_key === 'string' && item.s3_key.includes('/renders/')) entry.render = true
      else if (isRenderFileName(name)) entry.render = true
      return [entry]
    })
  }
  const text = await resp.text()
  // The server emits "<name>\t<size> bytes" per line. Malformed lines are
  // skipped instead of producing garbage entries.
  const FILE_ENTRY_RE = /^([^\t]+)\t(\d+)(?: bytes)?$/
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const match = FILE_ENTRY_RE.exec(line.trim())
      if (!match) return []
      const name = match[1].trim()
      const size = Number.parseInt(match[2], 10)
      if (!name || !Number.isFinite(size) || size < 0) return []
      return [{ name, size }]
    })
}

const VIDEO_FILE_RE = /\.(?:avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm)$/i
const AUDIO_FILE_RE = /\.(?:aac|flac|m4a|mp3|oga|ogg|wav)$/i
const IMAGE_FILE_RE = /\.(?:bmp|gif|jpe?g|png|webp)$/i
const SCRUB_PROXY_EDGE = 480
const SCRUB_FILE_RE = /_scrub(?:_(?:landscape|portrait|classic))?(?:_\d+)?\.[a-z0-9]+$/i
// Mirrors sessions.IsRenderOutput: final exports written as
// render_<hex>.<ext> (or legacy render_output.*). Used as a fallback when an
// older server does not send the explicit `render` flag.
const RENDER_FILE_RE = /^render_(?:.*\.)?(?:mp4|avi|mp3)$/i
const RENDER_OUTPUT_RE = /^render_output\.(?:mp4|avi|mp3)$/i

export function isRenderFileName(fileName: string): boolean {
  const base = fileName.trim().toLowerCase()
  return RENDER_FILE_RE.test(base) || RENDER_OUTPUT_RE.test(base)
}

export function mediaKindForFileName(fileName: string): MediaKind | null {
  if (/^ai_scene_[a-f0-9]{32}_\d{2}\.scene\.json$/i.test(fileName)) return 'video'
  if (VIDEO_FILE_RE.test(fileName)) return 'video'
  if (AUDIO_FILE_RE.test(fileName)) return 'audio'
  if (IMAGE_FILE_RE.test(fileName)) return 'image'
  return null
}

export async function listSourceVideos(): Promise<FileEntry[]> {
  const all = await listFiles()
  return all.filter((file) => VIDEO_FILE_RE.test(file.name) && !SCRUB_FILE_RE.test(file.name) && !isRenderFileName(file.name) && file.render !== true)
}

export interface ScrubEntry {
  scrubName: string
  displayName: string
  size: number
}

export async function listScrubs(): Promise<ScrubEntry[]> {
  const all = await listFiles()
  return all
    .filter((f) => SCRUB_FILE_RE.test(f.name))
    .map((f) => ({
      scrubName: f.name,
      displayName: f.name.replace(/_scrub(?:_(?:landscape|portrait|classic))?(?:_\d+)?(?=\.[a-z0-9]+$)/i, ''),
      size: f.size,
    }))
}

export function scrubProxyName(fileName: string, aspect?: ProjectAspect): string {
  const dot = fileName.lastIndexOf('.')
  const suffix = aspect ? `_scrub_${aspect}_${SCRUB_PROXY_EDGE}` : `_scrub_${SCRUB_PROXY_EDGE}`
  if (dot <= 0) return `${fileName}${suffix}`
  return `${fileName.slice(0, dot)}${suffix}${fileName.slice(dot)}`
}

export interface ProxySourceEntry extends FileEntry {
  mediaKind: MediaKind
  scrubName?: string
  isRender?: boolean
}

export async function listProxySources(): Promise<ProxySourceEntry[]> {
  const all = await listFiles()
  const videoNames = new Map(
    all.filter((file) => VIDEO_FILE_RE.test(file.name)).map((file) => [file.name.toLowerCase(), file.name]),
  )
  return all
    .filter((file) => mediaKindForFileName(file.name) !== null && !SCRUB_FILE_RE.test(file.name))
    .map((file) => {
      const mediaKind = mediaKindForFileName(file.name)!
      const isRender = file.render === true || isRenderFileName(file.name)
      return {
        ...file,
        mediaKind,
        isRender,
        ...(mediaKind === 'video' && !isRender ? {
          scrubName: videoNames.get(scrubProxyName(file.name, 'landscape').toLowerCase())
            ?? videoNames.get(scrubProxyName(file.name, 'portrait').toLowerCase())
            ?? videoNames.get(scrubProxyName(file.name, 'classic').toLowerCase())
            ?? videoNames.get(scrubProxyName(file.name).toLowerCase()),
        } : {}),
      }
    })
}

async function videoBlobResult(blob: Blob): Promise<{ blobUrl: string; duration: number }> {
  const blobUrl = URL.createObjectURL(blob)
  const duration = await new Promise<number>((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = false
    v.onloadedmetadata = () => {
      const d = v.duration || 0
      v.remove()
      resolve(d)
    }
    v.onerror = () => {
      v.remove()
      reject(new Error('cannot read video metadata for scrub proxy'))
    }
    v.src = blobUrl
  })
  return { blobUrl, duration }
}

export function scrubProxyUrl(sourceFileName: string, aspect: ProjectAspect = 'landscape'): string {
  return withSession(`${API_BASE}/scrub-proxy?file=${encodeURIComponent(sourceFileName)}&aspect=${aspect}`)
}

export async function getScrubProxy(sourceFileName: string, aspect: ProjectAspect = 'landscape'): Promise<{ blobUrl: string; duration: number }> {
  const url = scrubProxyUrl(sourceFileName, aspect)
  // Validate with a 2-byte range read instead of downloading the whole body.
  // Passthrough originals can be hundreds of MB; buffering them via blob()
  // fails in the browser (net::ERR_FAILED on a 200 response) and wastes RAM.
  // The timeline player streams through Range requests (the server answers
  // 206 with ETag), so returning the URL directly is both faster and safer.
  const probe = await fetch(url, { headers: { Range: 'bytes=0-1', ...authHeader(), ...sessionHeader() } })
  if (!probe.ok) await throwHttpError(probe, 'media')
  const type = probe.headers.get('content-type') ?? ''
  if (!type.startsWith('video/')) {
    throw new Error('We could not prepare the video preview. Please try again.')
  }
  await probe.arrayBuffer()
  const { duration } = await getMediaMetadata(sourceFileName)
  return { blobUrl: url, duration }
}

export function audioPreviewUrl(fileName: string): string {
  return withSession(`${API_BASE}/audio-preview?file=${encodeURIComponent(fileName)}`)
}

export async function getAudioPreview(fileName: string): Promise<string | null> {
  const url = audioPreviewUrl(fileName)
  // Same rationale as getScrubProxy: validate with a 2-byte range read and
  // stream the URL instead of buffering the whole preview as a Blob. Long
  // sources produce tens of MB of AAC, which fails in the browser
  // (net::ERR_FAILED on a 200 response) and pins RAM for the session.
  const probe = await fetch(url, { headers: { Range: 'bytes=0-1', ...authHeader(), ...sessionHeader() } })
  if (probe.status === 204) return null
  if (!probe.ok) await throwHttpError(probe, 'audio')
  if (!(probe.headers.get('content-type') ?? '').startsWith('audio/')) {
    throw new Error('We could not prepare the audio preview. Please try again.')
  }
  await probe.arrayBuffer()
  return url
}

export async function downloadFile(fileName: string): Promise<Blob> {
  const url = withSession(`${API_BASE}/download?file=${encodeURIComponent(fileName)}`)
  const resp = await fetch(url, { headers: { ...authHeader(), ...sessionHeader() } })
  if (!resp.ok) await throwHttpError(resp, 'media')
  return resp.blob()
}

export interface DeleteMediaResult {
  deleted: string
  scrubDeleted: string[]
}

export async function deleteMediaFile(fileName: string): Promise<DeleteMediaResult> {
  const resp = await fetch(withSession(`${API_BASE}/media?file=${encodeURIComponent(fileName)}`), { method: 'DELETE', headers: authHeader() })
  if (!resp.ok) await throwHttpError(resp, 'media')
  return await resp.json() as DeleteMediaResult
}

export interface BulkDeleteMediaFailure {
  file: string
  error: string
}

export interface BulkDeleteMediaResult {
  deleted: string[]
  scrubDeleted: string[]
  failed: BulkDeleteMediaFailure[]
}

export async function deleteMediaFiles(fileNames: string[]): Promise<BulkDeleteMediaResult> {
  const resp = await fetch(withSession(`${API_BASE}/media`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ files: fileNames }),
  })
  if (!resp.ok) await throwHttpError(resp, 'media')
  const result = await resp.json() as Partial<BulkDeleteMediaResult>
  return {
    deleted: Array.isArray(result.deleted) ? result.deleted : [],
    scrubDeleted: Array.isArray(result.scrubDeleted) ? result.scrubDeleted : [],
    failed: Array.isArray(result.failed) ? result.failed : [],
  }
}

export async function getVolumeSourcePreview(fileName: string): Promise<{ blob: Blob; blobUrl: string }> {
  const blob = await downloadFile(fileName)
  return { blob, blobUrl: URL.createObjectURL(blob) }
}

export async function getVolumeProxyPreview(scrubFileName: string): Promise<{ blobUrl: string; duration: number }> {
  const blob = await downloadFile(scrubFileName)
  if (!blob.type.startsWith('video/')) {
    throw new Error('We could not prepare the video preview. Please try again.')
  }
  return videoBlobResult(blob)
}

export function mediaSourceUrl(fileName: string): string {
  return withSession(`${API_BASE}/download?file=${encodeURIComponent(fileName)}`)
}

export function mediaThumbnailUrl(fileName: string): string {
  return withSession(`${API_BASE}/thumbnail?file=${encodeURIComponent(fileName)}`)
}

export async function getMediaMetadata(fileName: string): Promise<{ duration: number; width: number; height: number }> {
  const response = await fetch(withSession(`${API_BASE}/media-metadata?file=${encodeURIComponent(fileName)}`), { headers: { ...authHeader(), ...sessionHeader() } })
  if (!response.ok) await throwHttpError(response, 'media')
  const metadata = await response.json()
  if (![metadata.duration, metadata.width, metadata.height].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('We could not read the metadata for this media. Please try again.')
  }
  return metadata
}

export interface UploadProgress {
  loaded: number
  total: number
}

export async function uploadFile(file: File, onProgress?: (progress: UploadProgress) => void): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  if (onProgress) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', withSession(`${API_BASE}/upload`))
      const auth = authHeader()
      if (auth.Authorization) request.setRequestHeader('Authorization', auth.Authorization)
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress({ loaded: event.loaded, total: event.total })
      }
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) resolve(request.responseText)
        else reject(new Error(friendlyHttpError(request.status, request.responseText, 'upload')))
      }
      request.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
      request.onabort = () => reject(new Error('Upload canceled'))
      request.send(form)
    })
  }
  const resp = await fetch(withSession(`${API_BASE}/upload`), { method: 'POST', headers: authHeader(), body: form })
  if (!resp.ok) await throwHttpError(resp, 'upload')
  return await resp.text()
}

export async function getWaveform(fileName: string): Promise<WaveformData> {
  const response = await fetch(withSession(`${API_BASE}/waveform?file=${encodeURIComponent(fileName)}`))
  if (!response.ok) await throwHttpError(response, 'audio')

  const result = await response.json() as {
    sampleRate: number
    length: number
    binSamples: number
    min: number[]
    max: number[]
  }
  if (
    !Number.isFinite(result.sampleRate)
    || !Number.isFinite(result.length)
    || !Number.isFinite(result.binSamples)
    || result.sampleRate <= 0
    || result.length < 0
    || result.binSamples <= 0
    || !Array.isArray(result.min)
    || !Array.isArray(result.max)
    || result.min.length !== result.max.length
  ) {
    throw new Error('We could not load the audio waveform. Please try again.')
  }

  return {
    sampleRate: result.sampleRate,
    length: result.length,
    peaks: {
      binSamples: result.binSamples,
      totalBins: result.min.length,
      min: Float32Array.from(result.min),
      max: Float32Array.from(result.max),
    },
  }
}

export const AI_IMAGE_MODELS = [
  {
    id: 'openai/gpt-image-2.6-sunburst',
    label: 'GPT Image 2.6 Sunburst',
    price: 'Usage-based pricing',
    output: 'PNG; transparent or opaque',
    aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto'],
    transparent: true,
  },
  {
    id: 'openai/gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    price: 'Usage-based pricing',
    output: 'PNG; transparent or opaque',
    aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto'],
    transparent: true,
  },
  {
    id: 'openai/gpt-image-2',
    label: 'GPT Image 2',
    price: '$0.005-0.006 / image, low',
    output: 'Opaque; low quality',
    aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto'],
    transparent: false,
  },
  {
    id: 'black-forest-labs/flux.2-klein-4b',
    label: 'FLUX.2 Klein 4B',
    price: '$0.014 / MP',
    output: 'PNG or JPEG; opaque',
    aspects: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', 'auto'],
    transparent: false,
  },
  {
    id: 'krea/krea-2-medium-turbo',
    label: 'Krea 2 Medium Turbo',
    price: '$0.015 / image, 1K',
    output: 'Opaque',
    aspects: ['1:1', '4:3', '3:2', '16:9', '4:5', '2:3', '9:16'],
    transparent: false,
  },
  {
    id: 'sourceful/riverflow-v2.5-fast',
    label: 'Riverflow V2.5 Fast',
    price: '$0.019 / image, 1K',
    output: 'JPEG; opaque',
    aspects: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', 'auto'],
    transparent: false,
  },
  {
    id: 'google/gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    price: 'from $0.019 / image',
    output: 'Opaque',
    aspects: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '9:16', '16:9', '21:9'],
    transparent: false,
  },
  {
    id: 'qwen/qwen-image-3',
    label: 'Qwen Image 3',
    price: '$0.030 / image, 1K',
    output: 'PNG; opaque',
    aspects: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '9:16', '16:9'],
    transparent: false,
  },
  {
    id: 'bytedance-seed/seedream-5-0-lite',
    label: 'Seedream 5.0 Lite',
    price: '$0.035 / image, 2K',
    output: 'Opaque',
    aspects: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '9:16', '16:9', '21:9', 'auto'],
    transparent: false,
  },
  {
    id: 'recraft/recraft-v4.1',
    label: 'Recraft V4.1',
    price: '$0.035 / image',
    output: 'Opaque',
    aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', 'auto'],
    transparent: false,
  },
  {
    id: 'x-ai/grok-imagine-image-2.0',
    label: 'Grok Imagine Image 2.0',
    price: '$0.040 / image, 1K low',
    output: 'Opaque',
    aspects: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', 'auto'],
    transparent: false,
  },
] as const

export type AIImageModel = (typeof AI_IMAGE_MODELS)[number]['id']
export type AIImageAspect = 'auto' | '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '4:5' | '16:9' | '9:16' | '21:9'
export type AIImageBackground = 'auto' | 'transparent' | 'opaque'
export type AIImageQuality = 'auto' | 'low' | 'medium' | 'high'

export interface AIImageRequest {
  prompt: string
  sourceName?: string
  model?: AIImageModel
  aspect?: AIImageAspect
  background?: AIImageBackground
  quality?: AIImageQuality
}

export interface AIImageResult {
  id: string
  name: string
  mediaType: string
  width: number
  height: number
  sourceMode: 'proxy'
  warning?: string
}

export async function requestAIImage(request: AIImageRequest, signal?: AbortSignal): Promise<AIImageResult> {
  const headers = { 'Content-Type': 'application/json', ...authHeader(), ...sessionHeader() }
  const initial = await jobFetch(withSession(`${API_BASE}/ai/images`), {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  })
  const resp = await resolveJobResponse(initial, { base: API_BASE, headers, signal })
  if (!resp.ok) {
    await throwHttpError(resp, 'image')
  }
  return await resp.json() as AIImageResult
}

// --- AI timeline editing -------------------------------------------------

export interface AIClipContext {
  id: string
  name?: string
  sourceId?: string
  sourceDuration: number
  mediaKind?: MediaKind
  start: number
  end: number
  sourceIn: number
  sourceOut: number
  rate: number
  volume?: number
  transform?: ClipTransform
  transformKeyframes?: AITransformKeyframe[]
  motionPreset?: string
  linkedId?: string
}

export interface AIMediaSource {
  id: string
  name: string
  kind: MediaKind
  sourceMode?: 'proxy' | 'wasm'
  duration: number
  width?: number
  height?: number
  timelineClipIds?: string[]
}

export interface AITrackContext {
  id: string
  name: string
  type: 'video' | 'audio'
  locked: boolean
  muted: boolean
  hidden: boolean
  clips: AIClipContext[]
}

export interface AIFocusContext {
  playhead: number
  selectedClipIds: string[]
  selectedTrackIds: string[]
  selectedEffectIds: string[]
  selectedTextIds: string[]
}

export interface AIEffectContext {
  id: string
  trackId: string
  preset: string
  start: number
  duration: number
  params?: Record<string, number>
  ownerClipId?: string
  clipLookId?: string
  ramp?: EffectRamp
}

export interface AITransitionContext {
  id: string
  trackId: string
  leftClipId: string
  rightClipId: string
  preset: string
  duration: number
}

export interface AITextStyle {
  x?: number
  y?: number
  fontFamily?: TextFontFamily
  fontSize?: number
  fontWeight?: 400 | 700
  italic?: boolean
  align?: TextAlign
  color?: string
  strokeColor?: string
  strokeWidth?: number
  backgroundColor?: string
  backgroundOpacity?: number
  backgroundPadding?: number
  backgroundRadius?: number
  bannerStyle?: TextBannerStyle
  accentColor?: string
  animation?: TextAnimation
  animationDuration?: number
  opacity?: number
  rotation?: number
  isCaption?: boolean
  highlightMode?: TextHighlightMode
  highlightColor?: string
  highlightBackgroundColor?: string
  highlightBackgroundOpacity?: number
  highlightAnimation?: TextHighlightAnimation
}

export interface AITextContext {
  id: string
  start: number
  duration: number
  text: string
  style?: AITextStyle
}

export interface AIProjectContext {
  duration: number
  fps: number
  aspect: ProjectAspect
  focus: AIFocusContext
  tracks: AITrackContext[]
  effects: AIEffectContext[]
  transitions: AITransitionContext[]
  texts: AITextContext[]
  sources: AIMediaSource[]
}

export interface AITransformPatch {
  zoomX?: number
  zoomY?: number
  linkZoom?: boolean
  positionX?: number
  positionY?: number
  rotation?: number
  anchorX?: number
  anchorY?: number
  pitch?: number
  yaw?: number
  flipH?: boolean
  flipV?: boolean
  keyframes?: AITransformKeyframe[]
}

export interface AITransformKeyframe {
  time: number
  transform: Omit<AITransformPatch, 'keyframes'>
}

export type AIEditOperation =
  | { type: 'delete_range'; start: number; end: number; channelIds?: string[] }
  | { type: 'add_effect'; channelId: string; effectId: string; start: number; duration: number; params?: Record<string, number> }
  | { type: 'update_effect'; blockId: string; start?: number; duration?: number; params?: Record<string, number> }
  | { type: 'delete_effect'; blockId: string }
  | { type: 'add_text'; start: number; duration: number; text: string; textPresetId?: string; style?: AITextStyle }
  | { type: 'update_text'; textId: string; start?: number; duration?: number; text?: string; textPresetId?: string; style?: AITextStyle }
  | { type: 'delete_text'; textId: string }
  | { type: 'add_media'; sourceId: string; resultId: string; channelId: string; start: number; sourceIn: number; sourceOut: number; includeAudio: boolean; playbackRate?: number; volume?: number }
  | { type: 'move_clip'; clipId: string; channelId?: string; start?: number; delta?: number }
  | { type: 'update_clip'; clipId: string; start?: number; inPoint?: number; outPoint?: number; playbackRate?: number; volume?: number; transform?: AITransformPatch; motionPreset?: string }
  | { type: 'split_clip'; clipId: string; time: number }
  | { type: 'remove_source_audio'; clipId: string }
  | { type: 'delete_clip'; clipId: string }
  | { type: 'apply_preset'; clipId: string; presetId: string }
  | { type: 'add_transition' | 'update_transition'; channelId: string; leftClipId: string; rightClipId: string; effectId: string; duration: number }
  | { type: 'undo'; count?: number }

export interface AIEditImageJob {
  id: string
  prompt: string
  sourceName?: string
  style?: string
  placement: 'media-bin' | 'overlay'
  position: 'left' | 'center' | 'right'
  start: number
  duration: number
  background: AIImageBackground
  quality: AIImageQuality
  motionPreset: TransformPreset
  opacity?: number
  fade?: number
}

export interface AIEditSpeechJob {
  id: string
  input: string
  model: string
  voice: string
  language?: string
  instructions?: string
  start: number
  volume?: number
}

export interface AIEditPlan {
  documentEdit?: { result: CompilationResult; input: CompositionInput; revision: string; stateRevision: number }
  revision: string
  mode?: 'execute' | 'recommend'
  summary: string
  imageJobs?: AIEditImageJob[]
  speechJobs?: AIEditSpeechJob[]
  operations: AIEditOperation[]
}

export async function requestAIEdit(
  instruction: string,
  revision: string,
  project: AIProjectContext,
  signal?: AbortSignal,
  options?: { fast?: boolean },
): Promise<AIEditPlan> {
  const url = options?.fast ? `${API_BASE}/ai/edit?fast=1` : `${API_BASE}/ai/edit`
  const headers = { 'Content-Type': 'application/json', ...authHeader(), ...sessionHeader() }
  const initial = await jobFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ instruction, revision, project, ...(options?.fast ? { fast: true } : {}) }),
    signal,
  })
  const resp = await resolveJobResponse(initial, { base: API_BASE, headers, signal })
  if (!resp.ok) {
    await throwHttpError(resp, 'edit')
  }
  const plan = await resp.json() as AIEditPlan
  // The wire may carry null for omitted arrays; the editor always treats a
  // missing operation list as empty so reading operations.length never throws.
  plan.operations ??= []
  return plan
}

// --- Server-side compile (real ffmpeg) ----------------------------------
// The client sends the resolved timeline grouped by channel. The server cuts
// each segment from the ORIGINAL uploaded file, applies the filter, combines
// channels, and transcodes to the target resolution/fps.

export interface RenderSegmentPayload {
  srcStart: number
  srcEnd: number
  // Ordered preset instances. Each renderer validates the ID and parameters;
  // arbitrary client filtergraphs are rejected.
  effects: EffectInstance[]
}

export interface RenderClipPayload {
  // Original uploaded file name (NOT the scrub proxy).
  file: string
  sourceMode?: 'proxy' | 'wasm'
  sourceId?: string
  mediaKind?: MediaKind
  inPoint: number
  outPoint: number
  start: number
  playbackRate?: number
  // Per-clip audio level in percent (0-200); omitted values default to 100.
  volume?: number
  transform?: ClipTransform
  transformKeyframes?: ClipTransformKeyframe[]
  opacity?: number
  fadeIn?: number
  fadeOut?: number
  segments: RenderSegmentPayload[]
}

export interface RenderTransitionPayload {
  // Index of the right clip within the channel's sorted `clips` array; the junction
  // between clips[rightClipIndex-1] and clips[rightClipIndex] uses `xfade`.
  rightClipIndex: number
  // Whitelisted transition token resolved to an xfade preset or custom expression.
  xfade: string
}

export interface RenderChannelPayload {
  clips: RenderClipPayload[]
  transitions?: RenderTransitionPayload[]
}

export interface RenderTextPayload {
  start: number
  duration: number
  // Top-left output coordinates for the transparent PNG overlay.
  x: number
  y: number
  animation?: Exclude<TextAnimation, 'none'>
  animationDuration?: number
  // Highlight overlays keep the parent caption's motion while using a shorter
  // visibility window for the active word.
  motionStart?: number
  motionDuration?: number
  // Base64-encoded PNG rasterized by the same browser canvas used by Pixi.
  image: string
}

export type RenderFormat = 'mp4' | 'avi' | 'mp3'
export type RenderQuality = 'low' | 'normal' | 'high'

export interface RenderPayload {
  fit?: VideoFit
  format?: RenderFormat
  quality?: RenderQuality
  resolution: { w: number; h: number }
  fps: number
  videoChannels: RenderChannelPayload[]
  audioChannels: RenderChannelPayload[]
  textItems?: RenderTextPayload[]
}

export interface ServerRenderProgress {
  ratio: number
  message: string
}

export interface CompileProjectOptions {
  onProgress?: (progress: ServerRenderProgress) => void
}

interface ServerRenderEvent {
  type: 'progress' | 'complete' | 'error'
  ratio?: number
  message?: string
  filename?: string
}

async function readServerRenderEvents(
  response: Response,
  onProgress?: (progress: ServerRenderProgress) => void,
): Promise<string> {
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    const result = await response.json() as { filename?: string }
    if (!result.filename) throw new Error('The render completed without an output file.')
    return result.filename
  }
  if (!response.body) throw new Error('render server returned an empty response')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let filename = ''

  const handleLine = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as ServerRenderEvent
    if (event.type === 'error') throw new Error(friendlyErrorMessage(event.message || 'server render failed', 'render'))
    if (event.type === 'complete') {
      filename = event.filename || 'render_output.mp4'
      return
    }
    if (event.type === 'progress' && typeof event.ratio === 'number') {
      onProgress?.({
        ratio: Math.max(0, Math.min(0.97, event.ratio * 0.97)),
        message: event.message || 'rendering on server',
      })
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
    if (done) break
  }
  handleLine(buffer)
  if (!filename) throw new Error('render server closed before producing a file')
  return filename
}

async function downloadRenderedFile(
  filename: string,
  onProgress?: (progress: ServerRenderProgress) => void,
): Promise<Blob> {
  const response = await fetch(withSession(`${API_BASE}/download?file=${encodeURIComponent(filename)}`))
  if (!response.ok) {
    await throwHttpError(response, 'render')
  }

  const totalBytes = Number(response.headers.get('Content-Length'))
  if (!response.body || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    const blob = await response.blob()
    onProgress?.({ ratio: 1, message: 'download complete' })
    return blob
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let receivedBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    receivedBytes += value.byteLength
    onProgress?.({
      ratio: 0.97 + Math.min(1, receivedBytes / totalBytes) * 0.03,
      message: 'downloading rendered file',
    })
  }
  return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' })
}

export async function compileProject(
  payload: RenderPayload,
  options: CompileProjectOptions = {},
): Promise<{ blob: Blob; filename: string }> {
  const renderChannels = payload.format === 'mp3'
    ? payload.audioChannels
    : [...payload.videoChannels, ...payload.audioChannels]
  const hasLocalMedia = renderChannels
    .some((channel) => channel.clips.some((clip) => clip.sourceMode === 'wasm'))
  if (hasLocalMedia) throw new Error('Local media can only be rendered on this device')

  const headers = { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...authHeader(), ...sessionHeader() }
  const initial = await jobFetch(withSession(`${API_BASE}/render`), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const resp = await resolveJobResponse(initial, { base: API_BASE, headers,
    onProgress: job => options.onProgress?.({ ratio: job.progress * 0.97, message: job.message ?? 'Waiting for a render worker' }) })
  if (!resp.ok) {
    await throwHttpError(resp, 'render')
  }
  const filename = await readServerRenderEvents(resp, options.onProgress)
  options.onProgress?.({ ratio: 0.97, message: 'downloading rendered file' })
  const blob = await downloadRenderedFile(filename, options.onProgress)
  return { blob, filename }
}

export interface GenerateSRTRequest {
  file: string
  language?: string
  start?: number
  duration?: number
}

export interface GeneratedCaptionWord {
  text: string
  start: number
  end: number
}

export interface GeneratedCaptionCue {
  start: number
  end: number
  text: string
  words: GeneratedCaptionWord[]
}

export interface GenerateCaptionsResponse {
  cues: GeneratedCaptionCue[]
}

function subtitleHeaders(accept?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(accept ? { Accept: accept } : {}),
    ...authHeader(),
    ...sessionHeader(),
  }
}

export async function generateSRT(
  request: GenerateSRTRequest,
  signal?: AbortSignal,
): Promise<string> {
  const initial = await jobFetch(withSession(`${API_BASE}/ai/subtitles`), {
    method: 'POST',
    headers: subtitleHeaders(),
    body: JSON.stringify(request),
    signal,
  })

  const response = await resolveJobResponse(initial, { base: API_BASE, headers: subtitleHeaders(), signal })

  if (!response.ok) {
    await throwHttpError(response, 'captions')
  }

  return response.text()
}

export async function generateCaptions(
  request: GenerateSRTRequest,
  signal?: AbortSignal,
): Promise<GenerateCaptionsResponse> {
  const initial = await jobFetch(withSession(`${API_BASE}/ai/subtitles`), {
    method: 'POST',
    headers: subtitleHeaders('application/json'),
    body: JSON.stringify(request),
    signal,
  })
  const response = await resolveJobResponse(initial, { base: API_BASE, headers: subtitleHeaders('application/json'), signal })
  if (!response.ok) {
    await throwHttpError(response, 'captions')
  }
  return await response.json() as GenerateCaptionsResponse
}
