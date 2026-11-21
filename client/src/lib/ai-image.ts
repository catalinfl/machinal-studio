import { downloadFile, requestAIImage, uploadFile, type AIImageAspect, type AIImageBackground, type AIImageModel, type AIImageQuality, type AIImageResult } from './api'
import { clipEnd, editor, type Channel, type Clip } from '../stores/editor.svelte'
import { insertPreparedMedia, type PreparedMediaInsertion } from './drop'
import { getMediaBinSources, registerMediaBinSource } from './media-bin'
import { normalizeClipTransform, transformPreset, type TransformPreset } from './clip-transform'
import { readImageMetadata } from './video-metadata'

export type AIImagePlacement = 'media-bin' | 'overlay'
export type AIImagePosition = 'left' | 'center' | 'right'

export interface AIImageJob {
  id?: string
  prompt: string
  sourceName?: string
  model?: AIImageModel
  style?: string
  placement?: AIImagePlacement
  position?: AIImagePosition
  start?: number
  duration?: number
  aspect?: AIImageAspect
  background?: AIImageBackground
  quality?: AIImageQuality
  motionPreset?: TransformPreset
  opacity?: number
  fade?: number
}

export interface AIImageExecution {
  asset: AIImageResult
  clip?: Clip
}

export interface PreparedAIImageJob {
  asset: AIImageResult
  blobUrl: string
  sourceDuration: number
  job: AIImageJob
}

const DEFAULT_IMAGE_DURATION = 5

export async function importProxyImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, WebP, GIF, or BMP image')
  const metadata = await readImageMetadata(file)
  await uploadFile(file)
  const blobUrl = URL.createObjectURL(file)
  registerMediaBinSource({
    id: file.name,
    name: file.name,
    kind: 'image',
    duration: 10,
    width: metadata.width,
    height: metadata.height,
    sourceMode: 'proxy',
    scrubBlobUrl: blobUrl,
    generated: false,
  })
  return file.name
}

function projectAspect(): AIImageAspect {
  if (editor.effectiveProjectAspect === 'portrait') return '9:16'
  if (editor.effectiveProjectAspect === 'classic') return '4:3'
  return '16:9'
}

function generatedPrompt(job: AIImageJob, background: AIImageBackground): string {
  const prompt = job.prompt.trim()
  const style = job.style?.trim()
  const promptLength = Array.from(prompt).length
  if (promptLength > 4000) throw new Error('Image prompts must contain at most 4000 characters')
  const instructions = []
  if (style) instructions.push(`Visual style: ${style}.`)
  if (background === 'transparent') {
    instructions.push('Background requirement: no background. Isolate only the requested subject on a genuinely transparent alpha channel and return a transparent PNG. Do not draw a checkerboard, white or colored backdrop, frame, card, shadow plane, or rectangular canvas.')
  } else if (background === 'opaque') {
    instructions.push('Background requirement: include a complete, natural background that fits the requested scene. The image must be fully opaque; do not use transparency or a checkerboard pattern.')
  }
  if (instructions.length === 0) return prompt
  const separator = '\n\n'
  const suffix = instructions.join('\n')
  const available = Math.max(0, 4000 - Array.from(separator + suffix).length)
  return Array.from(prompt).slice(0, available).join('') + separator + suffix
}

function assertEditableSource(sourceName: string | undefined): void {
  if (!sourceName) return
  const source = getMediaBinSources().find((candidate) => candidate.name.toLowerCase() === sourceName.toLowerCase())
  if (!source || source.kind !== 'image') throw new Error(`Image source ${sourceName} is not available in the Media Bin`)
  if (source.sourceMode !== 'proxy') throw new Error('AI image editing is available only for images in Proxy mode')
}

function registerGeneratedImage(asset: AIImageResult, blobUrl: string, duration: number): void {
  registerMediaBinSource({
    id: asset.name,
    name: asset.name,
    kind: 'image',
    duration,
    width: asset.width,
    height: asset.height,
    sourceMode: 'proxy',
    scrubBlobUrl: blobUrl,
    generated: true,
  })
}

export function registerPreparedAIImageJob(preparedImage: PreparedAIImageJob): void {
  registerGeneratedImage(preparedImage.asset, preparedImage.blobUrl, preparedImage.sourceDuration)
}

function overlaps(channel: Channel, start: number, duration: number): boolean {
  const end = start + duration
  return channel.clips.some((clip) => start < clipEnd(clip) - 0.001 && end > clip.start + 0.001)
}

function imageChannel(start: number, duration: number): Channel {
  const videoChannels = editor.channels.filter((channel) => channel.type === 'video')
  for (let index = videoChannels.length - 1; index >= 0; index -= 1) {
    const channel = videoChannels[index]
    if (!channel.locked && !overlaps(channel, start, duration)) return channel
  }
  return editor.addChannel('video')
}

function overlayBase(position: AIImagePosition) {
  return normalizeClipTransform({
    zoomX: 0.62,
    zoomY: 0.62,
    positionX: position === 'left' ? -24 : position === 'right' ? 24 : 0,
  })
}

function applyImageTreatment(clip: Clip, job: AIImageJob, duration: number): void {
  const fade = Math.max(0, Math.min(duration / 2, job.fade ?? 0.35))
  editor.setClipCompositing(clip.id, {
    opacity: Math.max(0, Math.min(1, job.opacity ?? 1)),
    fadeIn: fade,
    fadeOut: fade,
  })

  const preset = job.motionPreset ?? 'none'
  const animation = transformPreset(preset, duration)
  const base = overlayBase(job.position ?? 'center')
  const keyframes = animation.keyframes.map((keyframe) => ({
    time: keyframe.time,
    transform: normalizeClipTransform({
      ...base,
      zoomX: base.zoomX * keyframe.transform.zoomX,
      zoomY: base.zoomY * keyframe.transform.zoomY,
      positionX: base.positionX + keyframe.transform.positionX * 0.35,
      positionY: base.positionY + keyframe.transform.positionY * 0.35,
    }),
  }))
  editor.setClipTransformKeyframes(clip.id, base, keyframes, preset)
}

export function applyPreparedAIImageJob(preparedImage: PreparedAIImageJob): Clip | undefined {
  const { asset, blobUrl, job, sourceDuration } = preparedImage
  if (!job.placement || job.placement === 'media-bin') return undefined
  const start = Math.max(0, job.start ?? editor.currentTime)
  const duration = Math.max(0.2, Math.min(sourceDuration, job.duration ?? DEFAULT_IMAGE_DURATION))
  const channel = imageChannel(start, duration)
  const prepared: PreparedMediaInsertion = {
    parsed: {
      fileName: asset.name,
      sourceMode: 'proxy',
      mediaKind: 'image',
      scrubBlobUrl: blobUrl,
      sourceDuration,
      sourceWidth: asset.width,
      sourceHeight: asset.height,
    },
    mediaKind: 'image',
    scrubBlobUrl: blobUrl,
    audioBlobUrl: null,
    sourceDuration,
  }
  const inserted = insertPreparedMedia(channel, prepared, start, {
    sourceIn: 0,
    sourceOut: duration,
    includeAudio: false,
  })?.primary
  if (!inserted) throw new Error('The generated image could not be added to the timeline')
  applyImageTreatment(inserted, job, duration)
  editor.selectClip(inserted.id)
  return inserted
}

export async function prepareAIImageJob(job: AIImageJob, signal?: AbortSignal): Promise<PreparedAIImageJob> {
  if (!job.prompt.trim()) throw new Error('Describe the image you want to create')
  assertEditableSource(job.sourceName)

  const background = job.background ?? (job.placement === 'overlay' ? 'transparent' : 'auto')
  const model = job.model ?? 'openai/gpt-image-2.6-sunburst'
  const asset = await requestAIImage({
    prompt: generatedPrompt(job, background),
    ...(job.sourceName ? { sourceName: job.sourceName } : {}),
    model,
    aspect: job.aspect ?? projectAspect(),
    background,
  }, signal)
  const blob = await downloadFile(asset.name)
  const blobUrl = URL.createObjectURL(blob)
  const sourceDuration = Math.max(10, job.duration ?? DEFAULT_IMAGE_DURATION)
  return { asset, blobUrl, sourceDuration, job }
}

export async function executeAIImageJob(job: AIImageJob, signal?: AbortSignal): Promise<AIImageExecution> {
  const prepared = await prepareAIImageJob(job, signal)
  if (!job.placement || job.placement === 'media-bin') {
    registerPreparedAIImageJob(prepared)
    return { asset: prepared.asset }
  }
  const inserted = editor.withHistoryTransaction(() => applyPreparedAIImageJob(prepared))
  registerPreparedAIImageJob(prepared)
  const clip = inserted ? editor.getClipById(inserted.id)?.clip : undefined
  return { asset: prepared.asset, clip }
}
