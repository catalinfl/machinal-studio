import { onDestroy } from 'svelte'
import { applyDocument, currentProject, currentTimeline, downloadCompositionInput, downloadProjectSource, editorAssets } from '../lib/compositions'
import { availableProjectAssets, bindAssetInProjectSource, parseProjectFile, projectFile } from '../lib/composition-file'
import { snapshotTimeline } from '../lib/composition-adapter'
import { generalizeDocument, starterRecipe, type RecipeStarter } from '../lib/composition-recipes'
import { MAX_PROJECT_BYTES, type CompositionInput, type EditDocument } from '../lib/composition-types'
import { editor } from '../stores/editor.svelte'
import { useRecipeActions } from './useRecipeActions.svelte'
import { withRecipeDefinition } from '../lib/recipe-actions'
import { hasPendingGeneration } from '../lib/composition-jobs'
import { parseDocument } from 'yaml'

type State = { kind: 'idle' } | { kind: 'compiling' } | { kind: 'saving' } | { kind: 'done'; summary: string } | { kind: 'error'; message: string }

function projectDraft(project: CompositionInput, origin: 'timeline' | 'staged' = 'timeline') {
  return { source: projectFile(project), origin }
}

export function useCompositionMenu() {
  let dialog = $state<HTMLDialogElement>()
  let draft = $state(projectDraft(currentProject()))
  let state = $state<State>({ kind: 'idle' })
  let starter = $state<RecipeStarter>('look')
  let view = $state<'actions' | 'code'>('actions')
  let controller: AbortController | null = null
  const busy = $derived(state.kind === 'compiling' || state.kind === 'saving')

  const actions = useRecipeActions({
    read: () => draft.source,
    write: updateSource,
    start: () => editor.currentTime,
  })

  function updateSource(source: string): void {
    if (source === draft.source) return
    draft = { ...draft, source, origin: 'staged' }
    state = { kind: 'idle' }
  }

  function useTimeline(): void {
    draft = projectDraft(currentProject())
    state = { kind: 'idle' }
    actions.reset()
  }

  function useRecipe(): void {
    const project = currentProject()
    if (!project.recipe) return
    const recipe = typeof project.recipe === 'string' ? project.recipe : $state.snapshot(project.recipe)
    draft = projectDraft({ ...project, document: recipe, recipe: undefined,
      bindings: typeof recipe !== 'string' && recipe.mode === 'modify' ? {} : project.bindings }, 'staged')
    state = { kind: 'idle' }
    actions.reset()
  }

  function generalize(): void {
    const project = currentProject()
    const snapshot = snapshotTimeline(currentTimeline(), editorAssets(), '')
    const tracks = editor.documentSession?.composition.tracks ?? snapshot.tracks
    const document = generalizeDocument({ ...project.document, tracks, effects: snapshot.effects })
    draft = projectDraft({ ...project, document, recipe: undefined, bindings: {} }, 'staged')
    state = { kind: 'idle' }
    actions.reset()
    view = 'code'
  }

  function useStarter(): void {
    const project = currentProject()
    const document = starterRecipe(starter, project.document.output)
    draft = projectDraft({ ...project, document, recipe: undefined, bindings: {} }, 'staged')
    state = { kind: 'idle' }
    actions.reset()
    view = starter === 'look' ? 'code' : 'actions'
  }

  function open(): void {
    if (draft.origin === 'timeline') useTimeline()
    else actions.reset()
    view = 'actions'
    dialog?.showModal()
  }

  function close(): void {
    controller?.abort()
    dialog?.close()
    state = { kind: 'idle' }
    actions.reset()
  }

  async function importFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Project exceeds 128 MiB')
      draft = projectDraft(parseProjectFile(await file.text(), editorAssets()), 'staged')
      state = { kind: 'idle' }
      actions.reset()
    } catch (error) {
      state = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
    } finally {
      input.value = ''
    }
  }

  async function apply(): Promise<void> {
    if (busy || actions.editing) return
    actions.reset()
    const currentController = new AbortController()
    controller = currentController
    state = { kind: 'compiling' }
    try {
      const project = draftInput()
      const result = await applyDocument(project, currentController.signal)
      draft = projectDraft({ document: result.document!, bindings: project.bindings,
        recipe: project.recipe, assets: result.composition!.assets, preparedText: result.composition!.preparedText })
      state = { kind: 'done', summary: result.summary }
    } catch (error) {
      if (controller === currentController && !currentController.signal.aborted) state = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  function availableDraftAssets() {
    const available = editorAssets()
    try {
      return availableProjectAssets(parseProjectFile(draft.source, available).assets, available)
    } catch {
      return available
    }
  }

  function draftInput(): CompositionInput {
    const project = parseProjectFile(draft.source, editorAssets())
    const document = project.document as EditDocument
    if (typeof document !== 'string' && document.version === 2 && document.mode === 'modify') {
      project.recipe = document
      project.bindings = {}
    }
    return withRecipeDefinition(project)
  }

  function bindAsset(assetId: string): void {
    try {
      updateSource(bindAssetInProjectSource(draft.source, assetId, availableDraftAssets()))
      state = { kind: 'idle' }
    } catch (error) {
      state = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  async function download(): Promise<void> {
    if (busy || actions.editing) return
    const currentController = new AbortController()
    controller = currentController
    state = { kind: 'saving' }
    try {
      const project = draftInput()
      const document = typeof project.document === 'string' ? parseDocument(project.document).toJS() as EditDocument : project.document
      if (hasPendingGeneration(document)) {
        downloadProjectSource(projectFile(project))
        state = { kind: 'done', summary: 'Recipe YAML saved. Pending actions have not been generated.' }
      } else {
        await downloadCompositionInput(project, currentController.signal)
        state = { kind: 'done', summary: 'YAML saved with editable text and prepared text images.' }
      }
    } catch (error) {
      if (!currentController.signal.aborted) state = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  onDestroy(() => controller?.abort())

  return {
    open,
    close,
    importFile,
    apply,
    download,
    useTimeline,
    useRecipe,
    generalize,
    useStarter,
    bindAsset,
    actions,
    get view() { return view },
    set view(value: 'actions' | 'code') { view = value },
    get busy() { return busy },
    get dialog() { return dialog },
    set dialog(value: HTMLDialogElement | undefined) { dialog = value },
    get draft() { return draft },
    get source() { return draft.source },
    set source(value: string) { updateSource(value) },
    get assets() { return availableDraftAssets() },
    get hasRecipe() { return Boolean(editor.documentSession?.recipe) },
    get starter() { return starter },
    set starter(value: RecipeStarter) { starter = value },
    get state() { return state },
  }
}
