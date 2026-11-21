<script lang="ts">
  import { onDestroy } from 'svelte'
  import LandingIcon from './LandingIcon.svelte'

  const command = 'docker compose -f compose.editengine.yaml up --build'
  let copy = $state<'idle' | 'copied' | 'error'>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      copy = 'copied'
    } catch {
      copy = 'error'
    }
    clearTimeout(timer)
    timer = setTimeout(() => copy = 'idle', 2500)
  }

  onDestroy(() => clearTimeout(timer))
</script>

<section class="local-runtime" id="local" aria-labelledby="local-heading">
  <div><h2 class="section-title" id="local-heading">Make it yours.<br /><span>Run it your way.</span></h2><p>Get the project from GitHub and bring up the rendering API with Docker. Configure your service and AI providers for your own environment.</p><a class="button button-solid" href="https://github.com/catalinfl/viral-server">Get the project on GitHub <LandingIcon name="direction" size={20} /></a><p class="local-note">You can also keep media in your browser and use local export from the editor.</p></div>
  <div class="setup"><ol><li><strong>Get the project.</strong><span>Clone or download the GitHub repository.</span></li><li><strong>Configure your environment.</strong><span>Follow the repository guide to configure api/.env.</span></li><li><strong>Start it with Docker.</strong><span>Run the command from the repository root.</span></li></ol><div class="command-heading"><span>Docker Compose</span><button onclick={copyCommand}>{copy === 'copied' ? 'Copied' : copy === 'error' ? 'Select to copy' : 'Copy command'}</button></div><pre><code>{command}</code></pre><span class="copy-status" role="status">{copy === 'copied' ? 'Command copied to clipboard.' : copy === 'error' ? 'Clipboard unavailable. Select the command and copy it.' : ''}</span><p>Keep the source media available to the service. Saved YAML can include prepared text overlays; it does not embed the original media files.</p><a href="https://github.com/catalinfl/viral-server/blob/HEAD/api/editengine/README.md">Read the Docker & rendering guide <LandingIcon name="direction" size={14} /></a></div>
</section>

<style>
  .local-runtime { display: grid; grid-template-columns: 1fr 1fr; gap: 10%; padding: 85px 8%; background: #222833; color: #f3f2ee; }
  .local-runtime .section-title span { color: #c6adff; }
  .local-runtime > div > p { color: #c2c8d4; font-size: 15px; line-height: 1.75; margin: 25px 0; max-width: 48ch; }
  .local-runtime .local-note { border-top: 1px solid #515866; padding-top: 20px; font-size: 12px; }
  .setup { min-width: 0; }
  ol { padding-left: 22px; margin: 0 0 29px; }
  li { color: #c6adff; padding-left: 8px; margin-bottom: 21px; }
  li strong, li span { display: block; }
  li strong { color: #f3f2ee; font-size: 18px; font-weight: 500; }
  li span { color: #c2c8d4; font-size: 13px; line-height: 1.6; margin-top: 5px; }
  .command-heading { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 12px 0; border-block: 1px solid #515866; font-size: 12px; }
  .command-heading button { color: #c6adff; background: none; border: 0; font-size: 11px; text-decoration: underline; cursor: pointer; }
  pre { font-size: 12px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; color: #ddceff; margin: 18px 0 0; }
  .copy-status { display: block; color: #c6adff; min-height: 15px; font-size: 10px; margin-top: 7px; }
  .local-runtime .setup > p { font-size: 12px; line-height: 1.75; margin: 12px 0 22px; }
  .setup > a { display: inline-flex; align-items: center; gap: 18px; color: #c6adff; font-size: 12px; text-underline-offset: 5px; }
  @media (max-width: 900px) { .local-runtime { padding-inline: 5%; gap: 6%; } }
  @media (max-width: 640px) { .local-runtime { grid-template-columns: 1fr; gap: 30px; padding-block: 65px; } }
</style>
