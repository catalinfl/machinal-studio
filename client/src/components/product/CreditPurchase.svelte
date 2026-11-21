<script lang="ts">
  import type { CreditAccount } from '../../composables/useCredits.svelte'
  import { formatCredits, formatUSD } from '../../lib/credits'

  let { account }: { account: CreditAccount } = $props()

  const payment = $derived('scope' in account.payment && account.payment.scope === 'credits' ? account.payment : { kind: 'idle' as const })

  const selectedPack = $derived(account.phase.kind === 'ready'
    ? account.phase.summary.purchase.packs.find(pack => pack.id === account.packId)
    : undefined)
</script>

{#snippet paymentFeedback()}
  {#if payment.kind === 'confirming'}<p role="status">Verifying your PayPal payment. Credits are added only after confirmation…</p>
  {:else if payment.kind === 'completed'}<p class="feedback" role="status">Payment confirmed. Your purchased credits have been added.</p>
  {:else if payment.kind === 'cancelled'}<p role="status">PayPal checkout was cancelled. No credits were added.</p>
  {:else if payment.kind === 'error'}
    <div role="alert"><p>{payment.message}</p>
      {#if payment.orderId}<button type="button" class="quiet-button" onclick={() => payment.kind === 'error' && payment.orderId && account.confirm(payment.orderId)}>Retry payment verification</button>{/if}
    </div>
  {/if}
{/snippet}

<section class="purchase" aria-label="Credit packs">
  <p id="credit-purchase-description">Choose how many extra API credits you need. One-time payment through PayPal; no automatic top-ups.</p>
  {#if account.phase.kind === 'ready'}
    {@const summary = account.phase.summary}
    {#if summary.purchase.available}
      <form onsubmit={event => { event.preventDefault(); void account.buy() }}>
        <fieldset disabled={account.busy || !summary.balance.pro}>
          <legend>Credit pack</legend>
          {#each summary.purchase.packs as pack (pack.id)}
            <label class="pack" class:selected={account.packId === pack.id}>
              <input type="radio" name="credit-pack" value={pack.id} checked={account.packId === pack.id} onchange={() => account.packId = pack.id} />
              <span><strong>{formatCredits(pack.credits)} credits</strong><small>{formatUSD(String(Number(pack.usd) / pack.credits))} per credit</small></span>
              <span class="price">{formatUSD(pack.usd)}</span>
            </label>
          {/each}
        </fieldset>
        {#if selectedPack}<p class="total">You’ll receive <strong>{formatCredits(selectedPack.credits)} credits</strong> for <strong>{formatUSD(selectedPack.usd)}</strong>. All prices are in USD.</p>{/if}
        {#if summary.payments?.mode === 'sandbox'}<p class="sandbox" role="status">PayPal sandbox: test payments only. No real money is charged.</p>{/if}
        {@render paymentFeedback()}
        <button class="button button-solid" disabled={account.busy || !summary.balance.pro || !account.packId}>{payment.kind === 'redirecting' ? 'Opening PayPal…' : 'Continue to PayPal'}</button>
      </form>
      <p>Top-ups never expire, but active paid access is required to buy and use them. A top-up does not activate or extend membership.</p>
      {#if !summary.balance.pro}<p><a href="/membership">Activate Pro access</a> before buying API credits.</p>{/if}
    {:else}
      <p class="unavailable">Credit purchases are not available yet. The administrator needs to configure PayPal Business and credit packs.</p>
      {@render paymentFeedback()}
    {/if}
  {:else if account.phase.kind === 'loading'}
    <p role="status">Loading credit packs…</p>
    {@render paymentFeedback()}
  {:else}
    <div role="alert"><p>{account.phase.message}</p><button type="button" class="quiet-button" onclick={() => account.load()}>Retry credit packs</button></div>
    {@render paymentFeedback()}
  {/if}
</section>

<style>
  .purchase { padding: 20px; }
  p { margin: 12px 0 0; color: var(--home-muted); font-size: 13px; line-height: 1.7; }
  .purchase > p:first-child { margin-top: 0; }
  form { display: grid; gap: 14px; margin-top: 16px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { margin-bottom: 10px; color: var(--home-muted); font-size: 12px; }
  .pack { display: flex; align-items: center; gap: 12px; padding: 12px 8px; border-top: 1px solid var(--home-rule); cursor: pointer; }
  .pack:last-child { border-bottom: 1px solid var(--home-rule); }
  .pack:hover, .pack.selected { background: var(--home-tint); }
  fieldset:disabled .pack { cursor: not-allowed; }
  input { width: 18px; height: 18px; accent-color: var(--home-accent); flex-shrink: 0; }
  .pack > span:first-of-type { flex: 1; min-width: 0; }
  strong { color: var(--home-ink); font-size: 13px; font-weight: 500; }
  small { display: block; margin-top: 4px; color: var(--home-muted); font-size: 11px; }
  .price { color: var(--home-ink); font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total { margin: 0; }
  .sandbox { margin: 0; padding: 10px 12px; border: 1px solid var(--home-rule); color: var(--home-ink); background: var(--home-tint); }
  .button { min-height: 42px; padding: 10px 16px; justify-content: center; }
  .unavailable { color: var(--home-ink); }
  .feedback { color: var(--home-accent); }
  [role='alert'] p { color: var(--destructive); margin-bottom: 12px; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
  @media (max-width: 640px) { .purchase { padding: 20px; } }
</style>
