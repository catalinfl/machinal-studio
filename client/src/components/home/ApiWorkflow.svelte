<script lang="ts">
  import LandingIcon from './LandingIcon.svelte'

  const steps = [
    { title: 'Bring your media.', text: 'Authenticate with your API credentials, create a session and upload the files for your composition.', route: 'POST /sessions · POST /upload' },
    { title: 'Send your recipe.', text: 'Validate and compile your YAML. Resolve any AI generation actions, then submit the prepared composition for rendering.', route: 'POST /compositions/compile · POST /renders' },
    { title: 'Get the finished video.', text: 'Follow the render job’s progress. When it is complete, download your result and put it to work.', route: 'GET /renders/{id} · GET /download' },
  ]
</script>

<section class="api-workflow" id="api" aria-labelledby="api-heading">
  <div class="api-intro"><h2 class="section-title" id="api-heading">Your files. Your YAML.<br /><span>A finished video.</span></h2><p class="section-copy">Build video into your workflow. Send media, authenticate with your API credentials and describe the edit as a recipe. The rendering service handles the final composition.</p></div>
  <div class="request-flow"><span><LandingIcon name="file" size={22} />Media files</span><span class="join">+</span><span><LandingIcon name="key" size={22} />API credentials</span><span class="join">+</span><span><LandingIcon name="code" size={22} />YAML recipe</span><LandingIcon name="arrow" size={27} /><span class="flow-output"><LandingIcon name="play" size={22} />Your video</span></div>
  <div class="api-steps">{#each steps as step, index}<article><span class="step-number measurement">{index + 1}</span><h3>{step.title}</h3><p>{step.text}</p><code>{step.route}</code></article>{/each}</div>
  <div class="api-close"><a class="text-link" href="/api">Explore the headless API <LandingIcon name="direction" size={17} /></a><span>Asynchronous jobs. Inspectable progress. Reusable recipes.</span></div>
</section>

<style>
  .api-workflow { padding: 85px 8%; background: var(--home-tint); }
  .api-intro { display: grid; grid-template-columns: 1.2fr 1fr; gap: 8%; align-items: end; }
  .api-intro p { margin: 0; }
  .request-flow { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 30px 0; margin-top: 35px; border-block: 1px solid var(--home-rule); }
  .request-flow > span:not(.join) { display: flex; align-items: center; gap: 12px; font-size: 16px; }
  .request-flow :global(svg) { color: var(--home-accent); flex-shrink: 0; }
  .join { font-size: 23px; color: var(--home-muted); }
  .flow-output { font-weight: 500; }
  .api-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 35px; padding-top: 37px; }
  .step-number { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; border: 1px solid var(--home-rule); color: var(--home-accent); font-size: 11px; }
  h3 { font-size: 24px; font-weight: 500; line-height: 1.2; letter-spacing: -.025em; margin: 17px 0 12px; }
  .api-steps p { color: var(--home-muted); font-size: 13px; line-height: 1.75; max-width: 40ch; }
  code { color: var(--home-accent); font-family: var(--font-mono); font-size: 10px; line-height: 1.7; overflow-wrap: anywhere; }
  .api-close { display: flex; align-items: center; justify-content: space-between; gap: 25px; margin-top: 38px; padding-top: 26px; border-top: 1px solid var(--home-rule); }
  .api-close > span { color: var(--home-muted); font-size: 11px; }
  @media (max-width: 900px) { .api-workflow { padding-inline: 5%; } .request-flow { gap: 10px; } .request-flow > span:not(.join) { font-size: 13px; gap: 8px; } }
  @media (max-width: 640px) { .api-workflow { padding-block: 65px; } .api-intro, .api-steps { grid-template-columns: 1fr; gap: 25px; } .request-flow { flex-wrap: wrap; justify-content: start; gap: 18px; padding-block: 22px; } .api-steps { gap: 26px; } .api-steps article + article { border-top: 1px solid var(--home-rule); padding-top: 25px; } .api-steps p { max-width: none; } .api-close { flex-direction: column; align-items: start; } }
</style>
