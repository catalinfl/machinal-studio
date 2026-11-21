import { clipPlaybackRate, clipTimelineDuration, editor, type Clip as ClipType } from '../stores/editor.svelte'
import { clipFadeIn, clipFadeOut, hasClipCompositing } from '../lib/clip-compositing'
import { clipTransform, clipTransformsEqual, DEFAULT_CLIP_TRANSFORM } from '../lib/clip-transform'
import { HUGE_CLIP_WIDTH_PX } from '../lib/waveform'
import type { ClipInteractions } from './useClipInteractions.svelte'

export interface ClipViewOptions {
  getClip: () => ClipType
  getChannelId: () => string
  getOverlap: () => { left: number; right: number } | undefined
  interactions: ClipInteractions
}

export function useClipView(options: ClipViewOptions) {
  const isAudio = $derived(editor.channels.find((channel) => channel.id === options.getChannelId())?.type === 'audio')
  const isSelected = $derived(editor.selectedClipIds.includes(options.getClip().id))
  const isLinkedSelected = $derived.by(() => {
    const linkedClipId = options.getClip().linkedClipId
    return !isSelected && Boolean(linkedClipId && editor.selectedClipIds.includes(linkedClipId))
  })
  const isDragPreview = $derived(editor.clipDragPreviewIds.includes(options.getClip().id))
  const visualDragOffsetY = $derived(
    isDragPreview ? editor.clipDragPreviewOffsetY : options.interactions.dragOffsetY,
  )
  const channelSelected = $derived(editor.selectedChannelIds.includes(options.getChannelId()))
  const showVolumeLine = $derived(isAudio && (isSelected || channelSelected))
  const channelLocked = $derived(editor.channels.find((channel) => channel.id === options.getChannelId())?.locked ?? false)
  const length = $derived(clipTimelineDuration(options.getClip()))
  const widthPx = $derived(length * editor.pixelsPerSecond)
  const leftPx = $derived(options.getClip().start * editor.pixelsPerSecond)
  // Very wide clips (a 58min local file is ~139k px at 40px/s) get
  // compositor-friendly treatment so dragging them never janks.
  const isHuge = $derived(widthPx >= HUGE_CLIP_WIDTH_PX)
  const clipOverlap = $derived(options.getOverlap() ?? editor.getClipOverlap(options.getChannelId(), options.getClip()))
  const fadeIn = $derived(clipFadeIn(options.getClip()))
  const fadeOut = $derived(clipFadeOut(options.getClip()))
  const playbackRate = $derived(clipPlaybackRate(options.getClip()))
  const hasCustomTransform = $derived.by(() => {
    const clip = options.getClip()
    if (clip.motionPreset && clip.motionPreset !== 'none') return true
    if (clip.transformKeyframes?.length) return true
    return Boolean(clip.transform) && !clipTransformsEqual(clipTransform(clip), DEFAULT_CLIP_TRANSFORM)
  })
  const hasClipLook = $derived(
    editor.effectBlocks.some((block) => block.ownerClipId === options.getClip().id && block.clipLookId !== undefined),
  )
  const hasLayerCompositing = $derived(hasClipCompositing(options.getClip()))
  const hasVisualTreatment = $derived(hasCustomTransform || hasClipLook || hasLayerCompositing)
  const treatmentLabel = $derived.by(() => {
    const treatments: string[] = []
    if (hasCustomTransform) treatments.push('Transform')
    if (hasClipLook) treatments.push('Preset')
    if (hasLayerCompositing) treatments.push('Compositing')
    return `${treatments.join(' and ')} applied`
  })
  const treatmentCode = $derived(hasCustomTransform || hasClipLook ? 'T' : 'L')

  return {
    editor,
    minWaveformWidthPx: 36,
    get isAudio() { return isAudio },
    get isSelected() { return isSelected },
    get isLinkedSelected() { return isLinkedSelected },
    get isDragPreview() { return isDragPreview },
    get visualDragOffsetY() { return visualDragOffsetY },
    get showVolumeLine() { return showVolumeLine },
    get channelLocked() { return channelLocked },
    get length() { return length },
    get widthPx() { return widthPx },
    get leftPx() { return leftPx },
    get isHuge() { return isHuge },
    get clipOverlap() { return clipOverlap },
    get fadeIn() { return fadeIn },
    get fadeOut() { return fadeOut },
    get playbackRate() { return playbackRate },
    get hasVisualTreatment() { return hasVisualTreatment },
    get treatmentLabel() { return treatmentLabel },
    get treatmentCode() { return treatmentCode },
  }
}
