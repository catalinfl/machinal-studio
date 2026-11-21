import { describe, it, expect } from 'vitest'
import { hasCurrentStorageAcknowledgment, storageAcknowledgment, STORAGE_NOTICE_LIFETIME } from '../../lib/browser-storage'

describe('storage notice acknowledgment', () => {
  const now = Date.UTC(2026, 10, 1)

  it('accepts a current version without recording tracking consent', () => {
    const stored = storageAcknowledgment(now)
    expect(hasCurrentStorageAcknowledgment(stored, now)).toBe(true)
    expect(JSON.parse(stored)).toEqual({ version: 1, acknowledgedAt: now })
  })

  it('expires after 180 days and rejects future or old-version entries', () => {
    expect(hasCurrentStorageAcknowledgment(storageAcknowledgment(now - STORAGE_NOTICE_LIFETIME + 1), now)).toBe(true)
    expect(hasCurrentStorageAcknowledgment(storageAcknowledgment(now - STORAGE_NOTICE_LIFETIME), now)).toBe(false)
    expect(hasCurrentStorageAcknowledgment(storageAcknowledgment(now + 1), now)).toBe(false)
    expect(hasCurrentStorageAcknowledgment(JSON.stringify({ version: 0, acknowledgedAt: now }), now)).toBe(false)
  })

  it.each([null, '', '{broken', 'null', '[]', 'true', '42', '{"version":1}', '{"version":1,"acknowledgedAt":"today"}'])('rejects invalid data: %s', value => {
    expect(hasCurrentStorageAcknowledgment(value, now)).toBe(false)
  })
})
