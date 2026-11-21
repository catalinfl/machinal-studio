<script lang="ts">
  import '../styles/editor-suite.css'
  import TopBar from '../components/TopBar.svelte'
  import EditorToolBar from '../components/EditorToolBar.svelte'
  import EditorCreationActions from '../components/EditorCreationActions.svelte'
  import MediaBin from '../components/MediaBin.svelte'
  import Timeline from '../components/Timeline.svelte'
  import Preview from '../components/Preview.svelte'
  import EffectsPanel from '../components/EffectsPanel.svelte'
  import PresetsPanel from '../components/PresetsPanel.svelte'
  import InspectorFactory from '../components/InspectorFactory.svelte'
  import TransitionsPanel from '../components/TransitionsPanel.svelte'
  import TextPanel from '../components/TextPanel.svelte'
  import TextToSpeechPanel from '../components/TextToSpeechPanel.svelte'
  import ImagePanel from '../components/ImagePanel.svelte'
  import CaptionDialogs from '../components/CaptionDialogs.svelte'
  import AIPanel from '../components/AIPanel.svelte'
  import SceneGenerationDialog from '../components/SceneGenerationDialog.svelte'
  import MobilePanelBar from '../components/MobilePanelBar.svelte'
  import ToolDeck from '../components/ToolDeck.svelte'
  import { useEditorPage } from '../composables/useEditorPage.svelte'

  const page = useEditorPage()
</script>

<div class="editor-suite">
<TopBar
  projects={page.projects}
  toolNavigation={false}
  showMediaBin={page.showMediaBin}
  showEffects={page.showEffects}
  showPresets={page.showPresets}
  showTransitions={page.showTransitions}
  showText={page.showText}
  showSpeech={page.showSpeech}
  showImage={page.showImage}
  showAI={page.showAI}
  onToggleMediaBin={page.toggleMediaBin}
  onToggleEffects={page.toggleEffects}
  onTogglePresets={page.togglePresets}
  onToggleTransitions={page.toggleTransitions}
  onToggleText={page.toggleText}
  onToggleSpeech={page.toggleSpeech}
  onToggleImage={page.toggleImage}
  onToggleAI={page.toggleAI}
  onRequireServerAccess={(feature) => page.aiAccess.request(feature)}
/>

{#if page.projects.ready}
<div class="editor-tool-ribbon">
<div class="editor-tool-ribbon-track">
<EditorToolBar active={page.activePanel} busy={page.mediaProcessing.active} onSelect={page.selectPanel} />

<MobilePanelBar
  showMediaBin={page.showMediaBin}
  showEffects={page.showEffects}
  showPresets={page.showPresets}
  showTransitions={page.showTransitions}
  showText={page.showText}
  showSpeech={page.showSpeech}
  showImage={page.showImage}
  showAI={page.showAI}
  mediaBusy={page.mediaProcessing.active}
  onToggleMediaBin={page.toggleMediaBin}
  onToggleEffects={page.toggleEffects}
  onTogglePresets={page.togglePresets}
  onToggleTransitions={page.toggleTransitions}
  onToggleText={page.toggleText}
  onToggleSpeech={page.toggleSpeech}
  onToggleImage={page.toggleImage}
  onToggleAI={page.toggleAI}
/>
<EditorCreationActions onGenerateScenes={() => page.requestFeatureGrant('scenes')} />
</div>
</div>

<div class="editor" bind:this={page.editorEl}>
  <div id="editor-workspace" class="top">
    <ToolDeck active={page.activePanel} mobileOpen={page.mobilePanelOpen} onClose={page.closeMobilePanel}>
      {#snippet assistant()}
        <AIPanel
          bind:instruction={page.aiInstruction}
          bind:floating={page.aiPanelFloating}
          bind:panelX={page.aiPanelX}
          bind:panelY={page.aiPanelY}
          hidden={!page.showAI}
          onDock={page.dockAIPanel}
        />
      {/snippet}
      {#if !page.isMobile || page.mobilePanelOpen}
      {#if page.activePanel === 'media'}<MediaBin />
      {:else if page.activePanel === 'effects'}<EffectsPanel />
      {:else if page.activePanel === 'presets'}<PresetsPanel />
      {:else if page.activePanel === 'transitions'}<TransitionsPanel />
      {:else if page.activePanel === 'text'}<TextPanel onGenerateCaptions={() => page.requestFeatureGrant('captions')} />
      {:else if page.activePanel === 'speech'}<TextToSpeechPanel onClose={page.closeSpeechPanel} />
      {:else if page.activePanel === 'image'}<ImagePanel onClose={page.closeImagePanel} />
      {/if}
      {/if}
    </ToolDeck>
    <Preview onOpenClipInspector={page.openClipInspector} onAddMedia={() => page.selectPanel('media')} onGenerateScenes={() => page.requestFeatureGrant('scenes')} />
  </div>
  <div
    id="editor-timeline"
    class="bottom"
    class:resizing={page.resizingTimeline}
    bind:this={page.bottomEl}
    style:flex-basis={page.timelineHeight === null ? undefined : `${page.timelineHeight}px`}
  >
    <div
      class="timeline-resizer"
      role="slider"
      tabindex="0"
      aria-label="Resize timeline"
      aria-orientation="vertical"
      aria-controls="editor-workspace editor-timeline"
      aria-valuemin="140"
      aria-valuemax="800"
      aria-valuenow={Math.round(page.timelineHeight ?? 340)}
      onpointerdown={page.startTimelineResize}
      onkeydown={page.resizeTimelineWithKeyboard}
    ><span aria-hidden="true"></span></div>
    <Timeline
      hideExport
      inspectorOpen={page.inspectorOpen}
      onOpenClipInspector={page.openClipInspector}
      onOpenEffectInspector={page.openEffectInspector}
      onOpenTextInspector={page.openTextInspector}
      onRequireServerAccess={(feature) => page.aiAccess.request(feature)}
    />
  </div>
  <InspectorFactory
    showClipInspector={page.clipInspectorVisible}
    showEffectInspector={page.effectInspectorVisible}
    showTextInspector={page.textInspectorVisible}
  />

  <CaptionDialogs />
  {#if page.sceneDialogOpen}<SceneGenerationDialog onClose={page.closeSceneDialog} />{/if}

  {#if (page.render.renderingForPlayback && page.render.renderProgressVisible) || page.mediaProcessing.longVideoActive || page.mediaProcessing.mediaBinImport.phase === 'processing'}
    <div class="please-wait" role="dialog" aria-modal="true" aria-labelledby="processing-title" aria-describedby="processing-description" aria-live="polite">
      <div class="pw-card">
        {#if page.mediaProcessing.mediaBinImport.phase === 'processing'}
          <div class="pw-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 4v11m-4-4 4 4 4-4M5 19h14" /></svg>
          </div>
          <div id="processing-title" class="pw-text">Importing video into Media Bin…</div>
          <div class="pw-file" title={page.mediaProcessing.mediaBinImport.fileName}>{page.mediaProcessing.mediaBinImport.fileName}</div>
          <div id="processing-description" class="pw-sub">Long videos can take several minutes to upload and prepare. Keep this tab open; the dialog will close when the video is ready.</div>
          <div class="pw-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        {:else if page.mediaProcessing.longVideoActive}
          <div class="pw-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 11v2M8 8v8M12 5v14M16 8v8M19 11v2" /></svg>
          </div>
          <div id="processing-title" class="pw-text">Your {page.mediaProcessing.longMediaKind} is getting ready…</div>
          <div id="processing-description" class="pw-sub">Long files can take a little longer. We’ll have it ready in a moment.</div>
          <div class="pw-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        {:else}
          <div class="pw-spinner"></div>
          <div id="processing-title" class="pw-text">Please wait, rendering preview…</div>
          <div id="processing-description" class="pw-sub">{page.render.renderProgressMsg || 'preparing'}</div>
        {/if}
        {#if page.render.renderingForPlayback && page.render.renderProgressVisible}
          <div class="pw-progress">
            <div class="pw-bar" role="progressbar" aria-label="Preview render progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(page.render.renderProgressRatio * 100)}>
              <div class="pw-fill" style="width: {page.render.renderProgressRatio * 100}%"></div>
            </div>
            <span class="pw-percent">{Math.round(page.render.renderProgressRatio * 100)}%</span>
          </div>
        {/if}
      </div>
    </div>
  {:else if page.render.wasmLoadState === 'error'}
    <div class="wasm-error" role="alert">
      <span>Preview engine failed to load: {page.render.wasmError}</span>
      <button onclick={page.retryWasm}>Retry</button>
    </div>
  {:else if page.render.renderError}
    <div class="wasm-error" role="alert">
      <span>Preview render failed: {page.render.renderError}</span>
      <button onclick={page.retryPlayback}>Retry</button>
    </div>
  {/if}
</div>
{:else}
  <div class="project-loading" role="status">
    {#if page.projects.phase.kind === 'error'}
      <p>{page.projects.phase.message}</p><button onclick={page.projects.retry}>Retry loading projects</button>
    {:else}<p>Loading your project…</p>{/if}
  </div>
{/if}
</div>

<style>
  .project-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-8); color: var(--muted-foreground); }
  .editor {
    flex: 1; display: flex; flex-direction: column;
    overflow: hidden; min-height: 0;
    position: relative;
    background: var(--background);
  }
  .top {
    flex: 1; display: flex; min-height: 0;
    position: relative; z-index: 2;
    overflow: hidden;
    border-bottom: 1px solid var(--border-strong);
  }
  @media (min-width: 1025px) {
    .top :global(.preview) { flex: 1 1 auto; max-width: none; margin-left: 0; padding: 18px 22px; justify-content: center; align-items: center; }
    .top :global(.preview .monitor) { flex: 0 1 auto; width: min(100%, 1000px); height: min(100%, 540px); border-radius: 2px; box-shadow: none; }
  }
  .bottom {
    flex: 0 0 340px;
    min-height: 220px;
    position: relative; z-index: 1;
  }
  .timeline-resizer {
    position: absolute; top: -5px; left: 0; right: 0; z-index: var(--layer-header);
    height: 10px; padding: 0; border: 0; outline: 0;
    cursor: ns-resize; touch-action: none;
  }
  .timeline-resizer span {
    position: absolute; top: 4px; left: 50%;
    width: 48px; height: 2px; transform: translateX(-50%);
    border-radius: var(--radius-pill); background: var(--border-strong);
  }
  .timeline-resizer:hover span,
  .timeline-resizer:focus-visible span,
  .bottom.resizing .timeline-resizer span { height: 3px; background: var(--primary); }
  .timeline-resizer:focus-visible { box-shadow: inset 0 2px var(--ring); }
  .please-wait {
    position: absolute; inset: 0;
    background: var(--scrim);
    display: flex; align-items: center; justify-content: center;
    z-index: var(--layer-overlay);
  }
  .pw-card {
    display: flex; flex-direction: column; align-items: center; gap: var(--space-10);
    padding: var(--space-24) var(--space-32) var(--space-20);
    border: 1px solid var(--border-strong); border-radius: var(--radius-md);
    background: var(--surface-elevated);
    box-shadow: var(--shadow-dialog);
    width: min(380px, calc(100vw - var(--space-32)));
    text-align: center;
  }
  .pw-icon {
    display: grid; place-items: center;
    width: 48px; height: 48px;
    border: 1px solid var(--primary);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--primary) 16%, var(--surface-elevated));
    color: var(--primary);
  }
  .pw-icon svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .pw-spinner {
    width: 28px; height: 28px; border-radius: var(--radius-pill);
    border: 3px solid var(--border); border-top-color: var(--primary);
    animation: pw-spin .8s linear infinite;
  }
  @keyframes pw-spin { to { transform: rotate(360deg); } }
  .pw-text { color: var(--foreground); font-size: var(--text-md); font-weight: var(--weight-semibold); }
  .pw-file {
    width: 100%;
    overflow: hidden;
    color: var(--primary);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pw-sub { max-width: 31ch; color: var(--muted-foreground); font-size: var(--text-xs); line-height: 1.45; min-height: 16px; }
  .pw-dots { display: flex; gap: 5px; margin-top: 2px; }
  .pw-dots span { width: 5px; height: 5px; border-radius: var(--radius-pill); background: var(--primary); animation: pw-dot 1.1s ease-in-out infinite; }
  .pw-dots span:nth-child(2) { animation-delay: .15s; }
  .pw-dots span:nth-child(3) { animation-delay: .3s; }
  @keyframes pw-dot { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
  .pw-progress { display: flex; align-items: center; gap: var(--space-6); width: 100%; }
  .pw-bar { flex: 1; width: 240px; height: 6px; background: var(--surface-muted); border-radius: var(--radius-xs); overflow: hidden; }
  .pw-fill { height: 100%; background: var(--primary); }
  .pw-percent { min-width: 3.5ch; color: var(--primary); font: var(--text-xs)/1 var(--font-mono); text-align: right; }
  .wasm-error {
    position: absolute; top: var(--space-8); left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: var(--space-8);
    max-width: calc(100% - var(--space-24));
    background: var(--destructive-subtle); border: 1px solid var(--destructive);
    color: var(--foreground); font-size: var(--text-xs);
    padding: var(--space-6) var(--space-8); border-radius: var(--radius-sm); z-index: var(--layer-overlay);
    box-shadow: var(--shadow-popover);
  }
  .wasm-error button {
    min-height: var(--height-control-sm);
    padding: 0 var(--space-8);
    border: 1px solid var(--destructive); border-radius: var(--radius-sm);
    background: var(--destructive); color: var(--destructive-foreground);
    font-size: var(--text-xs); font-weight: var(--weight-semibold); cursor: pointer;
  }
  .wasm-error button:hover { filter: brightness(1.08); }

  @media (max-width: 1024px) {
    .top {
      flex: 1 1 auto;
      min-height: 120px;
      overflow: hidden;
      isolation: isolate;
    }
    .bottom {
      flex: 0 0 auto;
      flex-basis: clamp(200px, 38dvh, 340px);
      min-height: 200px;
      max-height: 52dvh;
    }
    .top :global(.preview) { padding: var(--space-2); }
    .pw-card {
      width: calc(100% - 32px);
      min-width: 0;
      padding: 24px 18px;
      box-sizing: border-box;
    }
    .pw-bar { width: min(240px, 100%); }
    .pw-text, .pw-sub { max-width: 100%; text-align: center; overflow-wrap: anywhere; }
    .wasm-error {
      left: 12px;
      right: 12px;
      transform: none;
      align-items: flex-start;
    }
    .wasm-error span { min-width: 0; overflow-wrap: anywhere; }
  }

  @media (max-width: 760px) and (max-height: 500px), (max-width: 900px) and (orientation: landscape) and (max-height: 500px) {
    .top { flex-basis: auto; min-height: 100px; }
    .bottom { flex-basis: clamp(140px, 44dvh, 220px); min-height: 140px; max-height: 56dvh; }
  }

  @media (pointer: coarse) {
    .timeline-resizer { top: -9px; height: 18px; }
    .timeline-resizer span { top: 8px; width: 56px; }
  }
</style>
