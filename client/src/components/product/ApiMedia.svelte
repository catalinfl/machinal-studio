<script lang="ts">
  import type { ApiExplorer } from '../../composables/useApiExplorer.svelte'
  import LandingIcon from '../home/LandingIcon.svelte'

  let { explorer }: { explorer: ApiExplorer } = $props()
  let input: HTMLInputElement
  let dragOver = $state(false)

  function uploadFiles(event: Event) {
    const files = [...((event.currentTarget as HTMLInputElement).files ?? [])]
    void explorer.upload(files)
    input.value = ''
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    dragOver = false
    if (!explorer.busy) void explorer.upload([...(event.dataTransfer?.files ?? [])])
  }
</script>

<section class="media-sheet" aria-labelledby="media-heading">
  <div class="sheet-heading"><h2 id="media-heading">Your media</h2><span>{explorer.assets.length} new uploads</span></div>
  <div class="media-body">
    <input class="file-input" type="file" multiple accept="video/*,audio/*,image/*" bind:this={input} onchange={uploadFiles} disabled={explorer.busy} aria-label="Upload media files" tabindex="-1" />
    <button class="upload-zone" class:drag-over={dragOver} disabled={explorer.busy} onclick={() => input.click()} ondragover={(event) => { event.preventDefault(); dragOver = true }} ondragleave={() => dragOver = false} ondrop={drop}><LandingIcon name="file" size={25} /><strong>{explorer.phase.kind === 'uploading' ? 'Uploading…' : 'Drop your media here'}</strong><span>or click to choose files</span><small>Video · images · audio</small></button>
    {#if explorer.phase.kind === 'uploading'}<p class="upload-message" role="status">Uploading {explorer.phase.filename}</p>{/if}
    {#if !explorer.assets.length}<p class="empty-note">Upload the files your recipe uses. They will be registered with their metadata and fingerprints. Saved projects can also reference media already in your session.</p>{/if}
    <div class="asset-list">{#each explorer.assets as asset (asset.id)}<article><div class="asset-title"><LandingIcon name={asset.kind === 'image' ? 'image' : asset.kind === 'audio' ? 'voice' : 'file'} size={18} /><strong>{asset.file}</strong><button class="remove" aria-label="Remove {asset.file} from request" disabled={explorer.busy} onclick={() => explorer.removeAsset(asset.id)}><LandingIcon name="close" size={15} /></button></div><code>{asset.id}</code><span class="asset-meta">{asset.kind} · {Number(asset.duration).toFixed(1)}s</span><label class="field">Bind to input<select disabled={explorer.busy} value={Object.entries(explorer.bindings).find(([, ids]) => ids.includes(asset.id))?.[0] ?? ''} onchange={(event) => explorer.bindAsset(asset.id, event.currentTarget.value)}><option value="">Not bound</option>{#each explorer.slots.filter(slot => slot.kind === asset.kind) as slot}<option value={slot.id}>{slot.id}</option>{/each}</select></label></article>{/each}</div>
  </div>
</section>

<style>
  .media-sheet { min-width: 0; border-right: 1px solid var(--home-rule); }
  .media-body { padding: 17px; }
  .file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  .upload-zone { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; min-height: 175px; padding: 23px 12px; border: 1px dashed var(--home-rule); color: var(--home-ink); background: transparent; cursor: pointer; }
  .upload-zone :global(svg) { color: var(--home-accent); }
  .upload-zone strong { font-size: 13px; font-weight: 500; }
  .upload-zone span { font-size: 11px; color: var(--home-muted); }
  .upload-zone small { color: var(--home-muted); font-size: 10px; }
  .upload-zone:hover, .upload-zone.drag-over { background: var(--home-tint); border-color: var(--home-accent); }
  .empty-note, .upload-message { font-size: 11px; color: var(--home-muted); line-height: 1.75; margin-top: 15px; }
  .asset-list article { border-top: 1px solid var(--home-rule); padding: 15px 0; }
  .asset-title { display: flex; align-items: center; gap: 8px; }
  .asset-title > :global(svg) { flex-shrink: 0; color: var(--home-accent); }
  .asset-title strong { font-weight: 500; font-size: 11px; overflow-wrap: anywhere; }
  .remove { margin-left: auto; border: 0; color: var(--home-muted); background: none; padding: 4px 6px; cursor: pointer; display: flex; }
  code { display: block; font: 10px var(--font-mono); color: var(--home-accent); margin-top: 8px; }
  .asset-meta { display: block; color: var(--home-muted); font-size: 10px; margin-top: 7px; }
  .field { margin-top: 13px; }
  @media (max-width: 900px) { .media-sheet { border-right: 0; border-bottom: 1px solid var(--home-rule); } .media-body { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; } .asset-list { grid-column: 1 / -1; } }
  @media (max-width: 640px) { .media-body { display: block; } }
</style>
