<script lang="ts">
  import LandingIcon from './LandingIcon.svelte'

  const workflows = [
    {
      title: 'Visual editor',
      copy: 'Work in your browser with a multitrack timeline, live preview and hands-on controls for clips, effects, titles and audio.',
      action: 'Open editor',
      href: '/editor',
    },
    {
      title: 'Run locally',
      copy: 'Export on your device from the editor, or render YAML recipes with Docker or the edit CLI. AI actions use your configured providers.',
      action: 'Explore local options',
      href: '/docs#local-headless',
    },
    {
      title: 'Use the API',
      copy: 'Send media and a YAML recipe from your app or scripts, then download the finished video. Try recipes in the API workspace before integrating.',
      action: 'Explore the API',
      href: '/api',
    },
    {
      title: 'Create through MCP',
      copy: 'Give your coding agent a creative brief, then refine the video in conversation. Connect machinal to Codex, Claude Code or OpenCode.',
      action: 'Explore MCP',
      href: '/mcp',
    },
  ]
</script>

<section class="creation-workflows" id="workflows" aria-labelledby="workflows-heading">
  <div class="workflow-intro">
    <h2 class="section-title" id="workflows-heading">Choose how <br />you <span>create.</span></h2>
    <p class="section-copy">Work visually, run locally, integrate the API or direct your agent through MCP. Pick the workflow that fits your project.</p>
  </div>

  <div class="workflow-options">
    {#each workflows as workflow}
      <article>
        <h3>{workflow.title}</h3>
        <div>
          <p>{workflow.copy}</p>
          <a class="text-link" href={workflow.href}>{workflow.action} <LandingIcon name="arrow" size={17} /></a>
        </div>
      </article>
    {/each}
  </div>

  <p class="workflow-ai" id="ai">
    <strong>AI, when you need it.</strong>
    <span><a href="/editor?ai=image">Images</a>, <a href="/editor?ai=captions">captions</a> and <a href="/editor?ai=tts">text-to-speech</a> are available in the editor and YAML recipes. Hosted subscriptions include AI credits.</span>
  </p>
</section>

<style>
  .creation-workflows { display: grid; grid-template-columns: .85fr 1.4fr; column-gap: 8%; padding: 95px 8% 80px; }
  .workflow-intro .section-copy { margin: 24px 0 0; max-width: 35ch; }
  .workflow-options { min-width: 0; border-top: 1px solid var(--home-rule); }
  article { display: grid; grid-template-columns: minmax(125px, .75fr) minmax(0, 1.6fr); gap: 24px; padding: 25px 0 28px; border-bottom: 1px solid var(--home-rule); }
  h3 { margin: 0; font-size: 24px; font-weight: 500; line-height: 1.2; letter-spacing: -.025em; }
  article p { margin: 0 0 16px; color: var(--home-muted); font-size: 14px; line-height: 1.7; }
  article .text-link { min-height: 32px; font-size: 13px; }
  .workflow-ai { grid-column: 1 / -1; display: grid; grid-template-columns: .85fr 1.4fr; column-gap: 8%; margin: 32px 0 0; color: var(--home-muted); font-size: 12px; line-height: 1.75; }
  .workflow-ai strong { color: var(--home-ink); font-weight: 500; }
  .workflow-ai a { color: var(--home-accent); }
  .workflow-ai a:hover { text-decoration: none; }
  @media (max-width: 1100px) { .creation-workflows { grid-template-columns: .8fr 1.4fr; padding-inline: 5%; column-gap: 6%; } article { grid-template-columns: 1fr; gap: 12px; } .workflow-ai { grid-template-columns: .8fr 1.4fr; column-gap: 6%; } }
  @media (max-width: 640px) { .creation-workflows { grid-template-columns: 1fr; gap: 30px; padding-block: 65px; } .workflow-intro .section-copy { margin-top: 20px; max-width: none; } article { gap: 12px; padding-block: 23px; } article p { margin-bottom: 12px; } .workflow-ai { grid-template-columns: 1fr; gap: 8px; margin: 0; } }
</style>
