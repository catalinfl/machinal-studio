import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = [
  'VITE_LEGAL_OPERATOR_NAME',
  'VITE_LEGAL_OPERATOR_ADDRESS',
  'VITE_LEGAL_OPERATOR_COUNTRY',
  'VITE_LEGAL_CONTACT_EMAIL',
  'VITE_LEGAL_PRIVACY_EMAIL',
] as const

describe('public legal settings', () => {
  beforeEach(() => {
    vi.resetModules()
    for (const setting of settings) vi.stubEnv(setting, '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('does not invent missing operator details or remove draft protection', async () => {
    const { legalOperator, legalOperatorComplete, legalIsDraft } = await import('../../lib/legal')
    expect(Object.values(legalOperator).every(value => value === '')).toBe(true)
    expect(legalOperatorComplete).toBe(false)
    expect(legalIsDraft).toBe(true)
  })

  it('normalizes operator details and falls back to the general contact', async () => {
    vi.stubEnv('VITE_LEGAL_OPERATOR_NAME', ' Example Operator ')
    vi.stubEnv('VITE_LEGAL_OPERATOR_ADDRESS', ' Example address ')
    vi.stubEnv('VITE_LEGAL_OPERATOR_COUNTRY', ' Example country ')
    vi.stubEnv('VITE_LEGAL_CONTACT_EMAIL', ' contact@example.test ')
    const { legalOperator, legalOperatorComplete, legalIsDraft } = await import('../../lib/legal')
    expect(legalOperator.name).toBe('Example Operator')
    expect(legalOperator.privacyEmail).toBe('contact@example.test')
    expect(legalOperatorComplete).toBe(true)
    expect(legalIsDraft).toBe(true)
  })

  it('uses a separate privacy address when supplied', async () => {
    vi.stubEnv('VITE_LEGAL_CONTACT_EMAIL', 'contact@example.test')
    vi.stubEnv('VITE_LEGAL_PRIVACY_EMAIL', 'privacy@example.test')
    const { legalOperator } = await import('../../lib/legal')
    expect(legalOperator.privacyEmail).toBe('privacy@example.test')
  })

  it('encodes the address and request subject instead of composing raw mail headers', async () => {
    const { contactHref } = await import('../../lib/legal')
    expect(contactHref('privacy@example.test', 'Access & deletion')).toBe('mailto:privacy%40example.test?subject=Access%20%26%20deletion')
  })
})
