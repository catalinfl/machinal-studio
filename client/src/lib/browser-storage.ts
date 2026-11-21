export const STORAGE_NOTICE_KEY = 'direction-storage-notice'
export const STORAGE_NOTICE_VERSION = 1
export const STORAGE_NOTICE_LIFETIME = 180 * 24 * 60 * 60 * 1000

type StorageAcknowledgment = {
  version: number
  acknowledgedAt: number
}

export function hasCurrentStorageAcknowledgment(raw: string | null, now = Date.now()): boolean {
  if (!raw) return false
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return false
    const entry = value as Partial<StorageAcknowledgment>
    return entry.version === STORAGE_NOTICE_VERSION
      && typeof entry.acknowledgedAt === 'number'
      && Number.isFinite(entry.acknowledgedAt)
      && entry.acknowledgedAt <= now
      && now - entry.acknowledgedAt < STORAGE_NOTICE_LIFETIME
  } catch {
    return false
  }
}

export function storageAcknowledgment(now = Date.now()): string {
  return JSON.stringify({ version: STORAGE_NOTICE_VERSION, acknowledgedAt: now })
}
