<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { CompositionAsset } from '../lib/composition-types'

  let { source = $bindable(), assets, busy, onBind }: { source: string; assets: CompositionAsset[]; busy: boolean; onBind: (id: string) => void } = $props()
  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  async function copySource(): Promise<void> {
    try {
      await navigator.clipboard.writeText(source)
      copied = true
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { copied = false }, 1400)
    } catch {
      copied = false
    }
  }

  onDestroy(() => clearTimeout(copyTimer))
</script>

<div class="code-workspace">
  <section class="code-pane" aria-label="Recipe editor">
    <header><h3>Project YAML</h3><button type="button" onclick={copySource} disabled={busy || !source}>{copied ? 'Copied' : 'Copy DSL'}</button></header>
    <label for="recipe-source">Recipe</label><textarea id="recipe-source" bind:value={source} spellcheck="false" disabled={busy} placeholder={'document:\n  mode: assemble\nbindings: {}\nassets: []'}></textarea>
    <p>Actions write this DSL for you. You can also edit it directly, then compile and apply. Image and voice generation use <code>before</code>; captions use <code>after</code>.</p>
  </section>
  <aside class="media-pane" aria-label="Media and bindings">
    <h3>Available media <span>{assets.length}</span></h3>
    {#if assets.length}
      <ul>{#each assets as asset (asset.id)}<li><span><strong title={asset.file}>{asset.file}</strong><small>{asset.kind} · {asset.local ? 'Local' : 'Server'}</small><code title={asset.id}>{asset.id}</code></span><button type="button" title="Add to first bindings slot" disabled={busy} onclick={() => onBind(asset.id)}>Use</button></li>{/each}</ul>
      <p>Use adds the asset to the first bindings slot. Asset IDs are available in the YAML for advanced placement.</p>
    {:else}<p>Add files to the Media Bin, then reopen Recipe.</p>{/if}
  </aside>
</div>

<style>
  .code-workspace { display:grid; grid-template-columns:minmax(0,1.8fr) minmax(240px,1fr); height:100%; min-height:0; }
  .code-pane, .media-pane { display:flex; flex-direction:column; gap:var(--space-5); min-width:0; overflow:auto; padding:var(--space-8); }
  .code-pane { border-right:1px solid var(--border); }
  .media-pane { background:var(--surface-muted); }
  header { display:flex; align-items:center; justify-content:space-between; }
  h3 { margin:0; font-size:var(--text-sm); font-weight:var(--weight-semibold); }
  h3 span { margin-left:var(--space-3); color:var(--muted-foreground); font:var(--text-xs)/1 var(--font-mono); }
  label { font-size:var(--text-xs); font-weight:var(--weight-medium); }
  textarea { box-sizing:border-box; width:100%; min-height:320px; flex:1; padding:var(--space-6); resize:vertical; border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-xs)/1.65 var(--font-mono); caret-color:var(--primary); tab-size:2; }
  textarea:focus-visible, button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  p { margin:0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.6; }
  button { min-height:32px; padding:0 var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font:var(--text-xs)/1 var(--font-sans); cursor:pointer; }
  button:hover:not(:disabled) { background:var(--surface-muted); border-color:var(--border-strong); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  ul { margin:0; padding:0; list-style:none; }
  li { display:flex; align-items:center; gap:var(--space-4); padding:var(--space-5) 0; border-bottom:1px solid var(--border); }
  li > span { display:flex; flex:1; min-width:0; flex-direction:column; gap:var(--space-2); }
  strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--text-xs); font-weight:var(--weight-medium); }
  small { color:var(--muted-foreground); font-size:var(--text-2xs); text-transform:capitalize; }
  code { overflow:hidden; color:var(--muted-foreground); font:var(--text-2xs)/1.5 var(--font-mono); text-overflow:ellipsis; white-space:nowrap; }
  @media(max-width:760px) { .code-workspace { display:flex; height:auto; flex-direction:column; } .code-pane { border-right:0; border-bottom:1px solid var(--border); } }
</style>
