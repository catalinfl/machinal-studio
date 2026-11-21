<script lang="ts">
  import { useJobMonitor } from '../../composables/useJobMonitor.svelte'
  import JobEntry from './JobEntry.svelte'

  const monitor = useJobMonitor()
</script>

<header><h1>Jobs &amp; downloads</h1><p>Follow your server work. Download when it is ready.</p></header>
<div class="jobs-toolbar">
  <label class="field">Project<select aria-label="Project" value={monitor.projectId} disabled={!monitor.projects.length} onchange={event => monitor.selectProject(event.currentTarget.value)}>
    {#if !monitor.projects.length}<option value="">No projects loaded</option>{/if}
    {#each monitor.projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
  </select></label>
  <div class="toolbar-actions"><button class="quiet-button" disabled={monitor.refreshing} onclick={monitor.refresh}>{monitor.refreshing ? 'Refreshing…' : 'Refresh jobs'}</button>
    {#if monitor.notifications !== 'unsupported'}<button class="quiet-button" disabled={monitor.notifications === 'enabled' || monitor.notifications === 'denied'} onclick={monitor.enableNotifications}>{monitor.notifications === 'enabled' ? 'Notifications on' : monitor.notifications === 'denied' ? 'Notifications blocked' : 'Notify me when ready'}</button>{/if}
  </div>
</div>
<p class="guidance">Times are approximate, not deadlines. A job finishes only after its cloud upload succeeds when S3 is configured. Closing this page does not cancel work.</p>
{#if monitor.notifications === 'enabled'}<p class="guidance" role="status">Completion notifications work while this page stays open. Background checks may be delayed by your browser.</p>{/if}
{#if monitor.phase.kind === 'loading'}<p role="status">Loading your jobs…</p>
{:else if monitor.phase.kind === 'error'}<p class="error" role="alert">{monitor.phase.message} Use Refresh jobs to try again.</p>
{:else}
  {#if monitor.phase.warning}<p class="error" role="alert">Showing the last known status. {monitor.phase.warning}</p>{/if}
  <p class="updated">Last checked <time datetime={monitor.phase.updatedAt.toISOString()}>{monitor.phase.updatedAt.toLocaleTimeString()}</time> · Up to 100 recent jobs in this project</p>
  {#if monitor.phase.jobs.length}
    <ul aria-label="Project jobs">{#each monitor.phase.jobs as job (job.id)}<JobEntry {job} {monitor} />{/each}</ul>
  {:else}
    <section class="empty"><h2>No server jobs yet</h2><p>Exports and generation tasks for this project will appear here. Local browser exports do not use the server queue.</p><a class="quiet-button" href="/editor">Open editor</a></section>
  {/if}
{/if}
<p class="retention">Job history is retained for 30 days. Download links expire independently; request a new link here rather than rendering again.</p>

<style>
  header { margin-bottom: 32px; }
  header p { color: var(--home-muted); font-size: 14px; margin: 14px 0 0; }
  .jobs-toolbar { display: flex; align-items: end; flex-wrap: wrap; gap: 20px; padding-top: 24px; border-top: 1px solid var(--home-rule); }
  label { width: min(100%, 360px); }
  .toolbar-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  button.quiet-button { min-height: 42px; }
  .guidance, .retention { max-width: 75ch; color: var(--home-muted); font-size: 12px; line-height: 1.8; margin: 20px 0; }
  .updated { color: var(--home-muted); font-size: 11px; font-variant-numeric: tabular-nums; margin: 28px 0 16px; }
  ul { padding: 0; list-style: none; margin: 0; }
  .error { color: var(--destructive); font-size: 13px; line-height: 1.7; }
  .empty { border-top: 1px solid var(--home-rule); padding: 40px 0; }
  .empty h2 { font-size: 22px; font-weight: 500; margin: 0; }
  .empty p { font-size: 14px; line-height: 1.7; max-width: 65ch; color: var(--home-muted); }
  .retention { border-top: 1px solid var(--home-rule); padding-top: 20px; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
</style>
