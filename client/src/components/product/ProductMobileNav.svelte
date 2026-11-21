<script lang="ts">
  import LandingIcon from '../home/LandingIcon.svelte'
  import ProductAction from './ProductAction.svelte'
  import { DEVELOPER_LINKS, PRODUCT_LINKS, RESOURCE_LINKS, type ProductLink } from '../../lib/product-navigation'
  import { scrollToPublicSection } from '../../lib/public-section-navigation'
  import { auth } from '../../stores/auth.svelte'

  let { currentPath }: { currentPath: string } = $props()
  const id = $props.id()
  let trigger: HTMLButtonElement
  let panel: HTMLElement
  let open = $state(false)
  let top = $state(80)

  function place(event: Event) {
    if ((event as ToggleEvent).newState === 'open') top = trigger.closest('header')!.getBoundingClientRect().bottom + 8
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

{#snippet group(label: string, links: ProductLink[])}
  <details name={id} class:active={links.some(link => link.href === currentPath)}>
    <summary>{label}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
    <div class="group-links">
      {#each links as link}
        <a href={link.href} aria-current={currentPath === link.href ? 'page' : undefined} onclick={event => { close(); scrollToPublicSection(event) }}>
          <LandingIcon name={link.icon ?? 'arrow'} size={20} /><span>{link.label}</span>
          <span class="link-arrow"><LandingIcon name="arrow" size={15} /></span>
        </a>
      {/each}
    </div>
  </details>
{/snippet}

<button class="mobile-trigger" type="button" popovertarget={id} bind:this={trigger}
  aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls={id} aria-expanded={open}>
  <span>{open ? 'Close' : 'Menu'}</span>
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d={open ? 'm5 5 10 10M5 15 15 5' : 'M3 6h14M3 10h14M3 14h14'} /></svg>
</button>
<nav {id} class="mobile-navigation" aria-label="Mobile navigation" popover="auto" bind:this={panel}
  onbeforetoggle={place} ontoggle={() => open = panel.matches(':popover-open')}
  style:top="{top}px" style:max-height="calc(100dvh - {top}px - 12px)">
  <div class="mobile-links">
    {@render group('Product', PRODUCT_LINKS)}
    {@render group('Developers', DEVELOPER_LINKS)}
    <a class="pricing-link" href="/pricing" aria-current={currentPath === '/pricing' ? 'page' : undefined} onclick={close}>Pricing<LandingIcon name="arrow" size={18} /></a>
    {@render group('Resources', RESOURCE_LINKS)}
  </div>
  <div class="mobile-actions">
    <ProductAction href="/editor" label="Open editor" solid icon="direction" onclick={close} />
    {#if !auth.isLogged}<a class="mobile-login" href="/login" onclick={close}>Already have an account? <span>Log in <LandingIcon name="arrow" size={15} /></span></a>{/if}
  </div>
</nav>

<style>
  .mobile-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 12px; border: 1px solid var(--home-rule); border-radius: 8px; color: var(--home-ink); background: var(--home-surface); font: 500 13px var(--font-sans); cursor: pointer; }
  .mobile-trigger:hover, .mobile-trigger[aria-expanded='true'] { color: var(--home-accent); background: var(--home-tint); }
  .mobile-trigger svg, summary svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .mobile-navigation { position: fixed; left: auto; right: 12px; bottom: auto; width: 400px; max-width: calc(100vw - 24px); margin: 0; padding: 8px; border: 1px solid var(--home-rule); border-radius: 14px; background: var(--home-surface); color: var(--home-ink); overflow-y: auto; overscroll-behavior: contain; box-shadow: var(--shadow-popover); }
  .mobile-navigation::backdrop { background: transparent; }
  details + details, .pricing-link, .pricing-link + details { border-top: 1px solid var(--home-rule); }
  summary, .pricing-link { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 56px; padding: 16px; list-style: none; font-size: 16px; font-weight: 500; text-decoration: none; cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  summary:hover, details.active summary, .pricing-link:hover, .pricing-link[aria-current='page'] { color: var(--home-accent); }
  .pricing-link[aria-current='page'] { background: var(--home-tint); }
  details[open] summary svg { transform: rotate(180deg); }
  .group-links { display: grid; gap: 4px; padding: 0 8px 12px; }
  .group-links a { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 10px 12px; border-radius: 8px; color: var(--home-muted); font-size: 14px; text-decoration: none; }
  .group-links a:hover, .group-links a[aria-current='page'] { color: var(--home-accent); background: var(--home-tint); }
  .group-links a :global(svg) { flex-shrink: 0; }
  .link-arrow { display: flex; margin-left: auto; }
  .mobile-actions { display: grid; gap: 8px; margin-top: 8px; padding: 16px 8px 8px; border-top: 1px solid var(--home-rule); }
  .mobile-actions :global(.product-action) { border-radius: 8px; }
  .mobile-login { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 44px; color: var(--home-muted); font-size: 12px; text-decoration: none; }
  .mobile-login > span { display: inline-flex; align-items: center; gap: 8px; color: var(--home-ink); font-size: 13px; font-weight: 500; white-space: nowrap; }
  button:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--home-accent); outline-offset: -2px; border-radius: 8px; }
  @media (min-width: 1025px) { .mobile-trigger, .mobile-navigation { display: none; } }
</style>
