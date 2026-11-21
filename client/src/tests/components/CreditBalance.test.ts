import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/svelte'
import CreditBalance from '../../components/product/CreditBalance.svelte'
import type { CreditAccount } from '../../composables/useCredits.svelte'
import type { CreditSummary } from '../../lib/credits'

function accountFixture(): CreditAccount {
  const summary: CreditSummary = {
    balance: {
      pro: true, monthlyAllowance: 1000, monthlyRemaining: 870,
      purchasedRemaining: 250, remaining: 1120, reserved: 0, debt: 0,
      usagePending: false, nextReset: '2026-11-01T00:00:00Z',
    },
    pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '2' },
    purchase: { available: false, packs: [] },
  }

  return {
    phase: { kind: 'ready', summary },
    payment: { kind: 'idle' },
    busy: false,
    packId: '',
    load: vi.fn(async () => {}),
    buy: vi.fn(async () => {}),
    buyMembership: vi.fn(async () => {}),
    confirm: vi.fn(async () => {}),
  }
}

afterEach(cleanup)

describe('CreditBalance', () => {
  it('shows credit usage and the rendering rate without supplier or internal cost details', () => {
    const panel = render(CreditBalance, { account: accountFixture() })

    expect(panel.getByLabelText('Available credits')).toHaveTextContent('1,120 credits')
    expect(panel.container).toHaveTextContent('AI tools use credits based on the work completed.')
    expect(panel.container).toHaveTextContent('Rendering: 2 credits per output minute, prorated.')
    expect(panel.container).not.toHaveTextContent(/openrouter|provider|supplier|upstream|converted at|\$0\.01|30%|3\.33/i)
  })

  it('describes pending credit charges without exposing supplier accounting', () => {
    const account = accountFixture()
    if (account.phase.kind !== 'ready') throw new Error('Expected a ready fixture')
    account.phase.summary.balance.usagePending = true
    const panel = render(CreditBalance, { account })

    expect(panel.getByRole('status')).toHaveTextContent('Some credit charges are still being finalized.')
    expect(panel.getByRole('status')).toHaveTextContent('does not reserve your balance')
    expect(panel.container).not.toHaveTextContent(/openrouter|provider costs/i)
  })

  it('explains prepaid periods without claiming a calendar-month reset', () => {
    const account = accountFixture()
    if (account.phase.kind !== 'ready') throw new Error('Expected a ready fixture')
    account.phase.summary.balance.allowancePeriod = 'prepaid-30-day'
    account.phase.summary.balance.nextReset = '2026-11-25T12:00:00Z'
    const panel = render(CreditBalance, { account })

    expect(panel.container).toHaveTextContent('1,000 API credits per 30-day period')
    expect(panel.container).toHaveTextContent('25 November 2026')
    expect(panel.container).toHaveTextContent('12:00 UTC')
    expect(panel.container).toHaveTextContent('does not add the next period’s credits immediately')
    expect(panel.container).not.toHaveTextContent('calendar month')
  })
})
