import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import NotFound from '../../pages/NotFound.svelte'

describe('NotFound page', () => {
  it('renders the 404 code', () => {
    const { getByText } = render(NotFound)
    expect(getByText('404')).toBeTruthy()
  })

  it('renders the not-found message', () => {
    const { getByText } = render(NotFound)
    expect(getByText(/could not be found/)).toBeTruthy()
  })

  it('renders a link back home', () => {
    const { container } = render(NotFound)
    const link = container.querySelector('a[href="/"]')
    expect(link).toBeTruthy()
    expect(link?.textContent).toContain('Go home')
  })
})