<script lang="ts">
  import type { Snippet } from 'svelte'
  import { useInspector } from '../composables/useInspector.svelte'

  interface InspectorProps {
    id: string
    ariaLabel: string
    eyebrow: string
    title: string
    selectionLabel?: string
    onClose: () => void
    children: Snippet
  }

  let {
    id,
    ariaLabel,
    eyebrow,
    title,
    selectionLabel = '',
    onClose,
    children,
  }: InspectorProps = $props()

  const inspector = useInspector(() => onClose)
</script>

<svelte:window onkeydown={inspector.onWindowKeydown} />

<aside {id} class="inspector-shell" aria-label={ariaLabel}>
  <header class="inspector-head">
    <div class="inspector-heading">
      <h2>{title}</h2>
      {#if selectionLabel}<span class="inspector-selection-label">{selectionLabel}</span>{/if}
    </div>
    <button class="inspector-close" type="button" onclick={onClose} aria-label="Close inspector" title="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
  </header>
  <div class="inspector-body">
    {@render children()}
  </div>
</aside>

<style>
  .inspector-close svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.6; }
  :global(.inspector-shell) {
    flex: 0 0 var(--panel-sm);
    height: 100%; min-width: 0; overflow-y: auto;
    box-sizing: border-box;
    color: var(--foreground); background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow-overlay);
  }
  :global(.inspector-head) {
    min-height: 54px; padding: var(--space-6) var(--space-6) var(--space-5) var(--space-8);
    box-sizing: border-box;
    display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-6);
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--border);
  }
  :global(.inspector-heading) { min-width: 0; }
  :global(.inspector-eyebrow) {
    display: block; margin-bottom: var(--space-2);
    color: var(--muted-foreground); font-size: var(--text-2xs); font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label); text-transform: uppercase;
  }
  :global(.inspector-head h2) {
    margin: 0; color: var(--foreground); font-size: var(--text-md); line-height: var(--leading-tight); font-weight: var(--weight-semibold);
  }
  :global(.inspector-selection-label) {
    display: block; max-width: 245px; margin-top: var(--space-2);
    overflow: hidden; color: var(--muted-foreground); font-size: var(--text-2xs);
    text-overflow: ellipsis; white-space: nowrap;
  }
  :global(.inspector-close) {
    width: var(--height-control-sm); height: var(--height-control-sm); flex: 0 0 auto; padding: 0;
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--muted-foreground); background: var(--secondary); cursor: pointer; font-size: var(--text-lg);
  }
  :global(.inspector-close:hover) { color: var(--foreground); border-color: var(--border-strong); background: var(--surface-muted); }
  :global(.inspector-close:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
  :global(.inspector-accent) { height: 2px; background: var(--primary); }
  :global(.inspector-body > section),
  :global(.inspector-body > .section) { padding: var(--space-8); border-bottom: 1px solid var(--border); }
  :global(.inspector-body .section-title) {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--space-4); margin-bottom: var(--space-6);
  }
  :global(.inspector-body .section-title h3),
  :global(.inspector-body > section > h3) {
    margin: 0; color: var(--foreground); font-size: var(--text-2xs); font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label); text-transform: uppercase;
  }
  :global(.inspector-body .section-title > span) { color: var(--muted-foreground); font-size: var(--text-2xs); }
  :global(.inspector-body input),
  :global(.inspector-body select),
  :global(.inspector-body textarea) {
    box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--radius-sm);
    outline: 0; color: var(--foreground); background-color: var(--input);
    font-family: var(--font-sans); font-size: var(--text-2xs);
  }
  :global(.inspector-body input:focus),
  :global(.inspector-body select:focus),
  :global(.inspector-body textarea:focus) {
    border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent);
  }
  :global(.inspector-body input[type='range']),
  :global(.inspector-body input[type='range']:focus) {
    border: 0; border-radius: var(--radius-pill); background: transparent; box-shadow: none;
  }
  :global(.inspector-body .field) {
    min-height: 42px; display: flex; align-items: center;
    justify-content: space-between; gap: var(--space-6); border-top: 1px solid var(--border);
  }
  :global(.inspector-body .field-copy) {
    min-width: 0; display: flex; flex-direction: column; gap: var(--space-1);
  }
  :global(.inspector-body .field-copy strong) { color: var(--foreground); font-size: var(--text-2xs); font-weight: var(--weight-medium); }
  :global(.inspector-body .field-copy small) { color: var(--muted-foreground); font-size: var(--text-2xs); white-space: nowrap; }
  :global(.inspector-body input:disabled),
  :global(.inspector-body button:disabled) { opacity: .4; cursor: not-allowed; }
  @media (max-width: 900px) {
    :global(.inspector-shell) {
      position: absolute; inset: 0 0 0 auto; z-index: 60;
      width: min(340px, 92vw); max-width: 100%;
      box-shadow: var(--shadow-overlay);
    }
  }
  @media (max-width: 1024px) {
    :global(.inspector-shell) {
      inset: 0;
      width: 100%;
      max-width: none;
      flex-basis: 100%;
      border-left: 0;
    }
    :global(.inspector-close) { width: 34px; height: 34px; }
  }
</style>
