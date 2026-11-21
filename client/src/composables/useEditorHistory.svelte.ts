interface HistoryOptions<T> {
  capture: () => T
  restore: (snapshot: T) => void
  beforeCommit: () => void
  changed: () => void
  getRevision: () => number
  setRevision: (revision: number) => void
}

const HISTORY_LIMIT = 100

export function useEditorHistory<T>(options: HistoryOptions<T>) {
  let undoStack = $state.raw<T[]>([])
  let redoStack = $state.raw<T[]>([])
  let pending = $state.raw<T | null>(null)
  let pendingToken = 0
  let depth = 0
  let transactionSnapshot: T | null = null

  function commit(snapshot: T | null) {
    if (snapshot === null || JSON.stringify(snapshot) === JSON.stringify(options.capture())) return
    options.beforeCommit()
    undoStack = [...undoStack.slice(-(HISTORY_LIMIT - 1)), snapshot]
    redoStack = []
    options.changed()
  }

  function flushPending() {
    const snapshot = pending
    pending = null
    pendingToken += 1
    commit(snapshot)
  }

  function finishActive() {
    if (depth > 0) {
      depth = 0
      const snapshot = transactionSnapshot
      transactionSnapshot = null
      commit(snapshot)
    }
    flushPending()
  }

  function record() {
    options.setRevision(options.getRevision() + 1)
    if (depth > 0) {
      transactionSnapshot ??= options.capture()
      return
    }
    if (pending !== null) return
    pending = options.capture()
    const token = ++pendingToken
    queueMicrotask(() => {
      if (token === pendingToken) flushPending()
    })
  }

  function begin() {
    if (depth === 0) flushPending()
    depth += 1
  }

  function end() {
    if (depth === 0) return
    depth -= 1
    if (depth !== 0) return
    const snapshot = transactionSnapshot
    transactionSnapshot = null
    commit(snapshot)
  }

  function cancel() {
    if (depth === 0) return
    const snapshot = transactionSnapshot
    depth = 0
    transactionSnapshot = null
    if (snapshot !== null) options.restore(snapshot)
  }

  function transaction<Result>(action: () => Result): Result {
    const savepoint = options.capture()
    const revision = options.getRevision()
    const previousDepth = depth
    const previousSnapshot = transactionSnapshot
    begin()
    try {
      const result = action()
      end()
      return result
    } catch (error) {
      depth = previousDepth
      transactionSnapshot = previousSnapshot
      options.restore(savepoint)
      options.setRevision(revision)
      throw error
    }
  }

  function clear() {
    undoStack = []
    redoStack = []
    pending = null
    transactionSnapshot = null
    depth = 0
    pendingToken += 1
  }

  function undo(): boolean {
    finishActive()
    const snapshot = undoStack.at(-1)
    if (snapshot === undefined) return false
    undoStack = undoStack.slice(0, -1)
    redoStack = [...redoStack, options.capture()]
    options.restore(snapshot)
    options.setRevision(options.getRevision() + 1)
    options.changed()
    return true
  }

  function redo(): boolean {
    finishActive()
    const snapshot = redoStack.at(-1)
    if (snapshot === undefined) return false
    redoStack = redoStack.slice(0, -1)
    undoStack = [...undoStack, options.capture()]
    options.restore(snapshot)
    options.setRevision(options.getRevision() + 1)
    options.changed()
    return true
  }

  return {
    record,
    begin,
    end,
    cancel,
    transaction,
    clear,
    undo,
    redo,
    get canUndo() { return undoStack.length > 0 || pending !== null },
    get canRedo() { return redoStack.length > 0 },
  }
}
