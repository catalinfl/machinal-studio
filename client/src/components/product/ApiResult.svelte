<script lang="ts">
  import type { ApiExplorer } from '../../composables/useApiExplorer.svelte'
  import LandingIcon from '../home/LandingIcon.svelte'

  let { explorer }: { explorer: ApiExplorer } = $props()
  const result = $derived(explorer.phase.kind === 'checked' || explorer.phase.kind === 'error' ? explorer.phase.result : undefined)
  const hasErrors = $derived(result?.diagnostics.some(item => item.severity === 'error'))
  const progress = $derived(explorer.phase.kind === 'rendering' ? Math.max(0, Math.min(100, (explorer.phase.job?.progress ?? 0) * 100)) : 0)
</script>

<section class="result-sheet" aria-labelledby="result-heading">
  <div class="sheet-heading"><h2 id="result-heading">The result</h2><span>Live API</span></div>
  <div class="result-body">
    {#if explorer.phase.kind === 'idle'}<div class="ready-state"><LandingIcon name="direction" size={35} /><h3>Ready for your recipe.</h3><p>Validate the document, compile a composition, then send it to the rendering service.</p></div>
    {:else if explorer.phase.kind === 'uploading'}<h3>Adding your media.</h3><p role="status">{explorer.phase.filename}</p>
    {:else if explorer.phase.kind === 'checking'}<h3>{explorer.phase.action === 'validate' ? 'Validating the recipe.' : 'Compiling the composition.'}</h3><p role="status">Waiting for the API response…</p>
    {:else if explorer.phase.kind === 'checked'}<h3>{hasErrors ? 'A little attention needed.' : explorer.phase.action === 'validate' ? 'Recipe validated.' : 'Composition compiled.'}</h3><p role="status">{result?.summary || 'Inspect the response below.'}</p>
    {:else if explorer.phase.kind === 'error'}<h3>Let’s get it right.</h3><p role="alert">{explorer.phase.message}</p>
    {:else if explorer.phase.kind === 'rendering'}<h3>{explorer.phase.job ? 'Your video is on its way.' : 'Preparing your composition.'}</h3><p role="status">{explorer.phase.job?.message || (explorer.pendingGeneration ? 'Generating recipe actions and compiling…' : 'Compiling and preparing the render request…')}</p>{#if explorer.phase.job}<code class="job-id">Job {explorer.phase.job.id}</code><progress value={progress} max="100" aria-label="API render progress"></progress><span class="progress-value measurement">{Math.round(progress)}% · {explorer.phase.job.status}</span>{/if}
    {:else}<div class="ready-state"><LandingIcon name="check" size={35} /><h3>Your video is ready.</h3><p role="status">{explorer.phase.job.filename}</p><a class="button button-solid" href={explorer.phase.url} download={explorer.phase.job.filename}>Download result <LandingIcon name="arrow" size={17} /></a></div>{/if}
    {#if result?.composition}<dl><div><dt>Duration</dt><dd>{result.composition.duration.toFixed(2)}s</dd></div><div><dt>Format</dt><dd>{result.composition.output.format.toUpperCase()}</dd></div><div><dt>Clips</dt><dd>{result.composition.tracks.reduce((count, track) => count + track.clips.length, 0)}</dd></div></dl>{/if}
    {#if result?.diagnostics.length}<div class="diagnostics">{#each result.diagnostics as diagnostic}<p class:error={diagnostic.severity === 'error'}><code>{diagnostic.path}{diagnostic.line ? ` · line ${diagnostic.line}` : ''}</code><span>{diagnostic.message}</span></p>{/each}</div>{/if}
    {#if result?.requirements.length}<div class="requirements">{#each result.requirements as requirement}<p><strong>{requirement.kind}</strong><span>{requirement.message}</span></p>{/each}</div>{/if}
    <button class="button button-solid render-action" disabled={explorer.busy || !explorer.source.trim()} onclick={explorer.renderVideo}>{explorer.pendingGeneration ? 'Generate & render' : 'Render video'}<LandingIcon name="arrow" size={17} /></button>
    <p class="plan-note">Server rendering and AI generation use your subscription. Validate and Compile do not run AI actions.</p>
  </div>
</section>

<style>
  .result-sheet { min-width: 0; }
  .result-body { padding: 23px 20px; }
  .ready-state > :global(svg) { color: var(--home-accent); margin-bottom: 18px; }
  h3 { margin: 0 0 15px; font-size: 25px; font-weight: 500; letter-spacing: -.025em; line-height: 1.2; }
  p { font-size: 12px; line-height: 1.75; color: var(--home-muted); overflow-wrap: anywhere; }
  dl { margin: 22px 0; }
  dl > div { display: flex; justify-content: space-between; gap: 15px; padding: 9px 0; border-bottom: 1px solid var(--home-rule); font-size: 11px; }
  dt { color: var(--home-muted); } dd { margin: 0; font-family: var(--font-mono); }
  .render-action { width: 100%; margin-top: 25px; }
  .plan-note { font-size: 10px; margin-top: 14px; }
  .diagnostics p, .requirements p { border-top: 1px solid var(--home-rule); padding-top: 13px; }
  .diagnostics code, .requirements strong { display: block; color: var(--home-accent); font-size: 10px; margin-bottom: 5px; }
  .diagnostics span, .requirements span { display: block; }
  .diagnostics .error { color: var(--home-ink); }
  .job-id { display: block; font: 10px/1.7 var(--font-mono); color: var(--home-accent); overflow-wrap: anywhere; }
  progress { width: 100%; height: 5px; margin-top: 17px; accent-color: var(--home-accent); }
  progress::-webkit-progress-bar { background: var(--home-rule); } progress::-webkit-progress-value { background: var(--home-accent); }
  .progress-value { display: block; margin-top: 7px; color: var(--home-muted); font-size: 10px; }
  @media (max-width: 900px) { .result-sheet { border-top: 1px solid var(--home-rule); } }
</style>
