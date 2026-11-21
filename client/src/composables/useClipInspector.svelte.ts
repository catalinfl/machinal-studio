import { editor, clipPlaybackRate, clipTimelineDuration } from '../stores/editor.svelte'

export function useClipInspector() {
  const selectedClips = $derived(editor.selectedClipIds.flatMap((id) => {
    const found = editor.getClipById(id)
    return found ? [{ channel: found.channel, clip: found.clip }] : []
  }))

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

  const selectionStart = $derived(selectedClips.length > 0 ? Math.min(...selectedClips.map(({ clip }) => clip.start)) : 0)
  
  const commonDuration = $derived.by(() => {
    const first = selectedClips[0] ? clipTimelineDuration(selectedClips[0].clip) : null
    return first !== null && selectedClips.every(({ clip }) => Math.abs(clipTimelineDuration(clip) - first) <= 1e-9) ? first : null
  })
  
  const canTransform = $derived(selectedClips.length === 1 && selectedClips[0].channel.type === 'video')
  let volSliderEl = $state<HTMLInputElement>()

  const applyVolume = (event: Event): void => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    if (Number.isFinite(value)) for (const { clip } of selectedAudioClips) editor.setClipVolume(clip.id, value)
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
    } finally { 
        editor.endHistory() 
      }
  }

  const applyPosition = (event: Event): void => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    if (Number.isFinite(value)) editor.moveClips(selectedClips.map(({ clip }) => clip.id), Math.max(0, value) - selectionStart)
  }
  const applyDuration = (event: Event): void => {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    if (!Number.isFinite(value) || value < 0.2) return
    editor.beginHistory()
    try { for (const { clip } of selectedClips) editor.trimClip(clip.id, 'right', value - clipTimelineDuration(clip)) }
    finally { editor.endHistory() }
  }
  const beginHistory = (): void => editor.beginHistory()
  const endHistory = (): void => editor.endHistory()
  $effect(() => {
    const value = commonVolume
    if (value !== null && volSliderEl && !volSliderEl.matches(':focus')) volSliderEl.value = String(value)
  })
  return {
    editor,
    applyVolume, 
    applyPlaybackRate, 
    applyPosition, 
    applyDuration, 
    beginHistory, 
    endHistory,
    get selectedClips() { return selectedClips }, 
    get selectedAudioClips() { return selectedAudioClips },
    get commonVolume() { return commonVolume }, 
    get commonPlaybackRate() { return commonPlaybackRate },
    get clipsHaveLockedTrack() { return clipsHaveLockedTrack }, 
    get selectionStart() { return selectionStart },
    get commonDuration() { return commonDuration }, 
    get canTransform() { return canTransform },
    get volSliderEl() { return volSliderEl }, 
    set volSliderEl(value: HTMLInputElement | undefined) { volSliderEl = value },
    close: () => editor.selectClip(null),
  }
}
