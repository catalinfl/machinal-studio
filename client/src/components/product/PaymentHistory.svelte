<script lang="ts">
  import { usePaymentHistory } from '../../composables/usePaymentHistory.svelte'
  import { formatCredits, formatReset, formatUSD } from '../../lib/credits'

  const history = usePaymentHistory()
</script>

<section class="history" aria-labelledby="payments-title">
  <div class="history-heading"><h2 id="payments-title">Payment history</h2><button class="quiet-button" disabled={history.phase.kind === 'loading' || history.refund.kind === 'saving'} onclick={history.load}>Refresh history</button></div>
  <p>Your 50 most recent checkouts. Refund requests are reviewed by the merchant; submitting a request does not issue a PayPal refund. Confirmed refunds can revoke membership access and remove purchased credits, including debt for credits already used.</p>
  {#if history.phase.kind === 'loading'}<p role="status">Loading payments…</p>
  {:else if history.phase.kind === 'error'}<p role="alert">Could not load payment history. Use Refresh history to retry.</p>
  {:else if history.phase.payments.length === 0}<p>No payments yet. Confirmed purchases will appear here.</p>
  {:else}
    <ul>
      {#each history.phase.payments as payment (payment.id)}
        <li>
          <div class="payment-row">
            <div class="payment-description"><strong>{payment.planName || `${formatCredits(payment.credits)} credits`}</strong><span class="order-id">Order {payment.id}</span><span>{payment.createdAt.startsWith('0001-') ? 'Earlier payment' : formatReset(payment.createdAt)}</span></div>
            <div class="amount">{formatUSD(payment.usd)}<span>{payment.status === 'completed' ? 'Confirmed' : payment.status === 'awaiting-payment' ? 'Not confirmed' : 'Refund / reversal recorded'}</span></div>
            <div class="payment-action">
              {#if payment.refundRequestedAt}<span>Refund requested</span>
              {:else if payment.status === 'completed'}<button class="quiet-button" disabled={history.refund.kind === 'saving'} onclick={() => history.edit(payment.id)}>Request refund</button>{/if}
            </div>
          </div>
          {#if (history.refund.kind === 'editing' || history.refund.kind === 'error' || history.refund.kind === 'saving') && history.refund.id === payment.id}
            <form onsubmit={event => { event.preventDefault(); void history.requestRefund() }}>
              <label class="field">Why are you requesting a refund?<textarea rows="3" minlength="10" maxlength="1000" required disabled={history.refund.kind === 'saving'} value={history.refund.reason} oninput={event => history.setReason(event.currentTarget.value)}></textarea></label>
              {#if history.refund.kind === 'error'}<p role="alert">{history.refund.message}</p>{/if}
              {#if history.refund.kind === 'saving'}<p role="status">Saving refund request…</p>{/if}
              <div class="refund-actions"><button class="quiet-button" type="button" disabled={history.refund.kind === 'saving'} onclick={history.cancel}>Keep payment</button><button class="quiet-button" type="submit" disabled={history.refund.reason.trim().length < 10 || history.refund.kind === 'saving'}>{history.refund.kind === 'error' ? 'Retry refund request' : 'Send refund request'}</button></div>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if history.refund.kind === 'requested'}<p class="confirmation" role="status">Refund request saved for review. Keep your order ID for support.</p>{/if}
</section>

<style>
  .history { margin-top: 48px; border-top: 1px solid var(--home-rule); padding-top: 24px; }
  .history-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  h2 { font-size: 22px; font-weight: 500; margin: 0; letter-spacing: -.025em; }
  p { font-size: 13px; line-height: 1.7; color: var(--home-muted); max-width: 75ch; }
  ul { list-style: none; padding: 0; margin: 24px 0 0; }
  li { padding: 20px 0; border-top: 1px solid var(--home-rule); }
  .payment-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, .5fr) 160px; align-items: center; gap: 24px; }
  .payment-description { display: grid; gap: 6px; min-width: 0; }
  strong { font-weight: 500; overflow-wrap: anywhere; }
  span { font-size: 12px; color: var(--home-muted); }
  .order-id { font-family: var(--font-mono); overflow-wrap: anywhere; }
  .amount { font-variant-numeric: tabular-nums; font-size: 18px; display: grid; gap: 6px; }
  .payment-action { text-align: right; }
  form { display: grid; gap: 12px; max-width: 680px; margin-top: 20px; }
  .refund-actions { display: flex; gap: 10px; justify-content: end; flex-wrap: wrap; }
  textarea { resize: vertical; caret-color: var(--home-accent); }
  button.quiet-button { min-height: 40px; }
  button:focus-visible, textarea:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
  [role='alert'] { color: var(--destructive); }
  .confirmation { color: var(--home-accent); }
  @media (max-width: 680px) { .payment-row { grid-template-columns: minmax(0, 1fr) auto; gap: 16px; } .amount { text-align: right; } .payment-action { grid-column: 1 / -1; text-align: left; } }
</style>
