import ClipInspector from '../components/ClipInspector.svelte'
import EffectInspector from '../components/EffectInspector.svelte'
import TextInspector from '../components/TextInspector.svelte'
import { editor } from '../stores/editor.svelte'

export function useInspectorFactory(
  getShowClipInspector: () => boolean,
  getShowEffectInspector: () => boolean = () => true,
  getShowTextInspector: () => boolean = () => true,
) {
  const activeInspector = $derived.by(() => {
    if (getShowTextInspector() && editor.selectedTextItemIds.length > 0) return TextInspector
    if (getShowEffectInspector() && editor.selectedEffectBlockIds.length > 0) return EffectInspector
    if (getShowClipInspector() && editor.selectedClipIds.length > 0) return ClipInspector
    return null
  })
  return {
    get activeInspector() { return activeInspector },
  }
}
