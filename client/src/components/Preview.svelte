<script lang="ts">
  import { usePreview } from '../composables/usePreview.svelte'
  import PreviewControls from './PreviewControls.svelte'
  import ImageSelectionOverlay from './ImageSelectionOverlay.svelte'
  import { editor } from '../stores/editor.svelte'
  import EditorEmptyState from './EditorEmptyState.svelte'
  import WorkspaceExpandButton from './WorkspaceExpandButton.svelte'
  import type { EditorWorkflow } from '../lib/editor-workflows'

  let { onOpenClipInspector, onAddMedia, onGenerateScenes, onStartWorkflow, inactive = false, expanded = false, onToggleExpand }: { onOpenClipInspector?: () => void; onAddMedia?: () => void; onGenerateScenes?: () => void; onStartWorkflow?: (workflow: EditorWorkflow) => void; inactive?: boolean; expanded?: boolean; onToggleExpand?: () => void } = $props()
  const preview = usePreview({ get onOpenClipInspector() { return onOpenClipInspector } })

</script>

<div class="preview" inert={inactive}>
  <div class="monitor">
    <div class="status-rail">
      <div class="channel-status">
        <strong class="composition-label">Composition</strong>
        <span class="signal" class:playing={preview.playing} aria-hidden="true"></span>
        <span class="status-copy">{preview.activeSummary}</span>
      </div>
      <div class="timecode">
        <span class="timecode-label">TC</span>
        <span class="timecode-value">{preview.currentTime.toFixed(2)}s</span>
        {#if onToggleExpand}
          <WorkspaceExpandButton target="preview" {expanded} onToggle={onToggleExpand} />
        {/if}
      </div>
    </div>
    <div class="stage" class:image-selected={preview.selectedImageActive} class:dragging-image={preview.draggingImage} class:resizing-image={preview.resizingImage} bind:this={preview.stageEl} onpointerdown={preview.onStagePointerDown} role="application" aria-label="Video preview canvas">
      {#if editor.totalDuration === 0 && onAddMedia}
        <EditorEmptyState {onAddMedia} {onGenerateScenes} {onStartWorkflow} />
      {/if}
      {#if preview.sceneError}<p class="scene-error" role="alert">{preview.sceneError}</p>{/if}
      {#if preview.imageSelectionRect}
        <ImageSelectionOverlay
          rect={preview.imageSelectionRect}
          locked={preview.selectedImageLocked}
          zoom={preview.selectedImageZoom}
          mediaLabel={preview.selectedMediaLabel}
          onResizeStart={preview.startImageResize}
          onResizeKeyboard={preview.resizeImageWithKeyboard}
        />
      {/if}
    </div>
    <PreviewControls
      playing={preview.playing}
      muted={preview.muted}
      volume={preview.volume}
      aspect={preview.aspect}
      fit={editor.videoFit}
      onFitChange={editor.setVideoFit}
      onTogglePlay={preview.togglePlay}
      onToggleMute={preview.toggleMute}
      onVolumeInput={preview.setVolume}
      onToggleAspect={preview.toggleAspect}
    />
  </div>
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    flex: 0 1 calc(100vw - var(--panel-lg) - var(--panel-sm) - 12px);
    min-width: 0;
    max-width: 1020px;
    height: 100%;
    align-self: stretch;
    margin-left: auto;
    padding: var(--space-6);
    color: var(--foreground);
    background: var(--background);
    position: relative;
  }
  .monitor {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: #08090c;
    box-shadow: var(--shadow-object);
  }
  .status-rail {
    display: flex;
    min-height: 34px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: 0 var(--space-8);
    border-bottom: 1px solid rgb(255 255 255 / 14%);
    color: rgb(255 255 255 / 76%);
    background: #121419;
  }
  .channel-status {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-5);
  }
  .signal {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border: 1px solid rgb(255 255 255 / 26%);
    background: rgb(255 255 255 / 34%);
  }
  .signal.playing {
    border-color: var(--primary);
    background: var(--primary);
  }
  .status-copy {
    overflow: hidden;
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timecode {
    display: flex;
    flex: 0 0 auto;
    align-items: baseline;
    gap: var(--space-4);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .timecode-label {
    color: rgb(255 255 255 / 66%);
    font-size: 0.625rem;
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
  }
  .timecode-value {
    min-width: 6.5ch;
    color: #fff;
    font-size: var(--text-xs);
    text-align: right;
  }
  .stage {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #050608;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 5%);
    touch-action: none;
  }
  .stage.image-selected { cursor: grab; }
  .scene-error { position:absolute; inset:auto var(--space-6) var(--space-6); z-index:1; padding:var(--space-4); background:var(--surface); color:var(--destructive); font-size:var(--text-xs); }
  .stage.dragging-image { cursor: grabbing; }
  .stage.resizing-image { cursor: nwse-resize; }
  .stage :global(canvas) {
    display: block;
    flex: 0 0 auto;
    box-shadow: 0 8px 28px rgb(0 0 0 / 42%), 0 0 0 1px rgb(255 255 255 / 9%);
  }
  @media (max-width: 1024px) {
    .preview {
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      min-height: 0;
      margin-left: 0;
      padding: var(--space-2);
      overflow: hidden;
    }
    .monitor { border-radius: var(--radius-sm); min-height: 0; }
    .stage { min-height: 120px; }
    .status-rail {
      min-height: 30px;
      padding: 0 var(--space-6);
    }
    .status-copy { max-width: 40vw; }
  }
  @media (max-height: 500px) {
    .preview { padding-block: var(--space-2); }
    .status-rail { min-height: 28px; }
  }
</style>
