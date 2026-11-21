<script lang="ts">
  import type { EffectBlock as EffectBlockType } from '../stores/editor.svelte'
  import { editor, FX_LANE_HEIGHT } from '../stores/editor.svelte'
  import { useEffectBlockInteractions } from '../composables/useEffectBlockInteractions.svelte'
  import { useEffectBlockView } from '../composables/useEffectBlockView.svelte'

  let {
    block,
    laneIndex = 0,
    onEffectDragMove,
    onEffectDragEnd,
    onOpenInspector,
  }: {
    block: EffectBlockType
    laneIndex: number
    onEffectDragMove?: (
      clientX: number,
      clientY: number,
      onScroll: (deltaX: number, deltaY: number) => void,
      allowVerticalScroll: boolean,
    ) => void
    onEffectDragEnd?: () => void
    onOpenInspector?: () => void
  } = $props()

  const interactions = useEffectBlockInteractions({
    getBlock: () => block,
    getOnEffectDragMove: () => onEffectDragMove,
    getOnEffectDragEnd: () => onEffectDragEnd,
  })

  const view = useEffectBlockView({ getBlock: () => block, interactions })

  function openInspector(): void {
    if (!editor.selectedEffectBlockIds.includes(block.id)) editor.selectEffectBlock(block.id)
    onOpenInspector?.()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    openInspector()
  }
</script>

<div
  class="fxblock {view.isTransition ? 'transition' : 'effect'} {interactions.interaction.mode}"
  class:selected={view.isSelected}
  class:drag-preview={view.isDragPreview}
  class:preset-group={block.clipLookId !== undefined}
  class:preset-group-left={view.joinsPresetLeft}
  class:preset-group-right={view.joinsPresetRight}
  style="top: {laneIndex * FX_LANE_HEIGHT + 2}px; left: {view.leftPx}px; width: {Math.max(view.widthPx, 16)}px; transform: translateY({view.visualDragOffsetY}px)"
  onmousedown={interactions.startMove}
  ondblclick={openInspector}
  onkeydown={onKeyDown}
  role="button"
  tabindex="0"
  data-timeline-effect-id={block.id}
  title="{view.effect?.label ?? block.effectId} · {block.duration.toFixed(2)}s · {view.rampLabel} · lane {laneIndex + 1}"
>
  {#if !view.isTransition}
    <svg
      class="fx-envelope"
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-ramp-mode={block.ramp?.mode ?? 'constant'}
      data-ramp-curve={block.ramp?.curve ?? 'linear'}
    >
      <path class="fx-envelope-area" d={view.envelope.area}></path>
      <path class="fx-envelope-line" d={view.envelope.line}></path>
    </svg>
  {/if}
  <span class="fx-lane">L{laneIndex + 1}</span>
  <span class="fx-name">{view.effect?.label ?? block.effectId}</span>
  {#if view.rendered}<span class="fx-dirty" title="Not rendered yet. Press Play" aria-label="Not rendered yet"></span>{/if}
  <button class="fx-del" onclick={interactions.removeEffect} title="Remove effect">×</button>
  <div class="fx-resize left" onmousedown={interactions.startResizeLeft} role="button" tabindex="0" aria-label="Resize effect start" title="Drag to set range start"></div>
  <div class="fx-resize right" onmousedown={interactions.startResizeRight} role="button" tabindex="0" aria-label="Resize effect range" title="Drag to set range end"></div>
</div>

<style>
  .fxblock { position: absolute; top: 2px; height: 18px; border-radius: var(--radius-xs); cursor: grab; display: flex; align-items: center; gap: 4px; padding: 0 4px 0 6px; box-sizing: border-box; user-select: none; overflow: hidden; box-shadow: var(--shadow-object); z-index: 10; transition: border-color 120ms ease, background-color 120ms ease; touch-action: manipulation; }
  .fxblock.effect { background: var(--effect-surface); border: 1px solid var(--effect-border); }
  .fxblock.preset-group { border-style: double; }
  .fxblock.preset-group-left { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-color: transparent; }
  .fxblock.preset-group-right { border-top-right-radius: 0; border-bottom-right-radius: 0; border-right-color: transparent; }
  .fxblock.preset-group-left.preset-group-right { box-shadow: none; }
  .fxblock.transition { background: var(--transition-surface); border: 1px dashed var(--transition-border); }
  .fxblock.selected { border-color: var(--primary); background: var(--primary-subtle); }
  .fxblock:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .fxblock:active { cursor: grabbing; }
  .fxblock.move, .fxblock.drag-preview { cursor: grabbing; z-index: 20; }
  .fxblock.resize { cursor: ew-resize; }
  .fx-envelope { position: absolute; inset: 1px; width: calc(100% - 2px); height: calc(100% - 2px); pointer-events: none; z-index: 0; }
  .fx-envelope-area { fill: color-mix(in srgb, var(--primary) 12%, transparent); }
  .fx-envelope-line { fill: none; stroke: var(--border-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .fxblock.selected .fx-envelope-line { stroke: var(--primary); }
  .fx-lane { position: relative; z-index: 1; font-size: 8px; color: var(--muted-foreground); background: var(--surface-elevated); border: 1px solid var(--border); border-radius: 3px; padding: 0 3px; flex-shrink: 0; font-weight: 700; letter-spacing: .03em; }
  .fx-name { position: relative; z-index: 1; font-size: 10px; color: var(--foreground); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .fx-dirty { position: relative; z-index: 1; width: 5px; height: 5px; border-radius: var(--radius-pill); background: var(--warning); flex-shrink: 0; }
  .fx-del { position: relative; z-index: 2; width: 14px; height: 14px; border: none; background: var(--surface-elevated); color: var(--foreground); border-radius: 3px; cursor: pointer; font-size: 11px; line-height: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .fx-del:hover { background: var(--destructive); color: var(--destructive-foreground); }
  .fx-del:focus-visible, .fx-resize:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px; }
  .fx-resize { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; z-index: 2; cursor: ew-resize; background: color-mix(in srgb, var(--border-strong) 30%, transparent); border-radius: 0 4px 4px 0; }
  .fx-resize.left { left: 0; right: auto; border-radius: 4px 0 0 4px; background: color-mix(in srgb, var(--border-strong) 30%, transparent); }
  .fx-resize:hover, .fx-resize.left:hover { background: color-mix(in srgb, var(--primary) 42%, transparent); }
</style>
