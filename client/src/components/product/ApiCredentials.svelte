<script lang="ts">
  import { auth } from '../../stores/auth.svelte'
  import { API_BASE } from '../../lib/api'
  import { useAPIKeys } from '../../composables/useAPIKeys.svelte'
  import { useClipboardFeedback } from '../../composables/useClipboardFeedback.svelte'

  let { sessionId = '' }: { sessionId?: string } = $props()
  const keys = useAPIKeys()
  const clipboard = useClipboardFeedback()
</script>

<section class="credentials" aria-labelledby="api-key-heading">
  <div class="connection"><div><h2 id="api-key-heading">Application API keys</h2><p>For scripts and integrations. Premium is checked when you create or use a key.</p></div><div class="endpoint"><span>API origin</span><code>{API_BASE || window.location.origin}</code></div></div>
  <form onsubmit={(event) => { event.preventDefault(); void keys.create() }}>
    <label for="api-key-name">Key name<input id="api-key-name" bind:value={keys.name} placeholder="Production automation" maxlength="80" required disabled={keys.busy || keys.phase.kind === 'created'} /></label>
    <button class="button button-solid primary-button" disabled={keys.busy || !keys.name.trim() || keys.phase.kind === 'created'}>{keys.phase.kind === 'creating' ? 'Creating…' : 'Create API key'}</button>
  </form>
  {#if keys.phase.kind === 'created'}
    <div class="new-key"><p><strong>Copy your key now.</strong> It will not be shown again. Use this machinal key for hosted API and MCP integrations.</p><output aria-label="New application API key">{keys.phase.key}</output><div class="key-actions"><button class="quiet-button" onclick={() => keys.phase.kind === 'created' && clipboard.copy(keys.phase.key, 'API key copied.')}>Copy key</button><button class="quiet-button" onclick={keys.dismiss}>I saved this key</button></div></div>
  {/if}
  {#if keys.phase.kind === 'loading'}<p class="status-note" role="status">Loading your API keys…</p>
  {:else if keys.items.length === 0 && keys.phase.kind !== 'error'}<p class="status-note">No active keys. Create one for your first integration.</p>{/if}
  {#if keys.items.length}
    <ul class="key-list" aria-label="Active API keys">
      {#each keys.items as key (key.id)}
        <li><div><strong>{key.name}</strong><code>{key.prefix}…</code></div>
          {#if keys.phase.kind === 'confirming' && keys.phase.id === key.id}<div class="revoke-confirm"><p>Scripts using this key will lose access.</p><button class="quiet-button" onclick={() => keys.revoke()}>Confirm revoke</button><button class="quiet-button" onclick={keys.dismiss}>Keep key</button></div>
          {:else}<button class="quiet-button" aria-label={`Revoke ${key.name}`} disabled={keys.busy || keys.phase.kind === 'created'} onclick={() => keys.confirmRevoke(key.id)}>{keys.phase.kind === 'revoking' && keys.phase.id === key.id ? 'Revoking…' : 'Revoke'}</button>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if keys.phase.kind === 'error'}<div class="key-error" role="alert"><p>{keys.phase.message}</p><button class="quiet-button" onclick={() => keys.load()}>Retry keys</button></div>{/if}
  <p class="status-note" role="status">{clipboard.status || `Signed in as ${auth.user?.email ?? ''}. The browser workbench uses your account; scripts use an application key.`}</p>
  {#if sessionId}<details><summary>Browser workspace details</summary><p class="status-note">Current media session: <code>{sessionId}</code>. For external requests, select a project ID from <code>GET /v1/projects</code>; do not copy your login token.</p></details>{/if}
</section>

<style>
  .credentials { border:1px solid var(--home-rule); background:var(--home-surface); padding:20px; margin-bottom:24px; }
  .connection { display:flex; justify-content:space-between; gap:24px; align-items:start; }
  h2 { margin:0; color:var(--home-ink); font-size:17px; font-weight:500; }
  p { margin:8px 0 0; color:var(--home-muted); font-size:12px; line-height:1.6; }
  .endpoint { min-width:0; text-align:right; }
  .endpoint span { color:var(--home-muted); font-size:11px; }
  code, output { font:12px/1.6 var(--font-mono); color:var(--home-ink); overflow-wrap:anywhere; }
  .endpoint code { display:block; margin-top:4px; }
  form { display:flex; gap:12px; align-items:end; margin-top:20px; }
  label { display:grid; gap:7px; flex:1; max-width:420px; color:var(--home-ink); font-size:12px; }
  input { width:100%; min-width:0; min-height:40px; box-sizing:border-box; padding:8px 10px; color:var(--home-ink); background:var(--home-bg); border:1px solid var(--home-rule); font:13px var(--font-sans); caret-color:var(--home-accent); }
  input::placeholder { color:var(--home-muted); }
  button { min-height:40px; }
  .primary-button { padding:10px 16px; white-space:nowrap; }
  .new-key { margin-top:20px; padding:16px; background:var(--home-tint); }
  .new-key p { margin-top:0; }
  output { display:block; margin-top:12px; user-select:all; }
  .key-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  .key-list { list-style:none; margin:20px 0 0; padding:0; }
  li { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 0; border-top:1px solid var(--home-rule); }
  li > div:first-child { min-width:0; }
  li strong { display:block; color:var(--home-ink); font-size:13px; font-weight:500; overflow-wrap:anywhere; }
  li code { font-size:11px; }
  .revoke-confirm { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:end; }
  .revoke-confirm p { margin:0; }
  .key-error { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-top:12px; }
  .key-error p { color:var(--destructive); margin:0; }
  .status-note { margin-top:12px; }
  details { margin-top:12px; }
  summary { color:var(--home-muted); font-size:12px; cursor:pointer; }
  input:focus-visible, button:focus-visible, summary:focus-visible { outline:2px solid var(--home-accent); outline-offset:3px; }
  button:disabled { opacity:.55; cursor:not-allowed; }
  @media(max-width:640px) { .connection { flex-direction:column; gap:12px; } .endpoint { text-align:left; } form { flex-direction:column; align-items:stretch; } label { max-width:none; } li { align-items:start; } .revoke-confirm { flex-direction:column; align-items:stretch; } }
</style>
