<script lang="ts">
  import '../styles/media-library.css'
  import { mediaKindLabel, type MediaItem } from '../lib/media-item'
  import { useMediaBin } from '../composables/useMediaBin.svelte'
  import { auth } from '../stores/auth.svelte'
  import { loadUIDraft, saveUIDraft } from '../lib/ui-draft'
  import MediaBinToolbar from './MediaBinToolbar.svelte'
  import MediaBinEmpty from './MediaBinEmpty.svelte'
  import MediaBinDeleteDialog from './MediaBinDeleteDialog.svelte'
  import MediaBinItem from './MediaBinItem.svelte'
  import MediaPreviewDialog from './MediaPreviewDialog.svelte'
  import MediaImportStatus from './MediaImportStatus.svelte'

  const mediaBin = useMediaBin()
  let view = $state<'list' | 'grid'>(loadUIDraft('scrub-media-view').view === 'grid' ? 'grid' : 'list')
  const needsLogin = $derived(mediaBin.scrubMode === 'proxy' && !auth.isLogged)
  const showSkeletons = $derived(mediaBin.refreshing && mediaBin.items.length === 0 && !needsLogin)
  let previewOpener: HTMLButtonElement | null = null

  $effect(() => saveUIDraft('scrub-media-view', { view }))

  function openPreview(item: MediaItem): (event: MouseEvent) => void {
    const toggle = mediaBin.togglePreview(item)
    return event => {
      previewOpener = event.currentTarget as HTMLButtonElement
      toggle(event)
    }
  }

  function closePreview(): void {
    mediaBin.closePreview()
    const opener = previewOpener
    queueMicrotask(() => { if (opener?.isConnected) opener.focus() })
  }

  function handleSelectionKeydown(event: KeyboardEvent): void {
    if (!mediaBin.selecting) return
    if ((event.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (mediaBin.confirming) mediaBin.cancelDelete()
      else mediaBin.exitSelection()
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !mediaBin.confirming) {
      event.preventDefault()
      mediaBin.requestDelete()
    }
  }
</script>

<svelte:window onkeydown={handleSelectionKeydown} />

<aside id="media-bin-panel" class="mediabin media-library" aria-label="Media bin: drop or upload video, audio or image files" aria-busy={mediaBin.mediaProcessing.active || !!mediaBin.importProgress}>
  <MediaBinToolbar bin={mediaBin} {needsLogin} bind:view />
  {#if mediaBin.error}<div class="library-error" role="alert">{mediaBin.error}</div>{/if}
  {#if mediaBin.mediaProcessing.error}<div class="library-error" role="alert">{mediaBin.mediaProcessing.error}</div>{/if}
  {#if mediaBin.importProgress}<MediaImportStatus progress={mediaBin.importProgress} />{/if}

  <div id="media-bin-list" class="list" class:list-view={view === 'list'} bind:this={mediaBin.listEl} role="list">
    <MediaBinEmpty bin={mediaBin} {needsLogin} {showSkeletons} />
    {#if !needsLogin}
      {#each mediaBin.filteredItems as item (item.fileName + item.mode + item.scrubName)}
        <MediaBinItem
          {item}
          mediaProcessingActive={mediaBin.mediaProcessing.active}
          selecting={mediaBin.selecting}
          selected={mediaBin.isSelected(item)}
          selectable={mediaBin.isSelectable(item)}
          observePreview={mediaBin.observePreview}
          onToggleSelect={mediaBin.toggleSelect(item)}
          onTogglePreview={openPreview(item)}
          onAppendToTimeline={mediaBin.appendToTimeline(item)}
          onDragStart={mediaBin.writeTimelineDragPayload(item)}
          onRename={(name) => mediaBin.renameItem(item, name)}
        />
      {/each}
    {/if}
  </div>
  <footer class="library-foot">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12v10H4zM7 8h6M7 11h3" /></svg>
    <span>Drag to a track, or <strong>+</strong> to add</span>
  </footer>
</aside>

{#if mediaBin.previewItem && (mediaBin.previewItem.blobUrl || mediaBin.previewItem.scene)}
  <MediaPreviewDialog
    item={mediaBin.previewItem}
    kindLabel={mediaKindLabel}
    position={mediaBin.previewPosition}
    onClose={closePreview}
    onNavigate={mediaBin.navigatePreview}
    onAppendToTimeline={mediaBin.appendToTimeline(mediaBin.previewItem)}
    processing={mediaBin.mediaProcessing.active}
  />
{/if}

{#if mediaBin.confirming}<MediaBinDeleteDialog bin={mediaBin} />{/if}

{#if mediaBin.globalDrag && !needsLogin}
  <div class="media-drop-overlay" role="status" aria-live="polite">
    <div class="media-drop-target">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 19h14" /></svg>
      <h2>Add to your media library</h2>
      <p>Drop video, audio or image files here.</p>
    </div>
  </div>
{/if}
