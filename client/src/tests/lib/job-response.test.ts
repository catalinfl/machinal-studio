import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetPendingJob, jobFetch, resolveJobResponse, savedJob } from '../../lib/job-response'

const identity = vi.hoisted(() => ({ owner: 'alice', session: 'u_alice' }))

vi.mock('../../lib/pocketbase', () => ({ pb: { authStore: { get record() { return { id: identity.owner } } } } }))
vi.mock('../../lib/session', () => ({ peekProjectSessionId: () => identity.session }))

const id = 'a'.repeat(32)
const base = 'http://localhost:8080'
const headers = { Authorization: 'Bearer private-token', 'X-Session-Id': 'u_alice' }
const queued = () => Response.json({ id, status: 'queued', progress: 0, statusUrl: `/jobs/${id}` }, { status: 202 })

beforeEach(() => {
  localStorage.clear()
  identity.owner = 'alice'
  identity.session = 'u_alice'
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('persistent background job transport', () => {
  it('leaves synchronous responses untouched', async () => {
    const response = Response.json({ ok: true })
    expect(await resolveJobResponse(response, { base, headers })).toBe(response)
  })

  it('polls using the original private project scope and returns the final payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id, status: 'running', progress: .4 }))
      .mockResolvedValueOnce(Response.json({ id, status: 'completed', progress: 1, result: { filename: 'result.mp4' }, statusCode: 200, contentType: 'application/json' }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []
    const response = await resolveJobResponse(queued(), { base, headers, pollDelay: 0, onProgress: job => progress.push(job.progress) })
    expect(await response.json()).toEqual({ filename: 'result.mp4' })
    expect(progress).toEqual([0, .4, 1])
    expect(fetchMock).toHaveBeenCalledWith(`${base}/jobs/${id}`, expect.objectContaining({ headers }))
  })

  it('preserves compiler diagnostics and their HTTP status on a failed job', async () => {
    const result = { diagnostics: [{ message: 'Missing source' }], requirements: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id, status: 'failed', progress: 0, statusCode: 422, contentType: 'application/json', result })))
    const response = await resolveJobResponse(queued(), { base, headers, pollDelay: 0 })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(result)
  })

  it('preserves plain-text subtitle results', async () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nSalut!\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id, status: 'completed', progress: 1, statusCode: 200, contentType: 'text/plain', result: srt })))
    const response = await resolveJobResponse(queued(), { base, headers, pollDelay: 0 })
    expect(await response.text()).toBe(srt)
  })

  it('stops polling without cancelling server work when the browser detaches', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    controller.abort()
    await expect(resolveJobResponse(queued(), { base, headers, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends credentials to an external status address', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(resolveJobResponse(Response.json({ id, status: 'queued', statusUrl: 'https://other.example/jobs/' + id }, { status: 202 }), { base, headers })).rejects.toThrow('invalid job status')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reuses the idempotency key after an ambiguous network failure and forgets it only after completion', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Network lost')).mockImplementation(async () => queued())
    vi.stubGlobal('fetch', fetchMock)
    const init = { method: 'POST', headers, body: '{"prompt":"private creative instructions"}' }
    await expect(jobFetch(`${base}/ai/images`, init)).rejects.toThrow('Network lost')
    await jobFetch(`${base}/ai/images`, init)
    const firstKey = fetchMock.mock.calls[0][1].headers['Idempotency-Key']
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe(firstKey)
    const stored = JSON.stringify(localStorage)
    expect(stored).not.toContain('private-token')
    expect(stored).not.toContain('private creative instructions')
    savedJob('scene', id)
    forgetPendingJob(id)
    expect(savedJob('scene')).toBe(id)
    await jobFetch(`${base}/ai/images`, init)
    expect(fetchMock.mock.calls[2][1].headers['Idempotency-Key']).not.toBe(firstKey)
  })

  it('isolates recovery keys between accounts and projects', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => queued())
    vi.stubGlobal('fetch', fetchMock)
    const init = { method: 'POST', body: '{}' }
    savedJob('scene', id)
    await jobFetch(`${base}/ai/images`, init)
    identity.session = 'p_second'
    expect(savedJob('scene')).toBe('')
    await jobFetch(`${base}/ai/images`, init)
    identity.owner = 'bob'
    expect(savedJob('scene')).toBe('')
    await jobFetch(`${base}/ai/images`, init)
    expect(new Set(fetchMock.mock.calls.map(call => call[1].headers['Idempotency-Key'])).size).toBe(3)
  })

  it('shares one retry key between concurrent identical submissions', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => queued())
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([jobFetch(`${base}/ai/images`, { method: 'POST', body: '{}' }), jobFetch(`${base}/ai/images`, { method: 'POST', body: '{}' })])
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetchMock.mock.calls[1][1].headers['Idempotency-Key'])
  })

  it('does not attach a late submission to a different account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { identity.owner = 'bob'; return queued() }))
    await expect(jobFetch(`${base}/ai/images`, { method: 'POST', body: '{}' })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('tolerates corrupted browser recovery data', async () => {
    localStorage.setItem('direction-pending-jobs:alice:u_alice', 'null')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    expect((await jobFetch(`${base}/ai/images`, { method: 'POST', body: '{}' })).ok).toBe(true)
  })
})
