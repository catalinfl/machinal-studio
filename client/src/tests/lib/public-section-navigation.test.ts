import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollToPublicSection } from '../../lib/public-section-navigation'

describe('public section navigation', () => {
  const scroll = vi.fn()

  beforeEach(() => {
    history.replaceState({ preserved: true }, '', '/')
    document.body.innerHTML = '<section id="features"></section>'
    document.getElementById('features')!.scrollIntoView = scroll
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  function follow(href: string, options: MouseEventInit = {}) {
    const link = document.createElement('a')
    link.href = href
    link.addEventListener('click', event => {
      scrollToPublicSection(event)
      if (!event.defaultPrevented) event.preventDefault()
    })
    const event = new MouseEvent('click', { cancelable: true, ...options })
    const prevent = vi.spyOn(event, 'preventDefault')
    link.dispatchEvent(event)
    return prevent
  }

  it('scrolls without dispatching the same-route router navigation and preserves history state', () => {
    follow('/#features')
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    expect(location.hash).toBe('#features')
    expect(history.state).toEqual({ preserved: true })
  })

  it.each(['/pricing#features', '/?view=other#features', 'https://elsewhere.test/#features', '/#missing', '/'])('leaves other links to their normal navigation: %s', href => {
    follow(href)
    expect(scroll).not.toHaveBeenCalled()
    expect(location.hash).toBe('')
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('does not intercept modified clicks: %j', options => {
    follow('/#features', options)
    expect(scroll).not.toHaveBeenCalled()
    expect(location.hash).toBe('')
  })
})
