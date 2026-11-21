import { describe, expect, it, vi } from 'vitest'
import { useEditorHistory } from '../../composables/useEditorHistory.svelte'

function fixture() {
  let value = 0
  let revision = 0
  const changed = vi.fn()
  const history = useEditorHistory({
    capture: () => ({ value }),
    restore: snapshot => { value = snapshot.value },
    beforeCommit: vi.fn(), changed,
    getRevision: () => revision,
    setRevision: next => { revision = next },
  })
  return {
    history, changed,
    edit(next: number) { history.record(); value = next },
    get value() { return value },
    get revision() { return revision },
  }
}

describe('editor history lifecycle', () => {
  it('groups same-turn changes and exposes pending undo synchronously', async () => {
    const state = fixture()
    state.edit(1)
    state.edit(2)
    expect(state.history.canUndo).toBe(true)
    await Promise.resolve()
    expect(state.changed).toHaveBeenCalledTimes(1)
    expect(state.history.undo()).toBe(true)
    expect(state.value).toBe(0)
    expect(state.history.undo()).toBe(false)
    expect(state.history.redo()).toBe(true)
    expect(state.value).toBe(2)
  })

  it('clears pending microtasks without resurrecting old history', async () => {
    const state = fixture()
    state.edit(1)
    state.history.clear()
    await Promise.resolve()
    expect(state.history.canUndo).toBe(false)
    expect(state.changed).not.toHaveBeenCalled()
  })

  it('rolls back a failed nested transaction, preserving the outer edit and revision', () => {
    const state = fixture()
    state.history.transaction(() => {
      state.edit(1)
      const revision = state.revision
      expect(() => state.history.transaction(() => { state.edit(2); throw new Error('failed') })).toThrow('failed')
      expect(state.value).toBe(1)
      expect(state.revision).toBe(revision)
      state.edit(3)
    })
    expect(state.history.undo()).toBe(true)
    expect(state.value).toBe(0)
    expect(state.history.redo()).toBe(true)
    expect(state.value).toBe(3)
  })

  it('cancels a drag without recording it and keeps instances isolated', () => {
    const state = fixture()
    const other = fixture()
    state.history.begin()
    state.edit(5)
    state.history.cancel()
    expect(state.value).toBe(0)
    expect(state.history.canUndo).toBe(false)
    expect(other.revision).toBe(0)
  })

  it('does not discard redo for a no-op but clears it for a real edit', async () => {
    const state = fixture()
    state.edit(1)
    state.history.undo()
    state.edit(0)
    await Promise.resolve()
    expect(state.history.canRedo).toBe(true)
    state.edit(2)
    await Promise.resolve()
    expect(state.history.canRedo).toBe(false)
  })

  it('bounds history to the latest 100 committed changes', () => {
    const state = fixture()
    for (let value = 1; value <= 105; value++) state.history.transaction(() => state.edit(value))
    let count = 0
    while (state.history.undo()) count++
    expect(count).toBe(100)
    expect(state.value).toBe(5)
  })
})
