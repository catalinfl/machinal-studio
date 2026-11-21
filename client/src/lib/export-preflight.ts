import type { Channel, TextItem } from '../stores/editor.svelte'
import { getLocalSource } from './local-media'
import { getMediaBinSource } from './media-bin'
import { uploadFile } from './api'
import { peekProjectSessionId } from './session'
import type { DocumentProject } from './composition-types'

const uploadedSources = new WeakMap<File, Map<string, string>>()

export function offlineExportSources(channels: Channel[], format: string): string[] {
  return [...new Set(channels.filter(channel => !channel.hidden && !channel.muted && (format !== 'mp3' || channel.type === 'audio'))
    .flatMap(channel => channel.clips)
    .filter(clip => clip.sourceMode === 'wasm' && (!clip.sourceId || !getLocalSource(clip.sourceId)))
    .map(clip => clip.fileName))]
}

export function exportWarnings(channels: Channel[], texts: TextItem[], format: string): string[] {
  const active = channels.filter(channel => !channel.hidden && !channel.muted)
  const clips = active.flatMap(channel => channel.clips)
  const warnings: string[] = []
  const missing = offlineExportSources(channels, format)
  if (missing.length) warnings.push(`${missing.length} local source files are offline. Relink them before exporting.`)
  if (!active.some(channel => channel.type === 'audio' && channel.clips.length)) warnings.push('No active audio track: this export will be silent.')
  if (format !== 'mp3' && !clips.some(clip => clip.mediaKind !== 'audio') && !texts.length) warnings.push('No visible video, image or text to export.')
  return warnings
}

export async function uploadExportSources(project: DocumentProject, onProgress: (message: string) => void): Promise<DocumentProject> {
  const session = peekProjectSessionId()
  const tracks = project.document.tracks
  const used = new Set(tracks ? tracks.filter(track => !track.hidden && !track.muted && (project.document.output?.format !== 'mp3' || track.type === 'audio')).flatMap(track => track.clips.map(clip => clip.assetId)) : Object.values(project.bindings).flat())
  const pending = project.assets.filter(asset => asset.local && used.has(asset.id))
  const replacements = new Map<string, string>()
  for (const [index, asset] of pending.entries()) {
    const source = getMediaBinSource(asset.file)
    const sourceId = source?.sourceId ?? asset.id
    const file = getLocalSource(sourceId)
    if (!file) throw new Error(`Relink ${asset.file} before exporting.`)
    const key = `${session}:${sourceId}`
    const uploaded = uploadedSources.get(file) ?? new Map<string, string>()
    let name = uploaded.get(key)
    if (!name) {
      const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]
      if (!extension) throw new Error(`Unsupported source filename: ${file.name}`)
      name = `export_${crypto.randomUUID().replaceAll('-', '')}${extension.toLowerCase()}`
      const upload = new File([file], name, { type: file.type, lastModified: file.lastModified })
      await uploadFile(upload, progress => onProgress(`Uploading ${index + 1}/${pending.length}: ${file.name} · ${Math.round(progress.loaded / progress.total * 100)}%`))
      uploaded.set(key, name)
      uploadedSources.set(file, uploaded)
    }
    if (peekProjectSessionId() !== session) throw new Error('The project changed during upload. The export was not started.')
    replacements.set(asset.id, name)
  }
  return { ...project,
    assets: project.assets.map(asset => replacements.has(asset.id)
      ? { ...asset, file: replacements.get(asset.id)!, version: `unresolved:${asset.id}`, local: false } : asset),
  }
}
