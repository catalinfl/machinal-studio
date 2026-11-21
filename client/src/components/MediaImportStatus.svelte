<script lang="ts">
  import { onMount } from 'svelte'
  import { formatMediaDuration, type MediaImportProgress } from '../lib/media-item'

  let { progress }: { progress: MediaImportProgress } = $props()
  let now = $state(Date.now())
  const elapsed = $derived(Math.max(0, (now - progress.startedAt) / 1000))
  const percent = $derived(progress.phase === 'uploading' && progress.size > 0
    ? Math.min(100, Math.floor(progress.loaded / progress.size * 100)) : null)

  const bytesPerSecond = $derived(progress.phase === 'uploading'
    ? progress.loaded / Math.max(1, (now - progress.uploadStartedAt) / 1000) : 0)

  const remaining = $derived(progress.phase === 'uploading' && bytesPerSecond > 0
    ? Math.ceil((progress.size - progress.loaded) / bytesPerSecond) : null)

  onMount(() => {
    const timer = setInterval(() => { now = Date.now() }, 1000)
    return () => clearInterval(timer)
  })
</script>

<div class="import-status" aria-label="Media import progress">
  <div class="status-head" role="status">
    <strong>{progress.phase === 'metadata' ? 'Reading file' : progress.phase === 'saving' ? 'Saving on server' : 'Uploading'}</strong>
    <span>{progress.index} / {progress.total}</span>
  </div>
  <span class="file-name" title={progress.fileName}>{progress.fileName}</span>
  <progress max="100" value={percent ?? undefined} aria-label={`Upload progress for ${progress.fileName}`}></progress>
  <div class="metrics">
    <span>{formatMediaDuration(elapsed)} elapsed</span>
    {#if percent !== null}<span>{percent}%</span>{/if}
  </div>
  {#if bytesPerSecond > 0 && remaining !== null}
    <div class="metrics">
      <span>{(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s</span>
      <span>About {formatMediaDuration(remaining)} left</span>
    </div>
  {/if}
</div>

<style>
  .import-status {
    display: grid;
    gap: var(--space-4);
    flex: 0 0 auto;
    min-width: 0;
    padding: var(--space-6) var(--space-8);
    border-bottom: 1px solid var(--border);
    background: var(--surface-elevated);
    font-size: var(--text-xs);
  }
  .status-head, .metrics { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
  .status-head strong { color: var(--foreground); font-weight: var(--weight-semibold); }
  .status-head > span, .metrics { color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
  .file-name { overflow: hidden; color: var(--foreground); text-overflow: ellipsis; white-space: nowrap; }
  progress { width: 100%; height: 5px; border: 0; accent-color: var(--primary); }
</style>
