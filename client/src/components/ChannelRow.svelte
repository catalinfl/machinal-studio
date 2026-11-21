<script lang="ts">
  import type { Channel, Clip as ClipType } from '../stores/editor.svelte'
  import { useChannelRow } from '../composables/useChannelRow.svelte'
  import Clip from './Clip.svelte'
  import EffectBlock from './EffectBlock.svelte'
  import TransitionMarker from './TransitionMarker.svelte'

  let {
    channel,
    onClipDragMove,
    onClipDragEnd,
    onClipRouted,
    onOpenClipInspector,
    onOpenEffectInspector,
    onClipContextMenu,
    onEffectDragMove,
    onEffectDragEnd,
    onPaletteDragPreview,
    onPaletteDragEnd,
    visibleRange = null,
  }: {
    channel: Channel
    onClipDragMove?: (
      clientX: number,
      clientY: number,
      onScroll: (deltaX: number, deltaY: number) => void,
      allowVerticalScroll: boolean,
    ) => void
    onClipDragEnd?: () => void
    onClipRouted?: (clipId: string) => void
    onOpenClipInspector?: () => void
    onOpenEffectInspector?: () => void
    onClipContextMenu?: (event: MouseEvent, clip: ClipType, channelId: string) => void
    onEffectDragMove?: (
      clientX: number,
      clientY: number,
      onScroll: (deltaX: number, deltaY: number) => void,
      allowVerticalScroll: boolean,
    ) => void
    onEffectDragEnd?: () => void
    onPaletteDragPreview?: (preview: {
      kind: 'effect' | 'transition'
      time: number
      leftClipName?: string
      rightClipName?: string
    }) => void
    onPaletteDragEnd?: () => void
    visibleRange?: { start: number; end: number } | null
  } = $props()

  const row = useChannelRow({
    getChannel: () => channel,
    getVisibleRange: () => visibleRange,
    getOnClipRouted: () => onClipRouted,
    getOnPaletteDragPreview: () => onPaletteDragPreview,
    getOnPaletteDragEnd: () => onPaletteDragEnd,
  })
</script>

<div
  bind:this={row.trackEl}
  class="track {row.channel.type}"
  class:drop-active={row.dropActive && row.dropTargetClipId === null}
  class:locked={row.channel.locked}
  class:muted={row.channel.muted}
  class:hidden={row.channel.hidden}
  data-timeline-channel-id={row.channel.id}
  data-channel-type={row.channel.type}
  data-channel-locked={row.channel.locked ? 'true' : 'false'}
  ondrop={row.onDrop}
  ondragover={row.onDragOver}
  ondragenter={row.onDragEnter}
  ondragleave={row.onDragLeave}
  role="application"
  aria-label="Drop zone: {row.channel.name}"
  style:height="calc(var(--timeline-clip-height, {row.clipAreaHeight}px) + {row.trackHeight - row.clipAreaHeight}px)"
>
  {#if !row.channel.hidden}
    <div class="clips-area" style:height="var(--timeline-clip-height, {row.clipAreaHeight}px)">
      {#each row.visibleClips as clip (clip.id)}
        <Clip
          {clip}
          channelId={row.channel.id}
          overlap={row.clipOverlaps.get(clip.id)}
          dropTarget={row.dropTargetClipId === clip.id}
          {visibleRange}
          {onClipDragMove}
          {onClipDragEnd}
          onOpenInspector={onOpenClipInspector}
          onContextMenu={onClipContextMenu}
        />
      {/each}
      {#if row.channel.type === 'video'}
        {#each row.visibleTransitions as t (t.id)}
          <TransitionMarker transition={t} channel={row.channel} />
        {/each}
      {/if}
    </div>
    {#if row.channel.type === 'video' && row.lanes.length > 0}
      <div class="fx-area">
        {#each row.lanes as _, li (li)}
          <div class="fx-lane" class:alt={li % 2 === 1} aria-hidden="true"></div>
        {/each}
        {#each row.visibleEffects as { block, laneIndex } (block.id)}
          <EffectBlock {block} {laneIndex} {onEffectDragMove} {onEffectDragEnd} onOpenInspector={onOpenEffectInspector} />
        {/each}
      </div>
    {/if}
  {/if}
  {#if row.processing && !row.mediaProcessing.longVideoActive}
    <div class="processing-overlay" role="status" aria-live="polite">
      <span class="processing-message"><span class="processing-spinner" aria-hidden="true"></span>Adding your clip…</span>
    </div>
  {/if}
</div>

<style>
  .track {
    position: relative;
    height: 64px;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border);
  }
  .track.video {
    background: var(--background);
  }
  :global(.track:has(.clip.dragging)) {
    z-index: 2;
  }
  :global(.track.audio:has(.clip.dragging)) {
    z-index: 3;
  }
  .track.audio {
    background: color-mix(in srgb, var(--background) 78%, var(--surface));
  }

  .clips-area {
    position: relative;
    width: 100%;
    overflow: visible;
    z-index: 1;
  }

  .fx-area {
    position: relative;
    width: 100%;
    overflow: visible;
    border-top: 1px solid var(--border);
    z-index: 1;
  }

  .fx-lane {
    position: relative;
    width: 100%;
    height: 22px;
    box-sizing: border-box;
    overflow: visible;
    border-bottom: 1px solid var(--grid-line);
  }
  .fx-lane.alt { background: color-mix(in srgb, var(--surface-muted) 36%, transparent); }

  .track.drop-active::before {
    content: '';
    position: absolute; inset: 2px;
    border: 1px dashed var(--primary);
    border-radius: var(--radius-xs);
    pointer-events: none;
    background: color-mix(in srgb, var(--primary) 7%, transparent);
    z-index: 0;
  }
  .track.locked {
    cursor: default;
    background-image: repeating-linear-gradient(-45deg, transparent 0 8px, color-mix(in srgb, var(--border) 18%, transparent) 8px 9px);
  }
  .track.muted { background-color: color-mix(in srgb, var(--background) 72%, var(--surface-muted)); }
  .track.hidden { display: none; }
  .processing-overlay {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--background) 34%, transparent);
    z-index: 10;
  }
  .processing-message {
    display: inline-flex; align-items: center; gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--primary-border);
    border-radius: var(--radius-sm);
    color: var(--foreground);
    background: var(--surface-elevated);
    box-shadow: var(--shadow-object);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .processing-spinner {
    width: 11px; height: 11px;
    border: 2px solid var(--border);
    border-top-color: var(--primary);
    border-radius: var(--radius-pill);
    animation: processing-spin .8s linear infinite;
  }
  @keyframes processing-spin { to { transform: rotate(360deg); } }
</style>
