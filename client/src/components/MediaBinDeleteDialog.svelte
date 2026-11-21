<script lang="ts">
  import type { useMediaBin } from '../composables/useMediaBin.svelte'

  let { bin }: { bin: ReturnType<typeof useMediaBin> } = $props()
  let dialog: HTMLDialogElement | undefined
  let keepButton: HTMLButtonElement | undefined
  const title = $derived(`Delete ${bin.pendingDelete.length} ${bin.pendingDelete.length === 1 ? 'file' : 'files'}?`)
  const confirmLabel = $derived(bin.deleting ? 'Deleting…' : bin.pendingProxyCount > 0 ? bin.pendingLocalCount > 0 ? 'Delete files' : 'Delete permanently' : 'Remove from session')

  const description = $derived.by(() => {
    const proxy = bin.pendingProxyCount
    const local = bin.pendingLocalCount
    const serverFiles = `${proxy} ${proxy === 1 ? 'file' : 'files'}`
    const localFiles = `${local} ${local === 1 ? 'file' : 'files'}`
    if (proxy > 0 && local > 0) return `Permanently delete ${serverFiles} from server storage and remove ${local} browser-local ${local === 1 ? 'file' : 'files'} from this session? Server files cannot be recovered.`
    if (proxy > 0) return `Permanently delete ${serverFiles} from server storage? This cannot be undone.`
    return `Remove ${localFiles} from this session? The originals stay on your device and can be re-imported.`
  })

  $effect(() => {
    if (!dialog || dialog.open) return
    dialog.showModal()
    keepButton?.focus()
  })
</script>

<dialog bind:this={dialog} class="delete-dialog media-delete-dialog" data-width="compact" role="alertdialog" aria-labelledby="media-delete-title" aria-describedby="media-delete-desc" oncancel={event => { event.preventDefault(); bin.cancelDelete() }}>
  <h2 id="media-delete-title">{title}</h2>
  <p id="media-delete-desc">{description}</p>
  <ul class="delete-list" aria-label="Files to delete">
    {#each bin.pendingDelete as item (item.fileName + item.mode)}
      <li><span title={item.displayName}>{item.displayName}</span><small>{item.mode === 'proxy' ? 'Server volume' : 'This session'}</small></li>
    {/each}
  </ul>
  <div class="delete-actions">
    <button type="button" bind:this={keepButton} onclick={bin.cancelDelete} disabled={bin.deleting}>Keep files</button>
    <button type="button" class="delete-confirm" onclick={bin.confirmDelete} disabled={bin.deleting}>{confirmLabel}</button>
  </div>
</dialog>
