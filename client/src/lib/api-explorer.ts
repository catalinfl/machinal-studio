import { parseDocument } from 'yaml'
import { API_BASE, authHeader, friendlyHttpError } from './api'
import { sessionHeader } from './session'
import { forgetPendingJob, jobFetch, resolveJobResponse } from './job-response'
import { parseProjectFile, projectFile } from './composition-file'
import { hasPendingGeneration } from './composition-jobs'
import type { CompilationResult, CompositionAsset, CompositionInput, EditDocument } from './composition-types'

export type ApiRenderJob = { id: string; status: 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: number; message?: string; filename?: string }

export const API_STARTERS = {
  video: `version: 1
mode: assemble
inputs:
  shots: {kind: video, multiple: true}
sequence:
  use: shots
  each:
    take: {from: 0, duration: 4}
    source_audio: keep
  between: {preset: cross-dissolve, duration: 0.6}
output:
  aspect: landscape
  resolution: 1080p
  fps: 30
  format: mp4`,
  image: `version: 1
mode: assemble
inputs:
  shots: {kind: image, multiple: true}
sequence:
  use: shots
  each:
    take: {from: 0, duration: 4}
    look: warm-memory
  between: {preset: cross-dissolve, duration: 0.6}
output: {aspect: landscape, resolution: 1080p, fps: 30, format: mp4}`,
}

export function explorerDocument(source: string): EditDocument {
  const input = parseProjectFile(source)
  return typeof input.document === 'string' ? parseDocument(input.document).toJS() as EditDocument : input.document
}

export function explorerMetadata(source: string): { slots: Array<{ id: string; kind: CompositionAsset['kind'] }>; hasGeneration: boolean } {
  try {
    const document = explorerDocument(source)
    return { slots: Object.entries(document.inputs ?? {}).map(([id, value]) => ({ id, kind: value.kind })), hasGeneration: hasPendingGeneration(document) }
  } catch {
    return { slots: [], hasGeneration: false }
  }
}

export function buildExplorerInput(source: string, assets: CompositionAsset[], bindings: Record<string, string[]>): CompositionInput {
  const project = parseProjectFile(source, assets)
  if (!Array.isArray(project.assets)) throw new Error('The assets field must be a YAML list.')
  const value = parseDocument(source).toJS() as Record<string, unknown>
  const mergedAssets = new Map(project.assets.map(asset => [asset.id, asset]))
  for (const asset of assets) mergedAssets.set(asset.id, asset)
  return { ...project, assets: [...mergedAssets.values()], bindings: { ...project.bindings, ...bindings }, ...(value.snapshot ? { snapshot: value.snapshot as CompositionInput['snapshot'] } : {}) }
}

export function explorerRequestYaml(input: CompositionInput): string {
  const source = parseDocument(projectFile(input))
  if (input.snapshot) source.set('snapshot', input.snapshot)
  return source.toString({ lineWidth: 0 })
}

async function apiRequest<T>(route: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await (route === '/renders' ? jobFetch : fetch)(`${API_BASE}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...authHeader(), ...sessionHeader(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(friendlyHttpError(response.status, detail, 'render'))
  }
  const result = await response.json()
  if (result.id && ['completed', 'failed', 'cancelled'].includes(result.status)) forgetPendingJob(result.id)
  return result as T
}

export async function uploadExplorerFile(file: File, id: string, signal: AbortSignal): Promise<CompositionAsset> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE}/upload`, { method: 'POST', headers: { ...authHeader(), ...sessionHeader() }, body: form, signal })
  if (!response.ok) throw new Error(friendlyHttpError(response.status, await response.text(), 'upload'))
  const assets = await apiRequest<CompositionAsset[]>('/compositions/assets', signal, { files: [{ id, file: file.name }] })
  if (!assets[0]) throw new Error('The service did not return metadata for this file.')
  return assets[0]
}

export async function checkExplorerRecipe(input: CompositionInput, action: 'validate' | 'compile' | 'generate', signal: AbortSignal): Promise<CompilationResult> {
  const route = action === 'generate' ? 'compile-and-generate' : action
  const headers = { 'Content-Type': 'application/json', ...authHeader(), ...sessionHeader() }
  const initial = await (action === 'generate' ? jobFetch : fetch)(`${API_BASE}/compositions/${route}`, {
    method: 'POST', headers, body: JSON.stringify(input), signal,
  })
  const response = await resolveJobResponse(initial, { base: API_BASE, headers, signal })
  if (!response.ok && ![400, 422].includes(response.status)) throw new Error(friendlyHttpError(response.status, await response.text(), 'render'))
  const result = await response.json() as CompilationResult
  return { ...result, diagnostics: result.diagnostics ?? [], requirements: result.requirements ?? [] }
}

export function createExplorerRender(input: CompositionInput, signal: AbortSignal): Promise<ApiRenderJob> {
  return apiRequest('/renders', signal, input)
}

export function getExplorerRender(id: string, signal: AbortSignal): Promise<ApiRenderJob> {
  return apiRequest(`/renders/${encodeURIComponent(id)}`, signal)
}

export async function fetchExplorerVideo(filename: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`${API_BASE}/download?file=${encodeURIComponent(filename)}`, { headers: { ...authHeader(), ...sessionHeader() }, signal })
  if (!response.ok) throw new Error(friendlyHttpError(response.status, await response.text(), 'render'))
  return response.blob()
}

export function waitForRenderPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Polling stopped', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 1000)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

export function apiCurlExample(action: 'upload' | 'compile' | 'render' | 'status', origin: string, mode: 'cloud' | 'docker' | 'cli' = 'cloud'): string {
  if (mode === 'cli') return action === 'compile' ? 'edit compile composition.edit.yaml --root /path/to/media' : 'edit render composition.edit.yaml --root /path/to/media --output result.mp4'
  if (mode === 'docker') origin = 'http://127.0.0.1:8080'
  const base = origin.replace(/\/$/, '').replace(/'/g, `'"'"'`)
  const route = action === 'upload' ? '/upload' : action === 'compile' ? '/compositions/compile' : action === 'render' ? '/renders' : '/renders/'
  const url = `'${base}/v1/projects/'"$PROJECT_ID"'${route}'${action === 'status' ? '"$JOB_ID"' : ''}`
  const lines = [
    `curl${action === 'compile' || action === 'render' ? ' -X POST' : ''} ${url}`,
    ...(mode === 'cloud' ? ['  -H "Authorization: Bearer $MACHINAL_API_KEY"'] : []),
  ]
  if (action === 'upload') lines.push("  -F 'file=@your-clip.mp4'")
  if (action === 'compile' || action === 'render') lines.push("  -H 'Content-Type: application/yaml'", "  --data-binary '@composition.edit.yaml'")
  return lines.join(' \\' + '\n')
}
