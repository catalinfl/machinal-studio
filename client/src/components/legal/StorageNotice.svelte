<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { privacyNotice } from '../../stores/privacy.svelte'
  import LandingIcon from '../home/LandingIcon.svelte'

  let heading = $state<HTMLHeadingElement>()
  let returnFocus: HTMLElement | null = null

  $effect(() => {
    if (privacyNotice.view !== 'details') return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void tick().then(() => { if (privacyNotice.view === 'details') heading?.focus() })
  })

  function dismiss(): void {
    privacyNotice.acknowledge()
    if (returnFocus?.isConnected) returnFocus.focus()
    returnFocus = null
  }

  onMount(privacyNotice.initialize)
</script>

{#if privacyNotice.view !== 'closed'}
  <aside class="home storage-notice" aria-labelledby="storage-notice-title">
    <div class="notice-heading"><h2 id="storage-notice-title" tabindex="-1" bind:this={heading}>Cookies &amp; local storage</h2><LandingIcon name="file" size={21} /></div>
    <p>We use browser storage to keep you signed in and make the tools you choose work. No analytics or advertising trackers.</p>
    {#if privacyNotice.view === 'details'}
      <dl>
        <div><dt>Necessary for the service <span>Always active</span></dt><dd>Sign-in, project sessions, job recovery and remembering that you closed this notice.</dd></div>
        <div><dt>Features you choose <span>On request</span></dt><dd>Your appearance, editing drafts and browser-local project media. These are not used to track you across sites.</dd></div>
      </dl>
      <p class="notice-detail">There are no optional tracking cookies to accept or reject. Closing this notice is not consent to tracking. Read the <a href="/cookies">storage inventory</a> or our <a href="/privacy">Privacy Policy</a>.</p>
      {#if privacyNotice.persistence === 'unavailable'}<p class="notice-detail" role="status">Your browser is blocking saved preferences. You can close this notice for this visit, but it may appear again after reloading.</p>{/if}
    {:else}
      <a class="policy-link" href="/privacy">Read our Privacy Policy <LandingIcon name="arrow" size={14} /></a>
    {/if}
    <div class="notice-actions">
      {#if privacyNotice.view === 'notice'}<button class="button" type="button" onclick={privacyNotice.open}>View details</button>{:else}<a class="button" href="/cookies">Full storage policy</a>{/if}
      <button class="button button-solid" type="button" onclick={dismiss}>{privacyNotice.view === 'details' ? 'Close notice' : 'Got it'}</button>
    </div>
  </aside>
{/if}

<style>
  .storage-notice { position: fixed; z-index: var(--layer-global); right: 24px; bottom: 24px; width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow-y: auto; flex: none; padding: 24px; border: 1px solid var(--home-rule); background: var(--home-surface); box-shadow: var(--shadow-popover); }
  .notice-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  h2 { margin: 0; font-size: 20px; font-weight: 500; line-height: 1.3; letter-spacing: -.025em; }
  .notice-heading :global(svg) { color: var(--home-accent); flex-shrink: 0; }
  p { margin: 14px 0; color: var(--home-muted); font-size: 14px; line-height: 1.7; }
  .policy-link { display: inline-flex; align-items: center; gap: 10px; min-height: 32px; font-size: 12px; }
  .notice-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
  .notice-actions .button { justify-content: center; min-height: 44px; padding-inline: 10px; font-size: 13px; }
  dl { margin: 18px 0; border-top: 1px solid var(--home-rule); }
  dl > div { padding: 14px 0; border-bottom: 1px solid var(--home-rule); }
  dt { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; font-size: 13px; font-weight: 500; }
  dt span { color: var(--home-accent); font-size: 12px; font-weight: 400; }
  dd { margin: 6px 0 0; color: var(--home-muted); font-size: 13px; line-height: 1.65; }
  .notice-detail { font-size: 12px; }
  @media (max-width: 600px) { .storage-notice { right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); padding: 20px; } }
</style>
