import { clipEnd, type Channel, type Clip } from '../stores/editor.svelte'

const MEDIA_CONTINUITY_EPSILON = 0.0001

export interface PreviewMediaIndex {
  channels: Array<{ channel: Channel; clips: Clip[]; ends: number[]; prefixEnds: number[] }>
  cacheKeys: Map<string, string>
  sources: Map<string, string>
}

function continuous(left: Clip, right: Clip): boolean {
  return left.scrubBlobUrl !== null
    && left.scrubBlobUrl === right.scrubBlobUrl
    && left.mediaKind === right.mediaKind
    && Math.abs(clipEnd(left) - right.start) <= MEDIA_CONTINUITY_EPSILON
    && Math.abs(left.outPoint - right.inPoint) <= MEDIA_CONTINUITY_EPSILON
}

export function indexPreviewMedia(channels: Channel[]): PreviewMediaIndex {
  const cacheKeys = new Map<string, string>()
  const sources = new Map<string, string>()
  const indexed = channels.filter(channel => !channel.hidden).map(channel => {
    const clips = [...channel.clips].sort((a, b) => a.start - b.start)
    const ends: number[] = []
    const prefixEnds: number[] = []
    let key = ''
    let maxEnd = 0
    clips.forEach((clip, i) => {
      if (i === 0 || !continuous(clips[i - 1], clip)) key = `clip:${clip.id}`
      cacheKeys.set(clip.id, key)
      if (clip.scrubBlobUrl) {
        sources.set(key, clip.scrubBlobUrl)
        sources.set(`clip:${clip.id}`, clip.scrubBlobUrl)
      }
      const end = clipEnd(clip)
      maxEnd = Math.max(maxEnd, end)
      ends.push(end)
      prefixEnds.push(maxEnd)
    })
    return { channel, clips, ends, prefixEnds }
  })
  return { channels: indexed, cacheKeys, sources }
}

export function previewClipsInRange(index: PreviewMediaIndex, start: number, end = start): Array<{ channel: Channel; clip: Clip }> {
  const result: Array<{ channel: Channel; clip: Clip }> = []
  for (const { channel, clips, ends, prefixEnds } of index.channels) {
    let low = 0
    let high = clips.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (clips[middle].start <= end) low = middle + 1
      else high = middle
    }
    const matches: Clip[] = []
    for (let i = low - 1; i >= 0 && prefixEnds[i] > start; i--) {
      if (ends[i] > start) matches.push(clips[i])
    }
    for (let i = matches.length - 1; i >= 0; i--) result.push({ channel, clip: matches[i] })
  }
  return result
}
