import { onMount } from 'svelte'
import { API_BASE } from '../lib/api'
import type { BillingCatalog } from '../lib/credits'

type Phase = { kind: 'loading' } | { kind: 'ready'; catalog: BillingCatalog } | { kind: 'error' }

export function useBillingCatalog() {
  let phase = $state<Phase>({ kind: 'loading' })
  let controller: AbortController | undefined

  async function load() {
    controller?.abort()
    const request = new AbortController()
    controller = request
    phase = { kind: 'loading' }
    try {
      const response = await fetch(`${API_BASE}/billing/catalog`, { signal: request.signal })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Catalog unavailable')
      const catalog: BillingCatalog = await response.json()
      if (!request.signal.aborted) phase = { kind: 'ready', catalog }
    } catch {
      if (!request.signal.aborted) phase = { kind: 'error' }
    }
  }

  onMount(() => {
    void load()
    return () => controller?.abort()
  })

  return {
    load,
    get phase() { return phase },
  }
}
