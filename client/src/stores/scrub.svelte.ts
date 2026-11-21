import { pb } from '../lib/pocketbase'

export type ScrubMode = 'proxy' | 'wasm'

// When logged in, server scrub is home base: the Server tab leads and uploads
// go to the server volume. Logged out, only browser-local scrub works. The
// persisted PocketBase session restores synchronously, so the default follows
// it; login/logout transitions while the bin is mounted are handled by
// useMediaBin via scrubModeAfterAuthChange.
function defaultScrubMode(): ScrubMode {
  try {
    return pb.authStore.isValid ? 'proxy' : 'wasm'
  } catch {
    return 'wasm'
  }
}

let mode = $state<ScrubMode>(defaultScrubMode())

// Pure transition for auth changes: follow the account, but never override an
// explicit in-session choice (wasm picked while logged in, or proxy left open
// while logged out, both stay as the user left them).
export function scrubModeAfterAuthChange(current: ScrubMode, wasLogged: boolean, isLogged: boolean): ScrubMode {
  if (wasLogged === isLogged) return current
  if (isLogged) return current === 'wasm' ? 'proxy' : current
  return current === 'proxy' ? 'wasm' : current
}

export const scrubSettings = {
  get mode() { return mode },
  setMode(next: ScrubMode) { mode = next },
}
