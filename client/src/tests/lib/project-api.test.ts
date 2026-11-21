import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectOwner, projectRequest } from '../../lib/project-api'

vi.mock('../../lib/api-origin', () => ({ API_BASE: 'http://127.0.0.1:8080' }))
vi.mock('../../lib/session', () => ({ selectProjectSession: vi.fn(), startProjectSession: vi.fn() }))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('local projects API', () => {
  it('uses the local owner without an account', () => {
    expect(projectOwner()).toBe('local')
  })

  it('loads projects from the local API without credentials', async () => {
    fetchMock.mockResolvedValue(Response.json([{ id: 'default', name: 'Local film' }]))

    await expect(projectRequest()).resolves.toEqual([{ id: 'default', name: 'Local film' }])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/projects', {
      method: 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', keepalive: false,
    })
  })

  it('saves the versioned project locally and keeps unload support', async () => {
    const body = { name: 'Știință și țară', version: 2, state: { schemaVersion: 1 } }
    fetchMock.mockResolvedValue(Response.json({ version: 3 }))

    await expect(projectRequest('/p_film', body, true)).resolves.toEqual({ version: 3 })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/projects/p_film', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body), keepalive: true,
    })
  })

  it('retains reload recovery for a save conflict', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }))

    await expect(projectRequest('/p_film', {})).rejects.toThrow('This project changed in another tab. Your unsaved changes are still in this tab. Download a draft before reloading.')
  })

  it('points at local API recovery instead of a nonexistent login page', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))

    await expect(projectRequest()).rejects.toThrow('Could not load local projects. Check that the local API is running, then retry.')
  })

  it('explains how to recover when the local services are stopped', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(projectRequest()).rejects.toThrow('Could not reach the local API. Start the local Docker services and retry.')
  })
})
