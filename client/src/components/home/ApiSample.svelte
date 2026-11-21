<script lang="ts">
  import { useRenderDemo } from '../../composables/useRenderDemo.svelte'
  import LandingIcon from './LandingIcon.svelte'

  let { recipe }: { recipe: string } = $props()
  const render = useRenderDemo()
  const progress = $derived(render.phase.kind === 'completed' ? 100 : render.phase.kind === 'idle' ? 0 : render.phase.progress)
  const status = $derived(render.phase.kind === 'idle' ? 'Your files. Your recipe.' : render.phase.kind === 'completed' ? 'Your video is ready.' : render.phase.kind === 'uploading' ? 'Uploading media…' : render.phase.kind === 'compiling' ? 'Compiling the recipe…' : `Rendering · ${progress}%`)

  $effect(() => {
    recipe
    render.reset()
  })
</script>

<div class="api-sample">
  <div class="pane-heading"><LandingIcon name="code" size={17} /><span>Make it repeatable.</span><LandingIcon name="direction" size={14} /></div>
  <div class="api-body">
    <div class="api-input"><LandingIcon name="file" size={14} /><span>Your media files</span><small>Upload</small></div>
    <div class="api-input"><LandingIcon name="key" size={14} /><span>Your API credentials</span><small>Bearer</small></div>
    <div class="yaml-label"><span>direction.edit.yaml</span><span class="measurement">YAML</span></div>
    <pre><code>{recipe}</code></pre>
    <p class="recipe-help">Add a style or effect in the editor. Watch your YAML follow.</p>
    <div class="render-status"><span role="status">{status}</span>{#if render.phase.kind !== 'idle'}<progress value={progress} max="100" aria-label="Illustrative render progress"></progress>{/if}</div>
    {#if render.phase.kind === 'completed'}
      <a class="demo-action" href="/api">Explore the real API <LandingIcon name="arrow" size={15} /></a>
      <button class="replay" onclick={render.run}>Replay the workflow</button>
    {:else}
      <button class="demo-action" onclick={render.run} disabled={render.busy}>{render.busy ? 'Working…' : 'Preview render flow'}<LandingIcon name="arrow" size={15} /></button>
    {/if}
    <small class="demo-note">Interactive example · no files are sent</small>
  </div>
</div>

<style>
  .api-sample { min-width: 0; height: 100%; }
  .pane-heading { display: flex; align-items: center; gap: 9px; padding: 17px 18px; border-bottom: 1px solid var(--home-rule); font-size: 12px; }
  .pane-heading > :global(svg:last-child) { margin-left: auto; color: var(--home-accent); }
  .api-body { padding: 15px 18px; }
  .api-input { display: flex; align-items: center; gap: 8px; font-size: 10px; padding: 7px 0; }
  .api-input > :global(svg) { color: var(--home-muted); }
  .api-input small { margin-left: auto; font-size: 9px; color: var(--home-muted); }
  .yaml-label { display: flex; justify-content: space-between; padding: 12px 0 7px; color: var(--home-muted); font-size: 9px; }
  pre { margin: 0; padding: 12px; max-height: 185px; overflow: auto; scrollbar-color: var(--home-rule) var(--home-code); background: var(--home-code); color: var(--home-code-ink); font: 10px/1.6 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
  .recipe-help { color: var(--home-muted); font-size: 10px; line-height: 1.6; margin: 12px 0 0; }
  .render-status { min-height: 31px; padding: 13px 0 9px; font-size: 10px; }
  progress { display: block; width: 100%; height: 3px; accent-color: var(--home-accent); margin-top: 7px; }
  progress::-webkit-progress-bar { background: var(--home-rule); }
  progress::-webkit-progress-value { background: var(--home-accent); }
  .demo-action { width: 100%; min-height: 34px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 7px; border: 1px solid var(--home-accent); background: transparent; color: var(--home-accent); font-size: 10px; text-decoration: none; cursor: pointer; }
  .demo-action:hover { background: var(--home-tint); }
  .demo-action:disabled { opacity: .55; cursor: wait; }
  .replay { background: none; border: 0; padding: 8px 0 0; color: var(--home-muted); text-decoration: underline; font-size: 10px; cursor: pointer; }
  .demo-note { display: block; margin-top: 9px; font-size: 9px; color: var(--home-muted); }
</style>
