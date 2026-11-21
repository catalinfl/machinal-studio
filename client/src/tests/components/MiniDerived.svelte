<script lang="ts">
  import { editor } from '../../stores/editor.svelte'

  let { clipId = '' }: { clipId?: string } = $props()

  let viaChannels = $derived.by(() => {
    const clip = editor.channels.flatMap((ch) => ch.clips)[0]
    return clip?.volume ?? 100
  })

  let viaSelection = $derived.by(() => {
    const id = editor.selectedClipIds[0]
    if (!id) return 100
    for (const ch of editor.channels) {
      const clip = ch.clips.find((c) => c.id === id)
      if (clip) return clip.volume ?? 100
    }
    return 100
  })

  let viaFind = $derived.by(() => {
    for (const ch of editor.channels) {
      const clip = ch.clips.find((c) => c.id === clipId)
      if (clip) return clip.volume ?? 100
    }
    return 100
  })

  let viaSelId = $derived.by(() => {
    const id = editor.selectedClipIds[0]
    return id === clipId ? (editor.channels[0]?.clips[0]?.volume ?? 100) : 100
  })

  let viaGetter = $derived.by(() => {
    const found = editor.getClipById(clipId)
    return found ? (found.clip.volume ?? 100) : 100
  })
</script>

<span id="via-channels">{viaChannels}</span>
<span id="via-selection">{viaSelection}</span>
<span id="via-find">{viaFind}</span>
<span id="via-selid">{viaSelId}</span>
<span id="via-getter">{viaGetter}</span>
