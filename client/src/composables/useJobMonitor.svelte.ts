import { onDestroy, onMount } from 'svelte'
import { API_BASE, authHeader } from '../lib/api'
import type { ProjectSummary } from '../lib/project-api'
import { peekProjectSessionId } from '../lib/session'
import { activeJob, downloadableJob, jobsForCategory, safeDownloadURL, sortJobs, type JobSummary, type JobCategory } from '../lib/job-monitor'

type Phase = { kind: 'loading' } | { kind: 'error'; message: string }
  | { kind: 'ready'; jobs: JobSummary[]; updatedAt: Date; warning?: string }

type Action = { kind: 'idle' } | { kind: 'confirm-cancel'; id: string } | { kind: 'cancelling'; id: string }
  | { kind: 'downloading'; id: string } | { kind: 'download'; id: string; url: string; expiresAt: string }
  | { kind: 'expired'; id: string }
  | { kind: 'error'; id: string; message: string }

export function useJobMonitor() {
  let phase = $state<Phase>({ kind: 'loading' })
  let action = $state<Action>({ kind: 'idle' })
  let projects = $state<ProjectSummary[]>([])
  let projectId = $state('')
  let notifications = $state<'off' | 'enabled' | 'denied' | 'unsupported'>('off')
  let refreshing = $state(false)
  let category = $state<JobCategory>('renders')
  const visibleJobs = $derived(phase.kind === 'ready' ? jobsForCategory(phase.jobs, category) : [])
  let controller: AbortController | undefined
  let actionController: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const selected = $derived(projects.find(project => project.id === projectId))
  const busy = $derived(action.kind === 'cancelling' || action.kind === 'downloading')

  function checkDownloadExpiry() {
    clearTimeout(expiryTimer)
    if (action.kind !== 'download') return
    const remaining = Date.parse(action.expiresAt) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) {
      action = { kind: 'expired', id: action.id }
      return
    }
    expiryTimer = setTimeout(checkDownloadExpiry, Math.min(remaining, 2_147_483_647))
  }

  function setAction(next: Action) {
    clearTimeout(expiryTimer)
    action = next
    checkDownloadExpiry()
  }

  async function request<T>(path: string, signal: AbortSignal, method = 'GET', sessionId?: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, { method, signal,
      headers: { ...authHeader(), ...(sessionId ? { 'X-Session-Id': sessionId } : {}) },
    })
    if (!response.ok) throw new Error(response.status === 401 ? 'Your login expired. Sign in again.'
      : response.status === 503 ? 'Cloud downloads or the job queue are unavailable. Retry shortly.'
        : 'Could not complete this request. Retry shortly; do not resubmit the original job.')
    return response.status === 204 ? undefined as T : response.json() as Promise<T>
  }

  function schedule() {
    clearTimeout(timer)
    if (disposed || (document.hidden && notifications !== 'enabled')) return
    const delay = document.hidden ? 30_000 : phase.kind === 'ready' && phase.jobs.some(activeJob) ? 5_000 : 15_000
    timer = setTimeout(() => { void refresh() }, delay)
  }

  function notifyFinished(previous: JobSummary[], jobs: JobSummary[]) {
    if (notifications !== 'enabled') return
    const running = new Set(previous.filter(activeJob).map(job => job.id))
    for (const job of jobs) {
      if (running.has(job.id) && downloadableJob(job)) {
        try { new Notification('Your video is ready', { body: 'Open Jobs & downloads to get your private download link.', tag: `machinal-${job.id}` }) }
        catch { notifications = 'unsupported' }
      }
    }
  }

  async function refresh() {
    if (!selected || disposed) return
    const project = selected
    controller?.abort()
    const current = new AbortController()
    controller = current
    refreshing = true
    try {
      const jobs = await request<JobSummary[]>('/jobs?view=summary', current.signal, 'GET', project.sessionId)
      if (!Array.isArray(jobs)) throw new Error('Invalid job response. Retry shortly.')
      if (current.signal.aborted) return
      notifyFinished(phase.kind === 'ready' ? phase.jobs : [], jobs)
      phase = { kind: 'ready', jobs: sortJobs(jobs), updatedAt: new Date() }
    } catch (error) {
      if (current.signal.aborted) return
      const message = error instanceof Error ? error.message : 'Could not refresh jobs.'
      phase = phase.kind === 'ready' ? { ...phase, warning: message } : { kind: 'error', message }
    } finally {
      if (!current.signal.aborted) { refreshing = false; schedule() }
    }
  }

  async function selectProject(id: string) {
    if (disposed) return
    controller?.abort()
    actionController?.abort()
    clearTimeout(timer)
    projectId = id
    setAction({ kind: 'idle' })
    phase = { kind: 'loading' }
    refreshing = true
    const project = selected
    if (!project) { refreshing = false; return }
    const current = new AbortController()
    controller = current
    try {
      await request(`/projects/${encodeURIComponent(project.id)}`, current.signal)
      if (!current.signal.aborted) await refresh()
    } catch (error) {
      if (!current.signal.aborted) { refreshing = false; phase = { kind: 'error', message: error instanceof Error ? error.message : 'Could not open this project.' } }
    }
  }

  async function initialize() {
    const current = new AbortController()
    controller = current
    try {
      projects = await request<ProjectSummary[]>('/projects', current.signal)
      if (current.signal.aborted) return
      const initial = projects.find(project => project.sessionId === peekProjectSessionId()) ?? projects[0]
      if (initial) await selectProject(initial.id)
      else phase = { kind: 'ready', jobs: [], updatedAt: new Date() }
    } catch (error) {
      if (!current.signal.aborted) phase = { kind: 'error', message: error instanceof Error ? error.message : 'Could not load projects.' }
    }
  }

  async function download(job: JobSummary) {
    if (!selected || busy || !downloadableJob(job)) return
    actionController?.abort()
    const current = new AbortController()
    actionController = current
    setAction({ kind: 'downloading', id: job.id })
    try {
      const result = await request<{ url: string; expiresAt: string }>(`/jobs/${encodeURIComponent(job.id)}/download`, current.signal, 'GET', selected.sessionId)
      if (!current.signal.aborted) setAction({ kind: 'download', id: job.id, url: safeDownloadURL(result.url), expiresAt: result.expiresAt })
    } catch (error) {
      if (!current.signal.aborted) setAction({ kind: 'error', id: job.id, message: error instanceof Error ? error.message : 'Could not prepare this download.' })
    }
  }

  async function cancelJob() {
    if (!selected || action.kind !== 'confirm-cancel') return
    const id = action.id
    actionController?.abort()
    const current = new AbortController()
    actionController = current
    setAction({ kind: 'cancelling', id })
    try {
      await request(`/jobs/${encodeURIComponent(id)}`, current.signal, 'DELETE', selected.sessionId)
      if (current.signal.aborted) return
      setAction({ kind: 'idle' })
      await refresh()
    } catch (error) {
      if (!current.signal.aborted) setAction({ kind: 'error', id, message: error instanceof Error ? error.message : 'Could not request cancellation.' })
    }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) { notifications = 'unsupported'; return }
    try { notifications = await Notification.requestPermission() === 'granted' ? 'enabled' : 'denied' }
    catch { notifications = 'unsupported' }
    schedule()
  }

  const visibilityChanged = () => {
    checkDownloadExpiry()
    if (!document.hidden) void refresh()
    else schedule()
  }

  onMount(() => {
    if (!('Notification' in window)) notifications = 'unsupported'
    void initialize()
    document.addEventListener('visibilitychange', visibilityChanged)
  })

  onDestroy(() => {
    disposed = true
    clearTimeout(timer)
    clearTimeout(expiryTimer)
    controller?.abort()
    actionController?.abort()
    document.removeEventListener('visibilitychange', visibilityChanged)
  })

  return {
    refresh: () => selected ? refresh() : initialize(),
    selectProject,
    download,
    cancelJob,
    enableNotifications,
    selectCategory: (value: JobCategory) => { category = value },
    confirmCancel: (id: string) => { if (!busy) setAction({ kind: 'confirm-cancel', id }) },
    dismiss: () => { if (!busy) setAction({ kind: 'idle' }) },
    get phase() { return phase },
    get action() { return action },
    get projects() { return projects },
    get projectId() { return projectId },
    get refreshing() { return refreshing },
    get busy() { return busy },
    get notifications() { return notifications },
    get category() { return category },
    get visibleJobs() { return visibleJobs },
  }
}

export type JobMonitor = ReturnType<typeof useJobMonitor>
