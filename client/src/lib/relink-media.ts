import { editor } from '../stores/editor.svelte'
import { getMediaBinSource, registerMediaBinSource, type MediaBinSource } from './media-bin'
import { flushLocalSources, replaceLocalSource } from './local-media'
import { mediaKindForFileName } from './api'
import { readAudioMetadata, readImageMetadata, readVideoMetadata } from './video-metadata'

export function validateReplacement(source: MediaBinSource, metadata: { width?: number; height?: number; duration?: number }, requiredEnd: number): void {
  if (source.width && source.height && (source.width !== metadata.width || source.height !== metadata.height)) {
    throw new Error(`Choose the original ${source.width} × ${source.height} file. The replacement has different dimensions.`)
  }
  if (source.kind !== 'image' && (!Number.isFinite(metadata.duration) || metadata.duration! + 0.05 < requiredEnd)) {
    throw new Error('This file is too short for the saved edit. Choose the original file; clip timings have not been changed.')
  }
}

export async function relinkLocalMedia(name: string, file: File): Promise<void> {
  const source = getMediaBinSource(name)
  if (!source?.sourceId || source.sourceMode !== 'wasm') throw new Error('This local source is no longer available.')
  if (mediaKindForFileName(file.name) !== source.kind) throw new Error(`Choose a ${source.kind} file.`)
  const revision = editor.stateRevision
  const metadata = source.kind === 'image' ? await readImageMetadata(file)
    : source.kind === 'audio' ? await readAudioMetadata(file) : await readVideoMetadata(file)
  const clips = editor.channels.flatMap(channel => channel.clips).filter(clip => clip.sourceId === source.sourceId)
  const requiredEnd = clips.reduce((end, clip) => Math.max(end, clip.outPoint), 0)
  validateReplacement(source, metadata, requiredEnd)
  if (editor.stateRevision !== revision || getMediaBinSource(name)?.sourceId !== source.sourceId) throw new Error('The project changed. Select the file again.')
  replaceLocalSource(source.sourceId, file)
  await flushLocalSources()
  const preview = URL.createObjectURL(file)
  editor.relinkMediaSource(source.sourceId, preview)
  registerMediaBinSource({ ...source, missing: false, previewUrl: preview, scrubBlobUrl: preview })
}
