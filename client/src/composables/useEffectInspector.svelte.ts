import { editor, clipPlaybackRate, clipTimelineDuration } from '../stores/editor.svelte'
import { clampRampAmount, effectSupportsRamp, getEffect, normalizeRamp, type EffectParameterDef, type RampCurve, type RampMode } from '../lib/effects'

export const RAMP_MODE_OPTIONS: Array<{ value: RampMode | 'constant'; label: string }> = [
  { value: 'constant', label: 'Constant' }, { value: 'in', label: 'Fade In' },
  { value: 'out', label: 'Fade Out' }, { value: 'in-out', label: 'In & Out' },
]
export const RAMP_CURVE_OPTIONS: Array<{ value: RampCurve; label: string }> = [
  { value: 'linear', label: 'Linear' }, { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' }, { value: 'ease-in-out', label: 'Ease In-Out' },
]

export function useEffectInspector() {
  const selectedBlocks = $derived(editor.selectedEffectBlockIds.flatMap((id) => editor.effectBlocks.find((block) => block.id === id) ?? []))

  const selectedClips = $derived(editor.selectedClipIds.flatMap((id) => {
    const found = editor.getClipById(id)
    return found ? [{ channel: found.channel, clip: found.clip }] : []
  }))

  const showClips = $derived(selectedBlocks.length === 0 && selectedClips.length > 0)
  const selectedAudioClips = $derived(selectedClips.filter(({ channel }) => channel.type === 'audio'))
  
  const commonVolume = $derived.by(() => {
    if (selectedAudioClips.length === 0) return 100
    const first = selectedAudioClips[0].clip.volume ?? 100
    return selectedAudioClips.every(({ clip }) => (clip.volume ?? 100) === first) ? first : null
  })
  
  const commonPlaybackRate = $derived.by(() => {
    const first = selectedClips[0] ? clipPlaybackRate(selectedClips[0].clip) : 1
    return selectedClips.every(({ clip }) => Math.abs(clipPlaybackRate(clip) - first) <= 1e-9) ? first : null
  })
  
  const clipsHaveLockedTrack = $derived(selectedClips.some(({ channel, clip }) => {
    if (channel.locked) return true
    const linked = clip.linkedClipId ? editor.getClipById(clip.linkedClipId) : null
    return linked?.channel.locked ?? false
  }))
  
  const selectionStart = $derived.by(() => {
    const starts = [...selectedBlocks.map((block) => block.start), ...selectedClips.map(({ clip }) => clip.start)]
    return starts.length > 0 ? Math.min(...starts) : 0
  })
  
  const commonDuration = $derived.by(() => {
    const first = selectedBlocks[0]?.duration
    return first !== undefined && selectedBlocks.every((block) => Math.abs(block.duration - first) <= 1e-9) ? first : null
  })
  
  const commonEffect = $derived.by(() => {
    const first = selectedBlocks[0]?.effectId
    return first && selectedBlocks.every((block) => block.effectId === first) ? getEffect(first) : null
  })
  
  const commonParameters = $derived(commonEffect?.parameters ?? [])
  const rampableEffect = $derived(commonEffect ? effectSupportsRamp(commonEffect.id) : false)
  
  const commonRamp = $derived.by(() => {
    const first = normalizeRamp(selectedBlocks[0]?.ramp)
    const key = JSON.stringify(first)
    return { value: first, mixed: selectedBlocks.some((block) => JSON.stringify(normalizeRamp(block.ramp)) !== key) }
  })
  
  const trackLabel = $derived.by(() => {
    const channelIds = [...new Set(selectedBlocks.map((block) => block.channelId))]
    return channelIds.length === 1 ? editor.channels.find((channel) => channel.id === channelIds[0])?.name ?? 'Unknown track' : `${channelIds.length} tracks`
  })
  
  const hasLockedTrack = $derived(clipsHaveLockedTrack || selectedBlocks.some((block) => editor.channels.find((channel) => channel.id === block.channelId)?.locked))
  let volSliderEl = $state<HTMLInputElement>()
  
  const readNumber = (event: Event): number | null => {
    const rawValue = (event.currentTarget as HTMLInputElement).value.trim()
    if (!rawValue) return null
    const value = Number(rawValue)
    return Number.isFinite(value) ? value : null
  }
  
  const applyPosition = (event: Event): void => {
    const value = readNumber(event)
    if (value !== null && selectedBlocks.length > 0) editor.moveSelection(selectedClips.map(({ clip }) => clip.id), selectedBlocks.map((block) => block.id), [], Math.max(0, value) - selectionStart)
  }
  
  const applyDuration = (event: Event): void => {
    const value = readNumber(event)
    if (value !== null && selectedBlocks.length > 0) editor.resizeEffectBlocks(selectedBlocks.map((block) => block.id), value)
  }
  
  const applyBlockPosition = (blockId: string, event: Event): void => {
    const block = editor.effectBlocks.find((candidate) => candidate.id === blockId)
    const value = readNumber(event)
    if (block && value !== null) editor.moveEffectBlocks([blockId], Math.max(0, value) - block.start)
  }
  
  const applyBlockDuration = (blockId: string, event: Event): void => {
    const value = readNumber(event)
    if (value !== null) editor.resizeEffectBlocks([blockId], value)
  }
  
  const applyVolume = (event: Event): void => {
    const value = readNumber(event)
    if (value !== null) for (const { clip } of selectedAudioClips) editor.setClipVolume(clip.id, value)
  }
  
  const applyPlaybackRate = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement
    const value = Number(input.value)
    if (!Number.isFinite(value)) return
    editor.beginHistory()
    try {
      let changed = true
      for (const { clip } of selectedClips) {
        if (!editor.setClipPlaybackRate(clip.id, value)) changed = false
      }
      if (!changed && commonPlaybackRate !== null) input.value = commonPlaybackRate.toFixed(2)
    } finally { editor.endHistory() }
  }

  const commonParameterValue = (parameter: EffectParameterDef): number | null => {
    const first = selectedBlocks[0]?.params[parameter.key] ?? parameter.defaultValue
    return selectedBlocks.every((block) => Math.abs((block.params[parameter.key] ?? parameter.defaultValue) - first) <= 1e-9) ? first : null
  }
  
  const applyEffectParameter = (parameter: EffectParameterDef, event: Event): void => {
    const value = readNumber(event)
    if (value !== null) editor.setEffectParameter(selectedBlocks.map((block) => block.id), parameter.key, value)
  }
  
  const applyRampMode = (mode: RampMode | 'constant'): void => {
    if (mode === 'constant') editor.setEffectRamp(selectedBlocks.map((block) => block.id), null)
    else {
      const current = commonRamp.value
      editor.setEffectRamp(selectedBlocks.map((block) => block.id), { mode, curve: current?.curve ?? 'ease-in-out', amount: clampRampAmount(mode, current?.amount ?? 0.25) })
    }
  }
  
  const applyRampCurve = (curve: RampCurve): void => {
    const current = commonRamp.value
    if (current) editor.setEffectRamp(selectedBlocks.map((block) => block.id), { ...current, curve })
  }
  
  const applyRampAmount = (event: Event): void => {
    const current = commonRamp.value
    const amount = (readNumber(event) ?? NaN) / 100
    if (current && Number.isFinite(amount)) editor.setEffectRamp(selectedBlocks.map((block) => block.id), { ...current, amount })
  }
  
  const resetParameters = (): void => { editor.resetEffectParameters(selectedBlocks.map((block) => block.id)) }
  const effectFor = (effectId: string) => getEffect(effectId)
  const channelFor = (channelId: string) => editor.channels.find((channel) => channel.id === channelId)
  const timelineDuration = (clip: Parameters<typeof clipTimelineDuration>[0]): number => clipTimelineDuration(clip)
  const applyParameter = (parameter: EffectParameterDef) => (event: Event): void => applyEffectParameter(parameter, event)
  const rampMode = (mode: RampMode | 'constant') => (): void => applyRampMode(mode)
  const rampCurve = (curve: RampCurve) => (): void => applyRampCurve(curve)
  const blockPosition = (blockId: string) => (event: Event): void => applyBlockPosition(blockId, event)
  const blockDuration = (blockId: string) => (event: Event): void => applyBlockDuration(blockId, event)
  const parameterValue = (parameter: EffectParameterDef) => commonParameterValue(parameter)
  const beginHistory = (): void => editor.beginHistory()
  const endHistory = (): void => editor.endHistory()
  
  $effect(() => {
    const value = commonVolume
    if (value !== null && volSliderEl && !volSliderEl.matches(':focus')) volSliderEl.value = String(value)
  })

  return {
    editor,
    RAMP_MODE_OPTIONS,
    RAMP_CURVE_OPTIONS,
    applyPosition,
    applyDuration,
    applyBlockPosition,
    applyBlockDuration,
    blockPosition,
    blockDuration,
    applyVolume,
    applyPlaybackRate,
    commonParameterValue,
    parameterValue,
    applyEffectParameter,
    applyParameter,
    applyRampMode,
    rampMode,
    applyRampCurve,
    rampCurve,
    applyRampAmount,
    resetParameters,
    effectFor,
    channelFor,
    timelineDuration,
    beginHistory,
    endHistory,
    get selectedBlocks() { return selectedBlocks },
    get selectedClips() { return selectedClips },
    get showClips() { return showClips },
    get selectedAudioClips() { return selectedAudioClips },
    get commonVolume() { return commonVolume },
    get commonPlaybackRate() { return commonPlaybackRate },
    get clipsHaveLockedTrack() { return clipsHaveLockedTrack },
    get selectionStart() { return selectionStart },
    get commonDuration() { return commonDuration },
    get commonEffect() { return commonEffect },
    get commonParameters() { return commonParameters },
    get rampableEffect() { return rampableEffect },
    get commonRamp() { return commonRamp },
    get trackLabel() { return trackLabel },
    get hasLockedTrack() { return hasLockedTrack },
    get volSliderEl() { return volSliderEl },
    set volSliderEl(value: HTMLInputElement | undefined) { volSliderEl = value },
    close: () => editor.selectClip(null),
  }
}
