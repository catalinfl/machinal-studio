<script lang="ts">
  import { API_BASE } from '../lib/api-origin'
  import { openRouterSetup } from '../stores/openrouterSetup.svelte'
  import SessionMenu from '../components/SessionMenu.svelte'

  const configuration = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    mcp: { servers: { 'machinal-local': { type: 'remote', url: `${API_BASE}/mcp`, oauth: false } } },
  }, null, 2)
</script>

<svelte:head><title>Local documentation | machinal</title></svelte:head>

<main class="local-docs">
  <header><a href="/">Open the editor</a><SessionMenu /></header>
  <h1>machinal, on your computer.</h1>
  <p class="intro">The current editor and MCP tools, with your hardware, your storage and your own OpenRouter account. No machinal login, subscription or application key.</p>
  <nav aria-label="Documentation sections"><a href="#docker">Docker</a><a href="#ai">Your AI key</a><a href="#data">Your data</a><a href="#mcp">MCP</a><a href="/toolkit">Toolkit</a></nav>
  <section id="docker">
    <h2>Start your installation</h2>
    <p>Install Docker with Compose, start Docker, then run this from the repository folder:</p>
    <pre><code>docker compose up --build -d</code></pre>
    <p>The editor opens at <code>http://localhost:5173</code>. Keep the containers running while using the editor or MCP. The API is loopback-only; do not expose this single-user installation to a public network.</p>
    <pre><code>docker compose logs -f
docker compose down</code></pre>
    <p>Stopping the containers keeps your data. Never add <code>-v</code> unless you intend to delete your Docker volumes.</p>
  </section>
  <section id="ai">
    <h2>Connect your own OpenRouter key</h2>
    <p>Use the welcome or Settings → OpenRouter API key. The API verifies the key without generating content and saves it privately in <code>/data/.openrouter-key</code>. It never returns your key or saves it in browser storage.</p>
    <button type="button" onclick={() => openRouterSetup.openSettings()}>Configure OpenRouter</button>
    <p>AI editing, images, speech and transcription use that key and may charge your OpenRouter account. Ordinary editing, compilation and rendering on your own machine require no key and use no machinal credits. Provider features require an internet connection; this is not an entirely offline AI installation.</p>
  </section>
  <section id="data">
    <h2>Your volume, not a hosted library</h2>
    <p>Projects, originals, generated assets, persistent jobs and exports stay in the installation’s own <code>composition-data</code> Docker volume. There is no S3 connection or background upload to maintainer infrastructure, even if S3 variables are inherited.</p>
    <p>Projects autosave separately with conflict detection. Exports are not automatically removed after three renders. Back up your volume and export recipes when you need portable project descriptions; YAML does not embed every media original.</p>
    <p>Server processing means your local Docker API. Browser-local processing uses FFmpeg-WASM. Neither is a hosted rendering service. A read-only source-folder mount is optional and must be configured explicitly.</p>
  </section>
  <section id="mcp">
    <h2>Connect MCP without a machinal key</h2>
    <p>Start Docker first. Run:</p>
    <pre><code>npx -y @machinal/mcp setup --mode local --client opencode</code></pre>
    <p>Or merge the following into your OpenCode V2 configuration. HTTP transport is called <code>remote</code> in OpenCode even when its URL is localhost. No Authorization header or OAuth is needed:</p>
    <pre><code>{configuration}</code></pre>
    <p>Choose <strong>Server</strong> only for an existing hosted machinal API. Its own login, application key and billing rules apply there; they never apply to this local endpoint.</p>
    <p>MCP includes projects, YAML validation/compilation, source inspection, client-authored Svelte/Three.js scenes, generation with your provider key, persistent jobs and exports. Approvals still control source access and AI spending. Use <code>storage=volume</code>, not S3. Download links open only on the machine running the API.</p>
  </section>
</main>

<style>
  .local-docs { flex: 1; overflow-y: auto; padding: 24px max(24px, calc((100% - 920px) / 2)); color: var(--foreground); font-family: var(--font-sans); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 40px; }
  h1 { max-width: 18ch; margin: 0 0 20px; font-size: clamp(32px, 5vw, 54px); line-height: 1.08; letter-spacing: -.03em; }
  .intro { font-size: 18px; }
  p { max-width: 72ch; color: var(--muted-foreground); font-size: 14px; line-height: 1.8; }
  nav { display: flex; flex-wrap: wrap; gap: 8px 24px; border-bottom: 1px solid var(--border); padding-block: 12px; }
  a { display: inline-flex; align-items: center; min-height: 44px; color: var(--primary); text-underline-offset: 3px; }
  a:hover { color: var(--primary-hover); }
  section { margin-block: 48px; scroll-margin-top: 24px; }
  h2 { font-size: 24px; line-height: 1.3; margin-bottom: 16px; }
  pre { overflow-x: auto; padding: 18px; background: var(--surface-muted); border: 1px solid var(--border); border-radius: var(--radius-sm); font: 12px/1.7 var(--font-mono); }
  code { overflow-wrap: anywhere; }
  button { min-height: 44px; padding: 10px 18px; background: var(--primary); color: var(--primary-foreground); border: 1px solid var(--primary); border-radius: var(--radius-sm); cursor: pointer; }
  button:hover { background: var(--primary-hover); }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
</style>
