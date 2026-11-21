import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import Docs from '../../pages/Docs.svelte'

vi.mock('../../stores/openrouterSetup.svelte', () => ({ openRouterSetup: { openSettings: vi.fn() } }))

describe('local documentation', () => {
  it('explains user-owned infrastructure without a login or subscription link', () => {
    const { getByRole, container } = render(Docs)
    expect(getByRole('heading', { name: 'Connect MCP without a machinal key' })).toBeTruthy()
    expect(getByRole('button', { name: 'Configure OpenRouter' })).toBeTruthy()
    expect(container.querySelector('a[href="/login"]')).toBeNull()
    expect(container.querySelector('a[href="/membership"]')).toBeNull()
    expect(container.textContent).toContain('composition-data')
  })
})
