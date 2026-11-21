<script lang="ts">
  import LandingIcon from '../home/LandingIcon.svelte'

  const paths = [
    {
      id: 'browser', label: 'Browser-local', title: 'Your device does the rendering.',
      description: 'Import local media, arrange your timeline and export using your browser’s processing power. Local originals can be saved in this browser’s project storage.',
      steps: [{ title: 'Local media', detail: 'Files you choose on your device' }, { title: 'Browser editor', detail: 'Timeline, preview and local export' }, { title: 'Your download', detail: 'Save the finished file' }],
      note: 'Account and saved-project services still use the network. Local media must be uploaded separately if you choose hosted tools.',
      href: '/editor', action: 'Open the editor',
    },
    {
      id: 'hosted', label: 'Hosted tools', title: 'Send only what the task needs.',
      description: 'Upload the media needed for server rendering. Hosted image, voice and caption tools send the inputs needed for your request to the configured AI providers.',
      steps: [{ title: 'Your upload', detail: 'Media in your project workspace' }, { title: 'Hosted processing', detail: 'Server render or requested AI tool' }, { title: 'Finished result', detail: 'Recover it through your jobs' }],
      note: 'Hosted tools require an account and eligible paid access. Review the request and current pricing before starting paid work.',
      href: '/pricing', action: 'Understand hosted access',
    },
    {
      id: 'automation', label: 'API & MCP', title: 'The same idea, written as a recipe.',
      description: 'Describe your edit in YAML, validate its structure, then generate requested assets and render. Connect an application or a coding agent to an account-owned project.',
      steps: [{ title: 'Media + YAML', detail: 'Project sources and instructions' }, { title: 'Validate & compile', detail: 'Check the edit before rendering' }, { title: 'Generate & render', detail: 'Explicit, usage-based processing' }],
      note: 'Hosted API and MCP share your credit balance. An agent needs separate approval to access media and start paid work; installing MCP starts neither.',
      href: '/mcp', action: 'Explore the MCP workflow',
    },
  ]

  let selected = $state('browser')
  const path = $derived(paths.find(item => item.id === selected) ?? paths[0])
</script>

<section class="processing" aria-labelledby="processing-heading">
  <div class="processing-intro"><h2 id="processing-heading">One creative engine.<br /><span>Your choice of workflow.</span></h2><p>Start with a timeline. Build with a recipe. Know where the work happens.</p></div>
  <div class="path-switch" role="group" aria-label="Processing workflow">
    {#each paths as item}<button type="button" aria-pressed={selected === item.id} onclick={() => selected = item.id}>{item.label}</button>{/each}
  </div>
  <div class="path-content">
    <div class="path-copy"><h3>{path.title}</h3><p>{path.description}</p><a class="text-link" href={path.href}>{path.action}<LandingIcon name="arrow" size={17} /></a></div>
    <ol aria-label={`${path.label} processing steps`}>
      {#each path.steps as step, index}<li><span class="step-symbol"><LandingIcon name={index === 0 ? 'file' : index === 1 ? 'layers' : 'direction'} size={24} /></span><div><strong>{step.title}</strong><span>{step.detail}</span></div>{#if index < path.steps.length - 1}<LandingIcon name="arrow" size={20} />{/if}</li>{/each}
    </ol>
  </div>
  <p class="path-note">{path.note}</p>
</section>

<style>
  .processing { padding: 32px; border: 1px solid var(--home-rule); background: var(--home-surface); }
  .processing-intro { display: flex; align-items: end; justify-content: space-between; gap: 32px; padding-bottom: 28px; }
  h2 { margin: 0; font-size: clamp(26px, 2.7vw, 36px); font-weight: 500; line-height: 1.15; letter-spacing: -.035em; }
  h2 span { color: var(--home-accent); }
  .processing-intro p { max-width: 32ch; margin: 0; color: var(--home-muted); font-size: 14px; line-height: 1.7; }
  .path-switch { display: flex; border-block: 1px solid var(--home-rule); }
  .path-switch button { flex: 1; padding: 14px 12px; border: 0; border-inline-end: 1px solid var(--home-rule); background: transparent; color: var(--home-muted); font-size: 14px; cursor: pointer; }
  .path-switch button:last-child { border-inline-end: 0; }
  .path-switch button:hover { color: var(--home-accent); background: var(--home-tint); }
  .path-switch button[aria-pressed='true'] { color: var(--home-ink); background: var(--home-tint); font-weight: 500; }
  .path-switch button:focus-visible { outline-offset: -4px; }
  .path-content { display: grid; grid-template-columns: 1fr 1fr; gap: 7%; align-items: center; padding: 32px 0; }
  h3 { margin: 0; font-size: 24px; line-height: 1.25; font-weight: 500; letter-spacing: -.025em; }
  .path-copy p { max-width: 57ch; min-height: 100px; color: var(--home-muted); font-size: 15px; line-height: 1.75; margin: 16px 0 20px; }
  .path-copy .text-link { font-size: 13px; }
  ol { margin: 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 18px; padding: 17px 0; border-bottom: 1px solid var(--home-rule); }
  li:first-child { padding-top: 0; }
  li:last-child { border-bottom: 0; padding-bottom: 0; }
  .step-symbol { display: grid; place-items: center; width: 48px; height: 48px; background: var(--home-tint); color: var(--home-accent); flex-shrink: 0; }
  li div { flex: 1; min-width: 0; }
  li strong, li div > span { display: block; }
  li strong { font-weight: 500; font-size: 16px; }
  li div > span { color: var(--home-muted); font-size: 12px; line-height: 1.6; margin-top: 5px; }
  li > :global(svg) { transform: rotate(90deg); color: var(--home-accent); flex-shrink: 0; }
  .path-note { padding-top: 18px; margin: 0; border-top: 1px solid var(--home-rule); color: var(--home-muted); font-size: 12px; line-height: 1.7; }
  @media (max-width: 760px) { .processing { padding: 22px; } .processing-intro { align-items: start; flex-direction: column; gap: 16px; } .processing-intro p { max-width: 45ch; } .path-content { grid-template-columns: 1fr; gap: 30px; padding-block: 26px; } .path-copy p { min-height: 0; } .path-switch button { padding: 14px 6px; font-size: 12px; } }
  @media (max-width: 380px) { .processing { padding: 16px; } .path-switch button { font-size: 11px; } }
</style>
