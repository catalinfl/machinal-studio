import { describe, it, expect } from 'vitest'
import { scrubModeAfterAuthChange } from '../../stores/scrub.svelte'

describe('scrubModeAfterAuthChange', () => {
  it('lands fresh logins on the Server tab', () => {
    expect(scrubModeAfterAuthChange('wasm', false, true)).toBe('proxy')
  })

  it('keeps an explicit Local choice across login', () => {
    expect(scrubModeAfterAuthChange('proxy', false, true)).toBe('proxy')
  })

  it('falls back to Local on logout', () => {
    expect(scrubModeAfterAuthChange('proxy', true, false)).toBe('wasm')
  })

  it('keeps Local across logout', () => {
    expect(scrubModeAfterAuthChange('wasm', true, false)).toBe('wasm')
  })

  it('never switches without an auth transition', () => {
    expect(scrubModeAfterAuthChange('wasm', false, false)).toBe('wasm')
    expect(scrubModeAfterAuthChange('proxy', false, false)).toBe('proxy')
    expect(scrubModeAfterAuthChange('wasm', true, true)).toBe('wasm')
    expect(scrubModeAfterAuthChange('proxy', true, true)).toBe('proxy')
  })
})
