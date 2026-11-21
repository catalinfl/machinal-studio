<script lang="ts">
  import type { ApiExplorer } from '../../composables/useApiExplorer.svelte'
  import LandingIcon from '../home/LandingIcon.svelte'

  let { explorer }: { explorer: ApiExplorer } = $props()
  let fileInput: HTMLInputElement

  function importRecipe(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (file) void explorer.importYaml(file)
    fileInput.value = ''
  }
</script>

<section class="recipe-editor" aria-labelledby="api-recipe-heading">
  <div class="sheet-heading"><h2 id="api-recipe-heading">Your recipe</h2><span>YAML</span></div>
  <div class="recipe-toolbar"><span>Start with</span><button class="quiet-button" disabled={explorer.busy} onclick={() => explorer.loadStarter('video')}>Video reel</button><button class="quiet-button" disabled={explorer.busy} onclick={() => explorer.loadStarter('image')}>Images</button><button class="quiet-button import-button" disabled={explorer.busy} onclick={() => fileInput.click()}>Import YAML</button><input class="file-input" type="file" accept=".yaml,.yml" bind:this={fileInput} onchange={importRecipe} aria-label="Import a YAML recipe" disabled={explorer.busy} tabindex="-1" /></div>
  <textarea class="yaml-editor" aria-label="API recipe YAML" spellcheck="false" value={explorer.source} oninput={(event) => explorer.setSource(event.currentTarget.value)} readonly={explorer.busy}></textarea>
  <div class="recipe-actions"><button class="quiet-button" disabled={explorer.busy || !explorer.source.trim()} onclick={() => explorer.check('validate')}>Validate</button><button class="quiet-button" disabled={explorer.busy || !explorer.source.trim()} onclick={() => explorer.check('compile')}>Compile</button><button class="quiet-button" disabled={explorer.busy || !explorer.source.trim()} onclick={explorer.exportYaml}><LandingIcon name="file" size={14} />Save request YAML</button></div>
  <p>Recipes or saved .edit.yaml projects both work. Media is uploaded separately; named inputs are bound in the media panel.</p>
</section>

<style>
  .recipe-editor { min-width: 0; border-right: 1px solid var(--home-rule); display: flex; flex-direction: column; }
  .recipe-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 13px 17px; border-bottom: 1px solid var(--home-rule); }
  .recipe-toolbar > span { color: var(--home-muted); font-size: 10px; margin-right: 3px; }
  .import-button { margin-left: auto; }
  .file-input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; pointer-events: none; }
  .yaml-editor { display: block; flex: 1; width: 100%; min-height: 365px; resize: vertical; border: 0; padding: 22px; background: var(--home-code); color: var(--home-code-ink); font: 12px/1.75 var(--font-mono); tab-size: 2; caret-color: var(--home-accent); scrollbar-color: var(--home-rule) var(--home-code); }
  .recipe-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 15px 17px 0; border-top: 1px solid var(--home-rule); }
  p { color: var(--home-muted); font-size: 11px; line-height: 1.7; padding: 0 17px; margin-bottom: 17px; }
  @media (max-width: 900px) { .recipe-editor { border-right: 0; } }
  @media (max-width: 640px) { .yaml-editor { padding: 17px; font-size: 11px; min-height: 390px; } }
</style>
