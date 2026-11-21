<script lang="ts">
  import type { useProjects } from '../composables/useProjects.svelte'
  import { mediaProcessing } from '../stores/media-processing.svelte'
  import ProjectRenderPreview from './ProjectRenderPreview.svelte'

  let { projects }: { projects: ReturnType<typeof useProjects> } = $props()
  let panel: HTMLDivElement | undefined
  let name = $state('')
  let action = $state<'create' | 'rename'>('create')
  let working = $state(false)
  const failed = $derived(projects.phase.kind === 'error' || projects.phase.kind === 'conflict')
  const disabled = $derived(working || mediaProcessing.active || projects.phase.kind === 'loading' || projects.phase.kind === 'saving' || projects.phase.kind === 'conflict')
  // Opening a saved timeline already awaits the save queue; autosave must not swallow confirmation clicks.
  const timelineDisabled = $derived(working || mediaProcessing.active || projects.phase.kind === 'loading' || projects.phase.kind === 'conflict')
  const saveStatus = $derived(projects.phase.kind === 'saving' ? 'Saving…' : projects.phase.kind === 'pending' ? 'Unsaved changes' : failed ? 'Not saved' : projects.ready && projects.current ? 'Saved' : 'Loading')

  function open(): void {
    if (!failed) { name = ''; action = 'create' }
    panel?.togglePopover()
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim() || disabled) return
    working = true
    try {
      if (action === 'create') await projects.create(name)
      else { await projects.rename(name); name = ''; action = 'create' }
    } catch { /* The workspace retains the draft and exposes Retry. */ } finally { working = false }
  }

  async function select(id: string): Promise<void> {
    working = true
    try { await projects.select(id) } catch { /* Feedback is owned by the workspace. */ } finally { working = false }
  }
</script>

<button class="project-button" class:failed class:unsaved={projects.phase.kind === 'pending'} onclick={open} aria-haspopup="dialog" aria-label="Projects" title={`${projects.current?.name ?? 'Projects'} (${saveStatus})`}>
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5h5l2-2h3l2 2h3v11h-15z" /></svg>
  <span>Projects{failed ? ' · Not saved' : ''}</span>
</button>
<span class="save-feedback" role="status" aria-live="polite">{saveStatus}</span>
<div class="projects-panel" popover="auto" bind:this={panel} role="dialog" aria-label="Projects">
  <header><h2>Projects</h2><button class="quiet" onclick={() => panel?.hidePopover()} aria-label="Close projects">Close</button></header>
  <p class="help">Each project has its own timeline and Media Bin. Changes save automatically on this computer.</p>
  <p class="help">View or edit the project YAML in <strong>Recipe → Code DSL</strong>.</p>
  {#if projects.phase.kind === 'error'}
    <div class="failure" role="alert"><p>{projects.phase.message}</p><button onclick={projects.retry}>Retry</button><button onclick={projects.reload}>Reload project</button></div>
  {:else if projects.phase.kind === 'conflict'}
    <div class="failure" role="alert"><p>{projects.phase.message}</p><button onclick={projects.downloadDraft}>Download unsaved draft</button><button onclick={projects.reload}>Reload project</button></div>
  {/if}
  {#if projects.items.length > 0}
    <div class="project-list" aria-label="Saved projects">
      {#each projects.items as project (project.id)}
        <button class="project-row" class:selected={project.id === projects.current?.id} aria-pressed={project.id === projects.current?.id} disabled={disabled} onclick={() => select(project.id)}>
          <span class="project-name">{project.name}</span><span class="project-meta">{project.id === projects.current?.id ? 'Current project' : new Date(project.updatedAt).toLocaleDateString()}</span>
        </button>
      {/each}
    </div>
    <div class="current-actions"><span>{saveStatus}</span><button class="quiet" disabled={disabled || !projects.current} onclick={() => { action = 'rename'; name = projects.current?.name ?? '' }}>Rename current</button></div>
    <ProjectRenderPreview presentation={projects.presentation} warning={projects.presentationWarning} disabled={timelineDisabled} onopen={projects.openPrepared} />
    <form onsubmit={submit}>
      <label for="project-name">{action === 'create' ? 'New project name' : 'Project name'}</label>
      <div class="name-controls"><input id="project-name" bind:value={name} maxlength="120" required disabled={disabled} placeholder="e.g. Summer film" /><button type="submit" disabled={disabled || !name.trim()}>{action === 'create' ? 'Create' : 'Rename'}</button></div>
      {#if action === 'rename'}<button type="button" class="quiet" onclick={() => { action = 'create'; name = '' }}>Cancel rename</button>{/if}
    </form>
  {:else if projects.phase.kind === 'loading'}
    <p role="status">Loading your projects…</p>
  {:else if projects.phase.kind !== 'error'}
    <p>No local projects are available. Reload the project to retry.</p>
  {/if}
</div>

<style>
  .save-feedback { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .project-button.failed { border-color: var(--destructive); color: var(--destructive); }
  .project-button.unsaved { color: var(--primary); }
  .project-button { display: inline-flex; align-items: center; gap: var(--space-3); min-height: 34px; padding: 0 var(--space-6); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--foreground); font-size: var(--text-xs); cursor: pointer; }
  .project-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; }
  .project-button:hover { background: var(--surface-muted); }
  .projects-panel { position: fixed; inset: 60px 18px auto auto; margin: 0; width: min(360px, calc(100vw - 24px)); max-height: calc(100dvh - 80px); overflow: auto; box-sizing: border-box; padding: var(--space-10); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-elevated); color: var(--foreground); box-shadow: var(--shadow-popover); font-size: var(--text-xs); }
  header, .current-actions { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); }
  h2 { margin: 0; font-size: var(--text-md); }
  p { line-height: 1.5; }
  .help, .project-meta, .current-actions > span { color: var(--muted-foreground); }
  .project-list { display: flex; flex-direction: column; max-height: 280px; overflow: auto; border-block: 1px solid var(--border); }
  .project-row { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-start; gap: var(--space-3); width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--border); padding: var(--space-8); background: transparent; color: var(--foreground); cursor: pointer; }
  .project-row:last-child { border-bottom: 0; }
  .project-row:hover { background: var(--surface-muted); }
  .project-row.selected { background: var(--primary-subtle); color: var(--primary); }
  .project-name { width: 100%; overflow-wrap: anywhere; font-weight: 600; }
  .project-meta { font-size: var(--text-2xs); }
  .current-actions { margin-block: var(--space-6) var(--space-10); }
  form { border-top: 1px solid var(--border); padding-top: var(--space-10); }
  label { display: block; margin-bottom: var(--space-5); font-weight: 600; }
  .name-controls { display: flex; gap: var(--space-5); }
  input { min-width: 0; width: 100%; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--space-6); background: var(--input); color: var(--foreground); font: inherit; }
  input::placeholder { color: var(--muted-foreground); opacity: 1; }
  .projects-panel button { min-height: 34px; font: inherit; }
  .name-controls button, .failure button { border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding-inline: var(--space-6); background: var(--surface); color: var(--foreground); cursor: pointer; }
  .name-controls button { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
  .quiet { border: 0; padding: var(--space-3); color: var(--muted-foreground); background: transparent; cursor: pointer; }
  .quiet:hover { color: var(--foreground); }
  .failure { margin-block: var(--space-8); color: var(--destructive); }
  .failure button + button { margin-left: var(--space-5); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  @media (max-width: 600px) { .project-button { width: 34px; padding: 0; justify-content: center; } .project-button span { display: none; } }
</style>
