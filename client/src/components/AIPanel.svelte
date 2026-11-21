<script lang="ts">
  import { useAIPanel } from '../composables/useAIPanel.svelte'
  import BrowserPanel from './BrowserPanel.svelte'
  import CreditUsageNotice from './CreditUsageNotice.svelte'

  interface Props {
    instruction?: string
    floating?: boolean
    panelX?: number
    panelY?: number
    hidden?: boolean
    onDock?: () => void
  }

  let {
    instruction = $bindable(''),
    floating = $bindable(false),
    panelX = $bindable(0),
    panelY = $bindable(0),
    hidden = false,
    onDock,
  }: Props = $props()

  const aiPanel = useAIPanel({
    get instruction() { return instruction },
    set instruction(value) { instruction = value },
    get floating() { return floating },
    set floating(value) { floating = value },
    get panelX() { return panelX },
    set panelX(value) { panelX = value },
    get panelY() { return panelY },
    set panelY(value) { panelY = value },
    get onDock() { return onDock },
  })
</script>

<svelte:window onpointermove={aiPanel.movePanel} onpointerup={aiPanel.stopDragging} onpointercancel={aiPanel.stopDragging} onresize={aiPanel.handleResize} />

{#snippet panelActions()}
  <button
    type="button"
    class="panel-control drag-handle"
    class:dragging={aiPanel.dragging}
    aria-label={floating ? 'Move AI panel' : 'Undock and move AI panel'}
    title={floating ? 'Drag to move (arrow keys also work)' : 'Undock and move'}
    onkeydown={aiPanel.movePanelWithKeyboard}
    onclick={aiPanel.undockAtTopRight}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4h.01M13 4h.01M7 10h.01M13 10h.01M7 16h.01M13 16h.01" /></svg>
  </button>
  {#if floating}
     <button type="button" class="panel-control" aria-label="Dock AI panel" title="Return beside Text and Effects" onclick={aiPanel.dockPanel}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h12v13H4zM8 3.5v13" /></svg>
    </button>
  {/if}
{/snippet}

<div
  class="ai-panel-shell"
  role="presentation"
  class:floating
   class:dragging={aiPanel.dragging}
  hidden={hidden}
   bind:this={aiPanel.panelShell}
   style={aiPanel.style}
   onpointerdown={aiPanel.startDragging}
   oncontextmenu={aiPanel.preventHeaderContextMenu}
>
<BrowserPanel id="ai-panel" ariaLabel="AI edit assistant" title="AI Edit" width="medium" actions={panelActions}>
   <form class="ai-workbench" onsubmit={aiPanel.submitForm}>
    <label for="ai-instruction">Timeline instruction</label>
    <textarea
      id="ai-instruction"
      rows="2"
      bind:value={instruction}
       onkeydown={aiPanel.onKeydown}
       placeholder="Trim a clip, generate an image overlay, or add a voice-over saying ‘Welcome to the show’…"
       disabled={aiPanel.aiEdit.lifecycle.kind === 'working'}
       maxlength="4000"
     ></textarea>
      <CreditUsageNotice />
      <button type="submit" disabled={aiPanel.aiEdit.lifecycle.kind === 'working' || !instruction.trim()}>
         {#if aiPanel.aiEdit.lifecycle.kind === 'working'}<span class="spinner" aria-hidden="true"></span>Creating your edit...{:else}Edit timeline{/if}
      </button>
      <details class="advanced-settings"><summary>Edit options</summary>
      <label class="fast-toggle">
        <input type="checkbox" bind:checked={aiPanel.aiEdit.fast} disabled={aiPanel.aiEdit.lifecycle.kind === 'working'} />
        <span>Fast edit (one planning pass)</span>
      </label>
      </details>
      <span class="shortcut">Ctrl + Enter</span>
      {#if aiPanel.aiEdit.lifecycle.kind === 'working'}
        <p class="working-status" role="status" aria-live="polite" aria-atomic="true">{aiPanel.aiEdit.lifecycle.progress}</p>
     {/if}
   </form>

    {#if aiPanel.aiEdit.lifecycle.result}
      <div class="feedback success" role="status">
        {#if aiPanel.aiEdit.pendingRecommendation}<strong>AI recommendation</strong>{/if}
        <span>{aiPanel.aiEdit.lifecycle.result}</span>
        {#if aiPanel.aiEdit.pendingRecommendation}
          <button type="button" class="apply-recommendation" disabled={aiPanel.aiEdit.lifecycle.kind === 'working'} onclick={aiPanel.applyRecommendation}>Apply recommendation</button>
       {/if}
     </div>
   {/if}
    {#if aiPanel.aiEdit.lifecycle.kind === 'error'}
      <div class="feedback failure" role="alert">
        <strong>Edit not applied</strong>
        <span>{aiPanel.aiEdit.lifecycle.message}</span>
     </div>
   {/if}
</BrowserPanel>
</div>

<style>
  .ai-panel-shell { flex:0 0 var(--panel-sm); height:100%; min-width:0; }
  .ai-panel-shell[hidden] { display:none; }
  .ai-panel-shell :global(#ai-panel) { width:100%; }
   .ai-panel-shell.floating { position:fixed; z-index:var(--layer-global); width:min(320px, calc(100vw - 16px)); height:min(320px, calc(100vh - var(--height-topbar) - 16px)); overflow:hidden; border:1px solid var(--border-strong); border-radius:var(--radius-md); box-shadow:var(--shadow-dialog); transform:translate3d(0, 0, 0); will-change:left, top; }
  .ai-panel-shell.floating :global(#ai-panel) { border-right:0; }
  .ai-panel-shell.dragging { user-select:none; }
  .ai-panel-shell :global(.browser-panel-head) { cursor:grab; touch-action:none; }
  .ai-panel-shell.dragging :global(.browser-panel-head) { cursor:grabbing; }
  .panel-control { display:inline-flex; align-items:center; justify-content:center; width:var(--height-control-sm); height:var(--height-control-sm); min-height:0; padding:0; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--secondary); color:var(--muted-foreground); cursor:pointer; }
   .panel-control:hover { border-color:#593495; background:#593495; color:#fff; }
  .panel-control:focus-visible { outline:none; box-shadow:var(--focus-ring); }
  .panel-control svg { width:var(--icon-sm); height:var(--icon-sm); fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .drag-handle { cursor:grab; touch-action:none; }
  .drag-handle.dragging { cursor:grabbing; color:var(--primary); }
  .ai-workbench { display:flex; flex-direction:column; gap:var(--space-6); padding:var(--space-8); }
  label { color:var(--foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
   textarea { width:100%; min-height:60px; resize:vertical; padding:var(--space-4); border:1px solid var(--border-strong); border-radius:var(--radius-md); background:var(--input); color:var(--foreground); font:var(--text-xs)/var(--leading-copy) var(--font-sans); }
  textarea::placeholder { color:var(--muted-foreground); }
  textarea:focus-visible { outline:none; border-color:var(--primary); box-shadow:var(--focus-ring); }
  textarea:disabled { opacity:.65; }
  button { display:inline-flex; align-items:center; justify-content:center; gap:var(--space-4); min-height:var(--height-control-lg); border:1px solid var(--primary); border-radius:var(--radius-sm); background:var(--primary); color:var(--primary-foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; }
   button:hover:not(:disabled) { border-color:#593495; background:#593495; color:#fff; }
   .floating .ai-workbench { gap:var(--space-3); padding:var(--space-4); }
   .floating .fast-toggle { align-items:flex-start; justify-content:flex-start; }
   .floating .feedback { margin-inline:var(--space-4); }
  button:focus-visible { outline:none; box-shadow:var(--focus-ring); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .spinner { width:13px; height:13px; border:2px solid color-mix(in srgb, currentColor 35%, transparent); border-top-color:currentColor; border-radius:var(--radius-pill); animation:spin .75s linear infinite; }
  .shortcut { align-self:center; color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); }
  .fast-toggle { display:flex; align-items:center; justify-content:flex-start; gap:var(--space-4); color:var(--muted-foreground); font-size:var(--text-xs); cursor:pointer; }
  .fast-toggle input { accent-color:var(--primary); }
  .working-status { margin:0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-ui); text-align:center; overflow-wrap:anywhere; }
  .feedback { display:flex; flex-direction:column; gap:var(--space-3); margin:0 var(--space-8) var(--space-8); padding:var(--space-6); border:1px solid var(--border); border-radius:var(--radius-md); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .feedback.success { border-color:var(--success); background:var(--success-subtle); }
  .feedback.failure { border-color:var(--destructive); background:var(--destructive-subtle); }
  .feedback strong { color:var(--foreground); }
  .feedback span { color:var(--muted-foreground); overflow-wrap:anywhere; }
  .apply-recommendation { align-self:flex-start; min-height:var(--height-control-sm); padding:0 var(--space-6); }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration:1.5s; } }
  @media (max-width:760px), (max-width:900px) and (orientation:landscape) {
    .ai-panel-shell, .ai-panel-shell.floating { position:absolute; inset:0; z-index:40; width:100%; max-width:none; height:100%; flex:none; border:0; border-radius:0; box-shadow:none; }
    .drag-handle, .ai-panel-shell.floating .panel-control { display:none; }
  }
</style>
