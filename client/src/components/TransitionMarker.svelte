<script lang="ts">
  import type { Channel, Transition } from '../stores/editor.svelte'
  import { useTransitionMarker } from '../composables/useTransitionMarker.svelte'

  let { transition, channel }: { transition: Transition; channel: Channel } = $props()

  const marker = useTransitionMarker(() => transition, () => channel)
</script>

{#if marker.left && marker.right && marker.duration > 0.001}
  <div
    class="transition-marker {marker.mode}"
    class:pending={marker.pending}
    class:drag-preview={marker.dragPreview}
    style="left: {marker.leftPx}px; width: {marker.widthPx}px; transform: translateY({marker.dragPreviewOffsetY}px)"
    onmousedown={marker.onBodyDown}
    role="button"
    tabindex="0"
    aria-label="{marker.effect?.label ?? transition.effectId} transition, {marker.duration.toFixed(2)} seconds"
    title="{marker.effect?.label ?? transition.effectId} · {marker.duration.toFixed(2)}s. Drag to roll, edges to resize"
  >
    <div
      class="tm-edge left"
      role="button"
      tabindex="0"
      aria-label="Resize transition start"
       onmousedown={marker.onLeftDown}
    ></div>
    <span class="tm-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3.5 7h11M11.5 4l3 3-3 3M16.5 13h-11M8.5 10l-3 3 3 3"/></svg></span>
    {#if marker.widthPx > 72}
      <span class="tm-text"><span class="tm-name">{marker.effect?.label ?? 'Transition'}</span><span class="tm-dur">{marker.duration.toFixed(2)}s</span></span>
    {:else if marker.widthPx > 30}
      <span class="tm-dur">{marker.duration.toFixed(2)}s</span>
    {/if}
    {#if marker.pending}<span class="tm-pending" title="Not rendered yet. Press Play" aria-label="Not rendered yet"></span>{/if}
    <button class="tm-del" onclick={marker.onDelete} title="Remove transition (keeps crossfade)" aria-label="Remove transition"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 3.5h4M6.5 6l.6 10h5.8l.6-10M8.5 8.5v5M11.5 8.5v5"/></svg></button>
    <div
      class="tm-edge right"
      role="button"
      tabindex="0"
      aria-label="Resize transition end"
       onmousedown={marker.onRightDown}
    ></div>
  </div>
{/if}

<style>
  .transition-marker {
    position: absolute;
    top: 4px;
    height: calc(100% - 8px);
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 2px;
     background: var(--transition-surface);
     border: 1px dashed var(--transition-border);
    border-radius: var(--radius-xs);
    box-sizing: border-box;
    cursor: grab;
    user-select: none;
    overflow: hidden;
    box-shadow: var(--shadow-object);
    touch-action: manipulation;
  }
  .transition-marker:hover { border-style: solid; }
  .transition-marker.roll { cursor: grabbing; border-style: solid; }
  .transition-marker.pending { border-style: dashed; }
  .transition-marker:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-color: var(--primary); }
  .transition-marker.drag-preview {
    z-index: 35;
    pointer-events: none;
    opacity: .9;
  }
  .tm-icon { display: grid; place-items: center; flex: 0 0 auto; color: var(--foreground); pointer-events: none; }
  .tm-icon svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .tm-text { display: flex; align-items: baseline; gap: 4px; min-width: 0; pointer-events: none; }
  .tm-name {
    font-size: 10px; font-weight: var(--weight-semibold); color: var(--foreground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    pointer-events: none;
  }
  .tm-dur {
    flex: 0 0 auto;
    color: var(--foreground);
    font: 9px var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .tm-pending { width: 5px; height: 5px; border-radius: var(--radius-pill); background: var(--warning); pointer-events: none; }
  .tm-del {
    position: absolute; top: 0; right: 0;
    width: 14px; height: 14px;
    border: none; border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface-elevated); color: var(--muted-foreground);
    border-radius: 0 0 0 var(--radius-xs); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    z-index: 3;
    opacity: 0; pointer-events: none;
  }
  .transition-marker:hover .tm-del, .transition-marker:focus-within .tm-del { opacity: 1; pointer-events: auto; }
  .tm-del svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .tm-del:hover { background: var(--destructive); color: var(--destructive-foreground); }
  .tm-del:focus-visible, .tm-edge:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }
  .tm-edge {
    position: absolute; top: 0; bottom: 0;
    width: 7px;
    cursor: ew-resize;
    z-index: 2;
  }
  .tm-edge.left { left: 0; border-radius: 4px 0 0 4px; }
  .tm-edge.right { right: 0; border-radius: 0 4px 4px 0; }
  .tm-edge:hover { background: color-mix(in srgb, var(--primary) 28%, transparent); }
</style>
