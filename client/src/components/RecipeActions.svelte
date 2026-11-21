<script lang="ts">
  import RecipeActionForm from './RecipeActionForm.svelte'
  import RecipeActionIcon from './RecipeActionIcon.svelte'
  import { RECIPE_ACTION_TYPES, recipeActionDetail } from '../lib/recipe-action-fields'
  import type { useRecipeActions } from '../composables/useRecipeActions.svelte'
  import type { CompositionAsset } from '../lib/composition-types'

  let { actions, assets, busy, onCode }: {
    actions: ReturnType<typeof useRecipeActions>; assets: CompositionAsset[]; busy: boolean; onCode: () => void
  } = $props()
</script>

<div class="action-workspace" class:editing={actions.editing}>
  <aside class="action-register" aria-label="Recipe actions">
    <header class="register-heading"><h3>Actions <span>{actions.inspection.actions.length}</span></h3>
      <button type="button" class="add-button" onclick={actions.reset} disabled={busy || !!actions.inspection.error} aria-label="Add an action"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>Add</button>
    </header>
    {#if actions.inspection.error}
      <div class="register-empty"><p>The recipe needs attention.</p><small>{actions.inspection.error}</small><button type="button" class="text-button" onclick={onCode}>Open Code DSL</button></div>
    {:else}
      {#if actions.inspection.actions.length}
        <ol class="action-list">
          {#each actions.inspection.actions as entry (`${entry.ref.section}/${entry.ref.id}`)}
            {@const selected = actions.state.kind === 'editing' && actions.state.ref?.section === entry.ref.section && actions.state.ref?.id === entry.ref.id}
            <li class:selected>
              <button type="button" class="action-item" aria-label={`Edit ${RECIPE_ACTION_TYPES.find((item) => item.kind === entry.action.kind)?.label}: ${entry.action.id}`} aria-pressed={selected} disabled={busy} onclick={() => actions.edit(entry)}>
                <span class="row-icon"><RecipeActionIcon kind={entry.action.kind} /></span>
                <span class="row-content"><strong>{RECIPE_ACTION_TYPES.find((item) => item.kind === entry.action.kind)?.label}</strong><span>{entry.action.kind === 'image' || entry.action.kind === 'scene' ? entry.action.prompt || 'No description' : entry.action.kind === 'voice' || entry.action.kind === 'text' ? entry.action.text : 'Transcribe the resulting edit'}</span><small>{recipeActionDetail(entry.action)}</small></span>
              </button>
              <button type="button" class="remove-button" aria-label={`Remove ${entry.action.id}`} title="Remove action" disabled={busy} onclick={() => actions.remove(entry.ref)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2M6 6l1 10h6l1-10M9 9v4m2-4v4" /></svg></button>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="register-empty"><p>Your timeline is the starting point.</p><small>Add instructions for the content you want to create. Existing clips, positions and styles stay in the recipe.</small></div>
      {/if}
      <div class="register-note"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h9M6 3v4m7 1v4M8 13v4" /></svg><p>{actions.inspection.clipCount ? `${actions.inspection.clipCount} timeline clips included.` : 'Timeline content is included in the DSL.'} Generation runs before placement; captions run after the edit.</p></div>
      {#if actions.inspection.advancedCount}<p class="advanced-note">{actions.inspection.advancedCount} additional rules or jobs in <button type="button" class="text-button" onclick={onCode}>Code DSL</button>.</p>{/if}
    {/if}
  </aside>

  <section class="action-inspector" aria-label="Action configuration">
    {#if actions.state.kind === 'editing'}
      {#key `${actions.state.ref?.section ?? 'new'}/${actions.state.action.id}`}
        <RecipeActionForm bind:action={actions.state.action} {assets} isNew={!actions.state.ref} error={actions.state.error} {busy} onSave={actions.save} onCancel={actions.reset} />
      {/key}
    {:else}
      <div class="action-chooser">
        <h3>What would you like to add?</h3><p>Choose an action. Configure its content and destination here.</p>
        {#if actions.state.message}<p class="saved-note" role="status">{actions.state.message}</p>{/if}
        <div class="action-options">
          {#each RECIPE_ACTION_TYPES as option (option.kind)}
            <button type="button" class="action-option" disabled={busy || !!actions.inspection.error} onclick={() => actions.add(option.kind)}>
              <span class="option-icon"><RecipeActionIcon kind={option.kind} /></span><span><strong>{option.label}</strong><small>{option.description}</small></span><svg class="arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
            </button>
          {/each}
        </div>
        <p class="chooser-note">Adding an action saves its instruction. Nothing is generated until you apply the recipe.</p>
      </div>
    {/if}
  </section>
</div>

<style>
  .action-workspace { display:grid; grid-template-columns:minmax(250px,.75fr) minmax(0,1.5fr); height:100%; min-height:0; }
  .action-register { min-width:0; overflow:auto; border-right:1px solid var(--border); background:var(--surface-muted); }
  .register-heading { display:flex; align-items:center; justify-content:space-between; gap:var(--space-5); padding:var(--space-8); border-bottom:1px solid var(--border); }
  h3 { margin:0; font-size:var(--text-sm); font-weight:var(--weight-semibold); }
  .register-heading h3 { display:flex; align-items:baseline; gap:var(--space-4); }
  h3 span { color:var(--muted-foreground); font:var(--text-xs)/1 var(--font-mono); }
  .add-button { display:flex; align-items:center; gap:var(--space-2); min-height:32px; padding:0 var(--space-4); border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font:var(--text-xs)/1 var(--font-sans); cursor:pointer; }
  .add-button svg, .remove-button svg, .register-note svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.5; flex:0 0 auto; }
  .action-list { margin:0; padding:0; list-style:none; }
  .action-list li { display:flex; align-items:center; border-bottom:1px solid var(--border); }
  .action-list li.selected { background:var(--primary-subtle); }
  .action-item { display:flex; align-items:flex-start; gap:var(--space-4); width:100%; min-width:0; padding:var(--space-6) 0 var(--space-6) var(--space-8); border:0; background:transparent; color:var(--foreground); text-align:left; cursor:pointer; }
  .row-icon { width:20px; height:20px; flex:0 0 auto; color:var(--muted-foreground); }
  .row-icon :global(svg), .option-icon :global(svg) { width:100%; height:100%; }
  .selected .row-icon { color:var(--primary); }
  .row-content { display:flex; flex-direction:column; gap:var(--space-2); min-width:0; }
  .row-content strong { font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  .row-content > span { overflow:hidden; color:var(--muted-foreground); font-size:var(--text-xs); text-overflow:ellipsis; white-space:nowrap; }
  .row-content small { color:var(--muted-foreground); font:var(--text-2xs)/1.5 var(--font-mono); }
  .remove-button { display:grid; width:32px; height:36px; flex:0 0 auto; margin:0 var(--space-4); padding:0; place-items:center; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--muted-foreground); cursor:pointer; }
  .remove-button:hover:not(:disabled) { background:var(--destructive-subtle); color:var(--destructive); }
  .register-empty { padding:var(--space-8); }
  .register-empty p { margin:0 0 var(--space-3); font-size:var(--text-sm); font-weight:var(--weight-medium); line-height:1.5; }
  .register-empty small { display:block; color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.6; overflow-wrap:anywhere; }
  .register-note { display:flex; align-items:flex-start; gap:var(--space-4); padding:var(--space-8); color:var(--muted-foreground); }
  .register-note p, .advanced-note { margin:0; font-size:var(--text-xs); line-height:1.6; }
  .advanced-note { padding:0 var(--space-8) var(--space-8); color:var(--muted-foreground); }
  .text-button { padding:0; border:0; background:transparent; color:var(--primary); font:inherit; text-decoration:underline; text-underline-offset:3px; cursor:pointer; }
  .register-empty .text-button { margin-top:var(--space-5); font-size:var(--text-xs); }
  .action-inspector { min-width:0; overflow:auto; background:var(--surface-elevated); }
  .action-chooser { padding:var(--space-12); }
  .action-chooser h3 { font-size:var(--text-lg); }
  .action-chooser > p { max-width:55ch; margin:var(--space-3) 0 var(--space-10); color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.6; }
  .action-options { border-top:1px solid var(--border); }
  .action-option { display:flex; align-items:center; gap:var(--space-6); width:100%; padding:var(--space-8) 0; border:0; border-bottom:1px solid var(--border); background:transparent; color:var(--foreground); text-align:left; cursor:pointer; }
  .option-icon { width:28px; height:28px; flex:0 0 auto; color:var(--primary); }
  .action-option > span:nth-child(2) { display:flex; flex-direction:column; gap:var(--space-2); }
  .action-option strong { font-size:var(--text-sm); font-weight:var(--weight-medium); }
  .action-option small { color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.5; }
  .arrow { width:18px; height:18px; flex:0 0 auto; margin-left:auto; fill:none; stroke:currentColor; stroke-width:1.5; color:var(--muted-foreground); }
  .action-option:hover:not(:disabled) { background:var(--surface-muted); }
  .action-chooser > .chooser-note { margin-top:var(--space-8); }
  .action-chooser > .saved-note { padding:var(--space-4) 0; color:var(--success); }
  button:focus-visible { outline:2px solid var(--ring); outline-offset:-2px; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  @media(max-width:760px) { .action-workspace { display:flex; height:auto; min-height:100%; flex-direction:column; } .action-register { flex:0 0 auto; overflow:visible; border-right:0; border-bottom:1px solid var(--border); } .action-inspector { flex:1; overflow:visible; } .action-chooser { padding:var(--space-8); } .register-note { padding-block:var(--space-5); } .editing .action-list { max-height:164px; overflow:auto; } .editing .register-note, .editing .advanced-note { display:none; } }
</style>
