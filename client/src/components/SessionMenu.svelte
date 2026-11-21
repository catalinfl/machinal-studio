<script lang="ts">
  import { useTheme } from '../composables/useTheme.svelte'
  import { openRouterSetup } from '../stores/openrouterSetup.svelte'

  let { command = false, currentPath = '', navigation = false }: { command?: boolean; currentPath?: string; navigation?: boolean } = $props()
  const theme = useTheme()
  const id = $props.id()
  let panel: HTMLDivElement
  let open = $state(false)

  function configureAI(): void {
    panel.hidePopover()
    void openRouterSetup.openSettings()
  }
</script>

<div class="settings" class:command class:navigation>
  <button type="button" popovertarget={id} aria-label="Open settings" aria-expanded={open} aria-controls={id}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h5m4 0h5M3 14h9m4 0h1"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="14" r="2"/></svg>
    Settings
  </button>
  <div {id} popover="auto" bind:this={panel} ontoggle={() => open = panel.matches(':popover-open')} class="settings-panel">
    <strong>Local workspace</strong>
    <p>Your media stays in this installation.</p>
    <button type="button" onclick={configureAI}>OpenRouter API key</button>
    <div class="appearance" role="group" aria-label="Color theme">
      <button type="button" aria-pressed={theme.theme === 'light'} onclick={() => theme.setTheme('light')}>Light</button>
      <button type="button" aria-pressed={theme.theme === 'dark'} onclick={() => theme.setTheme('dark')}>Dark</button>
    </div>
    <a href="/toolkit" aria-current={currentPath === '/toolkit' ? 'page' : undefined}>Explore the toolkit</a>
    <a href="/docs" aria-current={currentPath === '/docs' ? 'page' : undefined}>Local setup &amp; documentation</a>
  </div>
</div>

<style>
  .settings { flex-shrink: 0; }
  button, a { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--foreground); font: 500 var(--text-xs)/1.4 var(--font-sans); text-decoration: none; cursor: pointer; }
  button:hover, a:hover { background: var(--surface-muted); }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .settings-panel { position: fixed; inset: 64px 12px auto auto; box-sizing: border-box; margin: 0; width: min(300px, calc(100vw - 24px)); padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-elevated); color: var(--foreground); box-shadow: var(--shadow-popover); font-family: var(--font-sans); }
  strong { font-size: var(--text-sm); }
  p { color: var(--muted-foreground); font-size: var(--text-xs); line-height: 1.6; }
  .settings-panel > button, a { width: 100%; box-sizing: border-box; margin-top: 8px; }
  .appearance { display: flex; gap: 8px; margin-block: 12px; }
  .appearance button { flex: 1; justify-content: center; }
  [aria-pressed='true'] { color: var(--primary); border-color: var(--primary); }
</style>
