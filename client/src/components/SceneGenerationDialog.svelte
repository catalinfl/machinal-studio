<script lang="ts">
  import WorkbenchDialog from './WorkbenchDialog.svelte'
  import SceneGenerationResult from './SceneGenerationResult.svelte'
  import ScenePromptFields from './ScenePromptFields.svelte'
  import { sceneGeneration as generation } from '../composables/useSceneGeneration.svelte'
  import { editor, projectResolution } from '../stores/editor.svelte'

  let { onClose }: { onClose: () => void } = $props()
  const selected = $derived(generation.selected)
  const selectedOverlay = $derived(!!selected?.source?.config.transparent)
  const insertionHelp = $derived(selected
    ? selectedOverlay
      ? `Adds on a separate upper track at the playhead · ${editor.currentTime.toFixed(2)} s`
      : `Adds at the end of your video · ${editor.totalDuration.toFixed(2)} s`
    : generation.draft.transparent
      ? 'Generate an overlay, review its transparency, then place it over your clips.'
      : 'Generate a scene, review it, then add it to the timeline.')

  const sceneSize = $derived(projectResolution('1080p', generation.draft.aspect && generation.draft.aspect !== 'project' ? generation.draft.aspect : editor.effectiveProjectAspect))
  let voiceInput = $state<HTMLInputElement>()

  function clearVoice(): void {
    generation.draft.voice = null
    if (voiceInput) voiceInput.value = ''
  }

  function chooseVoice(event: Event): void {
    generation.draft.voice = (event.currentTarget as HTMLInputElement).files?.[0] ?? null
    if (generation.draft.voice) generation.draft.audioSource = ''
  }
</script>

<WorkbenchDialog id="scene-generation-dialog" ariaLabel="Generate scenes" title="Generate scenes" subtitle="Turn text, narration and media into animated 2D or 3D scenes." width="large" metered {onClose}>
  <div class="scene-workbench">
    <div class="workspace-content">
      <form id="scene-generation-form" class="authoring" onsubmit={(event) => { event.preventDefault(); void generation.generate() }} aria-busy={generation.busy}>
        <div class="brief">
          <div class="input-mode" role="group" aria-label="Scene input">
            <button type="button" aria-pressed={generation.draft.mode === 'prompt'} class:active={generation.draft.mode === 'prompt'} disabled={generation.busy} onclick={() => generation.draft.mode = 'prompt'}>From a prompt</button>
            <button type="button" aria-pressed={generation.draft.mode === 'voice'} class:active={generation.draft.mode === 'voice'} disabled={generation.busy} onclick={() => generation.draft.mode = 'voice'}>From a voice</button>
          </div>
          <label for="scene-output">Scene output</label>
          <select id="scene-output" bind:value={generation.draft.transparent} disabled={generation.busy} aria-describedby="scene-output-help">
            <option value={false}>Full scene</option>
            <option value={true}>Transparent overlay</option>
          </select>
          <p id="scene-output-help" class="field-help">{generation.draft.transparent ? 'An effect or drawing without a background. Adds above your clips at the playhead.' : 'A complete animated scene. Adds at the end of your video.'}</p>
          {#if generation.draft.mode === 'voice'}
            <label for="scene-voice">Voice recording</label>
            <input id="scene-voice" bind:this={voiceInput} type="file" accept="audio/*,video/webm" onchange={chooseVoice} disabled={generation.busy} hidden />
            <div class="voice-file"><span title={generation.draft.voice?.name}>{generation.draft.voice?.name ?? 'No recording selected'}</span><button type="button" disabled={generation.busy} onclick={() => voiceInput?.click()}>{generation.draft.voice ? 'Replace recording' : 'Choose recording'}</button>{#if generation.draft.voice}<button type="button" disabled={generation.busy} onclick={clearVoice}>Clear recording</button>{/if}</div>
            {#if generation.audioSources.length}
              <label>Or use audio from your media bin
                <select bind:value={generation.draft.audioSource} disabled={generation.busy} onchange={clearVoice}>
                  <option value="">Choose server audio…</option>
                  {#each generation.audioSources as source (source.id)}<option value={source.name}>{source.name}</option>{/each}
                </select>
              </label>
            {/if}
            <p class="field-help">Up to 3 minutes · 25 MB. AI splits the narration into ideas and keeps the voice in each scene.</p>
          {/if}
          <ScenePromptFields {generation} />
        </div>
        <div class="settings">
          <h3>Scene settings</h3>
          <label for="scene-visual-mode">Scene design</label>
          <select id="scene-visual-mode" bind:value={generation.draft.visualMode} disabled={generation.busy}>
            <option value="auto">Automatic</option>
            <option value="2d">2D · Motion graphics</option>
            <option value="3d">3D · Three.js</option>
          </select>
          <p class="field-help">{generation.draft.visualMode === '3d' ? 'Real 3D geometry, lighting and camera movement.' : 'Choose the visual medium or let AI decide.'}</p>
          <label for="scene-format">Screen format</label>
          <select id="scene-format" bind:value={generation.draft.aspect} disabled={generation.busy}>
            <option value="project">Match project</option>
            <option value="landscape">Horizontal · 16:9</option>
            <option value="portrait">Vertical · 9:16</option>
            <option value="classic">Classic · 4:3</option>
          </select>
          <p class="field-help">Full HD · {sceneSize.w} × {sceneSize.h}</p>
          <label for="scene-duration">{generation.draft.mode === 'voice' ? 'Target scene length' : 'Scene length'}</label>
          <div class="duration-field"><input id="scene-duration" type="number" min="1" max="60" step="0.5" required bind:value={generation.draft.duration} disabled={generation.busy} /><span>seconds</span></div>
          <p class="field-help">{generation.draft.mode === 'voice' ? 'Cuts follow the spoken ideas. Each scene can be added separately.' : 'One generated component, ready to place in your edit.'}</p>
          <details class="advanced-settings">
            <summary>Advanced settings</summary>
            <div class="advanced-body">
          {#if generation.draft.mode === 'voice'}
            <label>Spoken language
              <select bind:value={generation.draft.language} disabled={generation.busy}><option value="">Auto-detect</option><option value="ro">Romanian</option><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="it">Italian</option></select>
            </label>
          {/if}
          <div class="format-note"><span>Frame rate</span><strong>{editor.fps} fps</strong></div>
            <p class="field-help">Frame rate follows project settings. The first scene sets an empty timeline’s screen format.</p>
            </div>
          </details>
        </div>
      </form>
      {#if generation.job?.transcript}<details class="transcript"><summary>Recognized narration</summary><p>{generation.job.transcript}</p></details>{/if}
      <SceneGenerationResult {generation} />
    </div>
    <footer>
      <div class="feedback" aria-live="polite">
        {#if generation.phase.kind === 'error'}<p class="error" role="alert">{generation.phase.message}</p>
        {:else if generation.busy}
          <p>{generation.phase.kind === 'uploading' ? 'Preparing your request…' : generation.job?.message}</p>
          <progress max="1" value={generation.phase.kind === 'uploading' || generation.job?.status === 'generating' || generation.job?.status === 'planning' || generation.job?.status === 'transcribing' ? undefined : generation.job?.progress} aria-label="Scene generation progress"></progress>
          <span>You can close this dialog and return while generation continues.</span>
          {#if generation.job?.status === 'generating'}<span>The AI is writing the scene and its design notes. Video rendering happens when you export.</span>{/if}
        {:else if generation.insertion.kind === 'added'}<p class="success">{selectedOverlay ? 'Overlay added above your clips. Existing footage stays in place.' : 'Scene added to the timeline. Choose another idea or keep editing.'}</p>
        {:else}<p>{insertionHelp}</p>{/if}
        {#if generation.insertion.kind === 'error'}<p class="error" role="alert">{generation.insertion.message}</p>{/if}
      </div>
      <div class="footer-actions">
        {#if generation.busy}<button type="button" class="secondary" onclick={() => void generation.cancel()}>Stop generation</button>
        {:else if generation.phase.kind === 'error' && generation.phase.jobId}<button type="button" class="secondary" onclick={() => void generation.cancel()}>Stop generation</button><button type="button" class="primary" onclick={() => void generation.retryStatus()}>Retry status</button>
        {:else if !generation.editDraft}<button type="submit" form="scene-generation-form" class:primary={!selected} class:secondary={!!selected} disabled={!generation.canGenerate}>{generation.job ? 'Generate again' : 'Generate scene'}</button>{/if}
        {#if selected}<button type="button" class="primary" disabled={generation.editingScene || generation.insertion.kind === 'adding'} onclick={() => void generation.addSelected()}>{generation.insertion.kind === 'adding' ? 'Adding scene…' : selectedOverlay ? 'Add overlay to timeline' : 'Add scene to timeline'}</button>{/if}
      </div>
    </footer>
  </div>
</WorkbenchDialog>

<style>
  .scene-workbench { display:flex; flex-direction:column; height:100%; min-height:0; }
  .workspace-content { flex:1; min-height:0; overflow:auto; scrollbar-color:var(--border-strong) var(--surface); }
  .authoring { display:grid; grid-template-columns:minmax(0,1fr) 220px; gap:28px; padding:var(--space-10); }
  .settings h3 { margin:0 0 12px; font-size:14px; font-weight:600; }
  .settings { padding:18px; border-radius:10px; background:var(--surface-elevated); align-self:start; }
  .brief, .settings { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .input-mode { display:flex; margin-bottom:var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); width:fit-content; }
  .input-mode button { min-height:36px; padding:0 var(--space-6); border:0; border-radius:0; font-size:var(--text-xs); color:var(--muted-foreground); background:var(--surface-elevated); }
  .input-mode button + button { border-left:1px solid var(--border); }
  .input-mode button.active { background:var(--primary-subtle); color:var(--primary); }
  label { display:grid; gap:var(--space-3); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  input, select { width:100%; min-width:0; padding:var(--space-5) var(--space-6); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-sm)/var(--leading-copy) var(--font-sans); caret-color:var(--primary); }
  .voice-file { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-3); padding:var(--space-4); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); }
  .voice-file > span { flex:1 1 100px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--text-xs); }
  .voice-file button { padding:var(--space-3) var(--space-4); min-height:36px; border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--foreground); background:var(--surface-elevated); font-size:var(--text-xs); }
  .voice-file button:hover:not(:disabled) { background:var(--surface-muted); }
  .duration-field { display:flex; align-items:center; position:relative; }
  .duration-field input { padding-right:75px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
  .duration-field > span { position:absolute; right:var(--space-6); color:var(--muted-foreground); font-size:var(--text-xs); pointer-events:none; }
  .field-help { margin:0; color:var(--muted-foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
  .format-note { display:grid; gap:var(--space-2); padding-top:var(--space-6); margin-top:auto; border-top:1px solid var(--border); color:var(--muted-foreground); font-size:var(--text-xs); }
  .format-note strong { font:var(--text-xs)/1.6 var(--font-mono); font-variant-numeric:tabular-nums; color:var(--foreground); }
  .transcript { padding:var(--space-5) var(--space-10); border-top:1px solid var(--border); font-size:var(--text-xs); }
  summary { cursor:pointer; color:var(--muted-foreground); }
  .transcript p { line-height:var(--leading-copy); margin:var(--space-4) 0; }
  footer { flex:0 0 auto; display:grid; gap:var(--space-6); padding:var(--space-6) var(--space-10); border-top:1px solid var(--border-strong); background:var(--surface-elevated); }
  .feedback p { margin:0; font-size:var(--text-xs); line-height:var(--leading-copy); }
  .feedback > span { display:block; margin-top:var(--space-2); color:var(--muted-foreground); font-size:var(--text-2xs); }
  progress { display:block; width:100%; height:5px; margin-top:var(--space-4); accent-color:var(--primary); }
  progress::-webkit-progress-bar { background:var(--surface-muted); }
  progress::-webkit-progress-value { background:var(--primary); }
  progress::-moz-progress-bar { background:var(--primary); }
  .footer-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:var(--space-4); }
  button { cursor:pointer; font-family:inherit; font-weight:var(--weight-semibold); }
  .footer-actions button { min-height:40px; padding:var(--space-4) var(--space-8); border:1px solid var(--border); border-radius:var(--radius-sm); font-size:var(--text-xs); }
  .primary { background:var(--primary); border-color:var(--primary)!important; color:var(--primary-foreground); }
  .primary:hover:not(:disabled) { background:var(--primary-hover); }
  .secondary { background:var(--secondary); color:var(--secondary-foreground); }
  .secondary:hover:not(:disabled), .input-mode button:hover:not(:disabled) { background:var(--surface-muted); }
  input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  button:disabled, input:disabled, select:disabled { opacity:.55; cursor:not-allowed; }
  .error { color:var(--destructive); }
  .success { color:var(--foreground); }
  ::selection { color:var(--primary-foreground); background:var(--primary); }
  @media (max-width:760px) {
    .authoring { grid-template-columns:minmax(0,1fr); gap:var(--space-6); padding:var(--space-6); }
    .settings { display:flex; flex-direction:column; align-items:stretch; }
    .settings > .field-help, .format-note { grid-column:1 / -1; }
    .format-note { display:flex; justify-content:space-between; flex-wrap:wrap; margin-top:var(--space-2); padding-top:var(--space-4); }
    .transcript { padding-inline:var(--space-6); }
    footer { padding:var(--space-6); }
    .footer-actions button { flex:1; }
  }
</style>
