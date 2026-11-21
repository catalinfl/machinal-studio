<script lang="ts">
  import type { MediaItem } from '../lib/media-item'
  import LiveScenePreview from './LiveScenePreview.svelte'
  import MediaVideoPreview from './MediaVideoPreview.svelte'

  let { item, kindLabel, position, onClose, onNavigate, onAppendToTimeline, processing }: {
    item: MediaItem
    kindLabel: (item: MediaItem) => string
    position: { index: number; total: number }
    onClose: () => void
    onNavigate: (direction: -1 | 1) => void
    onAppendToTimeline: (event: MouseEvent) => Promise<void>
    processing: boolean
  } = $props()

  let dialog = $state<HTMLDialogElement>()

  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal()
  })

  function handleKeydown(event: KeyboardEvent): void {
    if ((event.target as Element).closest('video, audio, input, textarea')) return
    if (event.key === 'ArrowLeft' && position.index > 0) {
      event.preventDefault()
      onNavigate(-1)
    } else if (event.key === 'ArrowRight' && position.index < position.total - 1) {
      event.preventDefault()
      onNavigate(1)
    }
  }

</script>

<dialog bind:this={dialog} class="media-preview" aria-label={`Preview ${item.displayName}`} onclose={onClose} onkeydown={handleKeydown} oncancel={(event) => event.preventDefault()}>
  <div class="viewer">
    <header class="viewer-head">
      <div class="identity">
        <span class="kind">{kindLabel(item)} <span aria-hidden="true">·</span> {item.mode === 'wasm' ? 'Local' : 'Server'}</span>
        <h2 title={item.displayName}>{item.displayName}</h2>
      </div>
      <button type="button" class="icon-button close" aria-label="Close media preview" onclick={() => dialog?.close()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    <div class="stage">
      {#key `${item.mode}:${item.sourceId ?? item.fileName}:${item.blobUrl}`}
        {#if item.scene}<div class="live-scene"><LiveScenePreview source={item.scene} /></div>
        {:else if item.mediaKind === 'video'}
          <MediaVideoPreview src={item.blobUrl} width={item.sourceWidth} height={item.sourceHeight} />
        {:else if item.mediaKind === 'audio'}
          <div class="audio-stage">
            <svg viewBox="0 0 80 80" aria-hidden="true"><path d="M8 40h5m6-12v24m9-36v48m9-28v8m9-19v30m9-39v48m9-30v12m9-6h4" /></svg>
            <span>Audio source</span>
            <!-- svelte-ignore a11y_media_has_caption -->
            <audio src={item.blobUrl} controls preload="metadata"></audio>
          </div>
        {:else}
          <img src={item.blobUrl} alt={`Preview of ${item.displayName}`} />
        {/if}
      {/key}
    </div>
    <footer class="viewer-foot">
      <div class="pager" aria-label="Browse media previews">
        <button type="button" class="icon-button" aria-label="Previous media" disabled={position.index <= 0} onclick={() => onNavigate(-1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4-6 6 6 6" /></svg></button>
        <span aria-live="polite">{position.index + 1} / {position.total}</span>
        <button type="button" class="icon-button" aria-label="Next media" disabled={position.index >= position.total - 1} onclick={() => onNavigate(1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg></button>
      </div>
      <button type="button" class="append" disabled={processing || item.state !== 'ready'} onclick={onAppendToTimeline}>Add to timeline <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M4 14h12M11 10h5m-2-2 2 2-2 2" /></svg></button>
    </footer>
  </div>
</dialog>

<style>
  .media-preview {
    width: min(960px, calc(100vw - 64px));
    max-width: none;
    max-height: calc(100dvh - 64px);
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--foreground);
    background: var(--surface-elevated);
    box-shadow: var(--shadow-dialog);
  }
  .media-preview::backdrop { background: var(--scrim); }
  .viewer { display: flex; flex-direction: column; min-height: 0; max-height: calc(100dvh - 64px); }
  .viewer-head, .viewer-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); padding: var(--space-5) var(--space-8); background: var(--surface-elevated); }
  .viewer-head { border-bottom: 1px solid var(--border); }
  .viewer-foot { border-top: 1px solid var(--border); }
  .identity { min-width: 0; }
  .kind { color: var(--muted-foreground); font-size: var(--text-2xs); }
  .identity h2 { margin: var(--space-1) 0 0; overflow: hidden; font-size: var(--text-md); font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
  .stage { display: grid; min-height: 160px; flex: 1 1 auto; place-items: center; overflow: hidden; background: #171a20; }
  .stage img { display: block; width: 100%; max-height: min(65dvh, 680px); object-fit: contain; }
  .stage img { min-height: 160px; }
  .live-scene { width:100%; padding:var(--space-6); }
  .audio-stage { display: flex; width: 100%; min-height: min(45vh, 360px); flex-direction: column; align-items: center; justify-content: center; gap: var(--space-8); padding: var(--space-12); color: var(--primary); }
  .audio-stage > svg { width: 80px; height: 80px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .audio-stage span { font-size: var(--text-xs); }
  .audio-stage audio { width: min(100%, 420px); }
  .icon-button { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--foreground); background: var(--secondary); cursor: pointer; }
  .icon-button:hover:not(:disabled) { background: var(--surface-muted); }
  .icon-button:disabled { opacity: .4; cursor: not-allowed; }
  .icon-button svg, .append svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .pager { display: flex; align-items: center; gap: var(--space-4); }
  .pager span { min-width: 48px; color: var(--muted-foreground); font: var(--text-xs)/1 var(--font-mono); text-align: center; font-variant-numeric: tabular-nums; }
  .append { display: inline-flex; min-height: 36px; align-items: center; gap: var(--space-5); padding: 0 var(--space-6); border: 1px solid var(--primary); border-radius: var(--radius-sm); color: var(--primary-foreground); background: var(--primary); font-size: var(--text-xs); font-weight: var(--weight-semibold); cursor: pointer; }
  .append:hover:not(:disabled) { background: var(--primary-hover); }
  .append:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  @media (max-width: 600px) {
    .media-preview { width: 100vw; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
    .viewer { height: 100%; max-height: none; }
    .stage { min-height: 0; }
    .stage img { max-height: calc(100dvh - 148px); }
    .viewer-head, .viewer-foot { padding: var(--space-5) var(--space-6); }
  }
  @media (pointer: coarse) { .icon-button, .append { min-width: 44px; min-height: 44px; } }
</style>
