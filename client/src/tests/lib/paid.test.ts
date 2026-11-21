import { describe, expect, it } from 'vitest'
import { fetchIsPaid, isPaidRequiredError, isPaidUserSync } from '../../lib/paid'
import { auth } from '../../stores/auth.svelte'

describe('local workspace access', () => {
  it('needs no login, token or paid entitlement', async () => {
    expect(auth.user.id).toBe('local')
    expect(auth.token).toBe('')
    expect(isPaidUserSync()).toBe(true)
    expect(await fetchIsPaid()).toBe(true)
  })

  it('never routes provider balance errors to a machinal paywall', () => {
    expect(isPaidRequiredError(new Error('paid plan required'))).toBe(false)
  })
})
