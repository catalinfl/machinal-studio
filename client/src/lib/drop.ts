// Shared drop logic for media-bin clips dropped on the timeline.
// Used by ChannelRow (drop on an existing channel) and by Timeline
// (drop below all channels, which first creates a new channel).

import { clipEnd, clipTimelineDuration, editor, type Channel, type Clip, type MediaKind, type ProjectAspect } from '../stores/editor.svelte'
import { generateScrub } from './scrub'
import { extractAudio } from './wasm'
import { getAudioPreview } from './api'
import type { ScrubMode } from '../stores/scrub.svelte'
import { mediaProcessing } from '../stores/media-processing.svelte'
import { getLocalSource } from './local-media'
import { isLiveSceneFile, loadLiveScene } from './live-scene'

export interface DropClipData {
  fileName: string
  sourceId?: string
  sourceMode?: ScrubMode
  mediaKind?: MediaKind
  scrubBlobUrl?: string
  sourceDuration?: number
  sourceWidth?: number
  sourceHeight?: number
  projectAspect?: ProjectAspect
  scrubMode?: ScrubMode
  dragOffsetX?: number
}

export function resolveDropMediaKind(parsed: Pick<DropClipData, 'fileName' | 'mediaKind'>): MediaKind {
  if (parsed.mediaKind === 'audio' || parsed.mediaKind === 'image') return parsed.mediaKind
  const extension = parsed.fileName.split('.').pop()?.toLowerCase()
  if (extension && ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac'].includes(extension)) return 'audio'
  if (extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) return 'image'
  return 'video'
}

export function acceptsDropOnChannel(channel: Pick<Channel, 'type'>, parsed: Pick<DropClipData, 'fileName' | 'mediaKind'>): boolean {
  const mediaKind = resolveDropMediaKind(parsed)
  return mediaKind === 'video'
    || (mediaKind === 'audio' && channel.type === 'audio')
    || (mediaKind === 'image' && channel.type === 'video')
}

const SNAP_PX = 100

export function computeDropStart(rawX: number, dragOffsetX = 0): number {
  const pps = editor.pixelsPerSecond
  const offsetX = Number.isFinite(dragOffsetX) ? Math.max(0, dragOffsetX) : 0
  const timelineX = Number.isFinite(rawX) ? rawX - offsetX : 0
  const playheadPx = editor.currentTime * pps
  // playhead is cursor of timeline
  const nearPlayhead = Math.abs(timelineX - playheadPx) < SNAP_PX

  if (nearPlayhead) return editor.currentTime
  return Math.max(0, timelineX / pps)
}

export interface DropOptions {
  // Force a new audio channel for a video channel created by this drop.
  freshAudioChannel?: boolean
  sourceIn?: number
  sourceOut?: number
  playbackRate?: number
  volume?: number
  includeAudio?: boolean
}

export interface PreparedMediaInsertion {
  parsed: DropClipData
  mediaKind: MediaKind
  scrubBlobUrl: string | null
  audioBlobUrl: string | null
  sourceDuration: number
  sceneAudio?: { file: string; start: number; duration: number }
}

export interface AddedTimelineMedia {
  primary: Clip
  linkedAudio?: Clip
}

const MAX_SAME_CHANNEL_DROP_OVERLAP_RATIO = 0.5
const LONG_MEDIA_DURATION_SECONDS = 10
const MIN_LONG_AUDIO_FEEDBACK_MS = 700
// Above this local file size the WASM audio extract is skipped in favour of
// playing audio straight from the video blob URL. extractAudio buffers the
// entire input in MEMFS, so multi-hundred-MB inputs get slow and 2GB+ inputs
// reliably OOM — leaving the timeline video permanently without its audio.
const LARGE_LOCAL_VIDEO_BYTES = 300 * 1024 * 1024

function exceedsDropOverlap(channel: Channel, start: number, duration: number): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return false
  const end = start + duration

  return channel.clips.some((clip) => {
    const overlap = Math.max(0, Math.min(end, clipEnd(clip)) - Math.max(start, clip.start))
    const shorterDuration = Math.min(duration, clipTimelineDuration(clip))
    return overlap > shorterDuration * MAX_SAME_CHANNEL_DROP_OVERLAP_RATIO + 1e-9
  })
}

function resolveDropChannel(
  channel: Channel,
  prepared: PreparedMediaInsertion,
  startSec: number,
  opts: DropOptions,
): Channel {
  const sourceDuration = prepared.sourceDuration > 0 ? prepared.sourceDuration : 5
  const sourceIn = opts.sourceIn ?? 0
  const sourceOut = opts.sourceOut ?? sourceDuration
  const duration = (sourceOut - sourceIn) / (opts.playbackRate ?? 1)
  const channelIndex = editor.channels.findIndex((candidate) => candidate.id === channel.id)
  if (channelIndex < 0) return channel

  for (const candidate of editor.channels.slice(channelIndex)) {
    if (candidate.type !== channel.type) continue
    if (!candidate.locked && !exceedsDropOverlap(candidate, startSec, duration)) return candidate
  }

  return editor.addChannel(channel.type)
}

export function attachPreparedSourceAudio(
  videoClipId: string,
  prepared: PreparedMediaInsertion,
  opts: DropOptions = {},
): Clip | null {
  if (!prepared.audioBlobUrl) return null
  const live = editor.getClipById(videoClipId)
  if (!live || live.channel.type !== 'video' || live.channel.locked || live.clip.linkedClipId) return null

  const currentStart = live.clip.start
  const videoChannelIndex = editor.channels.findIndex((candidate) => candidate.id === live.channel.id)
  const audioChannelsBelow = editor.channels
    .slice(videoChannelIndex + 1)
    .filter((candidate) => candidate.type === 'audio' && !candidate.locked)
  const firstAudioChannel = audioChannelsBelow[0]
  const audioEnd = clipEnd(live.clip)
  const overlapsDrop = (candidate: Channel) => candidate.clips.some((clip) => {
    const end = clipEnd(clip)
    return currentStart < end - 0.000001 && audioEnd > clip.start + 0.000001
  })

  let audioChannel: Channel | null = null
  if (!opts.freshAudioChannel) {
    audioChannel = firstAudioChannel && !overlapsDrop(firstAudioChannel)
      ? firstAudioChannel
      : audioChannelsBelow.find((candidate) => candidate.clips.length === 0) ?? null
  }
  if (!audioChannel) audioChannel = editor.addChannel('audio', live.channel.id)

  const audio = editor.addClip(audioChannel.id, {
    fileName: prepared.sceneAudio?.file ?? live.clip.fileName,
    sourceId: prepared.sceneAudio ? prepared.sceneAudio.file : live.clip.sourceId,
    sourceMode: live.clip.sourceMode,
    mediaKind: 'audio',
    scrubBlobUrl: prepared.audioBlobUrl,
    sourceDuration: prepared.sceneAudio?.duration ?? live.clip.sourceDuration,
    inPoint: (prepared.sceneAudio?.start ?? 0) + live.clip.inPoint,
    outPoint: prepared.sceneAudio ? Math.min(prepared.sceneAudio.duration, prepared.sceneAudio.start + live.clip.outPoint) : live.clip.outPoint,
    start: live.clip.start,
    playbackRate: live.clip.playbackRate,
    volume: live.clip.volume ?? 100,
    linkedClipId: live.clip.id,
  })
  live.clip.linkedClipId = audio.id
  return audio
}

async function prepareVideoAudio(parsed: DropClipData, scrubBlobUrl: string): Promise<string | null> {
  if ((parsed.sourceMode ?? parsed.scrubMode) === 'proxy') {
    // Keep large server videos out of the browser's WASM filesystem.
    return getAudioPreview(parsed.fileName)
  }
  // Local files over this size skip the WASM audio extract: extractAudio
  // copies the whole file into MEMFS (fetchFile + writeFile), so a 2GB+
  // video OOMs/times out and the timeline never gets its linked audio.
  // Audio voices are hidden <video> elements (see getOrCreateAudioVoice),
  // so they play the audio track straight from the video blob URL with no
  // transcode — instant, no memory copy, works at any file size. The final
  // local render resolves the original File anyway, so this only affects
  // preview/timeline playback.
  const localFile = parsed.sourceId ? getLocalSource(parsed.sourceId) : undefined
  if (localFile && localFile.size > LARGE_LOCAL_VIDEO_BYTES) {
    return scrubBlobUrl
  }
  try {
    return (await extractAudio({ input: scrubBlobUrl })).blobUrl
  } catch {
    // Local videos without a decodable audio stream remain video-only.
    return null
  }
}

export async function prepareMediaInsertion(
  channel: Channel,
  parsed: DropClipData,
  opts: DropOptions = {},
): Promise<PreparedMediaInsertion | null> {
  const mediaKind = resolveDropMediaKind(parsed)
  if (channel.locked || !acceptsDropOnChannel(channel, parsed)) return null

  let scrubBlobUrl: string | null = parsed.scrubBlobUrl ?? null
  let sourceDuration = parsed.sourceDuration ?? 0
  if (isLiveSceneFile(parsed.fileName)) {
    const source = await loadLiveScene(parsed.fileName)
    const audioBlobUrl = source.audio && opts.includeAudio !== false ? await getAudioPreview(source.audio.file) : null
    return { parsed, mediaKind: 'video', scrubBlobUrl: null, audioBlobUrl, sourceDuration: source.config.durationInFrames / source.config.fps, sceneAudio: source.audio }
  }
  const aspect = editor.projectAspect
    ?? parsed.projectAspect
    ?? (parsed.sourceWidth && parsed.sourceHeight
      ? parsed.sourceWidth / parsed.sourceHeight < 1
        ? 'portrait'
        : parsed.sourceWidth / parsed.sourceHeight < 1.5 ? 'classic' : 'landscape'
      : 'landscape')

  if (mediaKind === 'image' && sourceDuration <= 0) sourceDuration = 10

  if (mediaKind === 'video' && !scrubBlobUrl) {
    try {
      const mode = parsed.sourceMode ?? parsed.scrubMode
      const localFile = mode === 'wasm' && parsed.sourceId ? getLocalSource(parsed.sourceId) : undefined
      const result = await generateScrub(parsed.fileName, localFile, mode, aspect)
      scrubBlobUrl = result.blobUrl
      sourceDuration = result.duration
    } catch { return null }
  }

  let audioBlobUrl: string | null = null
  const needsVideoAudio = mediaKind === 'video'
    && (channel.type === 'audio' || opts.includeAudio !== false)
  if (needsVideoAudio && scrubBlobUrl) {
    audioBlobUrl = await prepareVideoAudio(parsed, scrubBlobUrl)
  }

  return { parsed, mediaKind, scrubBlobUrl, audioBlobUrl, sourceDuration }
}

export function insertPreparedMedia(
  channel: Channel,
  prepared: PreparedMediaInsertion,
  startSec: number,
  opts: DropOptions = {},
): AddedTimelineMedia | null {
  const { parsed, mediaKind, scrubBlobUrl, audioBlobUrl } = prepared
  if (channel.locked || !acceptsDropOnChannel(channel, parsed)) return null
  if (!editor.projectAspect && parsed.sourceWidth && parsed.sourceHeight) {
    editor.initializeProjectAspect(parsed.sourceWidth, parsed.sourceHeight)
  }

  const sourceDuration = prepared.sourceDuration > 0
    ? prepared.sourceDuration
    : mediaKind === 'image' ? 10 : 5
  const sourceIn = opts.sourceIn ?? 0
  const sourceOut = opts.sourceOut ?? sourceDuration
  const playbackRate = opts.playbackRate ?? 1
  if (
    !Number.isFinite(startSec)
    || !Number.isFinite(sourceIn)
    || !Number.isFinite(sourceOut)
    || !Number.isFinite(playbackRate)
    || startSec < 0
    || sourceIn < 0
    || sourceOut <= sourceIn
    || sourceOut > sourceDuration + 0.001
    || playbackRate < 0.25
    || playbackRate > 4
  ) {
    throw new Error(`Invalid source range for ${parsed.fileName}`)
  }

  const common = {
    fileName: parsed.fileName,
    sourceId: parsed.sourceId,
    sourceMode: parsed.sourceMode ?? parsed.scrubMode,
    sourceDuration,
    inPoint: sourceIn,
    outPoint: sourceOut,
    start: startSec,
    playbackRate,
    ...(opts.volume !== undefined ? { volume: opts.volume } : {}),
  }

  if (channel.type === 'audio') {
    const audioSource = mediaKind === 'video' ? audioBlobUrl : scrubBlobUrl
    if (!audioSource) return null
    const primary = editor.addClipAtValidStart(channel.id, {
      ...common,
      mediaKind: 'audio',
      scrubBlobUrl: audioSource,
      volume: opts.volume ?? 100,
    })
    return { primary }
  }

  const primary = editor.addClipAtValidStart(channel.id, {
    ...common,
    mediaKind,
    scrubBlobUrl,
  })

  let linkedAudio: Clip | undefined
  if (mediaKind === 'video' && opts.includeAudio !== false && audioBlobUrl) {
    linkedAudio = attachPreparedSourceAudio(primary.id, prepared, opts) ?? undefined
  }

  return { primary, linkedAudio }
}

// Adds a Media Bin item using the same preparation and insertion path used by
// AI edits. Audio is paired only after FFmpeg proves the video has audio.
export async function addDroppedClip(
  channel: Channel,
  parsed: DropClipData,
  startSec: number,
  opts: DropOptions = {},
): Promise<AddedTimelineMedia | null> {
  mediaProcessing.begin()
  let longMediaPending = false
  let longMediaIsAudio = false
  let longMediaStartedAt = 0
  try {
    const beginLongMediaProcessing = () => {
      if (longMediaPending) return
      longMediaIsAudio = resolveDropMediaKind(parsed) === 'audio'
      mediaProcessing.beginLongVideo(longMediaIsAudio ? 'audio' : 'video')
      longMediaPending = true
      longMediaStartedAt = Date.now()
    }
    if ((parsed.sourceDuration ?? 0) > LONG_MEDIA_DURATION_SECONDS) {
      beginLongMediaProcessing()
    }

    const deferVideoAudio = channel.type === 'video'
      && resolveDropMediaKind(parsed) === 'video'
      && !isLiveSceneFile(parsed.fileName)
      && opts.includeAudio !== false
    const prepared = await prepareMediaInsertion(channel, parsed, deferVideoAudio ? { ...opts, includeAudio: false } : opts)
    if (!prepared) return null
    if (prepared.sourceDuration > LONG_MEDIA_DURATION_SECONDS) {
      beginLongMediaProcessing()
    }
    const targetChannel = resolveDropChannel(channel, prepared, startSec, opts)
    const added = insertPreparedMedia(targetChannel, prepared, startSec, deferVideoAudio ? { ...opts, includeAudio: false } : opts)
    if (!added || !deferVideoAudio || !prepared.scrubBlobUrl) return added
    if (clipTimelineDuration(added.primary) > LONG_MEDIA_DURATION_SECONDS) beginLongMediaProcessing()

    prepared.audioBlobUrl = await prepareVideoAudio(parsed, prepared.scrubBlobUrl)
    added.linkedAudio = attachPreparedSourceAudio(added.primary.id, prepared, opts) ?? undefined
    return added
  } catch (error) {
    mediaProcessing.reportError(`${parsed.fileName}: ${error instanceof Error ? error.message : 'Could not prepare media'}`)
    return null
  } finally {
    if (longMediaPending) {
      // Direct audio drops finish immediately; keep the friendly feedback visible
      // long enough for the user to register what happened.
      const remaining = MIN_LONG_AUDIO_FEEDBACK_MS - (Date.now() - longMediaStartedAt)
      if (longMediaIsAudio && remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
      mediaProcessing.endLongVideo()
    }
    mediaProcessing.end()
  }
}
