<script lang="ts">
  import { useTextTrack } from '../composables/useTextTrack.svelte'
  import TextBlock from './TextBlock.svelte'

  let { onTextDragMove, onTextDragEnd, onOpenInspector, visibleRange = null }: {
    onTextDragMove?: (clientX: number, clientY: number, onScroll: (deltaX: number) => void, allowVerticalScroll: boolean) => void
    onTextDragEnd?: () => void
    onOpenInspector?: () => void
    visibleRange?: { start: number; end: number } | null
  } = $props()
  const track = useTextTrack(() => visibleRange)
</script>

<div class="text-track" style="height:{track.height}px" data-text-track role="application" aria-label="Text timeline track">
  {#each track.visibleLanes as lane, laneIndex (lane.key)}
    <div class="lane" style="top:{laneIndex * track.textLaneHeight}px; height:{track.textLaneHeight}px">
      {#each lane.items as item (item.id)}<TextBlock {item} {laneIndex} {onTextDragMove} {onTextDragEnd} {onOpenInspector} />{/each}
    </div>
  {/each}
  {#if track.lanes.length === 0}<span class="empty">Add titles from the Text panel</span>{/if}
</div>

<style>
  .text-track { position:relative; width:100%; flex-shrink:0; box-sizing:border-box; overflow:visible; border-bottom:1px solid var(--border); background:color-mix(in srgb,var(--surface-muted) 58%,var(--background)); }
  .lane { position:absolute; left:0; right:0; border-bottom:1px solid var(--grid-line); }
  .empty { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--muted-foreground); font-size:9px; pointer-events:none; }
</style>
