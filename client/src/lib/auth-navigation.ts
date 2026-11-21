import { requestedAIFeature } from './ai-access'

const RETURN_ROUTES = new Set(['/api', '/api-keys', '/toolkit', '/editor', '/membership', '/jobs'])
const LOCAL_ORIGIN = 'https://machinal.local'

export function safeReturnTarget(value: string | null): string | null {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\s\\]/.test(value)) return null
  try {
    const url = new URL(value, LOCAL_ORIGIN)
    if (url.origin !== LOCAL_ORIGIN || !RETURN_ROUTES.has(url.pathname)) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function loginUrl(target: string): string {
  return `/login?next=${encodeURIComponent(safeReturnTarget(target) ?? '/editor')}`
}

export function redirectToLogin(target: string): void {
  window.location.replace(loginUrl(target))
}

export function postLoginTarget(search: string): string {
  const target = safeReturnTarget(new URLSearchParams(search).get('next'))
  if (target) return target
  const feature = requestedAIFeature(search)
  return feature ? `/editor?ai=${feature}` : '/editor'
}

export function loginDestinationLabel(search: string): string {
  const target = postLoginTarget(search).split(/[?#]/)[0]
  const labels: Record<string, string> = { '/api': 'the API workspace', '/api-keys': 'API Keys & credits',
    '/toolkit': 'the toolkit', '/membership': 'Membership & billing', '/jobs': 'Jobs & downloads' }
  return labels[target] ?? 'the editor'
}
