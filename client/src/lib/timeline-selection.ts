import { clipEnd, type Channel, type EffectBlock, type TextItem } from '../stores/editor.svelte'

export interface TimelineElements {
  channels: Channel[]
  effectBlocks: EffectBlock[]
  textItems: TextItem[]
}

export function collectTimelineSnapEdges({ channels, effectBlocks, textItems }: TimelineElements): number[] {
  return [
    ...channels.flatMap((channel) => channel.clips.flatMap((clip) => [clip.start, clipEnd(clip)])),
    ...effectBlocks.flatMap((block) => [block.start, block.start + block.duration]),
    ...textItems.flatMap((item) => [item.start, item.start + item.duration]),
  ]
}

export interface SelectionRect {
  left: number
  top: number
  width: number
  height: number
}

export function elementsInRect(selector: string, dataKey: string, rect: SelectionRect): string[] {
  const right = rect.left + rect.width
  const bottom = rect.top + rect.height

  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.right >= rect.left
        && bounds.left <= right
        && bounds.bottom >= rect.top
        && bounds.top <= bottom
    })
    .map((element) => element.dataset[dataKey])
    .filter((id): id is string => Boolean(id))
}
