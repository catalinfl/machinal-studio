<script lang="ts">
  import type { ContextMenuIcon, ContextMenuItem } from '../lib/context-menu'
  import { useContextMenu } from '../composables/useContextMenu.svelte'

  let {
    x,
    y,
    title,
    detail,
    icon,
    items,
    onClose,
  }: {
    x: number
    y: number
    title: string
    detail: string
    icon: ContextMenuIcon
    items: ContextMenuItem[]
    onClose: () => void
  } = $props()

  const menu = useContextMenu({ getX: () => x, getY: () => y, getOnClose: () => onClose })
</script>

<div
  class="context-menu"
  class:positioned={menu.positioned}
  bind:this={menu.menuEl}
  style:left="{menu.left}px"
  style:top="{menu.top}px"
  role="menu"
  tabindex="-1"
  aria-label="Actions for {title}"
  onkeydown={menu.onMenuKeyDown}
  oncontextmenu={menu.preventContextMenu}
>
  <div class="menu-head">
    <span class="head-icon" aria-hidden="true">
      {#if icon === 'audio'}
        <svg viewBox="0 0 20 20"><path d="M7 14.5V5.8l8-1.8v8.5M7 14.5c0 1.1-1.1 2-2.5 2S2 15.6 2 14.5s1.1-2 2.5-2 2.5.9 2.5 2Zm8-2c0 1.1-1.1 2-2.5 2s-2.5-.9-2.5-2 1.1-2 2.5-2 2.5.9 2.5 2Z" /></svg>
      {:else}
        <svg viewBox="0 0 20 20"><rect x="3" y="5" width="10" height="10" rx="1.5"/><path d="m13 8 4-2v8l-4-2" /></svg>
      {/if}
    </span>
    <span class="head-copy">
      <strong>{title}</strong>
      <small>{detail}</small>
    </span>
  </div>

  <div class="menu-items">
    {#each items as item}
      {#if item.type === 'separator'}
        <div class="separator" role="separator"></div>
      {:else}
        <button
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          class:destructive={item.destructive}
          disabled={item.disabled}
           onclick={menu.chooseItem(item)}
        >
          <span class="item-icon" aria-hidden="true">
            {#if item.icon === 'inspect'}
              <svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M12 3v14M6 7h3M6 10h3M6 13h3" /></svg>
            {:else if item.icon === 'split'}
              <svg viewBox="0 0 20 20"><circle cx="5.5" cy="5.5" r="2.5"/><circle cx="5.5" cy="14.5" r="2.5"/><path d="m7.5 7 8 6M7.5 13l8-6" /></svg>
            {:else if item.icon === 'copy'}
              <svg viewBox="0 0 20 20"><rect x="6" y="6" width="10" height="10" rx="1.5"/><path d="M13 6V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H6" /></svg>
            {:else if item.icon === 'link' || item.icon === 'unlink'}
              <svg viewBox="0 0 20 20"><path d="M8 12.5 6.5 14a3 3 0 0 1-4.2-4.2l2.5-2.5A3 3 0 0 1 9 7M12 7.5 13.5 6a3 3 0 1 1 4.2 4.2l-2.5 2.5A3 3 0 0 1 11 13M7 10h6" />{#if item.icon === 'unlink'}<path d="m4 3 12 14" />{/if}</svg>
            {:else if item.icon === 'speed'}
              <svg viewBox="0 0 20 20"><path d="M3.5 14.5a7 7 0 1 1 13 0M10 10l4-3M6 15h8" /></svg>
            {:else if item.icon === 'mute'}
              <svg viewBox="0 0 20 20"><path d="M3 8h3l4-3v10l-4-3H3zM14 8l4 4M18 8l-4 4" /></svg>
            {:else if item.icon === 'lock'}
              <svg viewBox="0 0 20 20"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6a3 3 0 0 1 6 0v3" /></svg>
            {:else if item.icon === 'unlock'}
              <svg viewBox="0 0 20 20"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6a3 3 0 0 1 5.5-1.7" /></svg>
            {:else if item.icon === 'eye'}
              <svg viewBox="0 0 20 20"><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z"/><circle cx="10" cy="10" r="2" /></svg>
            {:else if item.icon === 'track'}
              <svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="4" rx="1"/><rect x="3" y="12" width="14" height="4" rx="1"/><path d="M7 6h7M7 14h7" /></svg>
            {:else if item.icon === 'delete'}
              <svg viewBox="0 0 20 20"><path d="M4 6h12M8 3h4l1 3M6 6l.7 11h6.6L14 6M8.5 9v5M11.5 9v5" /></svg>
            {:else if item.icon === 'audio'}
              <svg viewBox="0 0 20 20"><path d="M7 14.5V5.8l8-1.8v8.5M7 14.5c0 1.1-1.1 2-2.5 2S2 15.6 2 14.5s1.1-2 2.5-2 2.5.9 2.5 2Zm8-2c0 1.1-1.1 2-2.5 2s-2.5-.9-2.5-2 1.1-2 2.5-2 2.5.9 2.5 2Z" /></svg>
            {:else}
              <svg viewBox="0 0 20 20"><rect x="3" y="5" width="10" height="10" rx="1.5"/><path d="m13 8 4-2v8l-4-2" /></svg>
            {/if}
          </span>
          <span class="item-label">{item.label}</span>
          {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
          {#if item.checked}
            <svg class="check" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
</div>

<style>
  .context-menu {
    position: fixed; z-index: var(--layer-global);
    width: min(252px, calc(100vw - 16px));
    max-height: calc(100dvh - 16px); overflow-y: auto;
    border: 1px solid var(--border-strong); border-radius: var(--radius-md);
    color: var(--foreground); background: var(--surface-elevated);
    box-shadow: var(--shadow-popover);
    font-family: var(--font-sans);
    visibility: hidden;
    transform-origin: top left;
    animation: menu-in 120ms cubic-bezier(.2, .8, .2, 1);
  }
  .context-menu.positioned { visibility: visible; }
  @keyframes menu-in {
    from { opacity: 0; transform: translateY(-3px) scale(.985); }
  }
  .menu-head {
    display: flex; align-items: center; gap: var(--space-5);
    min-height: 48px; padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .head-icon {
    width: 28px; height: 28px; flex: 0 0 auto;
    display: grid; place-items: center;
    border: 1px solid var(--primary-border); border-radius: var(--radius-sm);
    color: var(--primary); background: var(--primary-subtle);
  }
  .head-icon svg { width: 16px; height: 16px; }
  .head-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .head-copy strong { overflow: hidden; color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
  .head-copy small { overflow: hidden; color: var(--muted-foreground); font: var(--text-2xs)/1.2 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
  .menu-items { padding: var(--space-3); }
  button {
    width: 100%; min-height: 32px; padding: 0 var(--space-4);
    display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: var(--space-4);
    border: 0; border-radius: var(--radius-sm);
    color: var(--foreground); background: transparent;
    font-size: var(--text-xs); text-align: left; cursor: pointer;
  }
  button:hover, button:focus-visible { outline: 0; color: var(--primary); background: var(--primary-subtle); }
  button:focus-visible { box-shadow: inset 0 0 0 1px var(--primary-border); }
  button:disabled { color: var(--muted-foreground); opacity: .5; cursor: not-allowed; background: transparent; }
  button.destructive:not(:disabled) { color: var(--destructive); }
  button.destructive:hover, button.destructive:focus-visible { color: var(--destructive); background: var(--destructive-subtle); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--destructive) 42%, transparent); }
  .item-icon { width: 18px; height: 18px; display: grid; place-items: center; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  kbd {
    min-width: 0; padding: 0;
    color: var(--muted-foreground); background: transparent;
    font: 9px/1 var(--font-mono); white-space: nowrap;
  }
  .check { width: 15px; height: 15px; color: var(--primary); }
  button:has(.check) { grid-template-columns: 18px minmax(0, 1fr) auto; }
  button:has(kbd):has(.check) { grid-template-columns: 18px minmax(0, 1fr) auto auto; }
  .separator { height: 1px; margin: var(--space-3) var(--space-4); background: var(--border); }

  @media (pointer: coarse) {
    .context-menu { width: min(280px, calc(100vw - 16px)); }
    button { min-height: 40px; }
  }
</style>
