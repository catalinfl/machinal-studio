<script lang="ts">
  import { API_BASE } from '../../lib/api'
  import { apiCurlExample } from '../../lib/api-explorer'
  import { useApiExplorer } from '../../composables/useApiExplorer.svelte'
  import { useClipboardFeedback } from '../../composables/useClipboardFeedback.svelte'
  import ApiMedia from './ApiMedia.svelte'
  import ApiRecipe from './ApiRecipe.svelte'
  import ApiResult from './ApiResult.svelte'
  import LandingIcon from '../home/LandingIcon.svelte'

  const explorer = useApiExplorer()
  const clipboard = useClipboardFeedback()
  let action = $state<'upload' | 'compile' | 'render' | 'status'>('render')
  let execution = $state<'cloud' | 'docker' | 'cli'>('cloud')
  const example = $derived(apiCurlExample(action, API_BASE || window.location.origin, execution))
  const requestActions = $derived(execution === 'cli' ? ['compile', 'render'] : ['upload', 'compile', 'render', 'status'])

  function changeExecution(event: Event) {
    execution = (event.currentTarget as HTMLSelectElement).value as typeof execution
    if (execution === 'cli' && action !== 'compile' && action !== 'render') action = 'render'
  }
</script>

<div class="page-intro"><h1>The API.<br /><span>Your creative engine.</span></h1><p>Your media, your credentials, your YAML. Send a recipe, inspect the composition and get the video when it is ready. This workspace makes real requests to your configured API.</p></div>
<div class="account-link"><p>Manage application keys, check your remaining credits or top up your account.</p><div class="account-actions"><a class="quiet-button" href="/mcp">Install MCP for your agent</a><a class="quiet-button" href="/api-keys">API Keys &amp; credits</a></div></div>
<div class="api-workbench"><ApiMedia {explorer} /><ApiRecipe {explorer} /><ApiResult {explorer} /></div>
<section class="request-guide" aria-labelledby="request-guide-heading">
  <div>
    <h2 class="section-heading" id="request-guide-heading">Take the workflow<br />into your own code.</h2>
    {#if execution === 'cloud'}
      <p>Set <code>MACHINAL_API_KEY</code> to your application key. Get an owned <code>PROJECT_ID</code> from <code>GET /v1/projects</code>, or create one with <code>POST /v1/projects</code> and a name.</p>
    {:else if execution === 'docker'}
      <p>Use the local API at <code>127.0.0.1:8080</code> without an application key. Select a local <code>PROJECT_ID</code> from <code>GET /v1/projects</code>, or create one with <code>POST /v1/projects</code>.</p>
    {:else}
      <p>Point <code>--root</code> at the directory containing your originals. No application key or project ID is needed. Build the <code>edit</code> command and install FFmpeg/ffprobe, or use the command bundled in Docker.</p>
    {/if}
    <a class="text-link" href="/docs#api">Read the API reference <LandingIcon name="direction" size={15} /></a>
    <p class="guide-note">Upload originals once, then reference their filenames in YAML bindings. Cloud storage uses the project's S3 space; Docker and CLI use local files. Media bytes and storage credentials do not belong in YAML.</p>
    {#if execution === 'cli'}
      <p class="guide-note">The CLI runs in the foreground, prepares the recipe and saves the result. JSON output goes to stdout; errors go to stderr with a nonzero exit code. No API job polling is needed.</p>
    {:else}
      <p class="guide-note">The versioned render route runs pending recipe actions, prepares text, then renders asynchronously. Poll the job and download its filename from the same project's <code>/download?file=…</code> route.</p>
    {/if}
  </div>
  <div class="request-sheet">
    <label class="execution-mode">Run with<select aria-label="Execution mode" value={execution} onchange={changeExecution}><option value="cloud">Cloud API · Premium key</option><option value="docker">Local Docker · no application key</option><option value="cli">Native CLI · media directory</option></select></label>
    <div class="request-tabs" role="group" aria-label="API request examples">
      {#each requestActions as item}<button class:active={action === item} aria-pressed={action === item} onclick={() => action = item as typeof action}>{item}</button>{/each}
      <button class="copy-request" onclick={() => clipboard.copy(example, 'Command copied.')}>Copy command</button>
    </div>
    <pre><code>{example}</code></pre>
    <p class="status-note" role="status">{clipboard.status || (execution === 'cloud' ? 'Application keys stay in environment variables, not in YAML.' : execution === 'docker' ? 'Run machinal-public on localhost. No machinal account or key is required.' : 'The CLI runs synchronously and needs FFmpeg. Point --root at originals; text and scenes also use the configured scene service.')}</p>
  </div>
</section>

<style>
  .account-link { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 24px; padding-block: 16px; border-block: 1px solid var(--home-rule); }
  .account-link p { margin: 0; color: var(--home-muted); font-size: 13px; line-height: 1.6; }
  .account-link a { text-decoration: none; }
  .account-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .api-workbench { display: grid; grid-template-columns: minmax(210px, .8fr) minmax(0, 1.8fr) minmax(240px, 1fr); border: 1px solid var(--home-rule); background: var(--home-surface); }
  .request-guide { display: grid; grid-template-columns: 1fr 1.3fr; gap: 8%; margin-top: 65px; }
  .request-guide p { color: var(--home-muted); font-size: 13px; line-height: 1.8; max-width: 58ch; }
  .request-guide p code { font-family: var(--font-mono); font-size: 11px; color: var(--home-accent); overflow-wrap: anywhere; }
  .guide-note { margin-top: 22px; font-size: 11px; }
  .request-sheet { min-width: 0; border: 1px solid var(--home-rule); background: var(--home-surface); align-self: start; }
  .execution-mode { display:flex; gap:12px; align-items:center; padding:12px; font-size:12px; color:var(--home-muted); border-bottom:1px solid var(--home-rule); }
  .execution-mode select { min-width:0; flex:1; min-height:40px; color:var(--home-ink); background:var(--home-surface); border:1px solid var(--home-rule); padding:8px; font:12px var(--font-sans); }
  .request-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 10px; border-bottom: 1px solid var(--home-rule); }
  .request-tabs button { border: 0; background: transparent; color: var(--home-muted); padding: 8px 10px; cursor: pointer; font-size: 11px; }
  .request-tabs button.active { background: var(--home-tint); color: var(--home-accent); }
  .request-tabs .copy-request { margin-left: auto; color: var(--home-accent); }
  pre { margin: 0; padding: 25px; background: var(--home-code); color: var(--home-code-ink); font-size: 11px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
  .request-sheet .status-note { padding-inline: 20px; font-size: 10px; }
  @media (max-width: 1100px) { .api-workbench { grid-template-columns: minmax(210px, .9fr) minmax(0, 1.5fr) minmax(220px, 1fr); } }
  @media (max-width: 900px) { .api-workbench { grid-template-columns: 1fr; } .request-guide { grid-template-columns: 1fr; gap: 25px; margin-top: 45px; } }
</style>
