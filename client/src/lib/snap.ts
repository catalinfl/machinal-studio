// Shared time-snapping used by the timeline ruler, playhead, text drops and
// text block edits. Mirrors clip behavior: snap within a small pixel tolerance
// to the nearest meaningful edge (playhead, clip, effect block or text item).
export function snapTime(seconds: number, pixelsPerSecond: number, tolerancePx: number, edges: number[]): number {
  let snapped = seconds
  let nearestDistancePx = tolerancePx + 1
  for (const edge of edges) {
    const distancePx = Math.abs(seconds - edge) * pixelsPerSecond
    if (distancePx <= tolerancePx && distancePx < nearestDistancePx) {
      snapped = edge
      nearestDistancePx = distancePx
    }
  }
  return snapped
}
