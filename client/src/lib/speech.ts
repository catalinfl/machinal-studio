import { fetchFile } from '@ffmpeg/util'
import { API_BASE, authHeader, downloadFile, friendlyHttpError, listProxySources, uploadFile } from './api'
import { withSession, sessionHeader } from './session'
import { jobFetch, resolveJobResponse } from './job-response'
import { getMediaBinSources, registerMediaBinSource } from './media-bin'
import { readAudioMetadata } from './video-metadata'
import { createFFmpeg, execGuarded } from './wasm'

export const MAX_SPEECH_REFERENCE_SECONDS = 30

const SPEECH_REFERENCE_RE = /\.(?:aac|avi|flac|m4a|mkv|mov|mp3|mp4|mpeg|mpg|oga|ogg|ogv|wav|webm)$/i

export { SPEECH_MODELS, DEFAULT_SPEECH_MODEL, type SpeechModel } from './speech-catalog'
import type { SpeechModel } from './speech-catalog'

export interface SpeechRequest {
  input: string
  language?: string
  instructions?: string
  model: SpeechModel
  voice?: string
  referenceName?: string
  referenceTranscript?: string
}

export interface SpeechResult {
  id: string
  name: string
  mediaType: string
  sourceMode: 'proxy'
  generationId?: string
  language?: string
}

export interface GeneratedSpeech {
  asset: SpeechResult
  blobUrl: string
  duration: number
}

export function registerGeneratedSpeech(generated: GeneratedSpeech): void {
  registerMediaBinSource({
    id: generated.asset.name,
    name: generated.asset.name,
    kind: 'audio',
    duration: generated.duration,
    sourceMode: 'proxy',
    scrubBlobUrl: generated.blobUrl,
    generated: true,
  })
}

export async function listSpeechReferences(): Promise<string[]> {
  const stored = (await listProxySources())
    .filter((source) => source.mediaKind === 'audio' && !source.isRender && /\.mp3$/i.test(source.name))
    .map((source) => source.name)
  const registered = getMediaBinSources()
    .filter((source) => source.kind === 'audio' && source.sourceMode === 'proxy' && /\.mp3$/i.test(source.name))
    .map((source) => source.name)
  return [...new Set([...stored, ...registered])].sort((left, right) => left.localeCompare(right))
}

export async function uploadSpeechReference(file: File, start: number, duration: number): Promise<string> {
  if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && !SPEECH_REFERENCE_RE.test(file.name)) {
    throw new Error('Choose an audio or video file with a supported format')
  }
  if (!Number.isFinite(start) || start < 0) throw new Error('Sample start must be zero or greater')
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SPEECH_REFERENCE_SECONDS) {
    throw new Error(`Sample duration must be between 0 and ${MAX_SPEECH_REFERENCE_SECONDS} seconds`)
  }

  const ffmpeg = await createFFmpeg()
  const inputName = `speech_reference_input_${Date.now()}`
  const outputName = `speech_reference_${Date.now()}.mp3`
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file))
    await execGuarded(ffmpeg, [
      '-ss', start.toFixed(3),
      '-i', inputName,
      '-t', duration.toFixed(3),
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '1',
      '-y', outputName,
    ])
    const data = await ffmpeg.readFile(outputName) as Uint8Array<ArrayBuffer>
    if (data.byteLength === 0) throw new Error('The selected segment contains no audio')
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'voice'
    const sample = new File([data], `${baseName}_voice.mp3`, { type: 'audio/mpeg' })
    if (sample.size > 15 * 1024 * 1024) throw new Error('The extracted voice sample exceeds 15 MB')
    await uploadFile(sample)
    return sample.name
  } finally {
    if (ffmpeg.loaded) {
      try { await ffmpeg.deleteFile(inputName) } catch {}
      try { await ffmpeg.deleteFile(outputName) } catch {}
    }
    try { ffmpeg.terminate() } catch {}
  }
}

export async function prepareSpeech(request: SpeechRequest, signal?: AbortSignal): Promise<GeneratedSpeech> {
  const headers = { 'Content-Type': 'application/json', ...authHeader(), ...sessionHeader() }
  const initial = await jobFetch(withSession(`${API_BASE}/ai/speech`), {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  })
  const response = await resolveJobResponse(initial, { base: API_BASE, headers, signal })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(friendlyHttpError(response.status, message, 'speech'))
  }
  const asset = await response.json() as SpeechResult
  const blob = await downloadFile(asset.name)
  const blobUrl = URL.createObjectURL(blob)
  const duration = (await readAudioMetadata(blob)).duration
  return { asset, blobUrl, duration }
}

export async function generateSpeech(request: SpeechRequest, signal?: AbortSignal): Promise<GeneratedSpeech> {
  const generated = await prepareSpeech(request, signal)
  registerGeneratedSpeech(generated)
  return generated
}

export function voiceLabel(voice: string): string {
  return voice
    .replace(/:MAI-Voice-2$/, '')
    .replace(/^(?:en|gb|fr|af|am|bf|bm|ef|em|ff|jf|jm|pf|pm|zf|zm)[-_]/i, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
