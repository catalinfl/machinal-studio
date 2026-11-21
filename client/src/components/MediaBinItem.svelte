<script lang="ts">
  import type { Action } from 'svelte/action'
  import { formatMediaDuration, mediaKindLabel, type MediaItem } from '../lib/media-item'
  import MediaRenameDialog from './MediaRenameDialog.svelte'

  type Props = {
    item: MediaItem
    mediaProcessingActive: boolean
    selecting: boolean
    selected: boolean
    selectable: boolean
    observePreview: Action<HTMLElement, MediaItem>
    onToggleSelect: (event: MouseEvent) => void
    onTogglePreview: (event: MouseEvent) => void
    onAppendToTimeline: (event: MouseEvent) => void
    onDragStart: (event: DragEvent) => void
    onRename: (name: string) => void
  }

  let { item, mediaProcessingActive, selecting, selected, selectable, observePreview, onToggleSelect, onTogglePreview, onAppendToTimeline, onDragStart, onRename }: Props = $props()
  let renaming = $state(false)
  let renameButton = $state<HTMLButtonElement>()
  const draggable = $derived(item.state === 'ready' && !mediaProcessingActive && !selecting && !renaming)

  function closeRename(): void {
    renaming = false
    queueMicrotask(() => { if (renameButton?.isConnected) renameButton.focus() })
  }
</script>

<div class="card media-item {item.state}" class:draggable class:selected={selected} use:observePreview={item} {draggable} ondragstart={onDragStart} role="listitem" aria-label={`Clip ${item.displayName}${item.state === 'ready' ? '' : `, ${item.state}`}`}>
  {#if selecting}
    <button type="button" class="selection-target" disabled={!selectable} aria-pressed={selected} aria-label={selected ? `Deselect ${item.displayName}` : `Select ${item.displayName} for deletion`} title={selectable ? 'Select for deletion' : 'Finish importing before selecting'} onclick={onToggleSelect}></button>
  {/if}
  <div class="thumb">
    {#if selecting}
      <span class="select-check" class:checked={selected} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m4.5 10.5 4 4 7-8" /></svg></span>
    {:else if item.isRender || item.generated}
      <span class="media-tag" title={item.isRender ? 'Final export kept on the server after logout' : 'AI-generated media'}>{item.isRender ? 'Render' : 'AI'}</span>
    {/if}
    {#if item.state === 'ready' && item.previewState === 'skipped'}
      <div class="ph" title="The duration of this video is unknown. Add it to the timeline to view it.">No preview</div>
    {:else if item.state === 'ready' && (item.blobUrl || item.scene)}
      <button type="button" class="preview-button" disabled={selecting} onclick={onTogglePreview} aria-label={`Preview ${item.displayName}`} title="Preview media">
        {#if item.scene}
          <span class="ph scene-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="6" width="24" height="20" rx="2" /><path d="M4 12h24M10 6l4 6M18 6l4 6m-9 5 7 4-7 4z" /></svg>Live scene</span>
        {:else if item.thumbnailUrl}
          <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => { item.thumbnailUrl = null }} />
        {:else if item.mediaKind === 'image' && item.mode === 'wasm'}
          <img src={item.blobUrl} alt="" loading="lazy" decoding="async" draggable="false" />
        {:else if item.mediaKind === 'audio'}
          <span class="audio-mark"><svg viewBox="0 0 64 32" aria-hidden="true"><path d="M5 13v6m6-10v14m6-17v20m6-22v24m6-17v10m6-19v28m6-22v16m6-19v22m6-15v8m6-5v2" /></svg></span>
        {:else if item.mode === 'wasm'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={item.blobUrl} muted preload="metadata" playsinline draggable="false"></video>
        {:else}<span class="ph">Preview</span>{/if}
        {#if !selecting}<span class="preview-glyph"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5z" /></svg></span>{/if}
      </button>
    {:else if item.state === 'ready' && item.mode === 'proxy' && (item.previewState === 'idle' || item.previewState === 'loading')}
      <div class="skel-thumb" aria-hidden="true"></div>
    {:else if item.state === 'ready'}
      <div class="ph">{mediaKindLabel(item)} source</div>
    {:else if item.state === 'loading' || item.state === 'scrubbing'}
      <div class="ph"><span class="spinner" aria-hidden="true"></span>Importing</div>
    {:else if item.state === 'error'}
      <div class="ph error" title={item.errorMsg}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6v5M10 14h.01" /></svg>Import failed</div>
    {/if}
    {#if item.state === 'ready' && item.mediaKind !== 'image'}<span class="dur">{formatMediaDuration(item.duration)}</span>{/if}
  </div>
  <div class="info">
    <div class="media-name-row">
      <span class="name" title={item.displayName === item.fileName ? item.fileName : `${item.displayName} (${item.fileName})`}>{item.displayName}</span>
      {#if !selecting}
        <button type="button" class="media-name-action rename-button" bind:this={renameButton} disabled={mediaProcessingActive || item.state !== 'ready'} aria-label={`Rename ${item.displayName}`} aria-haspopup="dialog" title="Rename in this project" onclick={() => { renaming = true }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 3.5 4 4M4 12l9-9a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-9 9-5 1z" /></svg></button>
      {/if}
    </div>
    <div class="media-item-detail">
      <span class="item-meta">{mediaKindLabel(item)} <span aria-hidden="true">·</span> {item.mode === 'wasm' ? 'Local' : 'Server'}</span>
      {#if !selecting}
        <button type="button" class="append-button" disabled={mediaProcessingActive || item.state !== 'ready'} aria-label={`Append ${item.displayName} to timeline`} title="Add to timeline" onclick={onAppendToTimeline}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
      {/if}
    </div>
    {#if item.state === 'error' && item.errorMsg}<span class="item-error">{item.errorMsg}</span>{/if}
  </div>
</div>

{#if renaming && !selecting}
  <MediaRenameDialog {item} processing={mediaProcessingActive} {onRename} onClose={closeRename} />
{/if}
