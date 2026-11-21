// Saved projects use isolated p_ sessions. The initial project retains the
// legacy u_<account> media space. An active editor keeps its own session in
// memory so selecting another project in a second tab cannot redirect uploads.

import { pb } from './pocketbase'

const STORAGE_KEY = 'scrub-project-session-id'
const HEARTBEAT_MS = 30_000
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let activeSessionId: string | undefined
let heartbeatGeneration = 0
let mediaAccess: { id: string; token: string; owner: string } | undefined

export function selectProjectSession(id: string, mediaToken?: string): void {
  stopProjectSessionHeartbeat()
  mediaAccess = undefined
  activeSessionId = isValidSessionId(id) ? id : ''
  storeSessionId(activeSessionId)
  rememberMediaToken(activeSessionId, mediaToken)
}

function rememberMediaToken(id: string, token: unknown): void {
  if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
    mediaAccess = { id, token, owner: currentPbUserId() }
  }
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id)
}

// peekProjectSessionId reads the id without creating one, so background
// helpers never mint sessions (and tests keep legacy URLs).
export function peekProjectSessionId(): string {
  if (activeSessionId !== undefined) return activeSessionId
  try {
    if (typeof localStorage === 'undefined') return ''
    const id = (localStorage.getItem(STORAGE_KEY) ?? '').trim()
    return isValidSessionId(id) ? id : ''
  } catch {
    return ''
  }
}

// withSession appends "?session=" when a project session exists (for
// <video>/<img> tags which cannot set headers).
export function withSession(url: string): string {
  const id = peekProjectSessionId()
  if (!id) return url
  const scoped = `${url}${url.includes('?') ? '&' : '?'}session=${encodeURIComponent(id)}`
  if (!mediaAccess || mediaAccess.id !== id || mediaAccess.owner !== currentPbUserId()) return scoped
  return `${scoped}&mediaToken=${encodeURIComponent(mediaAccess.token)}`
}

// sessionHeader returns X-Session-Id for fetch/XHR (preferred over query so
// bearer URLs never land in logs/history/Referer).
export function sessionHeader(): Record<string, string> {
  const id = peekProjectSessionId()
  return id ? { 'X-Session-Id': id } : {}
}

async function postJson(url: string, body: unknown): Promise<any> {
  try {
    const token = pb.authStore.token?.trim()
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!resp.ok) return null
    try {
      return await resp.json()
    } catch {
      return null
    }
  } catch {
    // Heartbeats must never break editing.
    return null
  }
}

function currentPbUserId(): string {
  try {
    const record = (pb.authStore as any)?.record as { id?: unknown } | null | undefined
    const id = typeof record?.id === 'string' ? record.id.trim() : ''
    return isValidSessionId(`u_${id}`) ? id : ''
  } catch {
    return ''
  }
}

function isLegacySessionId(id: string): boolean {
  return id.startsWith('u_')
}

function storeSessionId(id: string): void {
  try {
    if (typeof localStorage !== 'undefined' && isValidSessionId(id)) {
      localStorage.setItem(STORAGE_KEY, id)
    }
  } catch { }
}


export function ownedSessionId(pbUserId: string): string {
  return `u_${pbUserId.trim()}`.slice(0, 64)
}

export function adoptOwnedSession(pbUserId: string): string {
  stopProjectSessionHeartbeat()
  mediaAccess = undefined
  activeSessionId = undefined
  // Keep existing media storage; authenticated project/heartbeat responses
  // provide the separate read capability for native media tags.
  const id = ownedSessionId(pbUserId)
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, id)
  } catch { }
  return id
}

// startProjectSession reuses the stored session id (stable volume/S3 prefix).
// It only mints a new server id when none exists — never switches ids
// mid-session (that orphans the media bin: list from old volume, metadata
// from new empty volume → 404 "source file doesn't exist").
// Returns stop function.
export function startProjectSession(apiBase: string): () => void {
  if (!apiBase) return stopProjectSessionHeartbeat
  const base = apiBase.replace(/\/$/, '')
  let existing = peekProjectSessionId()
  // Recovery from orphan UUIDs minted by the buggy random-only Create:
  // logged-in users go back to the stable "u_<uid>" volume where their S3
  // objects actually live. Fresh UUID uploads in the window are abandoned
  // (they were unreachable anyway).
  const pbUid = currentPbUserId()
  if (existing && !isLegacySessionId(existing) && !existing.startsWith('p_') && pbUid) {
    existing = ownedSessionId(pbUid)
    storeSessionId(existing)
  }
  stopProjectSessionHeartbeat()
  const generation = heartbeatGeneration
  const owner = currentPbUserId()
  const current = () => generation === heartbeatGeneration && owner === currentPbUserId()
  const stop = () => { if (generation === heartbeatGeneration) stopProjectSessionHeartbeat() }
  const beat = async (id: string) => {
    if (!current()) return
    const result = await postJson(`${base}/sessions/${encodeURIComponent(id)}/heartbeat`, {})
    if (current() && peekProjectSessionId() === id) rememberMediaToken(id, result?.mediaToken)
  }
  if (existing) {
    // Stable id: register + heartbeat it, no mint.
    void beat(existing)
    heartbeatTimer = setInterval(() => { void beat(existing) }, HEARTBEAT_MS)
    return stop
  }
  // No id yet: mint one server-side, store, then heartbeat.
  void (async () => {
    const created = await postJson(`${base}/sessions`, {})
    if (!current()) return
    const fresh = typeof created?.id === 'string' && isValidSessionId(created.id) ? created.id : ''
    if (!fresh) return
    activeSessionId = fresh
    storeSessionId(fresh)
    rememberMediaToken(fresh, created?.mediaToken)
    void beat(fresh)
    heartbeatTimer = setInterval(() => { void beat(fresh) }, HEARTBEAT_MS)
  })()
  return stop
}

export function stopProjectSessionHeartbeat(): void {
  heartbeatGeneration++
  if (heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
}

export const __sessionInternals = { STORAGE_KEY, HEARTBEAT_MS }
