<script lang="ts">
  import { clipTimelineDuration, type Clip } from '../stores/editor.svelte'
  import { useCaptionSourceDialog } from '../composables/useCaptionSourceDialog.svelte'
  import CreditUsageNotice from './CreditUsageNotice.svelte'

  interface Props {
    onCancel: () => void
    onSelect: (clips: Clip[]) => void
    initialSelectedClips?: Clip[]
  }

  let { onCancel, onSelect, initialSelectedClips = [] }: Props = $props()
  const source = useCaptionSourceDialog({
    getInitialSelectedClips: () => initialSelectedClips,
    getOnCancel: () => onCancel,
    getOnSelect: () => onSelect,
  })
</script>

<dialog
  class="source-dialog"
  bind:this={source.dialogEl}
  aria-labelledby="caption-source-title"
  aria-describedby="caption-source-description"
  onclose={onCancel}
  oncancel={(event) => event.preventDefault()}
>
  <div class="dialog-shell">
    <header class="dialog-head">
      <div>
        <h2 id="caption-source-title">Select audio for captions</h2>
        <p id="caption-source-description">Choose clips with audio or include every available clip from an audio track.</p>
      </div>
         <button class="close-button" onclick={source.closeDialog} aria-label="Close audio source selector">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>

    <div class="tabs" role="tablist" aria-label="Caption source type">
      <button
        id="caption-clips-tab"
        role="tab"
         aria-selected={source.activeTab === 'clips'}
        aria-controls="caption-clips-panel"
         tabindex={source.activeTab === 'clips' ? 0 : -1}
         onclick={source.showClips}
      >
         Clips <span>{source.captionSources.length}</span>
      </button>
      <button
        id="caption-channels-tab"
        role="tab"
         aria-selected={source.activeTab === 'channels'}
        aria-controls="caption-channels-panel"
         tabindex={source.activeTab === 'channels' ? 0 : -1}
         onclick={source.showChannels}
      >
         Audio channels <span>{source.audioChannels.length}</span>
      </button>
    </div>

    <div class="source-body">
      {#if source.activeTab === 'clips'}
        <div id="caption-clips-panel" role="tabpanel" aria-labelledby="caption-clips-tab" class="source-list">
          {#if source.captionSources.length === 0}
            <div class="empty-state">
              <strong>No selectable audio yet</strong>
              <span>Add an audio clip or a video with extracted audio to the timeline. Local-only media cannot be transcribed.</span>
            </div>
          {:else}
             {#each source.captionSources as captionSource (captionSource.clip.id)}
               <label class="source-row" class:selected={source.selectedSourceIds.includes(captionSource.clip.id)} class:overlapping={source.overlappingSourceIds.has(captionSource.clip.id)}>
                <input
                  type="checkbox"
                   checked={source.selectedSourceIds.includes(captionSource.clip.id)}
                   onchange={source.toggleSourceFor(captionSource.clip.id)}
                   aria-label="Select clip {captionSource.clip.fileName}"
                />
                <span class="source-copy">
                   <span class="source-title"><strong>{captionSource.clip.fileName}</strong><i>{captionSource.channel.type === 'video' ? 'Video with audio' : 'Audio clip'}</i></span>
                  <small>
                     {captionSource.channel.name} - {source.formatTime(captionSource.clip.start)} to {source.formatTime(captionSource.clip.start + clipTimelineDuration(captionSource.clip))}
                     {#if source.overlappingSourceIds.has(captionSource.clip.id)}<span class="overlap-note"> · overlaps another audio clip</span>{/if}
                  </small>
                </span>
                 <span class="duration">{source.formatTime(clipTimelineDuration(captionSource.clip))}</span>
              </label>
            {/each}
          {/if}
        </div>
      {:else}
        <div id="caption-channels-panel" role="tabpanel" aria-labelledby="caption-channels-tab" class="source-list">
          {#if source.audioChannels.length === 0}
            <div class="empty-state">
              <strong>No audio channels</strong>
              <span>Add an audio track to select all of its caption sources at once.</span>
            </div>
          {:else}
             {#each source.audioChannels as channel (channel.id)}
               {@const sourceIds = source.sourceIdsForChannel(channel)}
               {@const selectedCount = sourceIds.filter((id) => source.selectedSourceIds.includes(id)).length}
              <label class="source-row channel-row" class:selected={selectedCount > 0} class:unavailable={sourceIds.length === 0}>
                <input
                  type="checkbox"
                  checked={sourceIds.length > 0 && selectedCount === sourceIds.length}
                  disabled={sourceIds.length === 0}
                   onchange={source.toggleChannelFor(channel)}
                  aria-label="Select audio channel {channel.name}"
                />
                <span class="source-copy">
                  <span class="source-title"><strong>{channel.name}</strong><i>Audio channel</i></span>
                  <small>{sourceIds.length === 0 ? 'No server-ready audio clips' : `${sourceIds.length} available ${sourceIds.length === 1 ? 'clip' : 'clips'}`}</small>
                </span>
                {#if selectedCount > 0}<span class="selected-count">{selectedCount}/{sourceIds.length}</span>{/if}
              </label>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <footer class="dialog-foot">
      <div class="selection-summary" aria-live="polite">
       <span>{source.selectedSources.length} {source.selectedSources.length === 1 ? 'clip' : 'clips'} selected</span>
        <CreditUsageNotice />
         {#if source.hasOverlappingSelection}
          <span class="selection-warning" role="alert">Choose one clip from each overlapping section.</span>
        {/if}
      </div>
      <div>
         <button class="secondary" onclick={source.closeDialog}>Cancel</button>
         <button class="primary" onclick={source.submitSelection} disabled={source.selectedSources.length === 0 || source.hasOverlappingSelection}>
           Generate from {source.selectedSources.length} {source.selectedSources.length === 1 ? 'clip' : 'clips'}
        </button>
      </div>
    </footer>
  </div>
</dialog>

<style>
  .source-dialog { width:min(720px, calc(100vw - 48px)); height:min(610px, calc(100vh - 48px)); margin:auto; padding:0; overflow:hidden; border:1px solid var(--border-strong); border-radius:var(--radius-lg); color:var(--foreground); background:var(--surface-elevated); box-shadow:var(--shadow-dialog); font-family:var(--font-sans); will-change:transform, opacity; animation:dialog-arrive 200ms cubic-bezier(.16, 1, .3, 1) both; }
  .source-dialog::backdrop { background:var(--scrim); animation:scrim-fade 200ms ease-out both; }
  .dialog-shell { height:100%; display:grid; grid-template-rows:auto auto minmax(0, 1fr) auto; }
  .dialog-head { min-height:84px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); padding:var(--space-8) var(--space-10); border-bottom:1px solid var(--border); background:var(--surface-elevated); }
  .dialog-head > div { min-width:0; }
  .dialog-head h2 { margin:0; font-size:var(--text-xl); font-weight:var(--weight-bold); letter-spacing:-.025em; line-height:var(--leading-tight); }
  .dialog-head p { max-width:58ch; margin:var(--space-2) 0 0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .close-button { width:32px; height:32px; display:grid; place-items:center; flex:0 0 auto; border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--secondary); cursor:pointer; }
  .close-button:hover { border-color:var(--primary-border); color:var(--primary); background:var(--primary-subtle); }
  .close-button svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; }
  .tabs { display:flex; min-height:44px; padding:0 var(--space-8); border-bottom:1px solid var(--border); background:var(--surface); }
  .tabs button { position:relative; display:flex; align-items:center; gap:var(--space-3); padding:0 var(--space-6); border:0; color:var(--muted-foreground); background:transparent; font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; }
  .tabs button::after { content:""; position:absolute; right:var(--space-4); bottom:-1px; left:var(--space-4); height:2px; background:transparent; }
  .tabs button:hover { color:var(--foreground); background:var(--surface-muted); }
  .tabs button[aria-selected="true"] { color:var(--primary); }
  .tabs button[aria-selected="true"]::after { background:var(--primary); }
  .tabs button span { min-width:20px; padding:2px var(--space-2); border-radius:var(--radius-xs); color:var(--muted-foreground); background:var(--surface-muted); font:var(--text-2xs)/1 var(--font-mono); font-variant-numeric:tabular-nums; text-align:center; }
  .source-body { min-height:0; background:var(--surface-elevated); }
  .source-list { height:100%; overflow-x:hidden; overflow-y:auto; scrollbar-color:var(--border-strong) var(--surface); }
  .source-row { min-height:70px; display:grid; grid-template-columns:20px minmax(0, 1fr) auto; align-items:center; gap:var(--space-5); padding:var(--space-5) var(--space-8); border-bottom:1px solid var(--border); background:var(--surface-elevated); cursor:pointer; transition:background-color 120ms ease; content-visibility:auto; contain-intrinsic-size:auto 70px; }
  .source-row:hover { background:var(--surface); }
  .source-row.selected { background:color-mix(in srgb, var(--primary-subtle) 38%, var(--surface-elevated)); }
  .source-row.overlapping:not(.selected) { background:color-mix(in srgb, var(--warning-subtle) 24%, var(--surface-elevated)); }
  .source-row.unavailable { cursor:not-allowed; opacity:.52; }
  .source-row input { appearance:none; width:18px; height:18px; margin:0; border:1px solid var(--border-strong); border-radius:var(--radius-xs); background:var(--input); cursor:pointer; }
  .source-row input:hover:not(:disabled) { border-color:var(--primary); }
  .source-row input:checked { border-color:var(--primary); background-color:var(--primary); background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2 6 2.5 2.5L10 3' fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.8'/%3E%3C/svg%3E"); background-position:center; background-repeat:no-repeat; background-size:11px; }
  .source-row input:disabled { cursor:not-allowed; }
  .source-copy { min-width:0; display:flex; flex-direction:column; gap:var(--space-2); }
  .source-title { min-width:0; display:flex; align-items:center; gap:var(--space-3); }
  .source-title strong { min-width:0; overflow:hidden; font-size:var(--text-sm); font-weight:var(--weight-semibold); white-space:nowrap; text-overflow:ellipsis; }
  .source-title i { flex:0 0 auto; padding:2px var(--space-2); border:1px solid var(--border); border-radius:var(--radius-xs); color:var(--muted-foreground); background:var(--surface); font-size:var(--text-2xs); font-style:normal; font-weight:var(--weight-medium); line-height:1; }
  .source-copy small { overflow:hidden; color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); white-space:nowrap; text-overflow:ellipsis; }
  .overlap-note, .selection-warning { color:var(--warning); font-weight:var(--weight-semibold); }
  .duration, .selected-count { color:var(--primary); font:var(--text-xs)/1 var(--font-mono); font-variant-numeric:tabular-nums; }
  .empty-state { height:100%; min-height:260px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-3); padding:var(--space-12); text-align:center; }
  .empty-state strong { font-size:var(--text-md); font-weight:var(--weight-semibold); }
  .empty-state span { max-width:48ch; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .dialog-foot { min-height:62px; display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); padding:var(--space-5) var(--space-8); border-top:1px solid var(--border); background:var(--surface); }
  .selection-summary { display:flex; flex-direction:column; gap:var(--space-1); min-width:0; color:var(--muted-foreground); font-size:var(--text-xs); }
  .selection-warning { font-size:var(--text-2xs); }
  .dialog-foot > div { display:flex; gap:var(--space-3); }
  .dialog-foot > .selection-summary { gap:var(--space-1); }
  .dialog-foot button { height:32px; padding:0 var(--space-6); border-radius:var(--radius-sm); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; }
  .dialog-foot .secondary { border:1px solid var(--border); color:var(--secondary-foreground); background:var(--secondary); }
  .dialog-foot .secondary:hover { border-color:var(--border-strong); background:var(--surface-muted); }
  .dialog-foot .primary { border:1px solid var(--primary); color:var(--primary-foreground); background:var(--primary); }
  .dialog-foot .primary:hover:not(:disabled) { background:var(--primary-hover); }
  .dialog-foot .primary:disabled { cursor:not-allowed; opacity:.5; }
  button:focus-visible, input:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }

  @media (prefers-reduced-motion: reduce) {
    .source-dialog { animation:none; }
  }

  @media (max-width:760px) {
    .source-dialog { width:100vw; height:100dvh; max-width:none; max-height:none; border:0; border-radius:0; }
    .dialog-head { min-height:76px; padding:var(--space-6); }
    .tabs { padding:0 var(--space-3); }
    .tabs button { flex:1; justify-content:center; padding-inline:var(--space-3); }
    .source-row { padding-inline:var(--space-6); }
    .dialog-foot { align-items:stretch; flex-direction:column; gap:var(--space-4); padding:var(--space-5) var(--space-6); }
    .dialog-foot > div { width:100%; }
    .dialog-foot button { flex:1; }
  }

  @media (pointer:coarse) {
    .close-button { width:40px; height:40px; }
    .tabs { min-height:48px; }
    .source-row input { width:20px; height:20px; }
    .dialog-foot button { min-height:40px; }
  }
</style>
