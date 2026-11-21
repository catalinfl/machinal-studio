import { createRecipeAction, type RecipeAction, type RecipeActionKind } from '../lib/recipe-action-fields'
import { inspectRecipeActions, nextRecipeActionID, removeRecipeAction, saveRecipeAction, type RecipeActionEntry, type RecipeActionRef } from '../lib/recipe-actions'

type ActionEditorState =
  | { kind: 'choosing'; message?: string }
  | { kind: 'editing'; action: RecipeAction; ref: RecipeActionRef | null; error: string | null }

type RecipeSource = { read: () => string; write: (source: string) => void; start: () => number }

export function useRecipeActions(source: RecipeSource) {
  let state = $state<ActionEditorState>({ kind: 'choosing' })
  const inspection = $derived(inspectRecipeActions(source.read()))

  function reset(): void {
    state = { kind: 'choosing' }
  }

  function add(kind: RecipeActionKind): void {
    if (inspection.error) return
    state = { kind: 'editing', action: createRecipeAction(kind, nextRecipeActionID(source.read(), kind), source.start()), ref: null, error: null }
  }

  function edit(entry: RecipeActionEntry): void {
    state = { kind: 'editing', action: structuredClone(entry.action), ref: entry.ref, error: null }
  }

  function save(event: SubmitEvent): void {
    event.preventDefault()
    if (state.kind !== 'editing') return
    const editing = state
    try {
      source.write(saveRecipeAction(source.read(), $state.snapshot(editing.action), editing.ref))
      state = { kind: 'choosing', message: 'Action saved. Apply the recipe when you are ready to run it.' }
    } catch (error) {
      state = { ...editing, error: error instanceof Error ? error.message : 'The action could not be saved.' }
    }
  }

  function remove(ref: RecipeActionRef): void {
    try {
      source.write(removeRecipeAction(source.read(), ref))
      state = { kind: 'choosing', message: 'Action removed from this recipe.' }
    } catch (error) {
      state = { kind: 'choosing', message: error instanceof Error ? error.message : 'The action could not be removed.' }
    }
  }

  return {
    reset,
    add,
    edit,
    save,
    remove,
    get state() { return state },
    get inspection() { return inspection },
    get editing() { return state.kind === 'editing' },
  }
}
