import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  __sessionInternals,
  adoptOwnedSession,
  isValidSessionId,
  ownedSessionId,
  peekProjectSessionId,
  startProjectSession,
  stopProjectSessionHeartbeat,
  withSession,
} from '../../lib/session'
import { listFiles, mediaSourceUrl } from '../../lib/api'

const KEY = __sessionInternals.STORAGE_KEY

describe('project session', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    stopProjectSessionHeartbeat()
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    stopProjectSessionHeartbeat()
  })

  it('peek returns empty without creating a session', () => {
    expect(peekProjectSessionId()).toBe('')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(withSession('http://x/list')).toBe('http://x/list')
  })

  it('rejects traversal ids from storage', () => {
    localStorage.setItem(KEY, '../evil')
    expect(peekProjectSessionId()).toBe('')
    expect(withSession('http://x/list')).toBe('http://x/list')
  })

  it('validates the same charset as the server volume dirs', () => {
    expect(isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isValidSessionId('user_1')).toBe(true)
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId('../x')).toBe(false)
    expect(isValidSessionId('a/b')).toBe(false)
    expect(isValidSessionId('a.b')).toBe(false)
  })

  it('derives one owned session per user and reuses it (shared across tabs)', () => {
    expect(ownedSessionId('abc123')).toBe('u_abc123')
    const first = adoptOwnedSession('abc123')
    expect(first).toBe('u_abc123')
    expect(peekProjectSessionId()).toBe(first)
    expect(localStorage.getItem(KEY)).toBe(first)
  })

  it('appends the session to media urls with ? and &', () => {
    localStorage.setItem(KEY, 'user-1')
    expect(withSession('http://x/list')).toBe('http://x/list?session=user-1')
    expect(withSession('http://x/download?file=a.mp4')).toBe('http://x/download?file=a.mp4&session=user-1')
    expect(mediaSourceUrl('clip test.mp4')).toContain('session=user-1')
  })

  it('start reuses the owned session and heartbeats, stop clears the timer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    try {
      const id = adoptOwnedSession('test-user-1')
      const stop = startProjectSession('http://api:8080')
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api:8080/sessions/${id}/heartbeat`,
        expect.objectContaining({ method: 'POST', body: '{}' }),
      )
      expect(peekProjectSessionId()).toBe(id)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      stop()
      const atStop = fetchMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(fetchMock.mock.calls.length).toBe(atStop)
    } finally {
      vi.useRealTimers()
    }
  })

  it('listFiles parses session JSON bins with s3 metadata', async () => {
    localStorage.setItem(KEY, 'user-9')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'clip.mp4', size: 1024, etag: 'abc', s3_key: 'user-9/clip.mp4', cached: true },
          { name: 'fresh.mp4', size: 7, cached: true },
          { name: '', size: 1 },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const files = await listFiles()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/list?session=user-9'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Session-Id': 'user-9' }) }),
    )
    expect(files).toEqual([
      { name: 'clip.mp4', size: 1024, etag: 'abc', s3Key: 'user-9/clip.mp4', cached: true },
      { name: 'fresh.mp4', size: 7, cached: true },
    ])
  })
})
