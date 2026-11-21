import { clipTransformAt } from './clip-transform'
import type { CompositionAsset, DocumentClip, EditDocument } from './composition-types'

const MILLISECONDS_PER_SECOND = 1000
const MICROSECONDS_PER_SECOND = 1_000_000

export function timelineSeconds(value: number): number {
  return Math.round(value * MILLISECONDS_PER_SECOND) / MILLISECONDS_PER_SECOND
}

function floorTimelineSeconds(value: number): number {
  return Math.floor(value * MILLISECONDS_PER_SECOND + 1e-9) / MILLISECONDS_PER_SECOND
}

function roundTimeValue<T extends number | string>(value: T): T {
  return (typeof value === 'number' ? timelineSeconds(value) : value) as T
}

function clipDuration(clip: DocumentClip): number {
  return Math.round((clip.outPoint - clip.inPoint) / (clip.playbackRate ?? 1) * MICROSECONDS_PER_SECOND) / MICROSECONDS_PER_SECOND
}

function normalizeClip(clip: DocumentClip, asset?: CompositionAsset): DocumentClip {
  const inPoint = timelineSeconds(clip.inPoint)
  const sourceEnd = asset && asset.kind !== 'image' ? floorTimelineSeconds(asset.duration) : Infinity
  const outPoint = Math.min(timelineSeconds(clip.outPoint), sourceEnd)
  const rounded = { ...clip, start: timelineSeconds(clip.start), inPoint, outPoint }
  const duration = clipDuration(rounded)
  const originalDuration = clipDuration(clip)
  const lastFrame = clip.transformKeyframes?.at(-1)
  const end = floorTimelineSeconds(duration)
  const frames: DocumentClip['transformKeyframes'] = []

  for (const frame of clip.transformKeyframes ?? []) {
    const time = timelineSeconds(frame.time)
    if (!Number.isFinite(time) || time < 0 || time >= end || frame.time > originalDuration) continue
    const previous = frames.at(-1)
    if (previous?.time === time) frames[frames.length - 1] = { time, transform: { ...frame.transform } }
    else frames.push({ time, transform: { ...frame.transform } })
  }
  if (lastFrame && end >= 0 && lastFrame.time >= end - 1e-9) {
    const final = { time: end, transform: clipTransformAt(clip, Math.min(end, originalDuration)) }
    if (frames.at(-1)?.time === end) frames[frames.length - 1] = final
    else frames.push(final)
  }
  return { ...rounded, fadeIn: Math.min(timelineSeconds(clip.fadeIn ?? 0), end),
    fadeOut: Math.min(timelineSeconds(clip.fadeOut ?? 0), end), transformKeyframes: frames }
}

export function normalizeDocumentTimeline(document: EditDocument, assets: CompositionAsset[] = []): EditDocument {
  const sources = new Map(assets.map((asset) => [asset.id, asset]))
  const tracks = document.tracks?.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => normalizeClip(clip, sources.get(clip.assetId))),
  }))
  const clips = new Map(tracks?.flatMap((track) => track.clips.map((clip) => [clip.id, clip] as const)))
  return {
    ...document,
    ...(tracks ? { tracks } : {}),
    effects: document.effects?.map((effect) => {
      const start = timelineSeconds(effect.start)
      const owner = effect.ownerClipId ? clips.get(effect.ownerClipId) : undefined
      const ownerEnd = owner ? floorTimelineSeconds(owner.start + clipDuration(owner)) : Infinity
      const end = Math.min(timelineSeconds(effect.start + effect.duration), ownerEnd)
      return { ...effect, start, duration: timelineSeconds(end - start) }
    }),
    transitions: document.transitions?.map((transition) => {
      const left = clips.get(transition.leftClipId)
      const right = clips.get(transition.rightClipId)
      const duration = left && right
        ? Math.round((left.start + clipDuration(left) - right.start) * MICROSECONDS_PER_SECOND) / MICROSECONDS_PER_SECOND
        : timelineSeconds(transition.duration)
      return { ...transition, duration }
    }),
    texts: document.texts?.map((text) => ({ ...text, start: timelineSeconds(text.start), duration: timelineSeconds(text.duration),
      words: text.words?.map((word) => ({ ...word, start: timelineSeconds(word.start), end: timelineSeconds(word.end) })) })),
    audio: document.audio?.map((item) => ({ ...item, start: timelineSeconds(item.start), from: timelineSeconds(item.from),
      duration: item.duration === undefined ? undefined : timelineSeconds(item.duration) })),
    overrides: document.overrides?.map((override) => ({ ...override,
      start: override.start === undefined ? undefined : timelineSeconds(override.start),
      from: override.from === undefined ? undefined : timelineSeconds(override.from),
      duration: override.duration === undefined ? undefined : timelineSeconds(override.duration),
      keyframes: override.keyframes?.map((frame) => ({ ...frame, time: timelineSeconds(frame.time) })),
    })),
    sequence: document.sequence && { ...document.sequence,
      each: { ...document.sequence.each, take: { from: roundTimeValue(document.sequence.each.take.from),
        duration: roundTimeValue(document.sequence.each.take.duration) } },
      between: document.sequence.between && { ...document.sequence.between,
        duration: roundTimeValue(document.sequence.between.duration) },
    },
    jobs: document.jobs?.map((job) => ({ ...job,
      start: job.start === undefined ? undefined : roundTimeValue(job.start),
      duration: job.duration === undefined ? undefined : roundTimeValue(job.duration),
    })),
  }
}
