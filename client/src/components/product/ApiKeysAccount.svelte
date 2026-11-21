<script lang="ts">
  import { useCredits } from '../../composables/useCredits.svelte'
  import ApiCredentials from './ApiCredentials.svelte'
  import CreditBalance from './CreditBalance.svelte'
  import CreditPurchaseDialog from './CreditPurchaseDialog.svelte'

  const account = useCredits()
</script>

<header class="keys-intro"><div><h1>API Keys</h1><p>Manage access to your creative engine.<br />Your keys, included credits and top-ups, in one place.</p></div><nav aria-label="API account shortcuts"><CreditPurchaseDialog {account} /><a class="quiet-button" href="#credits">View credits</a><a class="quiet-button" href="/api">Open API workspace</a></nav></header>
<div class="account-workspace"><ApiCredentials /><aside id="credits" aria-label="API credit account"><CreditBalance {account} /></aside></div>

<style>
  .keys-intro { display: flex; align-items: end; justify-content: space-between; flex-wrap: wrap; gap: 24px; margin-bottom: 28px; }
  .keys-intro p { margin: 14px 0 0; color: var(--home-muted); font-size: 14px; line-height: 1.7; }
  .keys-intro nav { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .account-workspace { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr); align-items: start; gap: 28px; }
  aside { min-width: 0; background: var(--home-surface); border: 1px solid var(--home-rule); scroll-margin-top: 24px; }
  a:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
  @media (max-width: 1000px) { .account-workspace { grid-template-columns: 1fr; gap: 0; } }
</style>
