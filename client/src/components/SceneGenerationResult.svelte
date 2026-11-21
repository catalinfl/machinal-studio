<script lang="ts">
  import type { SceneGeneration } from '../composables/useSceneGeneration.svelte'
  import { mediaSourceUrl } from '../lib/api'
  import LiveScenePreview from './LiveScenePreview.svelte'
  import SceneEditForm from './SceneEditForm.svelte'

  let { generation }: { generation: SceneGeneration } = $props()
  const selected = $derived(generation.selected)
</script>

<section class="results" aria-label="Generated scenes">
  <div class="register">
    <header><h3>Scenes</h3><span>{generation.job?.scenes.length ?? 0}</span></header>
    <div class="scene-list" role="group" aria-label="Choose a scene to preview">
      {#each generation.job?.scenes ?? [] as scene, index (scene.id)}
        <button type="button" class:active={selected?.id === scene.id} aria-pressed={selected?.id === scene.id} disabled={generation.editingScene || generation.insertion.kind === 'adding'} onclick={() => generation.select(scene.id)}>
          <span class="scene-number">{String(index + 1).padStart(2, '0')}</span>
          <span class="scene-copy"><strong>{scene.title}</strong><span>{scene.asset.duration?.toFixed(2)} s{scene.source?.config.transparent ? ' · Overlay' : ''}{scene.source?.audio || scene.asset.hasAudio ? ' · Voice included' : ''}</span></span>
        </button>
      {/each}
      {#if !generation.job?.scenes.length}<p class="register-empty">Each idea becomes its own scene.</p>{/if}
    </div>
  </div>
  <div class="preview">
    {#if selected}
      {#key selected.id}
        {#if selected.source}
          <LiveScenePreview source={selected.source} />
        {:else}
        <!-- The rendered source may include narration; users control playback. -->
        <!-- svelte-ignore a11y_media_has_caption -->
        <video controls playsinline preload="metadata" src={mediaSourceUrl(selected.asset.file)} aria-label={`Preview ${selected.title}`}></video>
        {/if}
      {/key}
      <div class="scene-description"><div class="scene-heading"><h3>{selected.title}</h3>{#if selected.source && !generation.editDraft}<button class="edit-button" type="button" disabled={generation.busy || generation.insertion.kind === 'adding'} onclick={() => generation.beginEdit()}>Edit scene</button>{/if}</div><p>{selected.brief}</p></div>
      <SceneEditForm {generation} />
      {#if selected.explanation || selected.source?.explanation}<details class="design-notes"><summary>AI design notes</summary><p>{selected.explanation || selected.source?.explanation}</p></details>{/if}
      <details><summary>Svelte component</summary><pre><code>{selected.component}</code></pre></details>
    {:else}
      <div class="preview-empty">
        <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="9" width="38" height="30" rx="2"/><path d="m20 17 11 7-11 7zM5 14h38M13 9v5m11-5v5m11-5v5"/></svg>
        <h3>Your animation appears here</h3>
        <p>{generation.busy ? 'We’re writing the scene component and preparing its live preview. Scenes appear as they’re ready.' : 'Describe an idea or bring a voice recording. Preview the result, then add the scene to your timeline.'}</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .results { display:grid; grid-template-columns:180px minmax(0,1fr); flex:1; min-height:250px; border-top:1px solid var(--border); }
  .register { min-width:0; border-right:1px solid var(--border); background:var(--surface-elevated); }
  .register header { display:flex; align-items:center; justify-content:space-between; padding:var(--space-6); border-bottom:1px solid var(--border); }
  h3 { margin:0; font-size:var(--text-sm); font-weight:var(--weight-semibold); }
  .register header > span, .scene-number { color:var(--muted-foreground); font:var(--text-xs)/1.4 var(--font-mono); font-variant-numeric:tabular-nums; }
  .scene-list { max-height:350px; overflow:auto; }
  .scene-list button { display:flex; align-items:flex-start; gap:var(--space-4); width:100%; min-height:66px; padding:var(--space-6); border:0; border-bottom:1px solid var(--border); color:var(--foreground); background:transparent; text-align:left; cursor:pointer; }
  .scene-list button:hover { background:var(--surface-muted); }
  .scene-list button.active { background:var(--primary-subtle); color:var(--primary); }
  .scene-list button:focus-visible { outline:2px solid var(--ring); outline-offset:-3px; }
  .scene-copy { display:grid; gap:var(--space-2); min-width:0; }
  .scene-copy strong { font-size:var(--text-xs); font-weight:var(--weight-semibold); overflow-wrap:anywhere; }
  .scene-copy > span { font-size:var(--text-2xs); color:var(--muted-foreground); font-variant-numeric:tabular-nums; }
  .register-empty { padding:var(--space-6); color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
  .preview { min-width:0; padding:var(--space-8); }
  video { display:block; width:100%; max-height:290px; background:var(--preview-surface, #17171c); object-fit:contain; }
  .scene-description { margin-top:var(--space-6); }
  .scene-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-4); }
  .edit-button { min-height:36px; padding:var(--space-3) var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--secondary-foreground); font:var(--weight-semibold) var(--text-xs)/1.4 var(--font-sans); cursor:pointer; }
  .edit-button:hover:not(:disabled) { background:var(--surface-muted); }
  .edit-button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  button:disabled { opacity:.55; cursor:not-allowed; }
  .scene-description p { margin:var(--space-2) 0 0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); overflow-wrap:anywhere; }
  details { margin-top:var(--space-6); border-top:1px solid var(--border); font-size:var(--text-xs); }
  .design-notes p { margin:0 0 var(--space-4); white-space:pre-wrap; overflow-wrap:anywhere; color:var(--muted-foreground); line-height:var(--leading-copy); }
  summary { padding-block:var(--space-4); color:var(--muted-foreground); cursor:pointer; }
  summary:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  pre { max-height:180px; overflow:auto; margin:0; padding:var(--space-6); background:var(--surface-muted); color:var(--foreground); font:var(--text-xs)/1.6 var(--font-mono); }
  .preview-empty { display:flex; min-height:220px; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-4); text-align:center; }
  .preview-empty svg { width:48px; height:48px; margin-bottom:var(--space-4); fill:none; stroke:var(--muted-foreground); stroke-width:1.4; stroke-linejoin:round; }
  .preview-empty p { max-width:38ch; margin:0; font-size:var(--text-xs); color:var(--muted-foreground); line-height:var(--leading-copy); }
  @media (max-width:760px) {
    .results { grid-template-columns:minmax(0,1fr); }
    .register { border-right:0; border-bottom:1px solid var(--border); }
    .register header { padding:var(--space-4) var(--space-6); }
    .scene-list { display:flex; overflow-x:auto; max-height:150px; }
    .scene-list button { flex:0 0 190px; border-right:1px solid var(--border); border-bottom:0; }
    .preview { padding:var(--space-6); }
    .preview-empty { min-height:160px; }
    video { max-height:240px; }
  }
</style>
