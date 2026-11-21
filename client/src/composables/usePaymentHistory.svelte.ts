import { onDestroy, onMount } from 'svelte'
import { API_BASE, authHeader } from '../lib/api'

export type PaymentRecord = {
  id: string; planName?: string; credits: number; membershipDays: number; usd: string
  createdAt: string; status: 'awaiting-payment' | 'completed' | 'refunded-or-reversed'; refundRequestedAt?: string
}

type Phase = { kind: 'loading' } | { kind: 'ready'; payments: PaymentRecord[] } | { kind: 'error' }
type Refund = { kind: 'idle' } | { kind: 'editing'; id: string; reason: string }
  | { kind: 'saving'; id: string; reason: string } | { kind: 'requested'; id: string }
  | { kind: 'error'; id: string; reason: string; message: string }

export function usePaymentHistory() {
  let phase = $state<Phase>({ kind: 'loading' })
  let refund = $state<Refund>({ kind: 'idle' })
  const controller = new AbortController()

  async function load() {
    phase = { kind: 'loading' }
    try {
      const response = await fetch(`${API_BASE}/billing/orders`, { headers: authHeader(), signal: controller.signal })
      if (!response.ok) throw new Error('Payment history unavailable')
      const payments = await response.json() as PaymentRecord[]
      if (!Array.isArray(payments)) throw new Error('Invalid payment history')
      if (!controller.signal.aborted) phase = { kind: 'ready', payments }
    } catch { if (!controller.signal.aborted) phase = { kind: 'error' } }
  }

  async function requestRefund() {
    if ((refund.kind !== 'editing' && refund.kind !== 'error') || refund.reason.trim().length < 10) return
    const { id, reason } = refund
    refund = { kind: 'saving', id, reason }
    try {
      const response = await fetch(`${API_BASE}/billing/paypal/orders/${encodeURIComponent(id)}/refund-request`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ reason }),
      })
      if (!response.ok) throw new Error('Could not save this refund request. Retry or contact support with your order ID.')
      if (!controller.signal.aborted) { refund = { kind: 'requested', id }; await load() }
    } catch (error) {
      if (!controller.signal.aborted) refund = { kind: 'error', id, reason, message: error instanceof Error ? error.message : 'Refund request failed.' }
    }
  }

  onMount(() => { void load() })
  onDestroy(() => controller.abort())

  return {
    load,
    requestRefund,
    edit: (id: string) => {
      if (refund.kind === 'saving') return
      const reason = (refund.kind === 'editing' || refund.kind === 'error') && refund.id === id ? refund.reason : ''
      refund = { kind: 'editing', id, reason }
    },
    cancel: () => { if (refund.kind !== 'saving') refund = { kind: 'idle' } },
    setReason: (reason: string) => { if (refund.kind === 'editing' || refund.kind === 'error') refund = { kind: 'editing', id: refund.id, reason } },
    get phase() { return phase },
    get refund() { return refund },
  }
}
