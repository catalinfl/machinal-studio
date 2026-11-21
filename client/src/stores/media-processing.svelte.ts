let activeOperations = $state(0)
let longVideoOperations = $state(0)
let longMediaKind = $state<'audio' | 'video'>('video')
let error = $state<string | null>(null)
type MediaBinImportState =
  | { phase: 'idle' }
  | { phase: 'processing'; fileName: string }

let mediaBinImport = $state<MediaBinImportState>({ phase: 'idle' })

export const mediaProcessing = {
  get error() {
    return error
  },

  reportError(message: string) {
    error = message
  },

  get active() {
    return activeOperations > 0
  },

  get longVideoActive() {
    return longVideoOperations > 0
  },

  get longMediaKind() {
    return longMediaKind
  },

  get mediaBinImport() {
    return mediaBinImport
  },

  begin() {
    if (activeOperations === 0) error = null
    activeOperations += 1
  },

  end() {
    activeOperations = Math.max(0, activeOperations - 1)
  },

  beginLongVideo(kind: 'audio' | 'video' = 'video') {
    if (longVideoOperations === 0) longMediaKind = kind
    longVideoOperations += 1
  },

  endLongVideo() {
    longVideoOperations = Math.max(0, longVideoOperations - 1)
    if (longVideoOperations === 0) longMediaKind = 'video'
  },

  beginMediaBinImport(fileName: string) {
    mediaBinImport = { phase: 'processing', fileName }
  },

  endMediaBinImport() {
    mediaBinImport = { phase: 'idle' }
  },
}
