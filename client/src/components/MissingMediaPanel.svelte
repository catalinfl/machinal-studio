<script lang="ts">
  import { getMediaBinSources } from '../lib/media-bin'
  import { relinkLocalMedia } from '../lib/relink-media'

  const missing = $derived(getMediaBinSources().filter(source => source.missing))
  let input = $state<HTMLInputElement>()
  let target = $state('')
  let status = $state<{ kind: 'idle' | 'working' | 'error'; message: string }>({ kind: 'idle', message: '' })

  async function replace(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (!file || !target) return
    status = { kind: 'working', message: 'Checking and saving the replacement…' }
    try {
      await relinkLocalMedia(target, file)
      status = { kind: 'idle', message: '' }
    } catch (error) {
      status = { kind: 'error', message: error instanceof Error ? error.message : 'Could not relink this file.' }
    } finally { if (input) input.value = '' }
  }
</script>

{#if missing.length}
  <section class="missing-media" aria-label="Offline project media">
    <strong>{missing.length} {missing.length === 1 ? 'file is' : 'files are'} offline</strong>
    <span>Your edit is intact. Choose the original files to restore preview and export. Matching dimensions and duration are checked, not file identity.</span>
    <ul>{#each missing as source (source.id)}<li><span>{source.displayName || source.name}</span><button disabled={status.kind === 'working'} onclick={() => { target = source.name; input?.click() }}>Relink file</button></li>{/each}</ul>
    {#if status.message}<p role={status.kind === 'error' ? 'alert' : 'status'}>{status.message}</p>{/if}
    <input bind:this={input} type="file" accept="video/*,audio/*,image/*" onchange={replace} hidden aria-label="Choose original media file" />
  </section>
{/if}

<style>
  .missing-media { padding: 12px 20px; background: var(--surface); border-bottom: 1px solid var(--border); color: var(--foreground); font-size: 12px; }
  .missing-media > span { margin-left: 12px; color: var(--muted-foreground); }
  ul { list-style: none; padding: 0; margin: 8px 0 0; max-height: 120px; overflow: auto; }
  li { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  li > span { overflow-wrap: anywhere; }
  button { min-height: 36px; flex-shrink: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--input); color: var(--foreground); padding: 4px 12px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--primary-subtle); }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  button:disabled { opacity: .6; cursor: wait; }
  p { margin: 8px 0 0; }
</style>
