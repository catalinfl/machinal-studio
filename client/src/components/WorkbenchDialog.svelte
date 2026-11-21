<script lang="ts">
  import type { Snippet } from 'svelte'
  import { useWorkbenchDialog } from '../composables/useWorkbenchDialog.svelte'
  import CreditUsageNotice from './CreditUsageNotice.svelte'

  interface Props {
    id: string
    ariaLabel: string
    title: string
    subtitle?: string
    metered?: boolean
    width?: 'compact' | 'medium' | 'large'
    onClose?: () => void
    children: Snippet
  }

  let {
    id,
    ariaLabel,
    title,
    subtitle = '',
    metered = false,
    width = 'medium',
    onClose,
    children,
  }: Props = $props()
  const dialog = useWorkbenchDialog({ getOnClose: () => onClose })
</script>

<dialog
  {id}
  class="workbench-dialog"
  data-width={width}
  bind:this={dialog.dialogEl}
  aria-label={ariaLabel}
  aria-labelledby={`${id}-title`}
  aria-describedby={subtitle ? `${id}-description` : undefined}
  onclose={dialog.notifyClose}
  oncancel={(event) => { event.preventDefault(); dialog.closeDialog() }}
>
  <div class="dialog-shell">
    <header class="dialog-head">
      <div>
        <h2 id={`${id}-title`}>{title}</h2>
        {#if subtitle}<p id={`${id}-description`}>{subtitle}</p>{/if}
        {#if metered}<CreditUsageNotice />{/if}
      </div>
       <button type="button" class="close-button" onclick={dialog.closeDialog} aria-label={`Close ${title}`}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    <div class="dialog-body">
      {@render children()}
    </div>
  </div>
</dialog>

<style>
  .workbench-dialog {
    width:min(680px, calc(100vw - 48px));
    height:min(760px, calc(100dvh - 48px));
    max-width:none;
    max-height:none;
    margin:auto;
    padding:0;
    overflow:hidden;
    border:1px solid var(--border-strong);
    border-radius:var(--radius-lg);
    color:var(--foreground);
    background:var(--surface-elevated);
    box-shadow:var(--shadow-dialog);
    font-family:var(--font-sans);
    will-change:transform, opacity;
    animation:dialog-arrive 180ms cubic-bezier(.16, 1, .3, 1) both;
  }
  .workbench-dialog[data-width='large'] { width:min(780px, calc(100vw - 48px)); height:min(820px, calc(100dvh - 48px)); }
  .workbench-dialog[data-width='compact'] { width:min(460px, calc(100vw - 32px)); height:fit-content; max-height:calc(100dvh - 32px); }
  .workbench-dialog[data-width='compact'] .dialog-shell { height:auto; max-height:calc(100dvh - 34px); }
  .workbench-dialog::backdrop { background:var(--scrim); animation:scrim-fade 180ms ease-out both; }
  .dialog-shell { display:grid; grid-template-rows:auto minmax(0, 1fr); height:100%; }
  .dialog-head {
    min-height:76px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:var(--space-8);
    padding:var(--space-8) var(--space-10);
    border-bottom:1px solid var(--border);
    background:var(--surface-elevated);
  }
  .dialog-head > div { min-width:0; }
  .dialog-head h2 { margin:0; font-size:var(--text-xl); font-weight:var(--weight-bold); letter-spacing:-.025em; line-height:var(--leading-tight); }
  .dialog-head p { margin:var(--space-2) 0 0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-ui); }
   .close-button { width:32px; height:32px; display:grid; place-items:center; flex:0 0 auto; padding:0; border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--surface); cursor:pointer; transition:border-color 140ms ease, background-color 140ms ease, color 140ms ease; }
   .close-button:hover { border-color:var(--primary-border); color:var(--primary); background:var(--primary-subtle); }
   .close-button:focus-visible { outline:none; border-color:var(--primary); box-shadow:var(--focus-ring); }
  .close-button svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; }
  .dialog-body { min-height:0; overflow-x:hidden; overflow-y:auto; background:var(--surface); scrollbar-color:var(--border-strong) var(--surface); }

  @media (prefers-reduced-motion:reduce) { .workbench-dialog { animation:none; } }
  @media (max-width:760px) {
    .workbench-dialog, .workbench-dialog[data-width='large'] { width:100vw; height:100dvh; border:0; border-radius:0; }
    .dialog-head { min-height:68px; padding:var(--space-6); }
  }
  @media (pointer:coarse) { .close-button { width:40px; height:40px; } }
</style>
