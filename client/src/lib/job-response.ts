import { pb } from './pocketbase'
import { peekProjectSessionId } from './session'

export interface BackgroundJob {
  id: string
  kind?: string
  status: 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message?: string
  result?: unknown
  statusCode?: number
  contentType?: string
  statusUrl?: string
}

type PendingSubmission = { key: string; id?: string }
const prefix = 'direction-pending-jobs:'

function storageKey(): string {
  return `${prefix}${pb.authStore.record?.id ?? ''}:${peekProjectSessionId()}`
}

function readPending(key: string): Record<string, PendingSubmission> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item === 'object' && typeof item.key === 'string'))
  } catch { return {} }
}

function writePending(key: string, value: Record<string, PendingSubmission>): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Jobs remain recoverable through GET /jobs. */ }
}

export async function jobFetch(url: string, init: RequestInit): Promise<Response> {
  const owner = pb.authStore.record?.id ?? ''
  const session = peekProjectSessionId()
  const headers: Record<string, string> = init.headers instanceof Headers || Array.isArray(init.headers)
    ? Object.fromEntries(new Headers(init.headers).entries()) : { ...init.headers }
  const key = storageKey()
  let fingerprint = ''
  if (crypto.subtle && typeof init.body === 'string') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${url}\n${init.body}\n${new Headers(headers).get('Accept') ?? ''}`))
    fingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  }
  let pending = readPending(key)
  const submission = pending[fingerprint] ?? { key: crypto.randomUUID() }
  headers['Idempotency-Key'] = submission.key
  if (fingerprint) {
    pending[fingerprint] = submission
    writePending(key, pending)
  }
  const response = await fetch(url, { ...init, headers })
  if (owner !== (pb.authStore.record?.id ?? '') || session !== peekProjectSessionId()) {
    throw new DOMException('The active account or project changed. Server work remains saved.', 'AbortError')
  }
  if (response.status === 202) {
    const job = await response.clone().json() as BackgroundJob
    if (fingerprint) {
      pending = readPending(key)
      pending[fingerprint] = { ...submission, id: job.id }
      writePending(key, pending)
    }
  } else if (fingerprint && response.status < 500 && response.status !== 408) {
    pending = readPending(key)
    delete pending[fingerprint]
    writePending(key, pending)
  }
  return response
}

export function forgetPendingJob(id: string): void {
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix))) {
      const pending = readPending(key)
      for (const [fingerprint, submission] of Object.entries(pending)) {
        if (submission.id === id) delete pending[fingerprint]
      }
      writePending(key, pending)
    }
  } catch { /* Storage can be disabled independently of the API. */ }
}

function wait(signal?: AbortSignal, delay = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Polling stopped', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, delay)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function resolveJobResponse(response: Response, options: {
  base: string
  headers: Record<string, string>
  signal?: AbortSignal
  onProgress?: (job: BackgroundJob) => void
  pollDelay?: number
}): Promise<Response> {
  if (response.status !== 202) return response
  const owner = pb.authStore.record?.id ?? ''
  const session = peekProjectSessionId()
  let job = await response.json() as BackgroundJob
  const origin = new URL(options.base || '/', location.origin)
  const status = new URL(job.statusUrl ?? `/jobs/${encodeURIComponent(job.id)}`, origin)
  if (status.origin !== origin.origin || !/^\/(?:v1\/projects\/[^/]+\/)?jobs\/[a-f0-9]{32}$/.test(status.pathname)) {
    throw new Error('The server returned an invalid job status address.')
  }
  let failures = 0
  for (;;) {
    options.signal?.throwIfAborted()
    if (owner !== (pb.authStore.record?.id ?? '') || session !== peekProjectSessionId()) {
      throw new DOMException('The active account or project changed. Server work remains saved.', 'AbortError')
    }
    options.onProgress?.(job)
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      forgetPendingJob(job.id)
      const contentType = job.contentType || 'application/json'
      const body = contentType.includes('application/json') ? JSON.stringify(job.result ?? { message: job.message }) : String(job.result ?? job.message ?? '')
      return new Response(body, { status: job.statusCode || (job.status === 'completed' ? 200 : 409), headers: { 'Content-Type': contentType } })
    }
    await wait(options.signal, options.pollDelay)
    try {
      response = await fetch(status.href, { headers: options.headers, signal: options.signal })
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) throw new Error('Job status is temporarily unavailable.')
        return response
      }
      job = await response.json() as BackgroundJob
      failures = 0
    } catch (cause) {
      options.signal?.throwIfAborted()
      if (++failures >= 5) throw new Error(`The connection to job ${job.id} was interrupted. Your job is still saved; retry to recover it.`, { cause })
    }
  }
}

export function savedJob(name: string, id?: string): string {
  const key = `${storageKey().replace(prefix, 'direction-saved-job:')}:${name}`
  try {
    if (id !== undefined) localStorage.setItem(key, id)
    return localStorage.getItem(key) ?? ''
  } catch { return '' }
}
