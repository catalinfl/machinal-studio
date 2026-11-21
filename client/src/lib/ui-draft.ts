export function loadUIDraft(key: string): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function saveUIDraft(key: string, value: Record<string, unknown>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A full or unavailable storage area must not block the editor workflow.
  }
}
