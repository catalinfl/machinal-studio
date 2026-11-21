export function normalizeAPIBase(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  return (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, '')
}

export const API_BASE = normalizeAPIBase(import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8080')
