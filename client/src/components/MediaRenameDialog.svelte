<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { MEDIA_NAME_MAX_LENGTH } from '../lib/media-bin'
  import type { MediaItem } from '../lib/media-item'
  import WorkbenchDialog from './WorkbenchDialog.svelte'

  type Props = {
    item: MediaItem
    processing: boolean
    onRename: (name: string) => void
    onClose: () => void
  }

  let { item, processing, onRename, onClose }: Props = $props()
  const id = $props.id()
  let draft = $state({ value: untrack(() => item.displayName), error: '' })
  let nameInput: HTMLInputElement | undefined

  onMount(() => {
    nameInput?.focus()
    nameInput?.select()
  })

  function saveRename(event: SubmitEvent): void {
    event.preventDefault()
    if (processing || !draft.value.trim()) return
    try {
      onRename(draft.value)
      onClose()
    } catch (cause) {
      draft.error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function handleNameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
</script>

<WorkbenchDialog {id} ariaLabel="Rename media" title="Rename media" width="compact" {onClose}>
  <form class="rename-form" onsubmit={saveRename}>
    <div class="rename-fields">
      <label for={`${id}-name`}>Name in this project</label>
      <input
        id={`${id}-name`}
        bind:this={nameInput}
        bind:value={draft.value}
        maxlength={MEDIA_NAME_MAX_LENGTH}
        aria-label={`Project name for ${item.fileName}`}
        aria-invalid={!!draft.error}
        aria-describedby={`${id}-help${draft.error ? ` ${id}-error` : ''}`}
        onkeydown={handleNameKeydown}
        oninput={() => { draft.error = '' }}
        disabled={processing}
      />
      <p id={`${id}-help`} class="rename-help">Name in this project only. Original file unchanged.</p>
      {#if draft.error}<p id={`${id}-error`} class="rename-error" role="alert">{draft.error}</p>{/if}
      <dl class="original-file">
        <dt>Original file</dt>
        <dd>{item.fileName}</dd>
      </dl>
    </div>
    <footer class="dialog-foot rename-actions">
      <button type="button" class="secondary" aria-label="Cancel media rename" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" aria-label="Save media name" disabled={processing || !draft.value.trim()}>Save name</button>
    </footer>
  </form>
</WorkbenchDialog>

<style>
  .rename-form { min-width: 0; }
  .rename-fields { display: grid; gap: var(--space-4); padding: var(--space-12); }
  label { font-size: var(--text-sm); font-weight: var(--weight-medium); }
  input { width: 100%; min-width: 0; min-height: 44px; padding: var(--space-6); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--input); color: var(--foreground); font: var(--text-md) / 1.5 var(--font-sans); }
  .rename-help, .rename-error { margin: 0; font-size: var(--text-xs); line-height: 1.65; }
  .rename-help { color: var(--muted-foreground); }
  .rename-error { color: var(--destructive); overflow-wrap: anywhere; }
  .original-file { display: grid; gap: var(--space-2); min-width: 0; margin: var(--space-8) 0 0; padding-top: var(--space-8); border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: var(--text-xs); line-height: 1.65; }
  dt { font-weight: var(--weight-medium); }
  dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
  .rename-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-4); padding: var(--space-8) var(--space-12); border-top: 1px solid var(--border); }
  button { min-height: var(--height-control-lg); padding: var(--space-4) var(--space-8); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--foreground); font: var(--weight-medium) var(--text-sm) / 1.4 var(--font-sans); cursor: pointer; }
  .secondary:hover { background: var(--surface-elevated); }
  .primary { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); }
  .primary:hover:not(:disabled) { background: var(--primary-hover); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  :is(input, button):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  @media (max-width: 600px) { .rename-fields { padding: var(--space-8); } }
</style>
