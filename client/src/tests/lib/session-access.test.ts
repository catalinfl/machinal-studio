import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authStore } = vi.hoisted(() => ({ authStore: { token: 'login-token', record: { id: 'alice' } } }))
vi.mock('../../lib/pocketbase', () => ({ pb: { authStore } }))

import { peekProjectSessionId, selectProjectSession, startProjectSession, stopProjectSessionHeartbeat, withSession } from '../../lib/session'

describe('private media session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    authStore.record = { id: 'alice' }
    selectProjectSession('')
  })

  afterEach(() => {
    stopProjectSessionHeartbeat()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('attaches only a workspace-scoped read token, never the login credential', () => {
    const token = 'a'.repeat(64)
    selectProjectSession('u_alice', token)
    const url = withSession('https://api.example/download?file=clip.mp4')
    expect(url).toContain(`&mediaToken=${token}`)
    expect(url).not.toContain('login-token')
    expect(localStorage.getItem('scrub-project-session-id')).toBe('u_alice')
    expect(JSON.stringify(localStorage)).not.toContain(token)
    selectProjectSession('p_other')
    expect(withSession('https://api.example/download')).not.toContain('mediaToken')
  })

  it('does not forward the previous account capability after an account change', () => {
    selectProjectSession('u_alice', 'a'.repeat(64))
    authStore.record = { id: 'bob' }
    expect(withSession('https://api.example/download')).not.toContain('mediaToken')
  })

  it('ignores a late session creation after selecting a different project', async () => {
    let finish!: (response: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const stopOld = startProjectSession('https://api.example')
    selectProjectSession('p_selected')
    finish(new Response(JSON.stringify({ id: 'u_alice', mediaToken: 'a'.repeat(64) })))
    await vi.advanceTimersByTimeAsync(0)
    expect(peekProjectSessionId()).toBe('p_selected')
    expect(fetchMock).toHaveBeenCalledOnce()
    stopOld()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('an older cleanup cannot stop the current project heartbeat', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', fetchMock)
    selectProjectSession('p_old')
    const stopOld = startProjectSession('https://api.example')
    selectProjectSession('p_new')
    const stopNew = startProjectSession('https://api.example')
    stopOld()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/p_new/'))).toHaveLength(2)
    stopNew()
    const count = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(count)
  })

  it('adopts a capability returned by the authenticated heartbeat', async () => {
    const token = 'b'.repeat(64)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ mediaToken: token }))))
    selectProjectSession('u_alice')
    startProjectSession('https://api.example')
    await vi.advanceTimersByTimeAsync(0)
    expect(withSession('https://api.example/thumbnail')).toContain(`mediaToken=${token}`)
  })
})
