<script lang="ts">
  import { openRouterSetup as setup } from '../stores/openrouterSetup.svelte'

  let { enabled = true }: { enabled?: boolean } = $props()
  let dialog: HTMLDialogElement
  const settings = $derived(setup.view.kind === 'settings')
  const configured = $derived(setup.view.kind !== 'closed' && setup.view.configured)

  $effect(() => {
    if (enabled) void setup.initialize()
  })

  $effect(() => {
    if (!dialog) return
    if (setup.view.kind !== 'closed' && !dialog.open) dialog.showModal()
    else if (setup.view.kind === 'closed' && dialog.open) dialog.close()
  })

  function cancel(event: Event): void {
    event.preventDefault()
    setup.close()
  }
</script>

<dialog bind:this={dialog} class="welcome" aria-labelledby="openrouter-title" aria-describedby="openrouter-description" oncancel={cancel}>
  <div class="welcome-layout">
    <aside class="introduction">
      <div class="wordmark">machinal local</div>
      <div class="intro-copy">
        <h2>{settings ? 'A key to your AI tools.' : 'Your next edit starts here.'}</h2>
        <p>Your footage. Your ideas.<br /> A little help when you need it.</p>
      </div>
      <ul class="capabilities" aria-label="AI tools">
        <li><span>AI editing</span><span>Describe the edit.</span></li>
        <li><span>Images</span><span>Create the missing shot.</span></li>
        <li><span>Voice</span><span>Give your story a voice.</span></li>
      </ul>
      <p class="intro-footnote">Your OpenRouter account powers the AI.<br />The editor is yours to use either way.</p>
    </aside>

    <section class="connection">
      {#if settings}
        <button type="button" class="close-button" aria-label="Close OpenRouter settings" onclick={() => setup.close()} disabled={setup.phase.kind === 'saving'}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      {/if}

      {#if setup.phase.kind === 'saved'}
        <div class="completion" role="status">
          <svg class="connected-mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><path d="m12 20 5 5 11-11" /></svg>
          <h1 id="openrouter-title">You’re connected.</h1>
          <p id="openrouter-description">Your key is saved on this installation.<br />You can change it anytime in Settings.</p>
          <button type="button" class="primary-button" onclick={() => setup.close()}>{settings ? 'Back to the editor' : 'Start editing'}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" /></svg></button>
        </div>
      {:else}
        <header>
          <h1 id="openrouter-title">{settings ? 'OpenRouter connection' : 'Welcome to machinal local.'}</h1>
          <p id="openrouter-description">{configured ? 'An OpenRouter key is already configured. Paste a new one to replace it.' : 'Add your OpenRouter key to connect the AI tools to your account.'}</p>
        </header>

        {#if configured}<p class="connection-status"><span aria-hidden="true"></span>Key configured on this installation</p>{/if}

        <form onsubmit={(event) => { event.preventDefault(); void setup.save() }} aria-busy={setup.busy}>
          <div class="field-heading"><label for="openrouter-key">OpenRouter API key</label><a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get a key<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M5 4h7v7" /></svg></a></div>
          <div class="key-field" class:invalid={setup.phase.kind === 'error'}>
            <input id="openrouter-key" name="openrouter-key" type={setup.draft.visible ? 'text' : 'password'} bind:value={setup.draft.apiKey} oninput={() => setup.editKey()} placeholder="sk-or-v1-…" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512" aria-describedby="key-note key-feedback" aria-invalid={setup.phase.kind === 'error'} disabled={setup.busy} />
            <button type="button" class="visibility-button" aria-label={setup.draft.visible ? 'Hide API key' : 'Show API key'} aria-pressed={setup.draft.visible} onclick={() => { setup.draft.visible = !setup.draft.visible }} disabled={setup.busy}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" /><circle cx="10" cy="10" r="2" />{#if setup.draft.visible}<path d="m3 3 14 14" />{/if}</svg>
            </button>
          </div>
          <p id="key-note" class="key-note">Saved on your local API, not in browser storage.<br />AI usage is billed to your OpenRouter account.</p>
          <div id="key-feedback" class="feedback" aria-live="polite">
            {#if setup.phase.kind === 'error'}<p role="alert">{setup.phase.message}</p>
            {:else if setup.phase.kind === 'checking'}<p>Checking this installation’s connection…</p>
            {:else if setup.phase.kind === 'saving'}<p>Verifying your key with OpenRouter…</p>{/if}
          </div>
          <button type="submit" class="primary-button" disabled={setup.busy || !setup.draft.apiKey.trim()}>
            {#if setup.phase.kind === 'saving'}<span class="spinner" aria-hidden="true"></span>Connecting…
            {:else}{configured ? 'Replace API key' : 'Connect OpenRouter'}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>{/if}
          </button>
          <button type="button" class="skip-button" onclick={() => setup.close()} disabled={setup.phase.kind === 'saving'}>{settings ? 'Keep current settings' : 'Continue without AI'}</button>
        </form>
        <p class="connection-footnote">{settings ? 'Your existing key stays active until its replacement is verified.' : 'No key yet? Import, edit and export as usual. Connect AI later in Settings.'}</p>
      {/if}
    </section>
  </div>
</dialog>

<style>
  .welcome { width: min(860px, calc(100vw - 40px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--foreground); background: var(--surface-elevated); box-shadow: var(--shadow-dialog); overflow: auto; }
  .welcome::backdrop { background: var(--scrim); }
  .welcome-layout { display: grid; grid-template-columns: 340px minmax(0, 1fr); }
  .introduction { display: flex; flex-direction: column; padding: 32px; background: #222833; color: #f3f2ee; }
  .wordmark { display: flex; align-items: center; gap: 10px; font-size: var(--text-lg); font-weight: var(--weight-semibold); }
  .intro-copy { margin: 54px 0 32px; }
  .intro-copy h2 { margin: 0 0 16px; max-width: 9ch; font-size: 34px; line-height: 1.1; font-weight: var(--weight-medium); text-wrap: balance; }
  .intro-copy p { margin: 0; color: #c6ccd5; font-size: var(--text-md); line-height: var(--leading-copy); }
  .capabilities { margin: 0; padding: 0; list-style: none; }
  .capabilities li { display: grid; gap: 3px; padding: 12px 0; border-top: 1px solid #46505f; font-size: var(--text-sm); }
  .capabilities li span:first-child { font-weight: var(--weight-semibold); }
  .capabilities li span:last-child { color: #c6ccd5; }
  .intro-footnote { margin: auto 0 0; padding-top: 28px; color: #c6ccd5; font-size: var(--text-xs); line-height: var(--leading-copy); }
  .connection { position: relative; display: flex; flex-direction: column; padding: 56px 40px 28px; min-width: 0; }
  h1 { margin: 0 0 12px; font-size: 28px; line-height: var(--leading-tight); font-weight: var(--weight-semibold); text-wrap: balance; }
  header p, .completion p { margin: 0; color: var(--muted-foreground); font-size: var(--text-md); line-height: var(--leading-copy); }
  form { margin-top: 36px; }
  .field-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; font-size: var(--text-sm); }
  label { font-weight: var(--weight-semibold); }
  .field-heading a { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; color: var(--primary); text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
  svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .field-heading svg { width: 14px; height: 14px; }
  .key-field { display: flex; min-width: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-xs); background: var(--input); }
  .key-field:focus-within { outline: 2px solid var(--ring); outline-offset: 2px; }
  .key-field.invalid { border-color: var(--destructive); }
  .key-field input { width: 100%; min-width: 0; height: 48px; padding: 0 14px; border: 0; outline: none; background: transparent; color: var(--foreground); font-family: var(--font-mono); font-size: var(--text-sm); caret-color: var(--primary); }
  input::placeholder { color: var(--muted-foreground); opacity: 1; }
  .visibility-button { display: grid; place-items: center; width: 46px; border: 0; background: transparent; color: var(--muted-foreground); cursor: pointer; flex-shrink: 0; }
  .visibility-button:hover { color: var(--foreground); background: var(--surface-muted); }
  .key-note { margin: 12px 0 0; color: var(--muted-foreground); font-size: var(--text-xs); line-height: var(--leading-copy); }
  .feedback { min-height: 58px; padding: 10px 0; font-size: var(--text-xs); line-height: var(--leading-copy); color: var(--muted-foreground); }
  .feedback p { margin: 0; }
  .feedback p[role='alert'] { color: var(--destructive); }
  .primary-button { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 46px; padding: 10px 16px; border: 1px solid transparent; border-radius: var(--radius-xs); background: var(--primary); color: var(--primary-foreground); font-size: var(--text-md); font-weight: var(--weight-semibold); cursor: pointer; }
  .primary-button:hover:not(:disabled) { background: var(--primary-hover); }
  .primary-button:active:not(:disabled) { background: var(--primary-active); }
  button:disabled { opacity: .55; cursor: not-allowed; }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
  .skip-button { width: 100%; min-height: 44px; margin-top: 8px; padding: 10px; border: 0; background: transparent; color: var(--muted-foreground); font-size: var(--text-sm); cursor: pointer; }
  .skip-button:hover:not(:disabled) { background: var(--surface); color: var(--foreground); }
  .connection-footnote { margin: auto 0 0; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: var(--text-xs); line-height: var(--leading-copy); }
  .connection-status { display: flex; align-items: center; gap: 8px; margin: 20px 0 -12px; color: var(--success); font-size: var(--text-xs); }
  .connection-status span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .close-button { position: absolute; top: 12px; right: 12px; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; background: transparent; color: var(--muted-foreground); cursor: pointer; }
  .close-button:hover { background: var(--surface-muted); color: var(--foreground); }
  .completion { display: flex; flex-direction: column; justify-content: center; flex: 1; }
  .connected-mark { width: 44px; height: 44px; margin-bottom: 24px; color: var(--success); }
  .completion .primary-button { margin-top: 36px; }
  .spinner { width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: turn 800ms linear infinite; }
  .welcome[open] .welcome-layout { animation: register 220ms cubic-bezier(.16, 1, .3, 1); }
  @keyframes turn { to { transform: rotate(360deg); } }
  @keyframes register { from { transform: translateY(8px); } to { transform: translateY(0); } }
  @media (max-width: 680px) {
    .welcome { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); }
    .welcome-layout { grid-template-columns: minmax(0, 1fr); }
    .introduction { padding: 22px 24px; }
    .intro-copy { margin: 24px 0 0; }
    .intro-copy h2 { max-width: 18ch; margin-bottom: 10px; font-size: 26px; }
    .intro-copy p { font-size: var(--text-sm); }
    .intro-copy br { display: none; }
    .capabilities { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 20px; padding-top: 14px; border-top: 1px solid #46505f; }
    .capabilities li { padding: 0; border: 0; font-size: var(--text-xs); }
    .capabilities li span:last-child, .intro-footnote { display: none; }
    .connection { padding: 28px 24px 24px; }
    h1 { font-size: 24px; }
    form { margin-top: 24px; }
    .field-heading a { min-height: 32px; }
    .connection-footnote { margin-top: 20px; padding-top: 16px; }
    .completion { min-height: 300px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .welcome[open] .welcome-layout, .spinner { animation: none; }
  }
</style>
