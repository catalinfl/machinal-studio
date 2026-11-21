import { projectResolution } from '../stores/editor.svelte'
import type { Composition, PreparedText } from './composition-types'
import { buildRenderTextOverlays } from './text-render'

export async function prepareCompositionText(composition: Composition): Promise<PreparedText | undefined> {
  if (!composition.textItems.length) return undefined
  if (composition.preparedText?.key === composition.textRenderKey && composition.preparedText.overlays.length >= composition.textItems.length) {
    return composition.preparedText
  }
  const { w, h } = projectResolution(composition.output.resolution, composition.output.aspect)
  return {
    key: composition.textRenderKey,
    overlays: await buildRenderTextOverlays(composition.textItems, w, h, composition.output.aspect),
  }
}
