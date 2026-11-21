<script lang="ts">
  import type { CreditAccount } from '../../composables/useCredits.svelte'
  import CreditPurchase from './CreditPurchase.svelte'

  let { account }: { account: CreditAccount } = $props()
  let dialog = $state<HTMLDialogElement>()

  $effect(() => {
    const payment = account.payment
    if ('scope' in payment && payment.scope === 'credits' && dialog && !dialog.open) dialog.showModal()
  })
</script>

<button type="button" class="button button-solid" aria-haspopup="dialog" aria-controls="credit-purchase-dialog" onclick={() => dialog?.showModal()}>Buy more credits</button>

<dialog id="credit-purchase-dialog" bind:this={dialog} aria-labelledby="credit-purchase-title" aria-describedby="credit-purchase-description">
  <div class="dialog-shell">
    <header>
      <h2 id="credit-purchase-title">Buy more credits</h2>
      <button type="button" class="close-button" aria-label="Close credit purchase" onclick={() => dialog?.close()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    <div class="dialog-body"><CreditPurchase {account} /></div>
  </div>
</dialog>

<style>
  dialog { width: min(540px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); margin: auto; padding: 0; overflow: hidden; border: 1px solid var(--home-rule); border-radius: var(--radius-lg); color: var(--home-ink); background: var(--home-surface); box-shadow: var(--shadow-dialog); font-family: var(--font-sans); }
  dialog::backdrop { background: var(--scrim); }
  .dialog-shell { display: flex; flex-direction: column; max-height: calc(100dvh - 34px); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--home-rule); }
  h2 { margin: 0; font-size: 18px; font-weight: 500; }
  .dialog-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-color: var(--home-rule) var(--home-surface); }
  .close-button { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; padding: 0; border: 1px solid var(--home-rule); color: var(--home-muted); background: transparent; cursor: pointer; }
  .close-button:hover { color: var(--home-accent); border-color: var(--home-accent); background: var(--home-tint); }
  .close-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
  button:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
</style>
