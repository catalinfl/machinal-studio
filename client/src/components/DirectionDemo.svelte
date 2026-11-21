<script lang="ts">
  import { useLandingEditor } from '../composables/useLandingEditor.svelte'
  import ApiSample from './home/ApiSample.svelte'
  import EditorControls from './home/EditorControls.svelte'
  import DemoPreview from './home/DemoPreview.svelte'
  import DemoTimeline from './home/DemoTimeline.svelte'
  import LandingIcon from './home/LandingIcon.svelte'
  import type { DemoTool } from '../lib/landing'

  let { showApi = true, initialTool = 'media' }: { showApi?: boolean; initialTool?: DemoTool } = $props()
  const editor = useLandingEditor()
  let route = $state<'editor' | 'api'>('editor')
  let tool = $state<DemoTool>('media')

  $effect(() => { tool = initialTool })

  function openText() {
    route = 'editor'
    tool = 'text'
    if (editor.project.title === null) editor.toggleTitle()
  }
</script>

<div class="direction-demo" aria-label="Interactive editor and YAML workflow">
  <div class="demo-header"><span>Your next idea. Already in motion.</span><span class="demo-header-note">Interactive sandbox · nothing to install</span></div>
  <div class="workspace" class:editor-only={!showApi}>
    <div class="editor-pane" class:mobile-active={route === 'editor'}><EditorControls {editor} bind:tool /></div>
    <div class="preview-pane"><DemoPreview {editor} /></div>
    {#if showApi}<div class="api-pane" class:mobile-active={route === 'api'}><ApiSample recipe={editor.recipe} /></div>{/if}
    {#if showApi}
    <div class="mobile-routes" role="group" aria-label="Explore a creative workflow">
      <button class:active={route === 'editor'} aria-pressed={route === 'editor'} onclick={() => route = 'editor'}><LandingIcon name="layers" size={16} />The editor</button>
      <button class:active={route === 'api'} aria-pressed={route === 'api'} onclick={() => route = 'api'}><LandingIcon name="code" size={16} />The API</button>
    </div>
    {/if}
    <div class="timeline-pane"><DemoTimeline {editor} ontext={openText} /></div>
  </div>
</div>

<style>
  .direction-demo { border: 1px solid var(--home-rule); background: var(--home-surface); }
  .demo-header { padding: 13px 20px; border-bottom: 1px solid var(--home-rule); display: flex; align-items: center; justify-content: space-between; gap: 15px; font-size: 12px; }
  .demo-header-note { color: var(--home-muted); font-size: 10px; }
  .workspace { display: grid; grid-template-columns: minmax(210px, .85fr) minmax(0, 2.3fr) minmax(210px, .85fr); }
  .workspace.editor-only { grid-template-columns: minmax(240px, .85fr) minmax(0, 2.3fr); }
  .editor-pane { border-right: 1px solid var(--home-rule); grid-row: 1 / 3; }
  .api-pane { border-left: 1px solid var(--home-rule); grid-row: 1 / 3; grid-column: 3; }
  .preview-pane { min-width: 0; grid-column: 2; }
  .timeline-pane { min-width: 0; grid-column: 2; }
  .mobile-routes { display: none; }
  @media (max-width: 1000px) {
    .workspace { grid-template-columns: 1fr 1fr; }
    .workspace.editor-only { grid-template-columns: 1fr; }
    .preview-pane, .timeline-pane { grid-column: 1 / -1; }
    .preview-pane { grid-row: 1; }
    .timeline-pane { grid-row: 2; }
    .editor-pane, .api-pane { grid-row: 3; border-top: 1px solid var(--home-rule); }
    .api-pane { grid-column: 2; }
    .editor-pane { border-right: 0; }
  }
  @media (max-width: 640px) {
    .workspace { grid-template-columns: 1fr; }
    .demo-header { padding: 12px 15px; font-size: 11px; }
    .demo-header-note { display: none; }
    .mobile-routes { display: grid; grid-template-columns: 1fr 1fr; grid-row: 3; border-bottom: 1px solid var(--home-rule); }
    .mobile-routes button { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border: 0; border-top: 1px solid var(--home-rule); background: transparent; color: var(--home-muted); cursor: pointer; font-size: 12px; }
    .mobile-routes button + button { border-left: 1px solid var(--home-rule); }
    .mobile-routes button.active { color: #262a30; background: var(--home-lilac); }
    .editor-pane, .api-pane { display: none; grid-row: 4; grid-column: 1; border: 0; }
    .mobile-active { display: block; }
    .editor-only .editor-pane { display: block; grid-row: 3; }
  }
</style>
