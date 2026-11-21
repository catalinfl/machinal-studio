<script lang="ts">
  import type { Clip as ClipType } from '../stores/editor.svelte'
  import { useClipInteractions } from '../composables/useClipInteractions.svelte'
  import { useClipView } from '../composables/useClipView.svelte'
  import { formatTimelineDuration } from '../lib/format'
  import { mediaDisplayName } from '../lib/media-bin'
  import Waveform from './Waveform.svelte'

  let {
    clip,
    channelId,
    dropTarget = false,
    onClipDragMove,
    onClipDragEnd,
    onOpenInspector,
    onContextMenu,
    overlap,
    visibleRange,
  }: {
    clip: ClipType
    channelId: string
    dropTarget?: boolean
    onClipDragMove?: (
      clientX: number,
      clientY: number,
      onScroll: (deltaX: number, deltaY: number) => void,
      allowVerticalScroll: boolean,
    ) => void
    onClipDragEnd?: () => void
    onOpenInspector?: () => void
    onContextMenu?: (event: MouseEvent, clip: ClipType, channelId: string) => void
    overlap?: { left: number; right: number }
    visibleRange?: { start: number; end: number } | null
  } = $props()

  const interactions = useClipInteractions({
    getClip: () => clip,
    getChannelId: () => channelId,
    getOnClipDragMove: () => onClipDragMove,
    getOnClipDragEnd: () => onClipDragEnd,
    getOnOpenInspector: () => onOpenInspector,
    getOnContextMenu: () => onContextMenu,
  })

  const view = useClipView({
    getClip: () => clip,
    getChannelId: () => channelId,
    getOverlap: () => overlap,
    interactions,
  })

  // Hidden while the waveform-off badge shows (it sits where the duration
  // label would be). The duration stays available in the badge tooltip.
  let waveformBadgeVisible = $state(false)

  const waveformVisiblePixels = $derived(visibleRange ? {
    start: (visibleRange.start - clip.start) * view.editor.pixelsPerSecond,
    end: (visibleRange.end - clip.start) * view.editor.pixelsPerSecond,
  } : undefined)
</script>

<div
  class="clip {view.isSelected ? 'selected' : ''}"
  class:linked-selected={view.isLinkedSelected}
  class:audio={view.isAudio}
  class:drop-target={dropTarget}
  class:dragging={interactions.dragging || view.isDragPreview}
  class:drag-source={interactions.dragging}
  class:huge={view.isHuge}
  style="left: {view.leftPx}px; width: {Math.max(view.widthPx, 20)}px; transform: translateY({view.visualDragOffsetY}px)"
  onmousedown={interactions.startDrag}
  ondblclick={interactions.openInspector}
  oncontextmenu={interactions.openContextMenu}
  onkeydown={interactions.onClipKeyDown}
  role="button"
  tabindex="0"
  data-timeline-clip-id={clip.id}
>
  {#if view.isAudio}
    {#if view.widthPx >= view.minWaveformWidthPx}
    <Waveform
      src={clip.scrubBlobUrl}
      fileName={clip.fileName}
      sourceMode={clip.sourceMode}
      sourceDuration={clip.sourceDuration}
      inPoint={clip.inPoint}
      outPoint={clip.outPoint}
      width={Math.max(view.widthPx, 20) - 2}
      visiblePixels={waveformVisiblePixels}
      volume={clip.volume ?? 100}
       dragging={interactions.volumeDragging}
       moveDragging={interactions.dragging}
       onBadgeVisibleChange={(visible) => { waveformBadgeVisible = visible }}
    />
    {/if}
    {#if view.showVolumeLine}
      <div
        class="vol-line"
        class:locked={view.channelLocked}
        style="top: {(1 - (clip.volume ?? 100) / 200) * 100}%"
        onmousedown={interactions.startVolumeDrag}
        onkeydown={interactions.onVolumeKey}
        title="Volume · drag up or down"
        role="slider"
        tabindex="0"
        aria-label="Adjust clip volume"
        aria-valuemin="0"
        aria-valuemax="200"
        aria-valuenow={clip.volume ?? 100}
      ></div>
    {/if}
  {/if}
  {#if view.clipOverlap.left > 0.001}
    <div class="xfade left" style="width: {view.clipOverlap.left * view.editor.pixelsPerSecond}px" title="Crossfade transition · {view.clipOverlap.left.toFixed(2)}s" aria-hidden="true">
      {#if view.clipOverlap.left * view.editor.pixelsPerSecond > 48}<span class="xfade-dur">{view.clipOverlap.left.toFixed(2)}s</span>{/if}
    </div>
  {/if}
  {#if view.clipOverlap.right > 0.001}
    <div class="xfade right" style="width: {view.clipOverlap.right * view.editor.pixelsPerSecond}px" title="Crossfade transition · {view.clipOverlap.right.toFixed(2)}s" aria-hidden="true">
      {#if view.clipOverlap.right * view.editor.pixelsPerSecond > 48}<span class="xfade-dur">{view.clipOverlap.right.toFixed(2)}s</span>{/if}
    </div>
  {/if}
  {#if view.fadeIn > 0.001}
    <div class="clip-fade left" style="width: {view.fadeIn * view.editor.pixelsPerSecond}px" title="Fade in · {view.fadeIn.toFixed(2)}s" aria-hidden="true"></div>
  {/if}
  {#if view.fadeOut > 0.001}
    <div class="clip-fade right" style="width: {view.fadeOut * view.editor.pixelsPerSecond}px" title="Fade out · {view.fadeOut.toFixed(2)}s" aria-hidden="true"></div>
  {/if}
  <span class="clip-name" title={clip.fileName}>{mediaDisplayName(clip.fileName)}</span>
  {#if !waveformBadgeVisible}
    <span class="clip-dur">{formatTimelineDuration(view.length)}</span>
  {/if}
  {#if Math.abs(view.playbackRate - 1) > 0.001}
    <span class="clip-speed">{view.playbackRate.toFixed(2).replace(/\.00$/, '')}x</span>
  {/if}
  {#if view.hasVisualTreatment}
    <span class="clip-treatment" aria-label={view.treatmentLabel} title={view.treatmentLabel}>{view.treatmentCode}</span>
  {/if}
  {#if view.isSelected}
    <button class="del" onmousedown={interactions.stopPropagation} onclick={interactions.deleteClip} title="Delete clip" aria-label="Delete clip"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 3.5h4M6.5 6l.6 10h5.8l.6-10M8.5 8.5v5M11.5 8.5v5"/></svg></button>
    <div
      class="trim left"
      class:active={interactions.trimming === 'left'}
      class:short-clip={view.length < 1}
      role="button"
      tabindex="0"
      aria-label="Trim start"
      onmousedown={interactions.startTrimLeft}
    ></div>
    <div
      class="trim right"
      class:active={interactions.trimming === 'right'}
      class:short-clip={view.length < 1}
      role="button"
      tabindex="0"
      aria-label="Trim end"
      onmousedown={interactions.startTrimRight}
    ></div>
  {/if}
</div>

<style>
  .clip { position: absolute; top: 4px; height: calc(100% - 8px); background: var(--video-surface); border: 1px solid var(--video-border); box-sizing: border-box; border-radius: var(--radius-sm); cursor: grab; overflow: hidden; display: flex; flex-direction: column; justify-content: center; padding: 0 6px; user-select: none; box-shadow: var(--shadow-object); transition: border-color 120ms ease, background-color 120ms ease, opacity 120ms ease; isolation: isolate; touch-action: manipulation; }
  .clip:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; z-index: 6; }
  .clip:hover { border-color: var(--primary-border); }
  .clip.drop-target { z-index: 8; border-color: var(--primary); outline: 2px solid var(--primary); outline-offset: 1px; }
  .clip.selected { z-index: 4; border-color: var(--primary); background: var(--primary-subtle); }
  .clip:active { cursor: grabbing; }
  .clip.dragging { z-index: 30; cursor: grabbing; opacity: .9; box-shadow: var(--shadow-popover); pointer-events: none; }
  .clip.huge { contain: layout paint; }
  .clip.huge.drag-source { box-shadow: none; opacity: 1; }
  .clip.audio { background: var(--audio-surface); border-color: var(--border-strong); }
  .clip.audio:hover { border-color: var(--primary-border); }
  .clip.linked-selected, .clip.linked-selected:hover { z-index: 3; border-color: var(--primary); border-style: dashed; }
  .vol-line { position: absolute; left: 0; right: 0; height: 7px; transform: translateY(-50%); z-index: 3; cursor: ns-resize; touch-action: none; }
  .vol-line::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 2px; transform: translateY(-50%); background: var(--primary); pointer-events: none; }
  .vol-line::after { content: ''; position: absolute; right: 3px; top: 50%; width: 7px; height: 12px; transform: translateY(-50%); border: 1px solid var(--surface-elevated); background: var(--primary); border-radius: 2px; pointer-events: none; }
  .vol-line:hover::before { height: 3px; background: var(--primary-hover); }
  .vol-line:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .vol-line.locked { cursor: not-allowed; opacity: .45; }
  .xfade { position: absolute; top: 0; bottom: 0; z-index: 2; pointer-events: none; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--transition-surface); }
  .xfade.left { left: 0; border-radius: 4px 0 0 4px; border-right: 1px dashed var(--transition-border); }
  .xfade.right { right: 0; border-radius: 0 4px 4px 0; border-left: 1px dashed var(--transition-border); }
  .xfade-dur { max-width: 100%; padding: 1px 5px; border: 1px solid var(--transition-border); border-radius: var(--radius-xs); color: var(--foreground); background: var(--surface-elevated); font: 9px var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .clip-fade { position: absolute; inset-block: 0; z-index: 1; pointer-events: none; background: color-mix(in srgb, var(--primary) 16%, transparent); }
  .clip-fade.left { left: 0; clip-path: polygon(0 100%, 100% 0, 100% 100%); }
  .clip-fade.right { right: 0; clip-path: polygon(0 0, 100% 100%, 0 100%); }
  .clip-name { position: relative; z-index: 1; font-size: 12px; color: var(--foreground); font-weight: var(--weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .clip-dur { position: relative; z-index: 1; font-size: 10px; color: var(--muted-foreground); font-family: var(--font-mono); }
  .clip-speed { position: relative; z-index: 1; width: fit-content; padding: 1px 4px; border: 1px solid var(--border); border-radius: var(--radius-xs); color: var(--muted-foreground); background: var(--surface-elevated); font: 8px var(--font-mono); }
  .clip-treatment { position: absolute; right: 14px; bottom: 4px; z-index: 2; display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: var(--radius-xs); color: var(--foreground); background: var(--surface-muted); font: 700 9px var(--font-mono); }
  .del { position: absolute; top: 0; right: 0; width: 17px; height: 17px; padding: 0; border: 0; border-left: 1px solid var(--primary-border); border-bottom: 1px solid var(--primary-border); background: var(--surface-elevated); color: var(--muted-foreground); border-radius: 0 0 0 var(--radius-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 3; }
  .del:hover { color: var(--destructive); background: var(--destructive-subtle); }
  .del svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .trim { position: absolute; top: 0; bottom: 0; width: 10px; cursor: ew-resize; z-index: 2; background: transparent; box-sizing: border-box; }
  .trim.left { left: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .trim.right { right: 0; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
  .trim:hover, .trim.active { background: color-mix(in srgb, var(--primary) 14%, transparent); }
  .trim:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
  .trim.short-clip { background: transparent; border: 0; }
  .trim.short-clip::after { display: none; }
  .trim::after { content: ''; position: absolute; top: 50%; left: 50%; width: 3px; height: 18px; transform: translate(-50%, -50%); border-left: 1px solid var(--primary); border-right: 1px solid var(--primary); pointer-events: none; }
</style>
