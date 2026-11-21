import { clipTimelineDuration, type Clip } from '../stores/editor.svelte'

export function formatTimelineTime(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const hours = Math.floor(tenths / 36000)
  const minutes = Math.floor((tenths % 36000) / 600)
  const remaining = ((tenths % 600) / 10).toFixed(1).padStart(4, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`
    : `${minutes}:${remaining}`
}

export function clipsOverlap(left: Clip, right: Clip): boolean {
  const leftEnd = left.start + clipTimelineDuration(left)
  const rightEnd = right.start + clipTimelineDuration(right)
  return left.start < rightEnd - 0.001 && right.start < leftEnd - 0.001
}

export function overlappingClipIds(clips: Clip[]): Set<string> {
  const ids = new Set<string>()
  for (let leftIndex = 0; leftIndex < clips.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < clips.length; rightIndex++) {
      if (!clipsOverlap(clips[leftIndex], clips[rightIndex])) continue
      ids.add(clips[leftIndex].id)
      ids.add(clips[rightIndex].id)
    }
  }
  return ids
}

export function hasClipOverlap(clips: Clip[]): boolean {
  for (let leftIndex = 0; leftIndex < clips.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < clips.length; rightIndex++) {
      if (clipsOverlap(clips[leftIndex], clips[rightIndex])) return true
    }
  }
  return false
}
