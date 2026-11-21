<script lang="ts">
  import { useCredits } from '../composables/useCredits.svelte'
  import { formatCredits } from '../lib/credits'

  const credits = useCredits({ handlePaymentReturn: false })
</script>

<div class="credit-overview" aria-label="Credit balance" aria-busy={credits.phase.kind === 'loading'}>
  <div class="heading"><strong>Credit balance</strong><button type="button" disabled={credits.phase.kind === 'loading'} onclick={() => credits.load()}>Refresh</button></div>
  {#if credits.phase.kind === 'loading'}
    <p role="status">Loading credits…</p>
  {:else if credits.phase.kind === 'error'}
    <p role="alert">{credits.phase.message}</p>
    <button type="button" onclick={() => credits.load()}>Retry balance</button>
  {:else}
    {@const balance = credits.phase.summary.balance}
    <p class="available" aria-label="Available credits">{formatCredits(balance.remaining)} <span>credits available</span></p>
    <dl>
      <div><dt>{balance.allowancePeriod === 'prepaid-30-day' ? 'Included' : 'Monthly'}</dt><dd>{formatCredits(balance.monthlyRemaining)} / {formatCredits(balance.monthlyAllowance)}</dd></div>
      <div><dt>Purchased</dt><dd>{formatCredits(balance.purchasedRemaining)}</dd></div>
    </dl>
    {#if balance.usagePending}<p role="status">Some costs are still being finalized. Your balance is not reserved.</p>{/if}
  {/if}
</div>

<style>
  .credit-overview { color: var(--foreground); font-size: var(--text-xs); }
  .heading, dl > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
  .heading strong { font-weight: var(--weight-medium); }
  button { border: 0; padding: var(--space-2); background: transparent; color: var(--primary); font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  button:hover:not(:disabled) { color: var(--foreground); }
  button:disabled { color: var(--muted-foreground); cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  p { margin: var(--space-4) 0 0; color: var(--muted-foreground); line-height: var(--leading-copy); overflow-wrap: anywhere; }
  .available { color: var(--foreground); font-size: var(--text-lg); font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }
  .available span { font-size: var(--text-xs); font-weight: var(--weight-normal); color: var(--muted-foreground); }
  dl { display: grid; gap: var(--space-2); margin: var(--space-4) 0 0; }
  dt { color: var(--muted-foreground); }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
</style>
