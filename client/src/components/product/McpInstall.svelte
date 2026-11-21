<script lang="ts">
  import { useClipboardFeedback } from '../../composables/useClipboardFeedback.svelte'
  import LandingIcon from '../home/LandingIcon.svelte'

  const clients = [
    { id: 'codex', label: 'Codex' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'opencode', label: 'OpenCode' },
  ] as const

  let client = $state<(typeof clients)[number]['id']>('codex')
  const selected = $derived(clients.find(item => item.id === client)!)
  const command = $derived(`npx @machinal/mcp setup --client ${client}`)
  const sourceCommand = $derived(`npm --prefix packages/mcp-installer ci --ignore-scripts\nnpx --yes ./packages/mcp-installer setup --client ${client}`)
  const clipboard = useClipboardFeedback()
</script>

<section class="installer" aria-label="MCP installer">
  <fieldset>
    <legend>Choose your coding agent</legend>
    <div class="client-options">
      {#each clients as item}
        <label class:selected={client === item.id}>
          <input type="radio" name="mcp-client" value={item.id} bind:group={client} />
          {item.label}
        </label>
      {/each}
    </div>
  </fieldset>

  <div class="command-heading">
    <h3>Install for {selected.label}</h3>
    <button class="quiet-button" onclick={() => clipboard.copy(command, `${selected.label} command copied.`)}>
      <LandingIcon name="file" size={15} />Copy command
    </button>
  </div>
  <pre class="install-command"><code>{command}</code></pre>
  <p class="key-note"><LandingIcon name="key" size={18} /><span>The installer asks for your API key in the terminal. Your input is hidden; the key never goes in this command.</span></p>
  <p class="status-note" role="status">{clipboard.status}</p>

  <details class="source-install">
    <summary>npm release pending — install from source</summary>
    <p>The registry command above will work once <code>@machinal/mcp</code> is published. Until then, run these commands from a <a href="https://github.com/catalinfl/viral-server">source checkout</a>:</p>
    <pre><code>{sourceCommand}</code></pre>
    <button class="quiet-button" onclick={() => clipboard.copy(sourceCommand, `${selected.label} source commands copied.`)}>Copy source commands</button>
  </details>
</section>

<style>
  .installer { min-width: 0; padding: 26px; border: 1px solid var(--home-rule); background: var(--home-code); }
  fieldset { min-width: 0; margin: 0 0 30px; padding: 0; border: 0; }
  legend { margin-bottom: 12px; padding: 0; color: var(--home-ink); font-size: 14px; font-weight: 500; }
  .client-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--home-rule); background: var(--home-surface); }
  .client-options label { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 46px; padding: 10px 8px; font-size: 13px; cursor: pointer; }
  .client-options label + label { border-left: 1px solid var(--home-rule); }
  .client-options label:hover { background: var(--home-tint); }
  .client-options label.selected { color: #262a30; background: var(--home-lilac); }
  input { flex-shrink: 0; width: 14px; height: 14px; margin: 0; accent-color: #593495; cursor: pointer; }
  .client-options label:has(input:focus-visible) { position: relative; outline: 2px solid var(--home-accent); outline-offset: 3px; }
  .command-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  h3 { margin: 0; font-size: 14px; font-weight: 500; }
  .installer .quiet-button { min-height: 38px; font-size: 12px; }
  pre { margin: 18px 0; color: var(--home-code-ink); font-size: 13px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
  .install-command { padding-block: 20px; border-block: 1px solid var(--home-rule); font-size: 15px; }
  .key-note { display: flex; align-items: start; gap: 10px; margin: 0; color: var(--home-muted); font-size: 13px; line-height: 1.7; }
  .key-note :global(svg) { flex-shrink: 0; margin-top: 3px; color: var(--home-accent); }
  .installer .status-note { margin-top: 8px; }
  .source-install { margin-top: 14px; padding-top: 16px; border-top: 1px solid var(--home-rule); }
  summary { width: fit-content; color: var(--home-accent); font-size: 12px; line-height: 1.7; cursor: pointer; }
  summary:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 4px; }
  .source-install p { margin: 15px 0 0; color: var(--home-muted); font-size: 13px; line-height: 1.7; }
  .source-install p code { color: var(--home-code-ink); font-family: var(--font-mono); font-size: 12px; }
  @media (max-width: 680px) {
    .installer { padding: 20px; }
    .client-options label { gap: 6px; padding-inline: 5px; font-size: 12px; }
    .install-command { font-size: 13px; }
  }
  @media (pointer: coarse) { .installer .quiet-button, summary { min-height: 44px; } summary { align-content: center; } }
</style>
