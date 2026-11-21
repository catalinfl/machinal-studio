import { dismissWelcome, getOpenRouterStatus, saveOpenRouterKey, welcomeDismissed } from '../lib/openrouter-settings'

type View = { kind: 'closed' } | { kind: 'welcome' | 'settings'; configured: boolean }
type Phase = { kind: 'idle' | 'checking' | 'saving' | 'saved' } | { kind: 'error'; message: string }

class OpenRouterSetup {
  view = $state<View>({ kind: 'closed' })
  phase = $state<Phase>({ kind: 'idle' })
  draft = $state({ apiKey: '', visible: false })
  #initialized = false
  #controller: AbortController | null = null

  get busy(): boolean {
    return this.phase.kind === 'checking' || this.phase.kind === 'saving'
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return
    this.#initialized = true
    if (welcomeDismissed()) return
    await this.check('welcome')
  }

  async openSettings(): Promise<void> {
    this.#initialized = true
    this.draft = { apiKey: '', visible: false }
    await this.check('settings')
  }

  async check(kind: 'welcome' | 'settings'): Promise<void> {
    this.#controller?.abort()
    const controller = new AbortController()
    this.#controller = controller
    this.phase = { kind: 'checking' }
    if (kind === 'settings') this.view = { kind, configured: false }
    try {
      const status = await getOpenRouterStatus(controller.signal)
      if (controller.signal.aborted) return
      if (kind === 'welcome' && status.configured) {
        dismissWelcome()
        this.view = { kind: 'closed' }
      } else {
        this.view = { kind, configured: status.configured }
      }
      this.phase = { kind: 'idle' }
    } catch {
      if (controller.signal.aborted) return
      this.view = { kind, configured: false }
      this.phase = { kind: 'error', message: 'Could not connect to the local API. Start it and try again, or continue without AI.' }
    }
  }

  editKey(): void {
    if (this.phase.kind === 'error') this.phase = { kind: 'idle' }
  }

  async save(): Promise<void> {
    if (this.busy || this.view.kind === 'closed') return
    const key = this.draft.apiKey.trim()
    if (!/^sk-or-\S+$/.test(key) || key.length > 512) {
      this.phase = { kind: 'error', message: 'Paste an OpenRouter API key beginning with sk-or-.' }
      return
    }
    const controller = new AbortController()
    this.#controller = controller
    this.phase = { kind: 'saving' }
    try {
      const status = await saveOpenRouterKey(key, controller.signal)
      if (controller.signal.aborted) return
      if (!status.configured) throw new Error('The key was not saved. Try again.')
      this.view = { ...this.view, configured: true }
      this.draft = { apiKey: '', visible: false }
      this.phase = { kind: 'saved' }
      dismissWelcome()
    } catch (error) {
      if (controller.signal.aborted) return
      this.phase = {
        kind: 'error',
        message: error instanceof Error && error.name === 'TimeoutError' ? 'The connection check timed out. Try again.'
          : error instanceof TypeError ? 'Could not reach the API. Check your connection and try again.'
          : error instanceof Error ? error.message : 'Could not save the key. Try again.',
      }
    }
  }

  close(): void {
    if (this.phase.kind === 'saving') return
    this.#controller?.abort()
    dismissWelcome()
    this.view = { kind: 'closed' }
    this.draft = { apiKey: '', visible: false }
    this.phase = { kind: 'idle' }
  }
}

export const openRouterSetup = new OpenRouterSetup()
