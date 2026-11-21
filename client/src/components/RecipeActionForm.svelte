<script lang="ts">
  import RecipeActionIcon from './RecipeActionIcon.svelte'
  import RecipeImageFields from './RecipeImageFields.svelte'
  import RecipeVoiceFields from './RecipeVoiceFields.svelte'
  import RecipeCaptionFields from './RecipeCaptionFields.svelte'
  import RecipeTextFields from './RecipeTextFields.svelte'
  import RecipeSceneFields from './RecipeSceneFields.svelte'
  import { RECIPE_ACTION_TYPES, type RecipeAction } from '../lib/recipe-action-fields'
  import type { CompositionAsset } from '../lib/composition-types'

  let { action = $bindable(), assets, isNew, error, busy, onSave, onCancel }: {
    action: RecipeAction; assets: CompositionAsset[]; isNew: boolean; error: string | null; busy: boolean
    onSave: (event: SubmitEvent) => void; onCancel: () => void
  } = $props()

  const definition = $derived(RECIPE_ACTION_TYPES.find((item) => item.kind === action.kind)!)
</script>

<form class="recipe-action-form" onsubmit={onSave} aria-label={isNew ? `Add action: ${definition.label}` : `Edit action: ${definition.label}`}>
  <header class="form-heading">
    <span class="action-icon"><RecipeActionIcon kind={action.kind} /></span>
    <div><h3>{definition.label}</h3><p>{definition.description}</p></div>
    <button class="cancel-icon" type="button" onclick={onCancel} disabled={busy} aria-label="Cancel action editing" title="Cancel">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
    </button>
  </header>
  <fieldset disabled={busy}>
    {#if action.kind === 'image'}<RecipeImageFields bind:action />
    {:else if action.kind === 'scene'}<RecipeSceneFields bind:action {assets} />
    {:else if action.kind === 'voice'}<RecipeVoiceFields bind:action {assets} />
    {:else if action.kind === 'captions'}<RecipeCaptionFields bind:action {assets} />
    {:else}<RecipeTextFields bind:action />{/if}
  </fieldset>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  <footer class="form-footer">
    <p>{action.kind === 'text' ? 'Adds the text when you apply the recipe.' : 'Saves an instruction. Applying AI actions uses your OpenRouter key and may incur provider charges.'}</p>
    <div><button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button><button type="submit" class="primary" disabled={busy}>{isNew ? 'Add action' : 'Save action'}</button></div>
  </footer>
</form>

<style>
  .recipe-action-form { min-width:0; padding:var(--space-10) var(--space-12); font-family:var(--font-sans); }
  .form-heading { display:flex; align-items:flex-start; gap:var(--space-6); padding-bottom:var(--space-10); border-bottom:1px solid var(--border); }
  .action-icon { width:28px; height:28px; color:var(--primary); flex:0 0 auto; }
  .action-icon :global(svg) { width:100%; height:100%; }
  h3 { margin:0; font-size:var(--text-lg); font-weight:var(--weight-semibold); }
  .form-heading p { margin:var(--space-2) 0 0; max-width:55ch; color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.5; }
  .cancel-icon { display:grid; width:32px; height:32px; flex:0 0 auto; margin-left:auto; place-items:center; border:1px solid var(--border); border-radius:var(--radius-sm); background:transparent; color:var(--muted-foreground); cursor:pointer; }
  .cancel-icon svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.5; }
  fieldset { min-width:0; margin:0; padding:0; border:0; }
  .recipe-action-form :global(.form-section) { display:flex; flex-direction:column; gap:var(--space-6); padding:var(--space-10) 0; border-bottom:1px solid var(--border); }
  .recipe-action-form :global(h4) { margin:0 0 var(--space-2); font-family:var(--font-sans); font-size:var(--text-sm); font-weight:var(--weight-semibold); }
  .recipe-action-form :global(.field) { display:flex; flex-direction:column; gap:var(--space-3); min-width:0; font-size:var(--text-xs); font-weight:var(--weight-medium); }
  .recipe-action-form :global(.field-row) { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-6); }
  .recipe-action-form :global(.position-row) { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .recipe-action-form :global(input), .recipe-action-form :global(textarea) { box-sizing:border-box; width:100%; min-height:var(--height-control-lg); padding:var(--space-4) var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-xs)/1.5 var(--font-sans); caret-color:var(--primary); }
  .recipe-action-form :global(input[type='number']) { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .recipe-action-form :global(input[type='color']) { padding:var(--space-2); cursor:pointer; }
  .recipe-action-form :global(textarea) { min-height:116px; resize:vertical; }
  .recipe-action-form :global(.short-textarea) { min-height:72px; }
  .recipe-action-form :global(textarea::placeholder) { color:var(--muted-foreground); }
  .recipe-action-form :global(input:focus-visible), .recipe-action-form :global(textarea:focus-visible), button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .recipe-action-form :global(.field-note) { margin:0; color:var(--muted-foreground); font:var(--text-xs)/1.5 var(--font-sans); font-weight:var(--weight-normal); }
  .recipe-action-form :global(.timing-note) { align-self:end; padding-bottom:var(--space-3); }
  .recipe-action-form :global(.optional) { color:var(--muted-foreground); font-weight:var(--weight-normal); }
  .form-footer { position:sticky; bottom:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); margin:var(--space-5) calc(var(--space-12) * -1) calc(var(--space-10) * -1); padding:var(--space-6) var(--space-12); border-top:1px solid var(--border); background:var(--surface-elevated); }
  .form-footer p { margin:0; max-width:32ch; color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.5; }
  .form-footer > div { display:flex; gap:var(--space-4); flex-shrink:0; }
  .primary, .secondary { min-height:var(--height-control-lg); padding:0 var(--space-6); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font:var(--weight-medium) var(--text-xs)/1 var(--font-sans); cursor:pointer; }
  .primary { border-color:var(--primary); background:var(--primary); color:var(--primary-foreground); }
  .primary:hover:not(:disabled) { background:var(--primary-hover); }
  .secondary:hover:not(:disabled), .cancel-icon:hover:not(:disabled) { background:var(--surface-muted); color:var(--foreground); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .form-error { padding:var(--space-5); border:1px solid var(--destructive); background:var(--destructive-subtle); color:var(--foreground); font-size:var(--text-xs); }
  @media(max-width:600px) { .recipe-action-form { padding:var(--space-8); } .recipe-action-form :global(.position-row) { grid-template-columns:1fr; } .form-footer { align-items:stretch; flex-direction:column; margin-inline:calc(var(--space-8) * -1); margin-bottom:calc(var(--space-8) * -1); padding:var(--space-5) var(--space-8); } .form-footer > div { justify-content:flex-end; } }
</style>
