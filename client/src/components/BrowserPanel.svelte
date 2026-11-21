<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    id: string
    ariaLabel: string
    title: string
    subtitle?: string
    width?: 'small' | 'medium' | 'large'
    actions?: Snippet
    children: Snippet
  }

  let {
    id,
    ariaLabel,
    title,
    subtitle = '',
    width = 'small',
    actions,
    children,
  }: Props = $props()
</script>

<aside {id} class="browser-panel ui-panel" data-width={width} aria-label={ariaLabel}>
  <header class="browser-panel-head ui-panel-head">
    <div class="browser-panel-copy">
      <h2 class="ui-panel-title">{title}</h2>
      {#if subtitle}<span class="ui-panel-subtitle">{subtitle}</span>{/if}
    </div>
    {#if actions}<div class="browser-panel-actions">{@render actions()}</div>{/if}
  </header>
  <div class="browser-panel-body">
    {@render children()}
  </div>
</aside>

<style>
  .browser-panel {
    display: flex;
    flex-direction: column;
    flex: 0 0 var(--panel-sm);
    height: 100%;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }
  .browser-panel :global(.ui-panel-head) { min-height: 60px; padding: 10px 16px; background: var(--surface-elevated); border-bottom: 1px solid var(--border-strong); }
  .browser-panel :global(.ui-panel-title) { font-size: 17px; letter-spacing: -.035em; line-height: 1.05; }
  .browser-panel :global(.ui-panel-subtitle) { margin-top: 3px; font-size: 10px; }
  .browser-panel[data-width='medium'] { flex-basis: var(--panel-md); }
  .browser-panel[data-width='large'] { flex-basis: var(--panel-lg); }
  .browser-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    flex: 0 0 auto;
  }
  .browser-panel-copy { min-width: 0; }
  .browser-panel-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .browser-panel-body {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    background: var(--surface);
  }

  @media (max-width: 1024px) {
    .browser-panel,
    .browser-panel[data-width='medium'],
    .browser-panel[data-width='large'] {
      flex: none;
      width: 100%;
      max-width: none;
      border-right: 0;
    }
    .browser-panel-head {
      min-height: 60px;
      padding: var(--space-6) var(--space-8);
    }
  }
</style>
