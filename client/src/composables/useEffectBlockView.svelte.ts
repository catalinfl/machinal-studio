import { editor } from '../stores/editor.svelte'
import { isPixiLiveNodeId, render } from '../stores/render.svelte'
import { getEffect, rampIntensityAt } from '../lib/effects'
import { isPixiPreviewEffect } from '../lib/effects-pixi'
import type { EffectBlock as EffectBlockType } from '../stores/editor.svelte'
import type { EffectBlockInteractions } from './useEffectBlockInteractions.svelte'

export interface EffectBlockViewOptions {
  getBlock: () => EffectBlockType
  interactions: EffectBlockInteractions
}

export function useEffectBlockView(options: EffectBlockViewOptions) {
  const leftPx = $derived(options.getBlock().start * editor.pixelsPerSecond)
  const widthPx = $derived(options.getBlock().duration * editor.pixelsPerSecond)
  const effect = $derived(getEffect(options.getBlock().effectId))
  const isTransition = $derived(effect?.kind === 'transition')
  const isSelected = $derived(editor.selectedEffectBlockIds.includes(options.getBlock().id))
  const isDragPreview = $derived(editor.effectDragPreviewIds.includes(options.getBlock().id))
  const visualDragOffsetY = $derived(
    isDragPreview ? editor.effectDragPreviewOffsetY : options.interactions.interaction.verticalOffset,
  )

  const rampLabel = $derived.by(() => {
    const block = options.getBlock()
    if (!block.ramp) return 'Constant'
    const mode = block.ramp.mode === 'in-out'
      ? 'In & Out'
      : block.ramp.mode === 'in' ? 'Fade In' : 'Fade Out'
    const curve = block.ramp.curve === 'linear'
      ? 'Linear'
      : block.ramp.curve.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
    return `${mode} / ${curve}`
  })

  const envelope = $derived.by(() => {
    const points = Array.from({ length: 33 }, (_, index) => {
      const progress = index / 32
      const intensity = rampIntensityAt(options.getBlock().ramp, progress)
      return `${(progress * 100).toFixed(3)},${(1 + (1 - intensity) * 6).toFixed(3)}`
    })
    return {
      line: `M${points.join(' L')}`,
      area: `M0,16 L${points.join(' L')} L100,16 Z`,
    }
  })

  const rendered = $derived.by(() => {
    const block = options.getBlock()
    if (isPixiPreviewEffect(block.effectId)) return true
    if (!block.nodeId) return false
    if (isPixiLiveNodeId(block.nodeId)) return true
    const renderNode = render.nodes.find((node) => node.id === block.nodeId)
    return renderNode?.state === 'ready'
  })

  const joinsPresetLeft = $derived.by(() => {
    const block = options.getBlock()
    if (!block.clipLookId || !block.ownerClipId) return false
    return editor.effectBlocks.some((candidate) => (
      candidate.id !== block.id
      && candidate.ownerClipId
      && candidate.ownerClipId !== block.ownerClipId
      && candidate.channelId === block.channelId
      && candidate.effectId === block.effectId
      && candidate.clipLookId === block.clipLookId
      && Math.abs(candidate.start + candidate.duration - block.start) <= 0.001
    ))
  })

  const joinsPresetRight = $derived.by(() => {
    const block = options.getBlock()
    if (!block.clipLookId || !block.ownerClipId) return false
    return editor.effectBlocks.some((candidate) => (
      candidate.id !== block.id
      && candidate.ownerClipId
      && candidate.ownerClipId !== block.ownerClipId
      && candidate.channelId === block.channelId
      && candidate.effectId === block.effectId
      && candidate.clipLookId === block.clipLookId
      && Math.abs(block.start + block.duration - candidate.start) <= 0.001
    ))
  })

  return {
    get leftPx() { return leftPx },
    get widthPx() { return widthPx },
    get effect() { return effect },
    get isTransition() { return isTransition },
    get isSelected() { return isSelected },
    get isDragPreview() { return isDragPreview },
    get visualDragOffsetY() { return visualDragOffsetY },
    get rampLabel() { return rampLabel },
    get envelope() { return envelope },
    get rendered() { return rendered },
    get joinsPresetLeft() { return joinsPresetLeft },
    get joinsPresetRight() { return joinsPresetRight },
  }
}
