<script lang="ts">
  import { useCompositionMenu } from '../composables/useCompositionMenu.svelte'
  import { editor } from '../stores/editor.svelte'
  import RecipeActions from './RecipeActions.svelte'
  import RecipeCodeEditor from './RecipeCodeEditor.svelte'

  const menu = useCompositionMenu()
  const hasError = $derived(menu.state.kind === 'error' || editor.documentSession?.kind === 'error')
  const statusLabel = $derived(menu.state.kind === 'compiling' ? 'Applying…' : menu.state.kind === 'saving' ? 'Saving…' : menu.state.kind === 'done' ? 'Ready' : hasError ? 'Needs review' : 'Draft')

  function changeView(view: 'actions' | 'code'): void {
    menu.view = view
  }

  function tabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    changeView(event.key === 'Home' ? 'actions' : event.key === 'End' ? 'code' : menu.view === 'actions' ? 'code' : 'actions')
    document.getElementById(`recipe-tab-${menu.view}`)?.focus()
  }
</script>

<button class="document-button" onclick={menu.open} aria-haspopup="dialog" title="Open the video recipe">
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5zM12 2.5v4h3M7.5 10h5M7.5 13h5" /></svg>
  <span>Recipe</span>{#if editor.documentSession?.kind === 'error'}<span class="attention">Needs review</span>{/if}
</button>

<dialog bind:this={menu.dialog} aria-labelledby="recipe-title" oncancel={(event) => event.preventDefault()}>
  <header class="dialog-heading">
    <div><h2 id="recipe-title">Video recipe</h2><p>Build actions for your edit. Choose the content, AI model and where it belongs.</p></div>
    <span class="recipe-status" class:is-error={hasError} class:is-done={menu.state.kind === 'done'}>{statusLabel}</span>
    <button type="button" class="close-button" onclick={menu.close} aria-label="Close video recipe" title="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
  </header>

  <div class="mode-bar">
    <div class="mode-tabs" role="tablist" aria-label="Recipe editing mode">
      <button id="recipe-tab-actions" type="button" role="tab" aria-selected={menu.view === 'actions'} aria-controls="recipe-actions-panel" tabindex={menu.view === 'actions' ? 0 : -1} class:active={menu.view === 'actions'} onclick={() => changeView('actions')} onkeydown={tabKeydown}>Actions</button>
      <button id="recipe-tab-code" type="button" role="tab" aria-selected={menu.view === 'code'} aria-controls="recipe-code-panel" tabindex={menu.view === 'code' ? 0 : -1} class:active={menu.view === 'code'} onclick={() => changeView('code')} onkeydown={tabKeydown}>Code DSL</button>
    </div>
    <div class="project-tools" aria-label="Recipe actions">
      <label class="import-button">Import recipe<input type="file" accept=".yaml,.yml,.json" onchange={menu.importFile} disabled={menu.busy} /></label>
      <button type="button" onclick={menu.useTimeline} disabled={menu.busy}>Use timeline</button>
      <button type="button" onclick={menu.download} disabled={menu.busy || menu.actions.editing}>{menu.state.kind === 'saving' ? 'Preparing YAML…' : 'Save YAML'}</button>
      <details class="more-tools"><summary>More <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary><div>
        <label>Starter action<select aria-label="Recipe template" bind:value={menu.starter} disabled={menu.busy}><option value="look">Style every video</option><option value="captions">Generate captions</option><option value="image">Image at 5–10 s</option><option value="scene">Animate a scene</option><option value="voice">Voice and captions</option></select></label>
        <button type="button" onclick={menu.useStarter} disabled={menu.busy}>Use template</button>
        <button type="button" onclick={menu.generalize} disabled={menu.busy} title="Create reusable style rules from the current timeline">Generalize timeline</button>
        {#if menu.hasRecipe}<button type="button" onclick={menu.useRecipe} disabled={menu.busy}>Edit rules</button>{/if}
        <a href="/docs">Open docs</a>
      </div></details>
    </div>
  </div>

  <div class="dialog-body">
    <div id="recipe-actions-panel" class="mode-panel" role="tabpanel" aria-labelledby="recipe-tab-actions" hidden={menu.view !== 'actions'}>
      <RecipeActions actions={menu.actions} assets={menu.assets} busy={menu.busy} onCode={() => changeView('code')} />
    </div>
    <div id="recipe-code-panel" class="mode-panel" role="tabpanel" aria-labelledby="recipe-tab-code" hidden={menu.view !== 'code'}>
      <RecipeCodeEditor bind:source={menu.source} assets={menu.assets} busy={menu.busy} onBind={menu.bindAsset} />
    </div>
  </div>

  <div class="feedback" aria-live="polite">
    {#if menu.state.kind === 'error'}<p class="error" role="alert">{menu.state.message}</p>
    {:else if menu.state.kind === 'done'}<p class="success" role="status">{menu.state.summary}</p>
    {:else if menu.state.kind === 'compiling'}<p role="status">Applying recipe… scene, image, voice and caption actions may take a moment.</p>
    {:else if menu.state.kind === 'saving'}<p role="status">Preparing editable text and text images for YAML export…</p>{/if}
    {#if editor.documentSession?.kind === 'error'}<p class="error">{editor.documentSession.message}</p>{/if}
  </div>

  <footer class="dialog-footer">
    <p>{menu.actions.editing ? 'Save or cancel the action before applying the recipe.' : 'Applies as one undoable edit.'}</p>
    <div><button type="button" class="secondary" onclick={menu.close}>Close</button><button type="button" class="primary" onclick={menu.apply} disabled={menu.busy || menu.actions.editing}>{menu.state.kind === 'compiling' ? 'Applying…' : menu.view === 'actions' ? 'Apply actions' : 'Compile and apply'}</button></div>
  </footer>
</dialog>

<style>
  .document-button { display:inline-flex; align-items:center; gap:var(--space-4); min-height:var(--height-control); padding:0 var(--space-6); border:1px solid transparent; border-radius:var(--radius-sm); background:transparent; color:var(--muted-foreground); font:var(--weight-medium) var(--text-xs)/1 var(--font-sans); cursor:pointer; white-space:nowrap; }
  .document-button:hover { border-color:var(--border); background:var(--surface-muted); color:var(--foreground); }
  .document-button svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.5; }
  .attention { color:var(--destructive); font-size:var(--text-2xs); }
  dialog { box-sizing:border-box; width:min(1100px,calc(100vw - 32px)); height:min(820px,calc(100dvh - 32px)); max-width:none; max-height:calc(100dvh - 32px); padding:0; overflow:hidden; border:1px solid var(--border-strong); border-radius:var(--radius-md); background:var(--surface-elevated); color:var(--foreground); box-shadow:var(--shadow-dialog); }
  dialog[open] { display:flex; flex-direction:column; animation:recipe-arrive 180ms cubic-bezier(.16,1,.3,1) both; }
  dialog::backdrop { background:var(--scrim); }
  .dialog-heading { display:flex; align-items:center; gap:var(--space-6); padding:var(--space-10) var(--space-12); border-bottom:1px solid var(--border); }
  .dialog-heading > div { min-width:0; flex:1; }
  h2 { margin:0; font-size:var(--text-lg); font-weight:var(--weight-semibold); }
  .dialog-heading p { margin:var(--space-3) 0 0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.5; }
  .recipe-status { color:var(--muted-foreground); font-size:var(--text-xs); white-space:nowrap; }
  .recipe-status.is-error { color:var(--destructive); }
  .recipe-status.is-done { color:var(--success); }
  .close-button { display:grid; width:32px; height:32px; flex:0 0 auto; padding:0; place-items:center; border:1px solid var(--border); border-radius:var(--radius-sm); background:transparent; color:var(--muted-foreground); cursor:pointer; }
  .close-button svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.5; }
  .mode-bar { display:flex; align-items:center; justify-content:space-between; gap:var(--space-6); min-height:54px; padding:0 var(--space-8); border-bottom:1px solid var(--border); background:var(--surface-elevated); }
  .mode-tabs { display:flex; align-self:stretch; flex:0 0 auto; }
  .mode-tabs button { position:relative; min-width:90px; padding:var(--space-5) var(--space-6); border:0; background:transparent; color:var(--muted-foreground); font:var(--weight-medium) var(--text-xs)/1 var(--font-sans); cursor:pointer; }
  .mode-tabs button.active { background:var(--primary-subtle); color:var(--primary); }
  .mode-tabs button.active::after { position:absolute; right:0; bottom:0; left:0; height:2px; background:var(--primary); content:''; }
  .project-tools { display:flex; align-items:center; gap:var(--space-3); }
  .project-tools > button, .import-button, summary { display:flex; align-items:center; justify-content:center; min-height:32px; padding:0 var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font:var(--text-xs)/1 var(--font-sans); cursor:pointer; white-space:nowrap; }
  .import-button { position:relative; overflow:hidden; }
  .import-button input { position:absolute; inset:0; width:100%; opacity:0; cursor:pointer; }
  .import-button:focus-within { outline:2px solid var(--ring); outline-offset:2px; }
  .more-tools { position:relative; }
  summary { gap:var(--space-2); list-style:none; }
  summary::-webkit-details-marker { display:none; }
  summary svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.5; }
  .more-tools > div { position:absolute; top:calc(100% + 5px); right:0; z-index:var(--layer-popover); display:flex; flex-direction:column; gap:var(--space-3); width:230px; padding:var(--space-6); border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:var(--surface-elevated); box-shadow:var(--shadow-popover); }
  .more-tools label { display:flex; flex-direction:column; gap:var(--space-3); font-size:var(--text-xs); }
  .more-tools select { min-height:32px; width:100%; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-xs)/1 var(--font-sans); }
  .more-tools button, .more-tools a { min-height:32px; padding:var(--space-4); border:0; border-radius:var(--radius-sm); background:transparent; color:var(--foreground); font:var(--text-xs)/1.4 var(--font-sans); text-align:left; text-decoration:none; cursor:pointer; }
  .more-tools button:hover:not(:disabled), .more-tools a:hover { background:var(--surface-muted); }
  .dialog-body { min-height:0; flex:1; overflow:hidden; }
  .mode-panel { height:100%; }
  .mode-panel[hidden] { display:none; }
  .feedback:empty { display:none; }
  .feedback { flex:0 0 auto; max-height:100px; overflow:auto; padding:var(--space-5) var(--space-8); border-top:1px solid var(--border); background:var(--surface-muted); }
  .feedback p { margin:0; font-size:var(--text-xs); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
  .feedback .error { color:var(--destructive); }
  .feedback .success { color:var(--success); }
  .dialog-footer { display:flex; align-items:center; justify-content:space-between; gap:var(--space-6); padding:var(--space-6) var(--space-8); border-top:1px solid var(--border); background:var(--surface-elevated); }
  .dialog-footer p { margin:0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:1.5; }
  .dialog-footer > div { display:flex; gap:var(--space-4); flex:0 0 auto; }
  .primary, .secondary { min-height:var(--height-control-lg); padding:0 var(--space-8); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font:var(--weight-medium) var(--text-xs)/1 var(--font-sans); cursor:pointer; }
  .primary { border-color:var(--primary); background:var(--primary); color:var(--primary-foreground); }
  .primary:hover:not(:disabled) { background:var(--primary-hover); }
  .secondary:hover:not(:disabled), .project-tools > button:hover:not(:disabled), .close-button:hover, summary:hover { background:var(--surface-muted); }
  button:focus-visible, summary:focus-visible, select:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  dialog :global(::selection) { background:var(--primary); color:var(--primary-foreground); }
  dialog :global(*) { scrollbar-color:var(--border-strong) transparent; scrollbar-width:thin; }
  @keyframes recipe-arrive { from { transform:translateY(5px); } to { transform:translateY(0); } }
  @media(max-width:760px) { dialog { width:calc(100vw - 16px); height:calc(100dvh - 16px); max-height:calc(100dvh - 16px); } .dialog-heading { padding:var(--space-6) var(--space-8); } .recipe-status { display:none; } .mode-bar { flex-wrap:wrap; gap:0; padding:0 var(--space-5) var(--space-4); } .mode-tabs { min-height:44px; } .project-tools { flex-wrap:wrap; width:100%; justify-content:flex-end; } .dialog-body { overflow:auto; } .mode-panel { height:auto; min-height:100%; } .dialog-footer { align-items:flex-start; flex-direction:column; gap:var(--space-4); } .dialog-footer > div { justify-content:flex-end; width:100%; } }
  @media(prefers-reduced-motion:reduce) { dialog[open] { animation:none; } }
</style>
