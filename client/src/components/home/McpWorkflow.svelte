<script lang="ts">
  import LandingIcon from './LandingIcon.svelte'

  const capabilities = [
    { title: 'Start with intent.', text: 'Describe the story, pacing and format. Your agent can discover the available editing tools and styles to shape the edit.' },
    { title: 'Refine in conversation.', text: 'Ask for a different opening, a longer scene or a quieter title. Keep creative direction in the conversation you already use.' },
    { title: 'Keep the final say.', text: 'Approve media access separately from paid generation and rendering. Connecting MCP does not start paid work.' },
  ]
</script>

<section class="mcp-workflow" id="mcp" aria-labelledby="mcp-heading">
  <div class="mcp-intro">
    <h2 class="section-title" id="mcp-heading">Direct your video.<br /><span>Through MCP.</span></h2>
    <p class="section-copy">MCP (Model Context Protocol) brings machinal’s video tools into Codex, Claude Code and OpenCode. Work from a creative brief instead of writing an API integration.</p>
    <a class="text-link" href="/mcp">Connect your coding agent <LandingIcon name="direction" size={17} /></a>
  </div>

  <div class="mcp-detail">
    <figure class="brief-example">
      <figcaption><LandingIcon name="network" size={20} />A brief to start with</figcaption>
      <blockquote>“Make a 20-second vertical launch video from my product photos. Use clean titles and a warm, unhurried pace.”</blockquote>
      <p class="revision-label">Then give it direction</p>
      <blockquote class="revision">“Keep the opening. Give the final scene more time.”</blockquote>
      <p class="example-note">Illustrative prompts · nothing runs on this page</p>
    </figure>
    <dl>
      {#each capabilities as capability}
        <div><dt>{capability.title}</dt><dd>{capability.text}</dd></div>
      {/each}
    </dl>
  </div>
</section>

<style>
  .mcp-workflow { display: grid; grid-template-columns: 1.05fr 1fr; gap: 9%; padding: 85px 8%; border-bottom: 1px solid var(--home-rule); }
  .mcp-intro .section-copy { margin: 23px 0 27px; }
  .mcp-detail { min-width: 0; }
  .brief-example { margin: 0; padding: 26px; border: 1px solid var(--home-rule); background: var(--home-surface); }
  figcaption { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; }
  figcaption :global(svg) { color: var(--home-accent); flex-shrink: 0; }
  blockquote { margin: 23px 0; font-size: clamp(20px, 2vw, 26px); line-height: 1.45; letter-spacing: -.02em; }
  .revision-label { margin: 0; padding-top: 19px; border-top: 1px solid var(--home-rule); color: var(--home-muted); font-size: 12px; }
  .revision { margin: 10px 0 20px; color: var(--home-accent); font-size: 18px; }
  .example-note { margin: 0; color: var(--home-muted); font-size: 11px; line-height: 1.7; }
  dl { margin: 27px 0 0; }
  dl > div { padding: 17px 0; border-top: 1px solid var(--home-rule); }
  dl > div:last-child { padding-bottom: 0; }
  dt { font-size: 17px; font-weight: 500; }
  dd { margin: 6px 0 0; color: var(--home-muted); font-size: 13px; line-height: 1.75; }
  @media (max-width: 900px) { .mcp-workflow { padding-inline: 5%; gap: 5%; } }
  @media (max-width: 640px) { .mcp-workflow { grid-template-columns: 1fr; gap: 35px; padding-block: 65px; } .brief-example { padding: 22px; } }
</style>
