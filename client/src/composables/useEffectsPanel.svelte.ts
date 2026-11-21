import { editor } from '../stores/editor.svelte'

export function useEffectsPanel() {
  const targetChannelId = $derived.by(() => {
    const selected = editor.selectedClipId ? editor.getClipById(editor.selectedClipId) : null
    if (selected?.channel.type === 'video' && !selected.channel.hidden) return selected.channel.id
    return editor.channels.find((channel) => channel.type === 'video' && !channel.hidden)?.id ?? null
  })
  return {
    get targetChannelId() { return targetChannelId },
  }
}
