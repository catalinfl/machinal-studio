import { EFFECTS, groupEffectsByCategory, type EffectDef } from '../lib/effects'
import { CLIP_LOOK_DRAG_MIME, CLIP_LOOKS, type ClipLookId } from '../lib/clip-looks'
import { editor } from '../stores/editor.svelte'

function groupedEffects(kind: EffectDef['kind']) {
  const effects = EFFECTS.filter((effect) => effect.kind === kind)
  return groupEffectsByCategory(effects)
}

function setCopyPayload(event: DragEvent, mime: string, payload: unknown): void {
  event.dataTransfer?.setData(mime, JSON.stringify(payload))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function cardHandlers<T>(apply: (item: T) => void, startDrag: (event: DragEvent, item: T) => void) {
  return {
    applyCard: (item: T) => (): void => apply(item),
    dragCard: (item: T) => (event: DragEvent): void => startDrag(event, item),
  }
}

export function useEffectsPalette(targetChannelId: () => string) {
  const addAtPlayhead = (effect: EffectDef): void => {
    const block = editor.addEffectBlock(targetChannelId(), effect.id, editor.currentTime, effect.defaultDuration ?? 2)
    if (block) {
      editor.anchorEffectBlock(block.id, editor.currentTime)
      editor.selectEffectBlock(block.id)
    }
  }

  const startEffectDrag = (event: DragEvent, effect: EffectDef): void => {
    const payload = effect.defaultDuration === undefined || effect.defaultDuration === 2
      ? { effectId: effect.id }
      : { effectId: effect.id, duration: effect.defaultDuration }
    setCopyPayload(event, 'application/x-cineedit-effect', payload)
  }

  return {
    effectGroups: groupedEffects('effect'),
    addAtPlayhead,
    startEffectDrag,
    addEffect: cardHandlers(addAtPlayhead, startEffectDrag).applyCard,
    dragEffect: cardHandlers(addAtPlayhead, startEffectDrag).dragCard,
  }
}

export function useTransitionsPalette() {
  const applyToSelection = (effectId: string): void => {
    editor.addTransitionToSelection(effectId)
  }

  const startTransitionDrag = (event: DragEvent, effectId: string): void => {
    setCopyPayload(event, 'application/x-cineedit-transition', { effectId })
  }

  return {
    transitionGroups: groupedEffects('transition'),
    applyToSelection,
    startTransitionDrag,
    applyTransition: cardHandlers(applyToSelection, startTransitionDrag).applyCard,
    dragTransition: cardHandlers(applyToSelection, startTransitionDrag).dragCard,
  }
}

export function useClipLooksPalette() {
  const selectedVideos = $derived.by(() => editor.selectedClipIds.flatMap((id) => {
    const found = editor.getClipById(id)
    return found?.channel.type === 'video' ? [found] : []
  }))

  const disabledReason = $derived.by(() => {
    if (selectedVideos.length === 0) return 'Select one or more video clips'
    if (selectedVideos.some(({ channel }) => channel.locked)) return 'Unlock all selected video tracks'
    return ''
  })

  const selectionHint = $derived(selectedVideos.length === 0
    ? 'Click applies to selected clips; drag onto a video clip'
    : selectedVideos.length === 1
      ? 'Applies to the selected clip'
      : `Applies to all ${selectedVideos.length} selected video clips`)

  const applyLook = (lookId: ClipLookId): void => {
    if (disabledReason) return
    editor.beginHistory()
    try {
      for (const { clip } of selectedVideos) {
        editor.applyClipLook(clip.id, lookId)
      }
    } finally {
      editor.endHistory()
    }
  }

  const startLookDrag = (event: DragEvent, lookId: ClipLookId): void => {
    setCopyPayload(event, CLIP_LOOK_DRAG_MIME, { lookId })
  }

  return {
    looks: CLIP_LOOKS,
    get selectedVideos() { return selectedVideos },
    get disabledReason() { return disabledReason },
    get selectionHint() { return selectionHint },
    applyLook,
    startLookDrag,
    applyLookCard: cardHandlers(applyLook, startLookDrag).applyCard,
    dragLookCard: cardHandlers(applyLook, startLookDrag).dragCard,
  }
}
