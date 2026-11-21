<script lang="ts">
  import type { CreditAccount } from '../../composables/useCredits.svelte'
  import { formatCreditDeadline, formatCredits, formatReset } from '../../lib/credits'

  let { account }: { account: CreditAccount } = $props()
</script>

<section class="balance" aria-labelledby="credit-heading" aria-busy={account.phase.kind === 'loading'}>
  <div class="balance-heading"><h2 id="credit-heading">Your credits</h2><button class="quiet-button" disabled={account.phase.kind === 'loading' || account.busy} onclick={() => account.load()}>Refresh balance</button></div>
  {#if account.phase.kind === 'loading'}
    <p role="status">Loading your credit balance…</p>
  {:else if account.phase.kind === 'error'}
    <div role="alert"><p>{account.phase.message}</p><button class="quiet-button" onclick={() => account.load()}>Retry balance</button></div>
  {:else}
    {@const summary = account.phase.summary}
    {@const balance = summary.balance}
    <dl>
      <div class="available"><dt>Available now</dt><dd aria-label="Available credits">{formatCredits(balance.remaining)} <span>credits</span></dd></div>
      <div><dt>{balance.allowancePeriod === 'prepaid-30-day' ? 'Included credits' : 'Monthly credits'} <span>{balance.pro ? 'Pro' : 'Free plan'}</span></dt><dd>{formatCredits(balance.monthlyRemaining)} / {formatCredits(balance.monthlyAllowance)}</dd></div>
      <div><dt>Purchased credits</dt><dd>{formatCredits(balance.purchasedRemaining)}</dd></div>
      {#if balance.debt > 0}<div><dt>Usage awaiting payment</dt><dd>{formatCredits(balance.debt)}</dd></div>{/if}
    </dl>
    {#if balance.pro && balance.allowancePeriod === 'prepaid-30-day'}
      <p>Your prepaid access includes <strong>{formatCredits(balance.monthlyAllowance)} API credits per 30-day period</strong>. This allocation ends on <time datetime={balance.nextReset}>{formatCreditDeadline(balance.nextReset)}</time>. Unused included credits do not roll over.</p>
      <p>A new allocation starts only with your next paid period. Buying your next pass early extends access; it does not add the next period’s credits immediately.</p>
    {:else if balance.pro}
      <p>Your external subscription includes <strong>{formatCredits(balance.monthlyAllowance)} credits each calendar month</strong>. Monthly credits reset on <time datetime={balance.nextReset}>{formatReset(balance.nextReset)}</time> at 00:00 UTC. Unused monthly credits do not roll over.</p>
    {:else}
      <p>A prepaid Pro pass includes 1,000 API credits for 30 days. Active paid access is required to use application keys and purchased credits. <a href="/membership">View membership options</a>.</p>
    {/if}
    <p>Purchased credits never expire. Your included credits are used first. Hosted browser AI, API keys and MCP share this balance.</p>
    <p>Credits are charged after completion based on actual usage, not reserved in advance.</p>
    <p>Work can use more than the remaining balance. Any overage must be covered before you can start more paid work.</p>
    {#if balance.usagePending}<p class="notice" role="status">Some credit charges are still being finalized. This does not reserve your balance or prevent new work.</p>{/if}
    {#if summary.pricing.configured}
      <p class="rates">AI tools use credits based on the work completed. Final usage is confirmed after processing.<br />Rendering: {formatCredits(Number(summary.pricing.renderPerMinute))} credits per output minute, prorated. Scene rendering and final video encoding are charged separately.<br />Speech and transcription have a minimum charge of 1 credit per billable call. Uploads, validation and ordinary compilation do not use credits.</p>
    {:else}
      <p class="notice">API usage pricing has not been configured yet. Paid API generation and rendering are unavailable until the administrator sets the rates.</p>
    {/if}
  {/if}
</section>

<style>
  .balance { padding: 20px; }
  .balance-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  h2 { margin: 0; font-size: 18px; font-weight: 500; }
  p { margin: 12px 0 0; color: var(--home-muted); font-size: 13px; line-height: 1.7; }
  p strong { color: var(--home-ink); font-weight: 500; }
  dl { margin: 16px 0 0; }
  dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--home-rule); }
  dt { color: var(--home-muted); font-size: 12px; }
  dt span { display: inline-block; margin-left: 5px; color: var(--home-accent); }
  dd { margin: 0; color: var(--home-ink); font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; }
  .available { padding-top: 0; }
  .available dd { font-size: 26px; font-weight: 500; letter-spacing: -.025em; }
  .available dd span { font-size: 12px; font-weight: 400; letter-spacing: normal; }
  .notice { color: var(--home-ink); }
  .rates { padding-top: 12px; border-top: 1px solid var(--home-rule); font-size: 12px; }
  button:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
  @media (max-width: 640px) { .balance { padding: 20px; } }
</style>
