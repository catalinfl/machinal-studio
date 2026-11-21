import { describe, expect, it } from 'vitest'
import { loginDestinationLabel, loginUrl, postLoginTarget, safeReturnTarget } from '../../lib/auth-navigation'

describe('authenticated page navigation', () => {
  it('returns to the requested API or toolkit location after authentication', () => {
    expect(postLoginTarget('?next=%2Fapi')).toBe('/api')
    expect(postLoginTarget('?next=%2Ftoolkit%3Fq%3Dwarm%2520memory%23playground')).toBe('/toolkit?q=warm%20memory#playground')
    expect(loginUrl('/toolkit')).toBe('/login?next=%2Ftoolkit')
    expect(loginDestinationLabel('?next=%2Fapi')).toBe('the API workspace')
    expect(loginDestinationLabel('?next=%2Ftoolkit')).toBe('the toolkit')
    expect(postLoginTarget('?next=%2Fapi-keys%3Fpaypal%3Dapproved%26token%3DORDER123')).toBe('/api-keys?paypal=approved&token=ORDER123')
    expect(loginDestinationLabel('?next=%2Fapi-keys')).toBe('API Keys & credits')
    expect(postLoginTarget('?next=%2Fmembership%3Fpaypal%3Dapproved%26token%3DORDER123')).toBe('/membership?paypal=approved&token=ORDER123')
    expect(loginDestinationLabel('?next=%2Fmembership')).toBe('Membership & billing')
    expect(loginUrl('/jobs')).toBe('/login?next=%2Fjobs')
  })

  it.each(['https://elsewhere.test/api', '//elsewhere.test/api', '/\\elsewhere.test/api', '/docs', '/api\n'])('rejects an invalid or external destination: %s', target => {
    expect(safeReturnTarget(target)).toBeNull()
    expect(postLoginTarget(`?next=${encodeURIComponent(target)}`)).toBe('/editor')
  })

  it('retains the existing AI deep-link login flow', () => {
    expect(postLoginTarget('?ai=image')).toBe('/editor?ai=image')
    expect(postLoginTarget('?ai=tts')).toBe('/editor?ai=tts')
    expect(postLoginTarget('?ai=unknown')).toBe('/editor')
  })
})
