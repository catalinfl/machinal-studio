import { API_BASE } from './api'

export const WELCOME_DISMISSED_KEY = 'scrub:welcome-dismissed'

export interface OpenRouterStatus {
  configured: boolean
}

async function settingsRequest(signal: AbortSignal, apiKey?: string): Promise<OpenRouterStatus> {
  const response = await fetch(`${API_BASE}/settings/openrouter`, {
    method: apiKey === undefined ? 'GET' : 'POST',
    headers: apiKey === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: apiKey === undefined ? undefined : JSON.stringify({ apiKey }),
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(response.status === 404
      ? 'This API does not support key setup yet. Rebuild and restart the API, then try again.'
      : message || 'Could not save the key. Try again.')
  }
  const status: OpenRouterStatus = await response.json()
  if (typeof status.configured !== 'boolean') throw new Error('The API could not read the OpenRouter settings. Try again.')
  return status
}

export function getOpenRouterStatus(signal: AbortSignal): Promise<OpenRouterStatus> {
  return settingsRequest(signal)
}

export function saveOpenRouterKey(apiKey: string, signal: AbortSignal): Promise<OpenRouterStatus> {
  return settingsRequest(signal, apiKey)
}

export function welcomeDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissWelcome(): void {
  try {
    localStorage.setItem(WELCOME_DISMISSED_KEY, '1')
  } catch {
    // The current visit still works when browser storage is unavailable.
  }
}
