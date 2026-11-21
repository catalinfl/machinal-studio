<script lang="ts">
  import { useCredits } from '../../composables/useCredits.svelte'
  import { formatCredits, formatReset, formatUSD } from '../../lib/credits'
  import CreditBalance from './CreditBalance.svelte'
  import CreditPurchaseDialog from './CreditPurchaseDialog.svelte'
  import PaymentHistory from './PaymentHistory.svelte'

  const account = useCredits({ checkoutScope: 'membership' })
  let planId = $state('')

  const selectedPlan = $derived(account.phase.kind === 'ready'
    ? account.phase.summary.memberships?.plans.find(plan => plan.id === planId)
    : undefined)

  const payment = $derived('scope' in account.payment && account.payment.scope === 'membership' ? account.payment : { kind: 'idle' as const })
</script>

<header><div><h1>Membership &amp; billing</h1><p>Choose your access. Keep track of every payment.</p></div><CreditPurchaseDialog {account} /></header>
<div class="billing-workspace">
  <section class="membership" aria-labelledby="membership-title">
    <h2 id="membership-title">Your membership</h2>
    {#if account.phase.kind === 'loading'}
      <p role="status">Loading membership options…</p>
    {:else if account.phase.kind === 'error'}
      <p role="alert">{account.phase.message}</p><button class="quiet-button" onclick={account.load}>Try again</button>
    {:else}
      {@const summary = account.phase.summary}
      {#if summary.membership?.active && summary.membership.until}
        <p class="access-state"><strong>{summary.membership.name}</strong> · Access through {formatReset(summary.membership.until)} (UTC).</p>
      {:else if summary.balance.pro}
        <p class="access-state">Your account has active paid access.</p>
      {:else}<p>No active membership. Local browser editing remains available.</p>{/if}
      {#if summary.memberships?.available}
        <form onsubmit={event => { event.preventDefault(); if (selectedPlan) void account.buyMembership(selectedPlan.id) }}>
          <fieldset disabled={account.busy}>
            <legend>Choose a prepaid pass</legend>
            {#each summary.memberships.plans as plan (plan.id)}
              <label class="plan" class:selected={planId === plan.id}>
                <input type="radio" name="membership-plan" value={plan.id} bind:group={planId} />
                <span><strong>{plan.name}</strong><small>{plan.days} days of paid access{plan.credits > 0 ? ` · ${formatCredits(plan.credits)} bonus credits` : ''}</small></span>
                <span class="price">{formatUSD(plan.usd)}</span>
              </label>
            {/each}
          </fieldset>
          <p>Includes <strong>{formatCredits(summary.memberships.includedCredits ?? 1000)} API credits per {summary.memberships.allowanceDays ?? 30}-day paid period</strong>. The period starts when access begins, not on the first of the calendar month. Unused included credits expire at the end of that period.</p>
          <p>Renew early to extend access. Your next period’s credits become available when that period starts, not at checkout. Any bonus credits listed above are separate top-ups.</p>
          <p>One payment. No automatic renewal. Passes extend your existing prepaid access; external subscriptions are separate.</p>
          {#if selectedPlan}<p class="checkout-total">Total: <strong>{formatUSD(selectedPlan.usd)} USD</strong> for {selectedPlan.days} days of paid access.</p>{/if}
          {#if summary.payments?.mode === 'sandbox'}<p class="sandbox" role="status">PayPal sandbox: test payments only. No real money is charged.</p>{/if}
          <button class="button button-solid" disabled={!selectedPlan || account.busy}>{payment.kind === 'redirecting' ? 'Opening PayPal…' : 'Continue to PayPal'}</button>
        </form>
      {:else}<p>Membership checkout is not available yet. The administrator needs to configure plans and PayPal Business.</p>{/if}
      {#if payment.kind === 'confirming'}<p role="status">Verifying your payment with PayPal…</p>
      {:else if payment.kind === 'completed'}<p class="access-state" role="status">Payment confirmed. Your account has been updated.</p>
      {:else if payment.kind === 'cancelled'}<p role="status">Checkout cancelled. Nothing was added to your account.</p>
      {:else if payment.kind === 'error'}
        <p role="alert">{payment.message}</p>
        {#if payment.orderId}<button class="quiet-button" onclick={() => payment.kind === 'error' && payment.orderId && account.confirm(payment.orderId)}>Retry payment verification</button>{/if}
      {/if}
    {/if}
  </section>
  <aside aria-label="Credit account"><CreditBalance {account} /></aside>
</div>
{#key account.payment.kind === 'completed'}<PaymentHistory />{/key}

<style>
  header { display: flex; align-items: end; justify-content: space-between; flex-wrap: wrap; gap: 24px; margin-bottom: 30px; }
  p { color: var(--home-muted); font-size: 14px; line-height: 1.7; max-width: 65ch; }
  header p { margin: 14px 0 0; }
  h2 { margin: 0 0 16px; font-size: 22px; font-weight: 500; letter-spacing: -.025em; }
  .billing-workspace { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(300px, 1fr); gap: 40px; align-items: start; }
  .membership { min-width: 0; padding-top: 20px; border-top: 1px solid var(--home-rule); }
  .access-state { color: var(--home-ink); }
  .checkout-total { color: var(--home-ink); }
  .sandbox { padding: 12px; border: 1px solid var(--home-rule); background: var(--home-tint); color: var(--home-ink); }
  form { margin-top: 28px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { font-size: 13px; color: var(--home-muted); margin-bottom: 12px; }
  .plan { display: flex; align-items: center; gap: 14px; border-top: 1px solid var(--home-rule); padding: 20px 12px; cursor: pointer; }
  .plan:last-child { border-bottom: 1px solid var(--home-rule); }
  .plan:hover, .plan.selected { background: var(--home-tint); }
  input { width: 18px; height: 18px; accent-color: var(--home-accent); flex-shrink: 0; }
  .plan > span:first-of-type { min-width: 0; flex: 1; }
  strong { display: inline-block; font-weight: 500; overflow-wrap: anywhere; }
  small { display: block; color: var(--home-muted); font-size: 12px; margin-top: 6px; line-height: 1.6; }
  .price { font-variant-numeric: tabular-nums; font-size: 18px; white-space: nowrap; }
  .button { margin-top: 8px; min-height: 44px; padding: 10px 20px; }
  aside { min-width: 0; border: 1px solid var(--home-rule); background: var(--home-surface); }
  [role='alert'] { color: var(--destructive); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 4px; }
  @media (max-width: 900px) { .billing-workspace { grid-template-columns: 1fr; gap: 30px; } }
  @media (max-width: 480px) { .plan { padding-inline: 4px; gap: 10px; } .price { font-size: 16px; } }
</style>
