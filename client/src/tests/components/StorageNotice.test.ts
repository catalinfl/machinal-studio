import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte'
import StorageNotice from '../../components/legal/StorageNotice.svelte'
import { privacyNotice } from '../../stores/privacy.svelte'
import { STORAGE_NOTICE_KEY, storageAcknowledgment } from '../../lib/browser-storage'

describe('StorageNotice', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('is non-modal and does not pretend to collect optional consent', async () => {
    const screen = render(StorageNotice)
    expect(await screen.findByRole('complementary', { name: 'Cookies & local storage' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept all|reject/i })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    expect(screen.getByText(/Closing this notice is not consent/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('persists dismissal without removing media or draft data', async () => {
    localStorage.setItem('scrub-text-to-speech-draft', 'keep my text')
    const screen = render(StorageNotice)
    await fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))
    expect(localStorage.getItem(STORAGE_NOTICE_KEY)).toContain('acknowledgedAt')
    expect(localStorage.getItem('scrub-text-to-speech-draft')).toBe('keep my text')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('stays dismissed on mount and can be reopened', async () => {
    localStorage.setItem(STORAGE_NOTICE_KEY, storageAcknowledgment())
    const screen = render(StorageNotice)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    privacyNotice.open()
    expect(await screen.findByRole('button', { name: 'Close notice' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Full storage policy' })).toHaveAttribute('href', '/cookies')
  })

  it('can close for the visit when browser persistence is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const screen = render(StorageNotice)
    await fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))
    privacyNotice.open()
    expect(await screen.findByRole('status')).toHaveTextContent('blocking saved preferences')
    await fireEvent.click(screen.getByRole('button', { name: 'Close notice' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('synchronizes dismissal from another tab', async () => {
    const screen = render(StorageNotice)
    await screen.findByRole('complementary')
    localStorage.setItem(STORAGE_NOTICE_KEY, storageAcknowledgment())
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_NOTICE_KEY }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
  })
})
