import { onDestroy, onMount } from 'svelte'
import { API_BASE, authHeader } from '../lib/api'
import type { CreditSummary } from '../lib/credits'
import { rememberServerAccess } from '../lib/server-access.svelte'

type Phase = { kind: 'loading' } | { kind: 'ready'; summary: CreditSummary } | { kind: 'error'; message: string }

type PaymentScope = 'credits' | 'membership'

type Payment = { kind: 'idle' } | { kind: 'redirecting'; scope: PaymentScope } | { kind: 'confirming'; orderId: string; scope: PaymentScope }
  | { kind: 'completed'; scope: PaymentScope } | { kind: 'cancelled'; scope: PaymentScope }
  | { kind: 'error'; scope: PaymentScope; message: string; orderId?: string }

export function useCredits({ handlePaymentReturn = true, checkoutScope = 'credits' }: { handlePaymentReturn?: boolean; checkoutScope?: PaymentScope } = {}) {
  let phase = $state<Phase>({ kind: 'loading' })
  let payment = $state<Payment>({ kind: 'idle' })
  let packId = $state('')
  let loadController: AbortController | undefined
  const paymentController = new AbortController()
  const busy = $derived(payment.kind === 'redirecting' || payment.kind === 'confirming')

  async function request<T>(method: string, path: string, signal: AbortSignal, body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}/billing${path}`, {
      method, signal, headers: { ...authHeader(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.status === 401) throw new Error('Your login expired. Sign in again to view credits.')
    if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      throw new Error('Billing returned a web page instead of account data. Check that VITE_API_BASE points to the API server.')
    }
    if (!response.ok) {
      const message = (await response.text()).trim()
      throw new Error(message && message.length <= 240 ? message : 'Billing is unavailable. Retry shortly.')
    }
    try {
      return await response.json()
    } catch {
      throw new Error('Billing returned an invalid response. Retry shortly.')
    }
  }

  async function load() {
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    phase = { kind: 'loading' }
    try {
      const summary = await request<CreditSummary>('GET', '/credits', controller.signal)
      if (controller.signal.aborted) return
      rememberServerAccess(summary.balance.pro)
      if (!summary.purchase.packs.some(pack => pack.id === packId)) packId = summary.purchase.packs[0]?.id ?? ''
      phase = { kind: 'ready', summary }
    } catch (error) {
      if (!controller.signal.aborted) phase = { kind: 'error', message: error instanceof Error ? error.message : 'Could not load your credit balance.' }
    }
  }

  async function buy() {
    if (busy || phase.kind !== 'ready' || !phase.summary.balance.pro || !phase.summary.purchase.available || !packId) return
    await checkout('/paypal/orders', { packId }, 'credits')
  }

  async function buyMembership(planId: string) {
    if (busy || phase.kind !== 'ready' || !phase.summary.memberships?.available || !phase.summary.memberships.plans.some(plan => plan.id === planId)) return
    await checkout('/membership/orders', { planId }, 'membership')
  }

  async function checkout(path: string, body: unknown, scope: PaymentScope) {
    payment = { kind: 'redirecting', scope }
    try {
      const result = await request<{ approvalUrl: string }>('POST', path, paymentController.signal, body)
      if (paymentController.signal.aborted) return
      const target = new URL(result.approvalUrl)
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !['www.paypal.com', 'www.sandbox.paypal.com'].includes(target.hostname)) {
        throw new Error('PayPal returned an invalid checkout link. Retry shortly.')
      }
      window.location.assign(target.href)
    } catch (error) {
      if (!paymentController.signal.aborted) payment = { kind: 'error', scope, message: error instanceof Error ? error.message : 'Could not start checkout.' }
    }
  }

  function clearPaymentQuery() {
    const url = new URL(window.location.href)
    for (const name of ['paypal', 'token', 'PayerID']) url.searchParams.delete(name)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  async function confirm(orderId: string) {
    if (busy) return
    const scope = payment.kind === 'error' ? payment.scope : checkoutScope
    payment = { kind: 'confirming', orderId, scope }
    try {
      await request('POST', `/paypal/orders/${encodeURIComponent(orderId)}/capture`, paymentController.signal)
      if (paymentController.signal.aborted) return
      payment = { kind: 'completed', scope }
      clearPaymentQuery()
      await load()
    } catch (error) {
      if (!paymentController.signal.aborted) payment = { kind: 'error', scope, message: error instanceof Error ? error.message : 'Payment could not be verified.', orderId }
    }
  }

  onMount(() => {
    void load()
    if (!handlePaymentReturn) return
    const query = new URLSearchParams(window.location.search)
    if (query.get('paypal') === 'cancelled') {
      payment = { kind: 'cancelled', scope: checkoutScope }
      clearPaymentQuery()
    } else if (query.get('paypal') === 'approved') {
      const orderId = query.get('token') ?? ''
      if (/^[A-Za-z0-9]{5,64}$/.test(orderId)) void confirm(orderId)
      else payment = { kind: 'error', scope: checkoutScope, message: 'The PayPal return link is invalid. Nothing was added to your account.' }
    }
  })

  onDestroy(() => {
    loadController?.abort()
    paymentController.abort()
  })

  return {
    load,
    buy,
    buyMembership,
    confirm,
    get phase() { return phase },
    get payment() { return payment },
    get busy() { return busy },
    get packId() { return packId },
    set packId(value: string) { packId = value },
  }
}

export type CreditAccount = ReturnType<typeof useCredits>
