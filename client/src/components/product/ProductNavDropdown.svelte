<script lang="ts">
  import LandingIcon from '../home/LandingIcon.svelte'
  import type { ProductLink } from '../../lib/product-navigation'
  import { scrollToPublicSection } from '../../lib/public-section-navigation'

  let { label, links, currentPath, columns = 1 }: { label: string; links: ProductLink[]; currentPath: string; columns?: 1 | 2 } = $props()
  const id = $props.id()
  let trigger: HTMLButtonElement
  let panel: HTMLDivElement
  let open = $state(false)
  let position = $state({ top: 0, left: 0 })

  function place(event: Event) {
    if ((event as ToggleEvent).newState !== 'open') return
    const rect = trigger.getBoundingClientRect()
    const width = columns === 2 ? 536 : 360
    position = { top: rect.bottom + 12, left: Math.max(12, Math.min(rect.left - 12, window.innerWidth - width - 12)) }
  }

  function close() {
    panel?.hidePopover()
  }

  $effect(() => {
    currentPath
    close()
  })
</script>

<svelte:window onresize={close} />

<button type="button" class:active={links.some(link => link.href === currentPath)} bind:this={trigger}
  popovertarget={id} aria-expanded={open} aria-controls={id}>
  {label}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
</button>
<div {id} class="nav-dropdown" class:two-columns={columns === 2} popover="auto" bind:this={panel} onbeforetoggle={place}
  ontoggle={() => open = panel.matches(':popover-open')} style:top="{position.top}px" style:left="{position.left}px">
  {#each links as link}
    <a href={link.href} aria-current={currentPath === link.href ? 'page' : undefined} onclick={event => { close(); scrollToPublicSection(event) }}>
      <span class="destination-icon"><LandingIcon name={link.icon ?? 'arrow'} size={22} /></span>
      <span><strong>{link.label}</strong><small>{link.description}</small></span>
      <span class="destination-arrow"><LandingIcon name={link.href.startsWith('https:') ? 'direction' : 'arrow'} size={15} /></span>
    </a>
  {/each}
</div>

<style>
  button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; color: var(--home-muted); font: 500 14px var(--font-sans); cursor: pointer; white-space: nowrap; }
  button:hover, button.active, button[aria-expanded='true'] { color: var(--home-accent); background: var(--home-tint); }
  button > svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .nav-dropdown { position: fixed; bottom: auto; right: auto; width: 360px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 100px); overflow-y: auto; margin: 0; padding: 8px; border: 1px solid var(--home-rule); border-radius: 14px; background: var(--home-surface); color: var(--home-ink); box-shadow: var(--shadow-popover); }
  .nav-dropdown:popover-open { display: grid; gap: 4px; }
  .two-columns { width: 536px; grid-template-columns: 1fr 1fr; }
  a { display: flex; align-items: center; gap: 12px; min-height: 84px; padding: 16px 12px; border-radius: 8px; text-decoration: none; }
  a:hover, a[aria-current='page'] { background: var(--home-tint); }
  a > span { min-width: 0; }
  .destination-icon { display: inline-flex; flex: 0 0 auto; color: var(--home-accent); }
  .destination-arrow { display: inline-flex; flex: 0 0 auto; margin-left: auto; color: var(--home-muted); }
  strong { display: block; font-size: 14px; font-weight: 500; }
  small { display: block; margin-top: 4px; color: var(--home-muted); font-size: 12px; line-height: 1.5; }
  a :global(svg) { flex-shrink: 0; }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 2px; }
  @media (max-width: 1280px) { button { padding-inline: 12px; } }
  @media (prefers-reduced-motion: no-preference) { button > svg { transition: transform 160ms ease; } button[aria-expanded='true'] > svg { transform: rotate(180deg); } .nav-dropdown:popover-open { animation: reveal 160ms cubic-bezier(.16, 1, .3, 1); } }
  @keyframes reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
</style>
