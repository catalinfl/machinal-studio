import { hasCurrentStorageAcknowledgment, storageAcknowledgment, STORAGE_NOTICE_KEY } from '../lib/browser-storage'

function createPrivacyNotice() {
  let view = $state<'closed' | 'notice' | 'details'>('closed')
  let persistence = $state<'available' | 'unavailable'>('available')

  function restore(): void {
    try {
      view = hasCurrentStorageAcknowledgment(localStorage.getItem(STORAGE_NOTICE_KEY)) ? 'closed' : 'notice'
    } catch {
      persistence = 'unavailable'
      view = 'notice'
    }
  }

  function initialize(): () => void {
    restore()
    const sync = (event: StorageEvent) => {
      if ((event.key === STORAGE_NOTICE_KEY || event.key === null) && view !== 'details') restore()
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }

  function acknowledge(): void {
    try {
      localStorage.setItem(STORAGE_NOTICE_KEY, storageAcknowledgment())
      persistence = 'available'
    } catch {
      persistence = 'unavailable'
    }
    view = 'closed'
  }

  function open(): void { view = 'details' }

  return {
    initialize,
    acknowledge,
    open,
    get view() { return view },
    get persistence() { return persistence },
  }
}

export const privacyNotice = createPrivacyNotice()
