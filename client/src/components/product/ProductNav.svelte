<script lang="ts">
  import LandingIcon from '../home/LandingIcon.svelte'
  import BrandMark from '../BrandMark.svelte'
  import SessionMenu from '../SessionMenu.svelte'
  import ProductNavDropdown from './ProductNavDropdown.svelte'
  import ProductMobileNav from './ProductMobileNav.svelte'
  import { DEVELOPER_LINKS, PRODUCT_LINKS, RESOURCE_LINKS } from '../../lib/product-navigation'
  import { auth } from '../../stores/auth.svelte'

  let { currentPath = '/' }: { currentPath?: string } = $props()
</script>

<header class="product-nav">
  <div class="navigation-row">
    <a class="product-brand" href="/" aria-label="machinal home"><BrandMark />machinal</a>
    <nav class="desktop-navigation" aria-label="Product navigation">
      <ProductNavDropdown label="Product" links={PRODUCT_LINKS} columns={2} {currentPath} />
      <ProductNavDropdown label="Developers" links={DEVELOPER_LINKS} {currentPath} />
      <a href="/pricing" aria-current={currentPath === '/pricing' ? 'page' : undefined}>Pricing</a>
      <ProductNavDropdown label="Resources" links={RESOURCE_LINKS} {currentPath} />
    </nav>
    <div class="account-actions">
      <SessionMenu navigation {currentPath} />
      {#if !auth.isLogged}<a class="login-link" href="/login">Log in</a>{/if}
      <a class="open-editor" href="/editor"><span>Open editor</span><LandingIcon name="direction" size={16} /></a>
      <div class="mobile-menu"><ProductMobileNav {currentPath} /></div>
    </div>
  </div>
</header>

<style>
  .product-nav { background: var(--home-surface); border-bottom: 1px solid var(--home-rule); }
  .navigation-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px; min-height: 76px; max-width: 1600px; margin-inline: auto; padding: 12px 5%; }
  .product-brand { display: inline-flex; align-items: center; justify-self: start; gap: 10px; white-space: nowrap; font-size: 22px; letter-spacing: -.04em; font-weight: 600; text-decoration: none; }
  .desktop-navigation { display: flex; align-items: center; gap: 4px; }
  .desktop-navigation > a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 14px; border-radius: 8px; color: var(--home-muted); font-size: 14px; font-weight: 500; text-decoration: none; }
  .desktop-navigation > a[aria-current='page'], .desktop-navigation > a:hover { color: var(--home-accent); background: var(--home-tint); }
  .account-actions { display: flex; align-items: center; justify-self: end; gap: 8px; }
  .login-link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 12px; color: var(--home-ink); font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 8px; white-space: nowrap; }
  .login-link:hover { background: var(--home-tint); color: var(--home-accent); }
  .open-editor { display: inline-flex; align-items: center; gap: 16px; min-height: 44px; border: 1px solid var(--home-lilac); border-radius: 8px; background: var(--home-lilac); color: #262a30; padding: 10px 16px; font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap; }
  .open-editor:hover { background: #d5c2ff; border-color: #d5c2ff; }
  .mobile-menu { display: none; }
  @media (max-width: 1280px) { .navigation-row { gap: 16px; } .desktop-navigation > a { padding-inline: 12px; } }
  @media (max-width: 1024px) { .navigation-row { grid-template-columns: 1fr auto; } .desktop-navigation { display: none; } .mobile-menu { display: block; } }
  @media (max-width: 600px) { .navigation-row { gap: 12px; min-height: 72px; padding-inline: 16px; } .product-brand { --brand-mark-size: 32px; font-size: 20px; gap: 8px; } .open-editor, .login-link { display: none; } .account-actions { gap: 8px; } }
</style>
