<script lang="ts">
  import type { JobMonitor } from '../../composables/useJobMonitor.svelte'
  import { activeJob, downloadableJob, jobKindLabel, jobProgress, jobWaitLabel, type JobSummary } from '../../lib/job-monitor'
  import { formatCredits } from '../../lib/credits'

  let { job, monitor }: { job: JobSummary; monitor: JobMonitor } = $props()
  const action = $derived('id' in monitor.action && monitor.action.id === job.id ? monitor.action : { kind: 'idle' as const })
</script>

<li class="job-entry">
  <div class="job-content">
    <div class="job-heading"><h2>{job.filename || job.file || jobKindLabel(job.kind)}</h2><span class="status" class:failed={job.status === 'failed'}>{job.status === 'claimed' ? 'Starting' : job.status}</span></div>
    <p class="metadata">{jobKindLabel(job.kind)} · <time datetime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time></p>
    {#if activeJob(job)}
      <p class="wait">{jobWaitLabel(job)}</p>
      {#if job.status === 'running'}<div class="progress-line"><progress max="100" value={jobProgress(job)} aria-label="Job progress"></progress><span>{jobProgress(job)}%</span></div>{/if}
    {/if}
    {#if job.message}<p class="message">{job.message}</p>{/if}
    {#if job.cost}<p class="metadata">{formatCredits(job.cost.knownCredits)} credits{job.cost.status === 'pending' ? ' known so far · final cost pending' : ' consumed'}</p>{/if}
    <details><summary>Job ID</summary><code>{job.id}</code></details>
  </div>
  <div class="job-actions">
    {#if downloadableJob(job)}
      <button class="quiet-button" disabled={monitor.busy} onclick={() => monitor.download(job)}>{action.kind === 'downloading' ? 'Checking cloud storage…' : action.kind === 'download' || action.kind === 'expired' ? 'Renew download link' : 'Get download link'}</button>
    {:else if activeJob(job)}<button class="quiet-button" disabled={monitor.busy} onclick={() => monitor.confirmCancel(job.id)}>{action.kind === 'cancelling' ? 'Cancelling…' : 'Cancel job'}</button>
    {:else if job.status === 'completed'}<span class="metadata">Available in your project</span>{/if}
    {#if action.kind === 'download'}
      <a class="download-link" href={action.url} target="_blank" rel="noreferrer">Download from S3</a>
      <span class="metadata">Link expires {new Date(action.expiresAt).toLocaleTimeString()}. Renew it here; no new render is needed.</span>
    {:else if action.kind === 'expired'}
      <p role="status">Download link expired. Renew it here; your video does not need another render.</p>
    {:else if action.kind === 'confirm-cancel'}
      <p>Stop this job? Work already consumed may still be charged.</p>
      <div class="confirm-actions"><button class="quiet-button" onclick={monitor.dismiss}>Keep running</button><button class="quiet-button" onclick={monitor.cancelJob}>Confirm cancellation</button></div>
    {:else if action.kind === 'error'}<p role="alert">{action.message}</p>{/if}
  </div>
</li>

<style>
  .job-entry { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 32px; padding: 24px 0; border-top: 1px solid var(--home-rule); }
  .job-content { min-width: 0; }
  .job-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px 20px; }
  h2 { font-size: 18px; font-weight: 500; margin: 0; overflow-wrap: anywhere; }
  .status { color: var(--home-accent); font-size: 12px; text-transform: capitalize; }
  .status.failed, [role='alert'] { color: var(--destructive); }
  p { margin: 10px 0; font-size: 13px; line-height: 1.7; max-width: 65ch; overflow-wrap: anywhere; }
  .metadata, .message { color: var(--home-muted); font-size: 12px; line-height: 1.7; }
  .wait { color: var(--home-ink); }
  .progress-line { display: flex; align-items: center; gap: 14px; max-width: 480px; }
  .progress-line span { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--home-muted); }
  progress { flex: 1; min-width: 0; height: 6px; border: 0; appearance: none; background: var(--home-tint); accent-color: var(--home-accent); }
  progress::-webkit-progress-bar { background: var(--home-tint); }
  progress::-webkit-progress-value { background: var(--home-accent); }
  progress::-moz-progress-bar { background: var(--home-accent); }
  details { margin-top: 12px; font-size: 11px; color: var(--home-muted); }
  summary { cursor: pointer; min-height: 28px; }
  code { font-size: 11px; overflow-wrap: anywhere; font-family: var(--font-mono); }
  .job-actions { display: flex; flex-direction: column; align-items: start; gap: 12px; }
  .confirm-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  button.quiet-button { min-height: 40px; }
  .download-link { color: var(--home-accent); font-size: 14px; font-weight: 500; min-height: 40px; display: inline-flex; align-items: center; text-underline-offset: 4px; }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--home-accent); outline-offset: 3px; }
  @media (max-width: 760px) { .job-entry { grid-template-columns: 1fr; gap: 16px; } }
</style>
