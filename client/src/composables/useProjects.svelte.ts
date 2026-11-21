import { onMount, untrack } from 'svelte'
import { projectOwner, projectRequest, activateProject, projectConflict, ProjectRequestError, loadProjectTextAsset, loadPreparedComposition, saveProjectTextAsset, type ProjectSummary, type SavedProject } from '../lib/project-api'
import { captureProjectState, restoreProjectState } from '../lib/project-state'
import { clearMediaBinSources, subscribeMediaBinSources, subscribeMediaBinRemovals } from '../lib/media-bin'
import { setLocalMediaScope, flushLocalSources } from '../lib/local-media'
import { selectProjectSession } from '../lib/session'
import { isPreparedProjectPristine, preparedCompositionJSON, preparedProjectState, projectStateForOpen, projectStateFingerprint, type PreparedComposition, type ProjectPresentation } from '../lib/project-presentation'
import { prepareSessionText, sessionTextAssets } from '../lib/project-text-assets'
import { editor } from '../stores/editor.svelte'
import type { ProjectState } from '../lib/project-state'

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'pending' } | { kind: 'saving' } | { kind: 'error' | 'conflict'; message: string }

export function useProjects() {
  let items = $state<ProjectSummary[]>([])
  let current = $state<ProjectSummary | null>(null)
  let presentation = $state<ProjectPresentation | undefined>()
  let presentationWarning = $state('')
  let phase = $state<Phase>({ kind: 'loading' })
  let loaded = $state(false)
  let mediaRevision = $state(0)
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> = Promise.resolve()
  let stopSession = () => {}
  let lastSaved = ''
  let preparedCompositionId: string | undefined
  let preparedStateFingerprint: string | undefined
  let owner = ''
  let retryAction: (() => Promise<void>) | null = null
  const accountId = $derived(projectOwner())
  const conflicted = $derived(phase.kind === 'conflict')
  const uploadedText = new Set<string>()

  function preferenceKey(): string { return `direction-active-project:${owner}` }

  function remember(id: string): void { localStorage.setItem(preferenceKey(), id) }

  function captureState() { return { ...captureProjectState(), ...(preparedCompositionId ? { preparedCompositionId, preparedStateFingerprint } : {}) } }

  function report(cause: unknown, retry?: () => Promise<void>): void {
    const conflict = cause instanceof ProjectRequestError && cause.status === 409
    phase = { kind: conflict ? 'conflict' : 'error', message: cause instanceof Error ? cause.message : String(cause) }
    retryAction = conflict ? null : retry ?? null
  }

  async function restoreText(state: ProjectState | null, projectId: string): Promise<ProjectState | null> {
    if (!state?.timeline?.documentSession) return state
    const session = await prepareSessionText(state.timeline.documentSession, async reference => {
      const value = await loadProjectTextAsset(projectId, reference)
      uploadedText.add(`${projectId}:${reference.id}`)
      return value
    })
    return { ...state, timeline: { ...state.timeline, documentSession: session } }
  }

  async function initialize(nextOwner: string): Promise<void> {
    if (owner && owner !== nextOwner) { window.location.reload(); return }
    const token = ++generation
    clearTimeout(timer)
    stopSession()
    current = null
    presentation = undefined
    presentationWarning = ''
    preparedCompositionId = undefined
    preparedStateFingerprint = undefined
    items = []
    loaded = false
    phase = { kind: 'loading' }
    owner = nextOwner
    uploadedText.clear()
    if (!owner) { selectProjectSession(''); loaded = true; phase = { kind: 'ready' }; return }
    try {
      const summaries = await projectRequest<ProjectSummary[]>()
      if (token !== generation) return
      items = summaries
      const id = localStorage.getItem(preferenceKey())
      const selected = summaries.find(item => item.id === id) ?? summaries[0]
      if (!selected) throw new Error('No project is available. Please retry.')
      const project = await projectRequest<SavedProject>(`/${selected.id}`)
      if (token !== generation) return
      stopSession = activateProject(project)
      const scope = `${owner}:${project.id}`
      setLocalMediaScope(scope)
      presentation = project.presentation
      presentationWarning = project.presentationWarning ?? ''
      if (!project.state && presentationWarning) throw new Error(presentationWarning)
      const initialState = projectStateForOpen(project.state, presentation)
      const recovered = initialState !== project.state
      const state = await restoreText(initialState, project.id)
      if (token !== generation) return
      const pristine = initialState && isPreparedProjectPristine(initialState)
      preparedCompositionId = state?.preparedCompositionId
      if (state) clearMediaBinSources()
      if (state) await restoreProjectState(state, scope)
      if (token !== generation) return
      current = project
      remember(project.id)
      preparedStateFingerprint = recovered || pristine ? projectStateFingerprint(captureProjectState()) : state?.preparedStateFingerprint
      const compacted = state?.media.some(source => source.scene !== undefined)
      const normalized = compacted || pristine && preparedStateFingerprint !== state?.preparedStateFingerprint
      lastSaved = project.state && !recovered && !normalized ? JSON.stringify(captureState()) : ''
      loaded = true
      phase = { kind: 'ready' }
      if (!project.state || recovered || normalized) await save()
    } catch (cause) { if (token === generation) report(cause, () => initialize(nextOwner)) }
  }

  function save(): Promise<void> {
    clearTimeout(timer)
    if (conflicted) return Promise.reject(projectConflict())
    const selected = current
    if (!selected || !loaded) return Promise.resolve()
    const token = generation
    const state = captureState()
    const source = JSON.stringify(state)
    const textAssets = sessionTextAssets(editor.documentSession)
    pending = pending.catch(() => {}).then(async () => {
      if (token !== generation || selected.id !== current?.id) return
      if (conflicted) throw projectConflict()
      if (source === lastSaved && current.version > 1) {
        if (phase.kind === 'pending') phase = { kind: 'ready' }
        return
      }
      phase = { kind: 'saving' }
      try {
        await flushLocalSources()
        for (const asset of textAssets) {
          const key = `${selected.id}:${asset.reference.id}`
          if (uploadedText.has(key)) continue
          await saveProjectTextAsset(selected.id, asset)
          if (token !== generation) return
          uploadedText.add(key)
        }
        if (token !== generation) return
        if (conflicted) throw projectConflict()
        const summary = await projectRequest<ProjectSummary>(`/${selected.id}`, { name: current.name, version: current.version, state })
        if (token !== generation) return
        current = summary
        items = items.map(item => item.id === summary.id ? summary : item)
        lastSaved = source
        phase = { kind: 'ready' }
        retryAction = null
      } catch (cause) { if (token === generation) report(cause, save); throw cause }
    })
    return pending
  }

  async function select(id: string): Promise<void> {
    if (id === current?.id) return
    try {
      await save()
      remember(id)
      window.location.reload()
    } catch (cause) { report(cause, () => select(id)); throw cause }
  }

  async function create(name: string): Promise<void> {
    try {
      await save()
      const project = await projectRequest<SavedProject>('', { name: name.trim() })
      remember(project.id)
      window.location.reload()
    } catch (cause) { report(cause, () => create(name)); throw cause }
  }

  async function rename(name: string): Promise<void> {
    try {
      await save()
      if (!current) return
      const summary = await projectRequest<ProjectSummary>(`/${current.id}`, { name: name.trim(), version: current.version })
      current = summary
      items = items.map(item => item.id === summary.id ? summary : item)
      phase = { kind: 'ready' }
      retryAction = null
    } catch (cause) { report(cause, () => rename(name)); throw cause }
  }

  async function openPrepared(prepared: PreparedComposition): Promise<void> {
    let state = preparedProjectState(prepared, captureProjectState().media)
    if (!state) throw new Error('This export has no retained editable timeline.')
    try {
      await save()
      if (!current || !loaded) return
      loaded = false
      phase = { kind: 'loading' }
      clearTimeout(timer)
      state = await restoreText(state, current.id)
      if (!state) throw new Error('The prepared timeline could not be restored.')
      await restoreProjectState(state, `${owner}:${current.id}`)
      preparedCompositionId = state.preparedCompositionId
      preparedStateFingerprint = projectStateFingerprint(captureProjectState())
      loaded = true
      phase = { kind: 'ready' }
      await save()
    } catch (cause) {
      loaded = true
      report(cause, () => openPrepared(prepared))
      throw cause
    }
  }

  function downloadDraft(): void {
    const state = { ...captureProjectState(true), preparedCompositionId, preparedStateFingerprint }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...current, state })], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'unsaved-project-draft.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function exportPrepared(prepared: PreparedComposition): Promise<string> {
    if (!current) throw new Error('No project is open.')
    return preparedCompositionJSON(await loadPreparedComposition(current.id, prepared))
  }

  $effect(() => {
    const nextOwner = accountId
    untrack(() => { void initialize(nextOwner) })
  })

  $effect(() => {
    if (!loaded || !current || conflicted) return
    mediaRevision
    const source = JSON.stringify(captureState())
    if (source === lastSaved) {
      untrack(() => { if (phase.kind === 'pending') phase = { kind: 'ready' } })
      return
    }
    untrack(() => { if (phase.kind === 'ready') phase = { kind: 'pending' } })
    clearTimeout(timer)
    timer = setTimeout(() => { void save().catch(() => {}) }, 600)
    return () => clearTimeout(timer)
  })

  onMount(() => {
    const changed = () => { mediaRevision++ }
    const unsubscribe = subscribeMediaBinSources(changed)
    const unsubscribeRemoval = subscribeMediaBinRemovals(changed)
    const flush = () => { if (document.hidden) void save().catch(() => {}) }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current && JSON.stringify(captureState()) !== lastSaved) { event.preventDefault(); void save().catch(() => {}) }
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', beforeUnload)
    return () => { generation++; unsubscribe(); unsubscribeRemoval(); clearTimeout(timer); stopSession(); document.removeEventListener('visibilitychange', flush); window.removeEventListener('beforeunload', beforeUnload) }
  })

  return {
    save,
    select,
    create,
    rename,
    openPrepared,
    exportPrepared,
    downloadDraft,
    retry: () => { if (!conflicted) void (retryAction ? retryAction() : loaded ? save() : initialize(projectOwner())).catch(() => {}) },
    reload: () => window.location.reload(),
    get items() { return items },
    get current() { return current },
    get presentation() { return presentation },
    get presentationWarning() { return presentationWarning },
    get phase() { return phase },
    get ready() { return loaded },
  }
}
