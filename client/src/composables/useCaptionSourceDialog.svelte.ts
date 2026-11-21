import { onMount } from 'svelte'
import { clipTimelineDuration, editor, type Channel, type Clip } from '../stores/editor.svelte'
import { formatTimelineTime, hasClipOverlap, overlappingClipIds } from '../lib/caption-sources'

interface CaptionSource {
  clip: Clip
  channel: Channel
}

interface Options {
  getInitialSelectedClips: () => Clip[]
  getOnCancel: () => () => void
  getOnSelect: () => (clips: Clip[]) => void
}

export function useCaptionSourceDialog(options: Options) {
  let dialogEl = $state<HTMLDialogElement>()
  let activeTab = $state<'clips' | 'channels'>('clips')
  let selectedSourceIds = $state<string[]>([])
  let selectionInitialized = false

  const sourceIdForClip = (clip: Clip): string => {
    const linked = clip.linkedClipId ? editor.getClipById(clip.linkedClipId) : null
    return linked?.channel.type === 'video' ? linked.clip.id : clip.id
  }

  $effect(() => {
    if (selectionInitialized) return
    selectedSourceIds = [...new Set(options.getInitialSelectedClips().map(sourceIdForClip))]
    selectionInitialized = true
  })

  const audioChannels = $derived(editor.channels.filter((channel) => channel.type === 'audio'))
  const captionSources = $derived.by((): CaptionSource[] => {
    const sources: CaptionSource[] = []
    const seen = new Set<string>()
    for (const audioChannel of audioChannels) {
      for (const audioClip of audioChannel.clips) {
        const linked = audioClip.linkedClipId ? editor.getClipById(audioClip.linkedClipId) : null
        const source = linked?.channel.type === 'video'
          ? { clip: linked.clip, channel: linked.channel }
          : { clip: audioClip, channel: audioChannel }
        if (source.clip.sourceMode === 'wasm' || seen.has(source.clip.id)) continue
        seen.add(source.clip.id)
        sources.push(source)
      }
    }
    return sources.sort((left, right) => left.clip.start - right.clip.start)
  })
  const selectedSources = $derived(captionSources.filter(({ clip }) => selectedSourceIds.includes(clip.id)))
  const overlappingSourceIds = $derived(overlappingClipIds(captionSources.map(({ clip }) => clip)))
  const hasOverlappingSelection = $derived(hasClipOverlap(selectedSources.map(({ clip }) => clip)))

  const sourceIdsForChannel = (channel: Channel): string[] => {
    const availableIds = new Set(captionSources.map(({ clip }) => clip.id))
    return [...new Set(channel.clips.flatMap((audioClip) => {
      const linked = audioClip.linkedClipId ? editor.getClipById(audioClip.linkedClipId) : null
      const sourceId = linked?.channel.type === 'video' ? linked.clip.id : audioClip.id
      return availableIds.has(sourceId) ? [sourceId] : []
    }))]
  }

  const toggleSource = (sourceId: string): void => {
    selectedSourceIds = selectedSourceIds.includes(sourceId)
      ? selectedSourceIds.filter((id) => id !== sourceId)
      : [...selectedSourceIds, sourceId]
  }

  const toggleChannel = (channel: Channel): void => {
    const sourceIds = sourceIdsForChannel(channel)
    if (sourceIds.length === 0) return
    const allSelected = sourceIds.every((id) => selectedSourceIds.includes(id))
    selectedSourceIds = allSelected
      ? selectedSourceIds.filter((id) => !sourceIds.includes(id))
      : [...new Set([...selectedSourceIds, ...sourceIds])]
  }
  const showClips = (): void => { activeTab = 'clips' }
  const showChannels = (): void => { activeTab = 'channels' }
  const toggleSourceFor = (sourceId: string) => (): void => toggleSource(sourceId)
  const toggleChannelFor = (channel: Channel) => (): void => toggleChannel(channel)

  const closeDialog = (): void => {
    if (dialogEl && typeof dialogEl.close === 'function') {
      dialogEl.close()
      return
    }
    dialogEl?.removeAttribute('open')
    options.getOnCancel()()
  }

  const submitSelection = (): void => {
    if (selectedSources.length > 0) options.getOnSelect()(selectedSources.map(({ clip }) => clip))
  }

  onMount(() => {
    if (!dialogEl || dialogEl.open) return
    if (dialogEl.showModal) dialogEl.showModal()
    else dialogEl.setAttribute('open', '')
  })

  return {
    get dialogEl() { return dialogEl },
    set dialogEl(value: HTMLDialogElement | undefined) { dialogEl = value },
    get activeTab() { return activeTab },
    set activeTab(value: 'clips' | 'channels') { activeTab = value },
    get selectedSourceIds() { return selectedSourceIds },
    get audioChannels() { return audioChannels },
    get captionSources() { return captionSources },
    get selectedSources() { return selectedSources },
    get overlappingSourceIds() { return overlappingSourceIds },
    get hasOverlappingSelection() { return hasOverlappingSelection },
    sourceIdsForChannel,
    toggleSource,
    toggleSourceFor,
    toggleChannel,
    toggleChannelFor,
    showClips,
    showChannels,
    formatTime: formatTimelineTime,
    closeDialog,
    submitSelection,
  }
}
