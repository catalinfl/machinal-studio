type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; ratio: number; message: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

type Progress = (ratio: number, message: string) => void

export function useWasmLoader(load: (progress: Progress) => Promise<unknown>, onProgress: Progress) {
  let state = $state<LoadState>({ kind: 'idle' })
  let inFlight: Promise<void> | null = null
  let generation = 0

  function ensure(): Promise<void> {
    if (state.kind === 'ready') return Promise.resolve()
    if (inFlight) return inFlight
    const attempt = ++generation
    state = { kind: 'loading', ratio: 0, message: '' }
    // Defer invocation so even a synchronous loader failure clears the shared slot.
    inFlight = Promise.resolve().then(() => load((ratio, message) => {
      if (generation !== attempt || state.kind !== 'loading') return
      state = { kind: 'loading', ratio, message }
      onProgress(ratio, message)
    })).then(() => {
      state = { kind: 'ready' }
    }).catch((cause: unknown) => {
      state = { kind: 'error', message: cause instanceof Error ? cause.message : String(cause) }
    }).finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    ensure,
    get state() { return state.kind },
    get ratio() { return state.kind === 'loading' ? state.ratio : state.kind === 'ready' ? 1 : 0 },
    get message() { return state.kind === 'loading' ? state.message : '' },
    get error() { return state.kind === 'error' ? state.message : '' },
  }
}
