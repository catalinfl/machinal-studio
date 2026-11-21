import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/svelte'
import CreditOverview from '../../components/CreditOverview.svelte'
import type { CreditSummary } from '../../lib/credits'

vi.mock('../../lib/api', () => ({
  API_BASE: 'http://127.0.0.1:8080',
  authHeader: () => ({ Authorization: 'Bearer credit-test-token' }),
}))

const summary: CreditSummary = {
  balance: {
    pro: true, monthlyAllowance: 1000, monthlyRemaining: 870.25,
    purchasedRemaining: 250, remaining: 1120.25, reserved: 0, debt: 0,
    usagePending: false, nextReset: '2026-11-01T00:00:00Z',
  },
  pricing: { configured: false, usdPerCredit: '', renderPerMinute: '' },
  purchase: { available: false, packs: [] },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CreditOverview', () => {
  it('loads the balance from the authenticated API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(summary))
    vi.stubGlobal('fetch', fetchMock)
    const panel = render(CreditOverview)

    expect(await panel.findByLabelText('Available credits')).toHaveTextContent('1,120.25 credits available')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/billing/credits', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer credit-test-token' }),
      signal: expect.any(AbortSignal),
    }))
  })

  it('keeps pending costs informational and rounds displayed credits', async () => {
    const pending = structuredClone(summary)
    pending.balance.remaining = 992.997426
    pending.balance.usagePending = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(pending)))
    const panel = render(CreditOverview)

    expect(await panel.findByLabelText('Available credits')).toHaveTextContent('993 credits available')
    expect(panel.getByRole('status')).toHaveTextContent('Your balance is not reserved.')
    expect(panel.container).not.toHaveTextContent('992.997426')
  })

  it.each([200, 502])('explains an HTML response with status %i and allows retry', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<!doctype html><html>Vite frontend</html>', {
        status, headers: { 'content-type': 'text/html; charset=utf-8' },
      }))
      .mockResolvedValueOnce(Response.json(summary))
    vi.stubGlobal('fetch', fetchMock)
    const panel = render(CreditOverview)

    expect(await panel.findByRole('alert')).toHaveTextContent('Check that VITE_API_BASE points to the API server.')
    expect(panel.getByRole('alert')).not.toHaveTextContent(/Unexpected token|<!doctype/)
    await fireEvent.click(panel.getByRole('button', { name: 'Retry balance' }))
    expect(await panel.findByLabelText('Available credits')).toHaveTextContent('1,120.25 credits available')
  })

  it('shows a readable error for malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid', {
      headers: { 'content-type': 'application/json' },
    })))
    const panel = render(CreditOverview)

    expect(await panel.findByRole('alert')).toHaveTextContent('Billing returned an invalid response. Retry shortly.')
  })

  it.each([
    [401, 'login required', 'Your login expired. Sign in again to view credits.'],
    [503, 'Credit balance is unavailable.', 'Credit balance is unavailable.'],
  ])('preserves the billing error for status %i', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
    const panel = render(CreditOverview)

    expect(await panel.findByRole('alert')).toHaveTextContent(message)
  })
})
