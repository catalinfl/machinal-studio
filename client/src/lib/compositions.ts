import { API_BASE, authHeader, friendlyHttpError, getScrubProxy, getAudioPreview } from './api'
import { withSession, sessionHeader, peekProjectSessionId } from './session'
import { forgetPendingJob, jobFetch, resolveJobResponse } from './job-response'
import { getMediaBinSources, isMediaBinSourceRemoved, registerMediaBinSource, waitForMediaBinLoads } from './media-bin'
import { editor } from '../stores/editor.svelte'
import { assertExactTimeline, cloneJSON, compositionTimeline, explicitDocument, revisionFingerprint, snapshotTimeline } from './composition-adapter'
import { projectFile, referencedProjectAssets, repairLegacyTimelineSource } from './composition-file'
import { parseDocument } from 'yaml'
import { normalizeDocumentTimeline } from './composition-timing'
import { prepareCompositionText } from './composition-text'
import { hasPendingGeneration } from './composition-jobs'
import { MAX_PROJECT_BYTES, type CompilationResult, type CompositionAsset, type CompositionInput, type DocumentProject, type EditDocument, type TimelineState } from './composition-types'
import { isLiveSceneFile, loadLiveScene } from './live-scene'

export class CompilationError extends Error {
  constructor(public result: CompilationResult) {
    super([...result.diagnostics.map((diagnostic) => `${diagnostic.path}${diagnostic.line ? ` (line ${diagnostic.line})` : ''}: ${diagnostic.message}`),
      ...result.requirements.map((requirement) => requirement.message)].join('\n') || 'Document compilation failed')
  }
}

async function postJSON<T>(route: string, input: unknown, signal?: AbortSignal): Promise<T> {
  const headers = { 'Content-Type': 'application/json', ...authHeader(), ...sessionHeader() }
  const queued = ['/renders', '/ai/compositions', '/compositions/compile-and-generate'].includes(route)
  const initial = await (queued ? jobFetch : fetch)(withSession(`${API_BASE}${route}`), {
    method: 'POST', headers, body: JSON.stringify(input), signal,
  })
  const response = route === '/renders' ? initial : await resolveJobResponse(initial, { base: API_BASE, headers, signal })
  if (!response.ok) {
    if (response.headers.get('content-type')?.includes('application/json')) {
      const result = await response.json() as CompilationResult
      if (Array.isArray(result.diagnostics)) throw new CompilationError(result)
    }
    throw new Error(friendlyHttpError(response.status, await response.text(), 'render'))
  }
  return response.json() as Promise<T>
}

export function currentTimeline(): TimelineState {
  return {
    channels: editor.channels, effectBlocks: editor.effectBlocks, transitions: editor.transitions, textItems: editor.textItems,
    fps: editor.fps, resolution: editor.resolution, aspect: editor.effectiveProjectAspect, fit: editor.videoFit,
  }
}

export function editorAssets(): CompositionAsset[] {
  const sources = getMediaBinSources()
  const availableFiles = new Set([...sources.map((source) => source.name.toLowerCase()),
    ...editor.channels.flatMap((channel) => channel.clips.map((clip) => clip.fileName.toLowerCase()))])
  const assets = editor.documentSession?.assets
    .filter((asset) => availableFiles.has(asset.file.toLowerCase()) && !isMediaBinSourceRemoved(asset.file))
    .map((asset) => ({ ...asset })) ?? []

  for (const source of sources) {
    if (assets.some((asset) => asset.id === source.id || asset.file === source.name)) continue
    assets.push({ id: source.id, file: source.name, version: source.sourceRevision?.startsWith('sha256:') ? source.sourceRevision : `unresolved:${source.sourceId ?? source.id}`,
      kind: source.kind, duration: source.duration, width: source.width, height: source.height,
      local: source.sourceMode === 'wasm', hasAudio: source.kind === 'audio' })
  }
  for (const channel of editor.channels) {
    for (const clip of channel.clips) {
      if (isMediaBinSourceRemoved(clip.fileName)) continue
      let asset = assets.find((asset) => asset.id === clip.sourceId || asset.file === clip.fileName)
      if (!asset) {
        asset = { id: clip.sourceId ?? clip.fileName, file: clip.fileName, version: `unresolved:${clip.sourceId ?? clip.fileName}`,
          kind: clip.mediaKind ?? channel.type, duration: clip.sourceDuration, local: clip.sourceMode === 'wasm' }
        assets.push(asset)
      }
      if (channel.type === 'audio' || clip.linkedClipId && !isLiveSceneFile(clip.fileName)) asset.hasAudio = true
    }
  }
  return assets
}

export function compositionRevision(): string {
  const snapshot = snapshotTimeline(currentTimeline(), editorAssets(), '')
  return `${editor.stateRevision}:${revisionFingerprint(JSON.stringify({ ...snapshot, output: { fps: editor.fps, resolution: editor.resolution, aspect: editor.effectiveProjectAspect, fit: editor.videoFit } }))}`
}

export function currentProject(): DocumentProject {
  if (editor.documentSession) {
    const project = cloneJSON({ document: editor.documentSession.document, assets: editorAssets(),
      bindings: editor.documentSession.bindings, preparedText: editor.documentSession.preparedText, recipe: editor.documentSession.recipe })
    return { ...project, document: normalizeDocumentTimeline(project.document, project.assets) }
  }
  const assets = editorAssets()
  const snapshot = snapshotTimeline(currentTimeline(), assets, '')
  return { document: explicitDocument(snapshot, { fps: editor.fps, resolution: editor.resolution, aspect: editor.effectiveProjectAspect, fit: editor.videoFit, format: 'mp4', quality: 'normal' }), assets, bindings: {} }
}

export async function compileDocument(input: CompositionInput, signal?: AbortSignal, mode: 'render' | 'draft' = 'render'): Promise<CompilationResult> {
  const doc = typeof input.document === 'string' ? parseDocument(input.document).toJS() as EditDocument : input.document
  const route = hasPendingGeneration(doc) ? '/compositions/compile-and-generate' : `/compositions/compile${mode === 'draft' ? '?draft=true' : ''}`
  const result = await postJSON<CompilationResult>(route, input, signal)
  if (!result.composition || !result.document) throw new CompilationError(result)
  return result
}

export async function planDocumentEdit(instruction: string, signal?: AbortSignal, fast = false) {
  const captured = await captureCompileInput({ ...currentProject(), preparedText: undefined })
  const result = await postJSON<CompilationResult & { mode: 'execute' | 'recommend'; recipe: EditDocument; bindings: CompositionInput['bindings'] }>(
    '/ai/compositions', { instruction, project: captured.input, playhead: editor.currentTime, fast }, signal)
  if (!result.document || result.diagnostics.some((item) => item.severity === 'error')
    || !result.composition && !result.requirements.length) throw new CompilationError(result)
  return { result, mode: result.mode, input: { ...captured.input, document: result.document, recipe: result.recipe, bindings: result.bindings }, revision: captured.revision, stateRevision: captured.stateRevision }
}

export async function executeDocumentEdit(edit: { result: CompilationResult; input: CompositionInput; revision: string; stateRevision: number }, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (compositionRevision() !== edit.revision) throw new Error('Timeline changed while planning. Submit the instruction again.')
  const result = edit.result.composition ? edit.result : await compileDocument(edit.input, signal, 'draft')
  await applyCompiledDocument(result, edit.input, edit.revision, edit.stateRevision, true, signal)
}

export async function captureCompileInput(project: DocumentProject | CompositionInput): Promise<{ input: CompositionInput; revision: string; stateRevision: number }> {
  await waitForMediaBinLoads()
  const revision = compositionRevision()
  const assets = editorAssets()
  const snapshot = snapshotTimeline(currentTimeline(), assets, revision)
  snapshot.selectedIds = [...editor.selectedClipIds, ...editor.selectedChannelIds, ...editor.selectedEffectBlockIds, ...editor.selectedTextItemIds]
  const input = cloneJSON(project)
  input.assets = input.assets.filter((asset) => !isMediaBinSourceRemoved(asset.file))
  if (typeof input.document === 'string') input.document = repairLegacyTimelineSource(input.document, input.assets)
  return { input: { ...input, snapshot }, revision, stateRevision: editor.stateRevision }
}

async function preparePreviews(result: CompilationResult): Promise<Map<string, string | null>> {
  const composition = result.composition!
  const previews = new Map<string, string | null>()
  const sources = getMediaBinSources()
  for (const track of composition.tracks) {
    for (const clip of track.clips ?? []) {
      const key = `${clip.assetId}/${track.type}`
      if (previews.has(key)) continue
      const asset = composition.assets.find((asset) => asset.id === clip.assetId)!
      if (track.type === 'video' && isLiveSceneFile(asset.file)) {
        await loadLiveScene(asset.file)
        previews.set(key, null)
        continue
      }
      const existing = editor.channels.find((channel) => channel.type === track.type)?.clips.find((clip) => clip.sourceId === asset.id || clip.fileName === asset.file)
      const source = sources.find((source) => source.id === asset.id || source.name === asset.file)
      let preview = existing?.scrubBlobUrl ?? source?.scrubBlobUrl ?? null
      if (!preview && asset.local) throw new Error(`Local media ${asset.file} must be loaded before applying this composition`)
      if (!preview && track.type === 'audio') preview = await getAudioPreview(asset.file)
      if (!preview && asset.kind === 'video') preview = (await getScrubProxy(asset.file, composition.output.aspect)).blobUrl
      if (!preview && asset.kind === 'image') preview = withSession(`${API_BASE}/download?file=${encodeURIComponent(asset.file)}`)
      if (!preview) throw new Error(`Preview for ${asset.file} is unavailable`)
      previews.set(key, preview)
    }
  }
  return previews
}

export async function applyCompiledDocument(result: CompilationResult, project: CompositionInput, revision: string, stateRevision: number, history = true, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (!result.document || !result.composition) throw new CompilationError(result)
  if (result.expectedRevision !== revision || compositionRevision() !== revision) throw new Error('Timeline changed while compiling. Recompile the document.')
  const previews = await preparePreviews(result)
  signal?.throwIfAborted()
  if (compositionRevision() !== revision) throw new Error('Timeline changed while preparing media. Recompile the document.')
  const timeline = compositionTimeline(result.composition, (asset, type) => previews.get(`${asset.id}/${type}`) ?? null)
  const expected = snapshotTimeline(timeline, result.composition.assets, '')
  editor.applyCompiledTimeline(timeline, {
    kind: 'ready', document: result.document, recipe: project.recipe, assets: result.composition.assets, bindings: project.bindings,
    preparedText: result.composition.preparedText,
    composition: result.composition,
  }, stateRevision, history, () => assertExactTimeline(expected, snapshotTimeline(currentTimeline(), result.composition!.assets, '')))
  for (const asset of result.composition.assets) {
    if (asset.local) continue
    registerMediaBinSource({ id: asset.id, name: asset.file, kind: asset.kind, duration: asset.duration,
      width: asset.width, height: asset.height, sourceMode: 'proxy', scrubBlobUrl: previews.get(`${asset.id}/${asset.kind === 'audio' ? 'audio' : 'video'}`) })
  }
}

export async function applyDocument(project: CompositionInput, signal?: AbortSignal): Promise<CompilationResult> {
  const captured = await captureCompileInput(project)
  const result = await compileDocument(captured.input, signal, 'draft')
  await applyCompiledDocument(result, captured.input, captured.revision, captured.stateRevision, true, signal)
  return result
}

export async function reconcileDocument(): Promise<void> {
  if (!editor.documentSession || editor.documentSession.kind === 'ready') return
  const captured = await captureCompileInput(currentProject())
  const result = await compileDocument(captured.input, undefined, 'draft')
  await applyCompiledDocument(result, captured.input, captured.revision, captured.stateRevision, false)
}

export function startDocumentSync(): () => void {
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const sync = () => {
    clearTimeout(timer)
    controller?.abort()
    if (!editor.documentSession || editor.documentSession.kind === 'ready') return
    timer = setTimeout(async () => {
      const currentController = new AbortController()
      controller = currentController
      let revision = editor.stateRevision
      try {
        const captured = await captureCompileInput(currentProject())
        revision = captured.stateRevision
        currentController.signal.throwIfAborted()
        const result = await compileDocument(captured.input, currentController.signal, 'draft')
        if (!currentController.signal.aborted) await applyCompiledDocument(result, captured.input, captured.revision, captured.stateRevision, false, currentController.signal)
      } catch (error) {
        if (!currentController.signal.aborted && editor.stateRevision === revision) editor.setDocumentError(error instanceof Error ? error.message : String(error))
      }
    }, 120)
  }

  const unsubscribe = editor.subscribeDocumentChanges(sync)
  sync()
  return () => { unsubscribe(); clearTimeout(timer); controller?.abort() }
}

export async function pinServerAssets(assets: CompositionAsset[], signal?: AbortSignal): Promise<CompositionAsset[]> {
  const pending = assets.filter((asset) => !asset.local && !asset.version.startsWith('sha256:'))
  const pinned = new Map<string, CompositionAsset>()
  for (let offset = 0; offset < pending.length; offset += 100) {
    const values = await postJSON<CompositionAsset[]>('/compositions/assets', { files: pending.slice(offset, offset + 100).map((asset) => ({ id: asset.id, file: asset.file })) }, signal)
    for (const value of values) pinned.set(value.id, value)
  }
  return assets.map((asset) => pinned.get(asset.id) ?? asset)
}

export function projectForRender(settings: { format: 'mp4' | 'avi' | 'mp3'; quality: 'low' | 'normal' | 'high' }): DocumentProject {
  const project = currentProject()
  project.document.output = { ...project.document.output, ...settings }
  return project
}

export async function renderDocument(project: DocumentProject, onProgress: (progress: { ratio: number; message: string }) => void): Promise<{ blob: Blob; filename: string }> {
  const captured = await captureCompileInput(project)
  const used = new Set([...Object.values(project.bindings).flat(), ...(project.document.tracks ?? []).flatMap((track) => track.clips.map((clip) => clip.assetId))])
  for (const job of project.document.jobs ?? []) {
    if (job.resultAssetId) used.add(job.resultAssetId)
    if (job.assetId) used.add(job.assetId)
  }
  captured.input.assets = await pinServerAssets(project.assets.filter((asset) => used.has(asset.id)))
  const result = await compileDocument(captured.input)
  await applyCompiledDocument(result, captured.input, captured.revision, captured.stateRevision, false)
  const preparedText = result.composition!.output.format === 'mp3' ? undefined : await prepareCompositionText(result.composition!)
  const request: DocumentProject = { document: result.document!, bindings: project.bindings, assets: captured.input.assets, preparedText }
  const job = await postJSON<{ id: string }>('/renders', request)
  const session = peekProjectSessionId()
  const headers = { ...authHeader(), ...sessionHeader() }
  for (;;) {
    const response = await fetch(`${API_BASE}/renders/${job.id}`, { headers })
    if (session !== peekProjectSessionId()) throw new DOMException('The active project changed.', 'AbortError')
    if (!response.ok) throw new Error(friendlyHttpError(response.status, await response.text(), 'render'))
    const state = await response.json() as { status: string; progress: number; message?: string; filename?: string }
    onProgress({ ratio: state.progress, message: state.message ?? state.status })
    if (['completed', 'failed', 'cancelled'].includes(state.status)) forgetPendingJob(job.id)
    if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.message ?? 'Render did not complete')
    if (state.status === 'completed' && state.filename) {
      const download = await fetch(`${API_BASE}/download?file=${encodeURIComponent(state.filename)}`, { headers })
      if (!download.ok) throw new Error(friendlyHttpError(download.status, await download.text(), 'render'))
      return { blob: await download.blob(), filename: state.filename }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
}

export function downloadDocument(signal?: AbortSignal): Promise<void> {
  return downloadCompositionInput(currentProject(), signal)
}

export async function prepareProjectFile(project: CompositionInput, signal?: AbortSignal): Promise<string> {
  const captured = await captureCompileInput(project)
  captured.input.assets = await pinServerAssets(referencedProjectAssets(captured.input), signal)
  const result = await compileDocument(captured.input, signal, 'draft')
  const preparedText = await prepareCompositionText(result.composition!)
  signal?.throwIfAborted()
  return projectFile({ document: result.document!, recipe: project.recipe, assets: result.composition!.assets, bindings: captured.input.bindings, preparedText })
}

export async function downloadCompositionInput(project: CompositionInput, signal?: AbortSignal): Promise<void> {
  downloadProjectSource(await prepareProjectFile(project, signal))
}

export function downloadProjectSource(source: string): void {
  const blob = new Blob([source], { type: 'application/yaml' })
  if (blob.size > MAX_PROJECT_BYTES) throw new Error('Project exceeds 128 MiB')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'composition.edit.yaml'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
