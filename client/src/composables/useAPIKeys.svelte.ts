import { onDestroy, onMount } from 'svelte'
import { API_BASE, authHeader } from '../lib/api'

export type APIKeySummary = { id: string; name: string; prefix: string; created: string }
type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'creating' } | { kind: 'created'; key: string }
  | { kind: 'confirming'; id: string } | { kind: 'revoking'; id: string } | { kind: 'error'; message: string }

export function useAPIKeys() {
  let items = $state<APIKeySummary[]>([])
  let name = $state('')
  let phase = $state<Phase>({ kind: 'loading' })
  let controller: AbortController | undefined
  const busy = $derived(phase.kind === 'loading' || phase.kind === 'creating' || phase.kind === 'revoking')

  async function request<T>(method: string, path = '', body?: unknown): Promise<T> {
    controller?.abort()
    controller = new AbortController()
    const response = await fetch(`${API_BASE}/api-keys${path}`, {
      method, headers: { ...authHeader(), 'Content-Type': 'application/json' }, signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      if (response.status === 402) throw new Error('Premium is required to create and use API keys.')
      if (response.status === 409) throw new Error('You have 10 active keys. Revoke one before creating another.')
      if (response.status === 401) throw new Error('Your login expired. Sign in again to manage API keys.')
      throw new Error('API keys are unavailable. Retry, or ask the administrator to check the PocketBase setup.')
    }
    return response.status === 204 ? undefined as T : response.json()
  }

  function fail(error: unknown) {
    if (controller?.signal.aborted) return
    phase = { kind: 'error', message: error instanceof Error ? error.message : 'Could not manage API keys.' }
  }

  async function load() {
    phase = { kind: 'loading' }
    try { items = await request<APIKeySummary[]>('GET'); phase = { kind: 'ready' } }
    catch (error) { fail(error) }
  }

  async function create() {
    if (busy || !name.trim() || phase.kind === 'created') return
    phase = { kind: 'creating' }
    try {
      const result = await request<APIKeySummary & { key: string }>('POST', '', { name: name.trim() })
      const { key, ...summary } = result
      items = [summary, ...items]
      name = ''
      phase = { kind: 'created', key }
    } catch (error) { fail(error) }
  }

  async function revoke() {
    if (phase.kind !== 'confirming') return
    const id = phase.id
    phase = { kind: 'revoking', id }
    try { await request('DELETE', `/${encodeURIComponent(id)}`); items = items.filter(item => item.id !== id); phase = { kind: 'ready' } }
    catch (error) { fail(error) }
  }

  onMount(() => { void load() })
  onDestroy(() => controller?.abort())

  return {
    load,
    create,
    revoke,
    confirmRevoke: (id: string) => { if (!busy && phase.kind !== 'created') phase = { kind: 'confirming', id } },
    dismiss: () => { phase = { kind: 'ready' } },
    get items() { return items },
    get name() { return name },
    set name(value: string) { name = value },
    get phase() { return phase },
    get busy() { return busy },
  }
}
