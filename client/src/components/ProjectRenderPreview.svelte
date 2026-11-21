<script lang="ts">
  import { mediaSourceUrl } from '../lib/api'
  import { preparedCompositionJSON, type ProjectPresentation, type PreparedComposition } from '../lib/project-presentation'

  let { presentation, warning = '' }: { presentation?: ProjectPresentation; warning?: string } = $props()
  let failedFile = $state('')
  let downloadError = $state('')
  const rendered = $derived(presentation?.lastRender)
  const prepared = $derived(presentation?.prepared)
  const audioOnly = $derived(rendered?.filename?.toLowerCase().endsWith('.mp3'))

  function downloadJSON(snapshot: PreparedComposition): void {
    downloadError = ''
    try {
      const url = URL.createObjectURL(new Blob([preparedCompositionJSON(snapshot)], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = snapshot.filename ? `${snapshot.filename}.edit.json` : 'composition.edit.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      downloadError = cause instanceof Error ? cause.message : String(cause)
    }
  }
</script>

{#if warning}<p class="notice" role="status">{warning}</p>{/if}
{#if rendered?.filename}
  <section aria-label="Last render" class="render-preview">
    <header><h3>Last render</h3><time datetime={rendered.updatedAt}>{new Date(rendered.updatedAt).toLocaleDateString()}</time></header>
    {#key rendered.filename}
      {#if audioOnly}
        <audio controls preload="none" src={mediaSourceUrl(rendered.filename)} onerror={() => { failedFile = rendered!.filename! }} aria-label="Last rendered audio"></audio>
      {:else}
        <!-- svelte-ignore a11y_media_has_caption (Playback of an existing export; caption overlays belong to that composition.) -->
        <video controls playsinline preload="metadata" src={mediaSourceUrl(rendered.filename)} onerror={() => { failedFile = rendered!.filename! }} aria-label="Last rendered video"></video>
      {/if}
    {/key}
    <p class="filename" title={rendered.filename}>{rendered.filename}</p>
    {#if failedFile === rendered.filename}<p role="status">The render could not be played. Reload the project to retry; its timeline is still available.</p>{/if}
    {#if rendered.composition && rendered.document}
      <button type="button" onclick={() => downloadJSON(rendered)}>Download render JSON</button>
    {:else}
      <p class="notice">No editable snapshot was retained for this export.</p>
    {/if}
  </section>
{/if}
{#if prepared?.document && prepared.composition && prepared.composition.id !== rendered?.composition?.id}
  <section aria-label="Prepared timeline" class="prepared">
    <h3>Prepared timeline</h3>
    <p>{prepared.composition.duration.toLocaleString(undefined, { maximumFractionDigits: 1 })}s · {prepared.composition.output.fps} fps · {prepared.composition.output.resolution}</p>
    <button type="button" onclick={() => downloadJSON(prepared)}>Download timeline JSON</button>
  </section>
{/if}
{#if downloadError}<p role="alert">{downloadError}</p>{/if}

<style>
  section { border-top: 1px solid var(--border); padding-block: var(--space-8); }
  header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); }
  h3 { margin: 0; font-size: var(--text-xs); font-weight: 600; }
  p, time { color: var(--muted-foreground); font-size: var(--text-2xs); line-height: 1.5; }
  p { margin-block: var(--space-4); }
  video { display: block; width: 100%; max-height: 220px; background: var(--background); object-fit: contain; }
  audio { display: block; width: 100%; }
  .filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .notice { overflow-wrap: anywhere; }
  button { min-height: 34px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding-inline: var(--space-6); background: var(--surface); color: var(--foreground); font: inherit; cursor: pointer; }
  button:hover { background: var(--surface-muted); }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  [role='alert'] { color: var(--destructive); }
</style>
