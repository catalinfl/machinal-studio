import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import CreditPurchase from '../../components/product/CreditPurchase.svelte'
import type { CreditAccount } from '../../composables/useCredits.svelte'
import type { CreditSummary } from '../../lib/credits'

function accountFixture(): CreditAccount {
  const summary: CreditSummary = {
    balance: { pro: true, monthlyAllowance: 1000, monthlyRemaining: 1000, purchasedRemaining: 0,
      remaining: 1000, reserved: 0, debt: 0, usagePending: false, nextReset: '2026-12-04T12:00:00Z', allowancePeriod: 'prepaid-30-day' },
    pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '10' },
    purchase: { available: true, packs: [
      { id: 'credits-500', credits: 500, usd: '5.00' },
      { id: 'credits-1000', credits: 1000, usd: '10.00' },
      { id: 'credits-2500', credits: 2500, usd: '25.00' },
      { id: 'credits-5000', credits: 5000, usd: '50.00' },
      { id: 'credits-10000', credits: 10000, usd: '100.00' },
    ] },
    payments: { mode: 'sandbox' },
  }
  return {
    phase: { kind: 'ready', summary }, payment: { kind: 'idle' }, busy: false, packId: 'credits-500',
    load: vi.fn(async () => {}), buy: vi.fn(async () => {}), buyMembership: vi.fn(async () => {}), confirm: vi.fn(async () => {}),
  }
}

afterEach(cleanup)

describe('CreditPurchase', () => {
  it('shows all five packs, retail unit prices, the total and sandbox conditions before checkout', async () => {
    const account = accountFixture()
    const panel = render(CreditPurchase, { account })

    expect(panel.getAllByRole('radio')).toHaveLength(5)
    expect(panel.getByRole('radio', { name: /^500 credits/ })).toBeChecked()
    expect(panel.getByRole('radio', { name: /10,000 credits/ })).toBeVisible()
    expect(panel.getByRole('status')).toHaveTextContent('PayPal sandbox: test payments only.')
    expect(panel.container).toHaveTextContent('You’ll receive 500 credits for $5.00')
    expect(panel.container).toHaveTextContent('A top-up does not activate or extend membership.')
    expect(panel.container).not.toHaveTextContent(/20%|supplier|upstream/i)
    await fireEvent.click(panel.getByRole('button', { name: 'Continue to PayPal' }))
    expect(account.buy).toHaveBeenCalledOnce()
  })

  it('keeps pack buying unavailable without active paid access', () => {
    const account = accountFixture()
    if (account.phase.kind !== 'ready') throw new Error('Expected ready fixture')
    account.phase.summary.balance.pro = false
    const panel = render(CreditPurchase, { account })

    for (const option of panel.getAllByRole('radio')) expect(option).toBeDisabled()
    expect(panel.getByRole('button', { name: 'Continue to PayPal' })).toBeDisabled()
    expect(panel.getByRole('link', { name: 'Activate Pro access' })).toHaveAttribute('href', '/membership')
  })

  it('shows loading feedback while fetching credit packs', () => {
    const account: CreditAccount = { ...accountFixture(), phase: { kind: 'loading' } }
    const panel = render(CreditPurchase, { account })

    expect(panel.getByRole('status')).toHaveTextContent('Loading credit packs…')
    expect(panel.queryByRole('button', { name: 'Continue to PayPal' })).not.toBeInTheDocument()
  })

  it('allows failed pack loading to be retried beside the error', async () => {
    const account: CreditAccount = { ...accountFixture(), phase: { kind: 'error', message: 'Billing is temporarily unavailable.' } }
    const panel = render(CreditPurchase, { account })

    expect(panel.getByRole('alert')).toHaveTextContent('Billing is temporarily unavailable.')
    await fireEvent.click(panel.getByRole('button', { name: 'Retry credit packs' }))
    expect(account.load).toHaveBeenCalledOnce()
  })
})
