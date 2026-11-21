import { editor, TEXT_LANE_HEIGHT, TEXT_TRACK_MIN_HEIGHT } from '../stores/editor.svelte'

export function useTextTrack(getVisibleRange: () => { start: number; end: number } | null) {
  const lanes = $derived(editor.getTextLanes())
  const height = $derived(Math.max(TEXT_TRACK_MIN_HEIGHT, lanes.length * TEXT_LANE_HEIGHT))
  const preservedIds = $derived(new Set([...editor.selectedTextItemIds, ...editor.textDragPreviewIds]))

  const visibleLanes = $derived(lanes.map((lane, laneIndex) => ({
    // Stable per-lane identity (see useChannelRow): keying by first visible
    // item id remounted the lane on every scroll pixel at the cull boundary.
    key: laneIndex,
    items: !getVisibleRange()
      ? lane
      : lane.filter((item) => preservedIds.has(item.id) || (
        item.start + item.duration >= getVisibleRange()!.start && item.start <= getVisibleRange()!.end
      )),
  })))

  return {
    textLaneHeight: TEXT_LANE_HEIGHT,
    get lanes() { return lanes },
    get height() { return height },
    get visibleLanes() { return visibleLanes },
  }
}
