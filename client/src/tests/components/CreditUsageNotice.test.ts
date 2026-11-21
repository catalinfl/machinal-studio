import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import CreditUsageNotice from '../../components/CreditUsageNotice.svelte'

describe('local usage notice', () => {
  it('separates optional provider charges from local rendering without hosted links', () => {
    render(CreditUsageNotice)

    expect(screen.getByText(/AI actions use your OpenRouter key and may incur provider charges/)).toBeInTheDocument()
    expect(screen.getByText(/Rendering runs on this computer without machinal credits/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
