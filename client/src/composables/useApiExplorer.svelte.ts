import { onMount, onDestroy } from 'svelte'
import { auth } from '../stores/auth.svelte'
import { API_BASE, friendlyErrorMessage } from '../lib/api'
import { adoptOwnedSession, peekProjectSessionId, startProjectSession } from '../lib/session'
import { prepareCompositionText } from '../lib/composition-text'
import { downloadProjectSource } from '../lib/compositions'
import { API_STARTERS, buildExplorerInput, checkExplorerRecipe, createExplorerRender, explorerMetadata, explorerRequestYaml, fetchExplorerVideo, getExplorerRender, uploadExplorerFile, waitForRenderPoll, type ApiRenderJob } from '../lib/api-explorer'
import type { CompilationResult, CompositionAsset } from '../lib/composition-types'
import { savedJob } from '../lib/job-response'

type ExplorerPhase =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'checking'; action: 'validate' | 'compile' | 'generate' }
  | { kind: 'checked'; action: 'validate' | 'compile' | 'generate'; result: CompilationResult }
  | { kind: 'rendering'; job?: ApiRenderJob }
  | { kind: 'completed'; job: ApiRenderJob; url: string }
  | { kind: 'error'; message: string; result?: CompilationResult }

export function useApiExplorer() {
  let source = $state(API_STARTERS.video)
  let assets = $state<CompositionAsset[]>([])
  let bindings = $state<Record<string, string[]>>({})
  let phase = $state<ExplorerPhase>({ kind: 'idle' })
  let sessionId = $state('')
  let controller: AbortController | undefined
  let stopHeartbeat: (() => void) | undefined
  let downloadUrl: string | undefined
  let assetSequence = 0
  const metadata = $derived(explorerMetadata(source))
  const slots = $derived(metadata.slots)
  const pendingGeneration = $derived(metadata.hasGeneration)
  const busy = $derived(['uploading', 'checking', 'rendering'].includes(phase.kind))

  function releaseResult() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    downloadUrl = undefined
  }

  function startRequest() {
    controller?.abort()
    releaseResult()
    controller = new AbortController()
    return controller.signal
  }

  function fail(cause: unknown, signal?: AbortSignal) {
    if (signal?.aborted) return
    phase = { kind: 'error', message: friendlyErrorMessage(cause, 'render') }
  }

  function setSource(value: string) {
    if (busy) return
    releaseResult()
    source = value
    phase = { kind: 'idle' }
  }

  function bindAsset(id: string, slot: string) {
    if (busy) return
    const next = Object.fromEntries(Object.entries(bindings).map(([key, ids]) => [key, ids.filter(value => value !== id)]))
    if (slot) next[slot] = [...(next[slot] ?? []), id]
    bindings = next
    phase = { kind: 'idle' }
  }

  function removeAsset(id: string) {
    if (busy) return
    assets = assets.filter(asset => asset.id !== id)
    bindAsset(id, '')
    releaseResult()
  }

  async function upload(files: File[]) {
    if (busy || !files.length) return
    const signal = startRequest()
    try {
      const input = buildExplorerInput(source, assets, bindings)
      if (files.length + input.assets.length > 100) throw new Error('Use up to 100 media files in one request.')
      const ids = new Set(input.assets.map(asset => asset.id))
      bindings = { ...input.bindings }
      for (const file of files) {
        phase = { kind: 'uploading', filename: file.name }
        while (ids.has(`media-${assetSequence + 1}`)) assetSequence++
        const asset = await uploadExplorerFile(file, `media-${++assetSequence}`, signal)
        signal.throwIfAborted()
        ids.add(asset.id)
        assets = [...assets, asset]
        const slot = slots.find(slot => slot.kind === asset.kind)
        if (slot) bindings = { ...bindings, [slot.id]: [...(bindings[slot.id] ?? []), asset.id] }
      }
      phase = { kind: 'idle' }
    } catch (cause) { fail(cause, signal) }
  }

  async function importYaml(file: File) {
    if (busy) return
    try {
      const value = await file.text()
      buildExplorerInput(value, assets, bindings)
      setSource(value)
      bindings = {}
    } catch (cause) { fail(cause) }
  }

  async function check(action: 'validate' | 'compile' | 'generate') {
    if (busy) return
    const signal = startRequest()
    phase = { kind: 'checking', action }
    try {
      const result = await checkExplorerRecipe(buildExplorerInput(source, assets, bindings), action, signal)
      signal.throwIfAborted()
      phase = { kind: 'checked', action, result }
    } catch (cause) { fail(cause, signal) }
  }

  function loadStarter(kind: 'video' | 'image') {
    if (busy) return
    setSource(API_STARTERS[kind])
    bindings = { shots: assets.filter(asset => asset.kind === kind).map(asset => asset.id) }
  }

  async function poll(job: ApiRenderJob, signal: AbortSignal) {
    const session = peekProjectSessionId()
    for (;;) {
      const current = await getExplorerRender(job.id, signal)
      signal.throwIfAborted()
      if (session !== peekProjectSessionId()) throw new DOMException('The active project changed.', 'AbortError')
      phase = { kind: 'rendering', job: current }
      if (current.status === 'failed' || current.status === 'cancelled') throw new Error(current.message || 'The render did not complete. Review the recipe and try again.')
      if (current.status === 'completed' && current.filename) {
        const blob = await fetchExplorerVideo(current.filename, signal)
        signal.throwIfAborted()
        downloadUrl = URL.createObjectURL(blob)
        phase = { kind: 'completed', job: current, url: downloadUrl }
        return
      }
      await waitForRenderPoll(signal)
    }
  }

  async function renderVideo() {
    if (busy) return
    const signal = startRequest()
    phase = { kind: 'rendering' }
    try {
      const input = buildExplorerInput(source, assets, bindings)
      const result = await checkExplorerRecipe(input, pendingGeneration ? 'generate' : 'compile', signal)
      signal.throwIfAborted()
      if (!result.composition || !result.document || result.diagnostics.some(item => item.severity === 'error') || result.requirements.length) {
        phase = { kind: 'error', message: 'The composition needs attention before rendering.', result }
        return
      }
      const preparedText = result.composition.output.format === 'mp3' ? undefined : await prepareCompositionText(result.composition)
      signal.throwIfAborted()
      const job = await createExplorerRender({ document: result.document, assets: result.composition.assets, bindings: input.bindings, preparedText }, signal)
      savedJob('api-render', job.id)
      signal.throwIfAborted()
      phase = { kind: 'rendering', job }
      await poll(job, signal)
    } catch (cause) { fail(cause, signal) }
  }

  function exportYaml() {
    try { downloadProjectSource(explorerRequestYaml(buildExplorerInput(source, assets, bindings))) }
    catch (cause) { fail(cause) }
  }

  onMount(() => {
    if (!peekProjectSessionId() && auth.user) adoptOwnedSession(auth.user.id)
    stopHeartbeat = startProjectSession(API_BASE)
    sessionId = peekProjectSessionId()
    const id = savedJob('api-render')
    if (id) {
      const signal = startRequest()
      phase = { kind: 'rendering' }
      void poll({ id, status: 'queued', progress: 0 }, signal).catch(cause => fail(cause, signal))
    }
  })

  onDestroy(() => { controller?.abort(); stopHeartbeat?.(); releaseResult() })

  return {
    upload,
    importYaml,
    check,
    renderVideo,
    setSource,
    bindAsset,
    removeAsset,
    exportYaml,
    loadStarter,
    get source() { return source },
    get assets() { return assets },
    get bindings() { return bindings },
    get slots() { return slots },
    get phase() { return phase },
    get busy() { return busy },
    get pendingGeneration() { return pendingGeneration },
    get sessionId() { return sessionId },
  }
}

export type ApiExplorer = ReturnType<typeof useApiExplorer>
