<script lang="ts">
  import type { useProjects } from '../composables/useProjects.svelte'
  import { useProjectVersions } from '../composables/useProjectVersions.svelte'

  let { projects }: { projects: ReturnType<typeof useProjects> } = $props()
  const history = useProjectVersions(() => projects)
</script>

<details ontoggle={event => { if (event.currentTarget.open) void history.load() }}>
  <summary>Saved versions</summary>
  <p>Keep up to 20 named checkpoints. Restoring also saves the current edit first. Original media is not duplicated.</p>
  <form onsubmit={event => { event.preventDefault(); void history.save() }}><label>Version name<input bind:value={history.name} maxlength="120" required disabled={history.busy} /></label><button disabled={history.busy || !history.name.trim() || !projects.current || projects.phase.kind === 'conflict'}>Save version</button></form>
  <ul>{#each history.versions as version (version.id)}<li><strong>{version.name}</strong><span>{new Date(version.createdAt).toLocaleString()}</span><div><button disabled={history.busy} onclick={() => history.requestRestore(version)}>Restore</button><button disabled={history.busy} onclick={() => history.requestRemove(version)}>Remove checkpoint</button></div></li>{/each}</ul>
  {#if history.pending}<div role="group" aria-label="Confirm version action"><p>{history.pending.kind === 'restore' ? `Restore “${history.pending.version.name}”? The current edit will be kept as a checkpoint.` : `Remove “${history.pending.version.name}”? This checkpoint will be removed, not your original media.`}</p><button disabled={history.busy} onclick={() => void history.confirm()}>{history.pending.kind === 'restore' ? 'Confirm restore' : 'Confirm removal'}</button><button disabled={history.busy} onclick={history.dismiss}>Cancel</button></div>{/if}
  {#if history.phase.kind === 'error'}<p role="alert">{history.phase.message}</p>{:else if history.busy}<p role="status">Working…</p>{/if}
</details>

<style>
  details { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
  summary { cursor: pointer; padding: 6px 0; }
  p, li > span { color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }
  form, li { display: flex; flex-direction: column; gap: 8px; }
  ul { list-style: none; padding: 0; max-height: 240px; overflow: auto; }
  li { border-top: 1px solid var(--border); padding: 10px 0; }
  label { display: grid; gap: 6px; }
  input, button { min-height: 36px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--input); color: var(--foreground); font: inherit; padding: 6px 10px; box-sizing: border-box; }
  input { min-width: 0; width: 100%; }
  li div { display: flex; gap: 8px; flex-wrap: wrap; }
  button { cursor: pointer; }
  button:hover:not(:disabled) { background: var(--primary-subtle); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
