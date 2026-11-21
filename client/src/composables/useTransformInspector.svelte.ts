import { editor, clipTimelineDuration } from '../stores/editor.svelte'
import { clipTransform, clipTransformAt, DEFAULT_CLIP_TRANSFORM, normalizeClipTransform, TRANSFORM_PRESETS, transformPreset, type ClipTransform, type ClipTransformKeyframe, type LayerEntranceEffect, type LayerExitEffect, type TransformPreset } from '../lib/clip-transform'
import { clipFadeIn, clipFadeOut, clipOpacity } from '../lib/clip-compositing'
import { formatSeconds } from '../lib/format'

interface Options { getOnClose: () => (() => void) | undefined }
type NumericTransformKey = Exclude<keyof ClipTransform, 'linkZoom' | 'flipH' | 'flipV'>

export function useTransformInspector(options: Options) {

  const transformKeys = Object.keys(DEFAULT_CLIP_TRANSFORM) as (keyof ClipTransform)[]

  const transformsMatch = (left: ClipTransform, right: ClipTransform): boolean => transformKeys.every((key) => {
    const a = left[key], b = right[key]
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 : a === b
  })

  const keyframesMatch = (expected: ClipTransformKeyframe[], actual: ClipTransformKeyframe[]): boolean => expected.length === actual.length && expected.every((keyframe, index) => {
    const candidate = actual[index]
    return Math.abs(keyframe.time - candidate.time) <= 1e-6 && transformsMatch(keyframe.transform, candidate.transform)
  })

  const selectedVideo = $derived.by(() => {
    for (const id of editor.selectedClipIds) {
      const found = editor.getClipById(id)
      if (found?.channel.type === 'video') return found
    }
    return null
  })

  const clip = $derived(selectedVideo?.clip ?? null)
  const channel = $derived(selectedVideo?.channel ?? null)
  const duration = $derived(clip ? clipTimelineDuration(clip) : 0)
  const relativeTime = $derived(clip ? Math.max(0, Math.min(duration, editor.currentTime - clip.start)) : 0)
  const currentTransform = $derived(clip ? clipTransformAt(clip, relativeTime) : DEFAULT_CLIP_TRANSFORM)
  const keyframes = $derived(clip?.transformKeyframes ?? [])
  let advancedOpen = $state(false)
  let inspectedClipId: string | undefined

  $effect(() => {
    const clipId = clip?.id
    if (clipId === inspectedClipId) return
    inspectedClipId = clipId
    advancedOpen = keyframes.length > 0
  })

  const activeKeyframeTime = $derived.by(() => {
    const tolerance = 1 / Math.max(1, editor.fps) / 2
    return keyframes.find((keyframe) => Math.abs(keyframe.time - relativeTime) <= tolerance)?.time ?? null
  })

  const selectedPreset = $derived.by(() => {
    if (!clip) return 'none'
    if (clip.motionPreset && clip.motionPreset !== 'none') return clip.motionPreset
    if (keyframes.length === 0) return 'none'
    const matching = TRANSFORM_PRESETS.find((preset) => preset.value !== 'none' && keyframesMatch(transformPreset(preset.value, duration).keyframes, keyframes))
    return matching?.value ?? 'custom'
  })

  const locked = $derived(channel?.locked ?? false)
  const layerOpacity = $derived(clip ? clipOpacity(clip) : 1)
  const fadeIn = $derived(clip ? clipFadeIn(clip) : 0)
  const fadeOut = $derived(clip ? clipFadeOut(clip) : 0)
  const selectedEntrance = $derived<LayerEntranceEffect>(clip?.layerEntrance ?? (fadeIn > 0 ? 'fade' : 'none'))
  const selectedExit = $derived<LayerExitEffect>(clip?.layerExit ?? (fadeOut > 0 ? 'fade' : 'none'))

  const entranceEffects: Array<{ value: LayerEntranceEffect; label: string; hint: string }> = [
    { value: 'none', label: 'None', hint: 'Immediate cut' }, { value: 'fade', label: 'Clean', hint: 'Opacity only' },
    { value: 'focus', label: 'Focus', hint: 'Soft settle' }, { value: 'lift', label: 'Lift', hint: 'Rise into place' },
    { value: 'drift-left', label: 'Drift L', hint: 'From the left' }, { value: 'drift-right', label: 'Drift R', hint: 'From the right' },
  ]

  const exitEffects: Array<{ value: LayerExitEffect; label: string; hint: string }> = [
    { value: 'none', label: 'None', hint: 'Immediate cut' }, { value: 'fade', label: 'Fade', hint: 'Opacity only' },
    { value: 'zoom-out', label: 'Zoom out', hint: 'Soft exit' }, { value: 'sink', label: 'Sink', hint: 'Settle down' },
    { value: 'drift-left', label: 'Drift L', hint: 'To the left' }, { value: 'drift-right', label: 'Drift R', hint: 'To the right' },
  ]
  let editOneKeyframe = $state(false)
  const updateTransform = (patch: Partial<ClipTransform>): void => {
    if (!clip) return
    if (keyframes.length === 0 || editOneKeyframe) editor.setClipTransform(clip.id, patch, keyframes.length > 0 ? relativeTime : undefined)
    else editor.setClipTransformKeyframes(clip.id, normalizeClipTransform({ ...clipTransform(clip), ...patch }), keyframes.map((keyframe) => ({ time: keyframe.time, transform: normalizeClipTransform({ ...keyframe.transform, ...patch }) })))
  }

  const updateCompositing = (key: 'opacity' | 'fadeIn' | 'fadeOut', event: Event): void => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    if (clip && Number.isFinite(value)) editor.setClipCompositing(clip.id, { [key]: value })
  }

  const applyEntrance = (effect: LayerEntranceEffect): void => { if (clip) editor.setClipLayerEntrance(clip.id, effect) }
  const applyExit = (effect: LayerExitEffect): void => { if (clip) editor.setClipLayerExit(clip.id, effect) }

  const updateNumber = (key: NumericTransformKey, event: Event): void => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    if (Number.isFinite(value)) updateTransform({ [key]: value } as Partial<ClipTransform>)
  }

  const updateBoolean = (key: 'linkZoom' | 'flipH' | 'flipV', event: Event): void => {
    if (clip) updateTransform({ [key]: (event.currentTarget as HTMLInputElement).checked } as Partial<ClipTransform>)
  }

  const addKeyframe = (): void => { if (clip) editor.setClipTransform(clip.id, {}, relativeTime) }

  const applyPreset = (presetValue: string): void => {
    if (!clip) return
    const preset = TRANSFORM_PRESETS.find((candidate) => candidate.value === presetValue)?.value as TransformPreset | undefined
    if (preset) {
      const result = transformPreset(preset, duration)
      editor.setClipTransformKeyframes(clip.id, result.transform, result.keyframes, preset)
    }
  }

  const reset = (): void => { if (clip) editor.resetClipTransform(clip.id) }
  const selectKeyframe = (time: number): void => { if (clip) editor.setCurrentTime(clip.start + time) }
  const removeKeyframe = (time: number): void => { if (clip) editor.removeClipTransformKeyframe(clip.id, time) }
  const closeInspector = (): void => { options.getOnClose()?.(); editor.selectClip(null) }
  const entranceEffect = (effect: LayerEntranceEffect) => (): void => applyEntrance(effect)
  const exitEffect = (effect: LayerExitEffect) => (): void => applyExit(effect)
  const selectKeyframeFor = (time: number) => (): void => selectKeyframe(time)
  const beginHistory = (): void => editor.beginHistory()
  const endHistory = (): void => editor.endHistory()
  const updateCompositingFor = (key: 'opacity' | 'fadeIn' | 'fadeOut') => (event: Event): void => updateCompositing(key, event)
  const updateNumberFor = (key: NumericTransformKey) => (event: Event): void => updateNumber(key, event)
  const updateBooleanFor = (key: 'linkZoom' | 'flipH' | 'flipV') => (event: Event): void => updateBoolean(key, event)
  const removeKeyframeFor = (time: number) => (event: MouseEvent): void => {
    event.stopPropagation()
    removeKeyframe(time)
  }

  const removeKeyframeWithKeyboard = (time: number) => (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.stopPropagation()
      removeKeyframe(time)
    }
  }

  const toggleEditScope = (): void => {
    editOneKeyframe = !editOneKeyframe
  }

  return {
    editor,
    TRANSFORM_PRESETS,
    entranceEffects,
    exitEffects,
    updateCompositing,
    updateCompositingFor,
    applyEntrance,
    applyExit,
    entranceEffect,
    exitEffect,
    updateNumber,
    updateNumberFor,
    updateBoolean,
    updateBooleanFor,
    addKeyframe,
    applyPreset,
    reset,
    selectKeyframe,
    selectKeyframeFor,
    removeKeyframe,
    removeKeyframeFor,
    removeKeyframeWithKeyboard,
    toggleEditScope,
    closeInspector,
    formatTime: formatSeconds,
    beginHistory,
    endHistory,
    get clip() { return clip },
    get channel() { return channel },
    get duration() { return duration },
    get relativeTime() { return relativeTime },
    get currentTransform() { return currentTransform },
    get keyframes() { return keyframes },
    get activeKeyframeTime() { return activeKeyframeTime },
    get selectedPreset() { return selectedPreset },
    get locked() { return locked },
    get layerOpacity() { return layerOpacity },
    get fadeIn() { return fadeIn },
    get fadeOut() { return fadeOut },
    get selectedEntrance() { return selectedEntrance },
    get selectedExit() { return selectedExit },
    get advancedOpen() { return advancedOpen },
    set advancedOpen(value: boolean) { advancedOpen = value },
    get editOneKeyframe() { return editOneKeyframe },
  }
}
