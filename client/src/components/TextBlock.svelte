<script lang="ts">
  import type { TextItem } from '../stores/editor.svelte'
  import { editor } from '../stores/editor.svelte'
  import { useTextBlock } from '../composables/useTextBlock.svelte'

  let { item, laneIndex = 0, onTextDragMove, onTextDragEnd, onOpenInspector }: {
    item: TextItem
    laneIndex?: number
    onTextDragMove?: (clientX: number, clientY: number, onScroll: (deltaX: number) => void, allowVerticalScroll: boolean) => void
    onTextDragEnd?: () => void
    onOpenInspector?: () => void
  } = $props()

  const block = useTextBlock({
    getItem: () => item,
    getOnTextDragMove: () => onTextDragMove,
    getOnTextDragEnd: () => onTextDragEnd,
  })

  function openInspector(): void {
    if (!editor.selectedTextItemIds.includes(item.id)) editor.selectTextItem(item.id)
    onOpenInspector?.()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    openInspector()
  }
</script>

<div class="text-block {block.mode}" class:selected={block.selected} style="left:{block.left}px; width:{Math.max(block.width,20)}px; transform:translateY({block.dragPreviewOffsetY}px)" data-timeline-text-id={item.id} onmousedown={block.startMove} ondblclick={openInspector} onkeydown={onKeyDown} role="button" tabindex="0" title="{item.text} · {item.duration.toFixed(2)}s · lane {laneIndex + 1}">
  <span class="name">{item.text || 'Empty text'}</span>
  <div class="resize left" onmousedown={block.startResizeLeft} role="button" tabindex="0" aria-label="Resize text start" title="Drag to set text start"></div>
  <div class="resize right" onmousedown={block.startResizeRight} role="button" tabindex="0" aria-label="Resize text end" title="Drag to set text end"></div>
</div>

<style>
  .text-block { position:absolute; top:3px; height:22px; box-sizing:border-box; display:flex; align-items:center; padding:0 6px; overflow:hidden; border:1px solid var(--border-strong); border-radius:var(--radius-xs); background:var(--surface-elevated); color:var(--foreground); cursor:grab; user-select:none; box-shadow:var(--shadow-object); z-index:25; transition:border-color 120ms ease,background-color 120ms ease; touch-action:manipulation; }
  .text-block.selected { border-color:var(--primary); background:var(--primary-subtle); }
  .text-block:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .text-block.move { cursor:grabbing; z-index:30; }
  .text-block.resize { cursor:ew-resize; }
  .name { min-width:0; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:10px; font-weight:600; }
  .resize { position:absolute; top:0; bottom:0; width:8px; z-index:2; cursor:ew-resize; }
  .resize.right { right:0; left:auto; }
  .resize.left { left:0; right:auto; }
  .resize:hover { background:color-mix(in srgb, var(--primary) 28%, transparent); }
  .resize:focus-visible { outline:2px solid var(--ring); outline-offset:-1px; }
</style>
