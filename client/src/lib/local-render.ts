import { fetchFile } from '@ffmpeg/util'
import {
  downloadFile,
  type RenderChannelPayload,
  type RenderClipPayload,
  type RenderFormat,
  type RenderPayload,
  type RenderQuality,
  type RenderTextPayload,
} from './api'
import { getLocalSource } from './local-media'
import { buildFilterChain, sanitizeXfade, xfadeFilter } from './effects'
import { createFFmpeg, execGuarded } from './wasm'
import { buildClipTransformFilter } from './ffmpeg-transform'
import { clipFadeIn, clipFadeOut, clipOpacity, hasClipCompositing } from './clip-compositing'
import { isLiveSceneFile, LiveScenePlayer, loadLiveScene } from './live-scene'
import { videoFitFilter, type VideoFit } from './video-fit'

const TRANSITION_EPS = 0.05
const GAP_EPS = 0.01
const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 4
const LOCAL_EXEC_TIMEOUT_MS = 30 * 60 * 1000
const VIDEO_ENCODING_ARGS = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p']
const ALPHA_SCENE_ENCODING_ARGS = ['-c:v', 'qtrle', '-pix_fmt', 'argb']
const PCM_AUDIO_ENCODING_ARGS = ['-c:a', 'pcm_f32le', '-ar', '44100', '-ac', '2']
const AUDIO_CONTINUITY_EPSILON = 0.0001
const VIDEO_EFFECT_WORK_FACTOR = 0.25
const VIDEO_HEAVY_EFFECT_WORK_FACTOR = 1.0
const HEAVY_EFFECT_IDS: ReadonlySet<string> = new Set([
  'blur', 'gaussian-blur', 'directional-blur', 'soft-focus',
  'global-beauty', 'denoise', 'motion-trails', 'frame-echo', 'datamosh',
  'oil-painting', 'watercolor', 'light-rays', 'glow-bloom', 'halation',
  'tilt-shift', 'comic-book', 'neon-edges', 'lens-distortion', 'fisheye',
  'crt-curvature', 'camera-shake', 'gate-weave', 'old-projector',
  'waviness', 'kaleidoscope', 'tiny-planet', 'lens-flare',
  'vhs-tracking', 'vhs-head-noise', 'glitch-bands', 'bad-tv',
])

function segmentEffectsCost(effects: ReadonlyArray<{ id?: string }>): number {
  let cost = 0
  for (const effect of effects) {
    cost += effect?.id && HEAVY_EFFECT_IDS.has(effect.id)
      ? VIDEO_HEAVY_EFFECT_WORK_FACTOR
      : VIDEO_EFFECT_WORK_FACTOR
  }
  return cost
}
const VIDEO_MASK_WORK_FACTOR = 0.08
const AUDIO_WORK_FACTOR = 0.12
const SILENCE_WORK_FACTOR = 0.02
const FINAL_AUDIO_WORK_FACTOR = 0.04

const OUTPUT_PROFILES: Record<RenderQuality, {
  mp4Crf: string
  aviQuality: string
  audioBitrate: string
}> = {
  low: { mp4Crf: '30', aviQuality: '8', audioBitrate: '96k' },
  normal: { mp4Crf: '23', aviQuality: '5', audioBitrate: '160k' },
  high: { mp4Crf: '18', aviQuality: '2', audioBitrate: '256k' },
}

const OUTPUT_MIME: Record<RenderFormat, string> = {
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
}

type FFmpegInstance = Awaited<ReturnType<typeof createFFmpeg>>

interface TrackGroup {
  file: string
  start: number
  duration: number
}

interface VideoTrackGroup extends TrackGroup {
  maskFile: string
}

interface VideoTrack {
  file: string
  maskFile: string
  channel: RenderChannelPayload
}

export interface LocalRenderProgress {
  ratio: number
  message: string
}

export interface LocalRenderOptions {
  onProgress?: (progress: LocalRenderProgress) => void
  resolveSource?: (fileName: string, clip?: RenderClipPayload) => Promise<Blob | File>
}

interface RenderContext {
  inst: FFmpegInstance
  file(stem: string, extension: string): string
  write(name: string, data: Uint8Array<ArrayBuffer>): Promise<void>
  remove(...names: string[]): Promise<void>
  run(args: string[], message: string, work?: number): Promise<void>
  concat(inputs: string[], output: string, label: string): Promise<void>
  cleanup(): Promise<void>
}

let renderSequence = 0

function fmt(value: number): string {
  return String(Number(value.toFixed(6)))
}

function sourceDuration(clip: RenderClipPayload): number {
  return clip.outPoint - clip.inPoint
}

function playbackRate(clip: RenderClipPayload): number {
  const rate = clip.playbackRate ?? 1
  return Number.isFinite(rate) ? Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, rate)) : 1
}

function clipDuration(clip: RenderClipPayload): number {
  return sourceDuration(clip) / playbackRate(clip)
}

function clipEnd(clip: RenderClipPayload): number {
  return clip.start + clipDuration(clip)
}

function videoSegmentFrameCount(
  clip: RenderClipPayload,
  srcStart: number,
  srcEnd: number,
  fps: number,
): number {
  const rate = playbackRate(clip)
  const startFrame = Math.round(Math.max(0, (srcStart - clip.inPoint) / rate) * fps)
  const endFrame = Math.round(Math.max(0, (srcEnd - clip.inPoint) / rate) * fps)
  return Math.max(0, endFrame - startFrame)
}

function exactVideoFrameFilter(fps: number, frameCount: number): string {
  return `tpad=stop_mode=clone:stop=-1,trim=end_frame=${frameCount},setpts=N/(${fps}*TB)`
}

function clipMaskFilter(
  clip: RenderClipPayload,
  width: number,
  height: number,
  fps: number,
  fit: VideoFit,
): string {
  const duration = clipDuration(clip)
  const frameCount = videoSegmentFrameCount(clip, clip.inPoint, clip.outPoint, fps)
  const transform = buildClipTransformFilter(
    clip,
    width,
    height,
    0,
    duration,
    fps,
    'mask_transform_shear',
  )
  const filters = [
    `setpts=(PTS-STARTPTS)/${fmt(playbackRate(clip))}`,
    'format=rgba',
    'alphaextract',
    videoFitFilter(width, height, fit, { padColor: 'black' }),
    `fps=${fps}`,
    transform,
  ].filter(Boolean)
  const opacity = clipOpacity(clip)
  const fadeIn = clipFadeIn(clip)
  const fadeOut = clipFadeOut(clip)
  if (opacity < 1) filters.push(`lut=y='val*${fmt(opacity)}'`)
  if (fadeIn > 0) filters.push(`fade=t=in:st=0:d=${fmt(fadeIn)}:color=black`)
  if (fadeOut > 0) filters.push(`fade=t=out:st=${fmt(duration - fadeOut)}:d=${fmt(fadeOut)}:color=black`)
  filters.push(exactVideoFrameFilter(fps, frameCount))
  return filters.join(',')
}

function clipGain(clip: RenderClipPayload): number {
  return Math.max(0, Math.min(200, clip.volume ?? 100)) / 100
}

function atempoFilters(rate: number): string[] {
  const filters: string[] = []
  let remaining = rate
  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  while (remaining > 2) {
    filters.push('atempo=2')
    remaining /= 2
  }
  if (remaining !== 1) filters.push(`atempo=${fmt(remaining)}`)
  return filters
}

function sourceExtension(fileName: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName)
  return match ? `.${match[1].toLowerCase()}` : '.bin'
}

function sortedClips(clips: RenderClipPayload[]): RenderClipPayload[] {
  return [...clips].sort((left, right) => left.start - right.start)
}

function coalesceContinuousAudioClips(clips: RenderClipPayload[]): RenderClipPayload[] {
  // A visual cut must not create a new decoder/encoder boundary in unchanged audio.
  const merged: RenderClipPayload[] = []
  for (const clip of sortedClips(clips)) {
    const previous = merged.at(-1)
    const isContinuous = previous
      && previous.file === clip.file
      && previous.sourceMode === clip.sourceMode
      && previous.sourceId === clip.sourceId
      && previous.mediaKind === clip.mediaKind
      && Math.abs(clipEnd(previous) - clip.start) <= AUDIO_CONTINUITY_EPSILON
      && Math.abs(previous.outPoint - clip.inPoint) <= AUDIO_CONTINUITY_EPSILON
      && Math.abs(playbackRate(previous) - playbackRate(clip)) <= Number.EPSILON
      && Math.abs(clipGain(previous) - clipGain(clip)) <= Number.EPSILON
    if (isContinuous) {
      previous.outPoint = clip.outPoint
    } else {
      merged.push({ ...clip })
    }
  }
  return merged
}

function groupOverlapping(clips: RenderClipPayload[]): Array<[number, number]> {
  const groups: Array<[number, number]> = []
  for (let i = 0; i < clips.length;) {
    let end = i
    while (end + 1 < clips.length && clips[end + 1].start < clipEnd(clips[end]) - TRANSITION_EPS) {
      end++
    }
    groups.push([i, end])
    i = end + 1
  }
  return groups
}

function activeExpression(clips: RenderClipPayload[]): string {
  const intervals: Array<[number, number]> = []
  for (const clip of clips) {
    const start = clip.start
    const end = clipEnd(clip)
    if (end <= start) continue
    const previous = intervals.at(-1)
    if (previous && start <= previous[1]) {
      if (end > previous[1]) previous[1] = end
      continue
    }
    intervals.push([start, end])
  }
  return intervals.map(([start, end]) => `between(t,${fmt(start)},${fmt(end)})`).join('+')
}

function timelineGroupWork(clips: RenderClipPayload[], totalDuration: number, factor: number): number {
  let work = 0
  let cursor = 0
  const gapFactor = factor === 1
    ? 1
    : factor === VIDEO_MASK_WORK_FACTOR ? VIDEO_MASK_WORK_FACTOR : SILENCE_WORK_FACTOR
  for (const [start, end] of groupOverlapping(clips)) {
    const groupClips = clips.slice(start, end + 1)
    const groupStart = groupClips[0].start
    const groupDuration = clipEnd(groupClips.at(-1)!) - groupStart
    if (groupClips.length > 1) work += groupDuration * factor
    if (groupStart - cursor > GAP_EPS) work += (groupStart - cursor) * gapFactor
    cursor = Math.max(cursor, groupStart + groupDuration)
  }
  if (totalDuration - cursor > GAP_EPS) {
    work += (totalDuration - cursor) * gapFactor
  }
  return work
}

function estimateLocalRenderWork(payload: RenderPayload, totalDuration: number): number {
  const videoChannels = payload.format === 'mp3'
    ? []
    : payload.videoChannels.filter((channel) => channel.clips.length > 0)
  const audioChannels = payload.audioChannels.filter((channel) => channel.clips.length > 0)
  let work = 0

  for (const channel of videoChannels) {
    const clips = sortedClips(channel.clips)
    for (const clip of clips) {
      const segments = clip.segments.length > 0
        ? clip.segments
        : [{ srcStart: clip.inPoint, srcEnd: clip.outPoint, effects: [] }]
      for (const segment of segments) {
        const duration = Math.max(0, segment.srcEnd - segment.srcStart) / playbackRate(clip)
        work += duration * (1 + segmentEffectsCost(segment.effects))
      }
      work += clipDuration(clip) * VIDEO_MASK_WORK_FACTOR
    }
    work += timelineGroupWork(clips, totalDuration, 1)
    work += timelineGroupWork(clips, totalDuration, VIDEO_MASK_WORK_FACTOR)
  }
  const baseCompositingStages = videoChannels[0]?.clips.some(hasClipCompositing) ? 1 : 0
  work += (Math.max(0, videoChannels.length - 1) + baseCompositingStages) * totalDuration

  const textItems = payload.format === 'mp3' ? [] : payload.textItems ?? []
  if (videoChannels.length === 0 && textItems.length > 0) work += totalDuration
  if (textItems.length > 0) work += totalDuration * (1 + Math.min(textItems.length, 20) * 0.01)

  for (const channel of audioChannels) {
    const clips = coalesceContinuousAudioClips(channel.clips)
    work += clips.reduce((sum, clip) => sum + clipDuration(clip) * AUDIO_WORK_FACTOR, 0)
    work += timelineGroupWork(clips, totalDuration, AUDIO_WORK_FACTOR)
  }
  work += Math.max(0, audioChannels.length - 1) * totalDuration * AUDIO_WORK_FACTOR
  work += totalDuration * (audioChannels.length > 0 ? FINAL_AUDIO_WORK_FACTOR : 0.01)
  if (payload.format !== 'mp3' && (videoChannels.length > 0 || textItems.length > 0)) work += totalDuration

  return Math.max(work, 0.25)
}

function createContext(
  inst: FFmpegInstance,
  prefix: string,
  estimatedWork: number,
  onProgress?: (progress: LocalRenderProgress) => void,
): RenderContext {
  const files = new Set<string>()
  let fileSequence = 0
  let completedWork = 0
  let lastRatio = 0.03

  const report = (ratio: number, message: string) => {
    const renderRatio = 0.03 + Math.min(1, ratio) * 0.96
    lastRatio = Math.max(lastRatio, Math.min(0.99, renderRatio))
    onProgress?.({ ratio: lastRatio, message })
  }

  const remove = async (...names: string[]) => {
    if (!inst.loaded) return
    for (const name of new Set(names)) {
      if (!files.has(name)) continue
      try {
        await inst.deleteFile(name)
        files.delete(name)
      } catch {
        // A final cleanup pass retries files that are still in use.
      }
    }
  }

  return {
    inst,
    file(stem, extension) {
      const name = `${prefix}_${stem}_${++fileSequence}${extension}`
      files.add(name)
      return name
    },
    async write(name, data) {
      files.add(name)
      await inst.writeFile(name, data)
    },
    remove,
    async run(args, message, work = 0) {
      const workStart = completedWork
      report(workStart / estimatedWork, message)
      try {
        await execGuarded(
          inst,
          args,
          (ratio) => report((workStart + ratio * work) / estimatedWork, message),
          LOCAL_EXEC_TIMEOUT_MS,
        )
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`${message}: ${detail}`)
      }
      completedWork += work
      report(completedWork / estimatedWork, message)
    },
    async concat(inputs, output, label) {
      if (inputs.length === 0) throw new Error(`${label}: no input files`)
      const list = `${output}.txt`
      files.add(list)
      const body = inputs.map((input) => `file '${input}'\n`).join('')
      try {
        await inst.writeFile(list, new TextEncoder().encode(body))
        await this.run([
          '-f', 'concat', '-safe', '0', '-i', list,
          '-c', 'copy', '-y', output,
        ], label)
      } finally {
        await remove(list)
      }
    },
    async cleanup() {
      await remove(...files)
    },
  }
}

async function writeSource(
  context: RenderContext,
  source: Blob | File,
  fileName: string,
  stem: string,
): Promise<string> {
  const input = context.file(stem, sourceExtension(fileName))
  await context.write(input, await fetchFile(source) as Uint8Array<ArrayBuffer>)
  return input
}

async function renderXfadeGroup(
  context: RenderContext,
  clips: RenderClipPayload[],
  inputs: string[],
  fps: number,
  globalStart: number,
  xfadeByRight: Map<number, string>,
  label: string,
  stem = 'video_xfade',
  workFactor = 1,
): Promise<string> {
  const args: string[] = []
  for (const input of inputs) args.push('-i', input)

  const filters: string[] = inputs.map(
    (_, index) => `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${fps},format=rgb24,format=yuv444p[v${index}]`,
  )
  let current = '[v0]'
  let accumulatedDuration = clipDuration(clips[0])
  for (let i = 1; i < clips.length; i++) {
    let overlap = clipEnd(clips[i - 1]) - clips[i].start
    overlap = Math.min(overlap, clipDuration(clips[i]) - TRANSITION_EPS)
    overlap = Math.min(overlap, accumulatedDuration - TRANSITION_EPS)
    const offset = accumulatedDuration - overlap
    const outputLabel = `[vx${i}]`
    const transition = xfadeByRight.get(globalStart + i) ?? 'fade'
    filters.push(
      `${current}[v${i}]xfade=${xfadeFilter(transition)}:duration=${fmt(overlap)}:offset=${fmt(offset)}${outputLabel}`,
    )
    current = outputLabel
    accumulatedDuration += clipDuration(clips[i]) - overlap
  }

  const output = context.file(stem, '.mp4')
  await context.run([
    ...args,
    '-filter_complex_threads', '1',
    '-filter_complex', filters.join(';'),
    '-map', current,
    ...VIDEO_ENCODING_ARGS,
    '-r', String(fps), '-an', '-threads', '1',
    '-y', output,
  ], label, accumulatedDuration * workFactor)
  return output
}

async function generateBlackVideo(
  context: RenderContext,
  duration: number,
  width: number,
  height: number,
  fps: number,
  workFactor = 1,
): Promise<string> {
  const output = context.file('black', '.mp4')
  await context.run([
    '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
    '-t', fmt(duration),
    ...VIDEO_ENCODING_ARGS,
    '-an', '-threads', '1', '-y', output,
  ], 'rendering black video', duration * workFactor)
  return output
}

async function buildVideoTrack(
  context: RenderContext,
  channel: RenderChannelPayload,
  channelIndex: number,
  width: number,
  height: number,
  fps: number,
  totalDuration: number,
  resolveSource: (clip: RenderClipPayload) => Promise<Blob | File>,
  fit: VideoFit,
): Promise<VideoTrack> {
  const clips = sortedClips(channel.clips)
  const sortedChannel = { ...channel, clips }
  const xfadeByRight = new Map<number, string>()
  for (const transition of channel.transitions ?? []) {
    xfadeByRight.set(transition.rightClipIndex, sanitizeXfade(transition.xfade))
  }

  const scaleFilter = `${videoFitFilter(width, height, fit)},fps=${fps}`
  const clipFiles: string[] = []
  const maskFiles: string[] = []

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex]
    const input = await writeSource(
      context,
      await resolveSource(clip),
      clip.file,
      `video_${channelIndex}_${clipIndex}_source`,
    )
    const segments = clip.segments.length > 0
      ? clip.segments
      : [{ srcStart: clip.inPoint, srcEnd: clip.outPoint, effects: [] }]
    const segmentFiles: string[] = []

    try {
      const rate = playbackRate(clip)
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segment = segments[segmentIndex]
        const sourceSegmentDuration = segment.srcEnd - segment.srcStart
        if (sourceSegmentDuration <= 0) continue
        const frameCount = videoSegmentFrameCount(clip, segment.srcStart, segment.srcEnd, fps)
        if (frameCount === 0) continue
        const timelineSegmentDuration = sourceSegmentDuration / rate
        const segmentOffset = Math.max(0, (segment.srcStart - clip.inPoint) / rate)
        const output = context.file('video_segment', '.mp4')
        const effectFilter = buildFilterChain(segment.effects, timelineSegmentDuration)
        const transformFilter = buildClipTransformFilter(
          clip,
          width,
          height,
          segmentOffset,
          timelineSegmentDuration,
          fps,
        )
        const filter = [
          `setpts=(PTS-STARTPTS)/${fmt(rate)}`,
          `fps=${fps}`,
          effectFilter,
          scaleFilter,
          transformFilter,
          exactVideoFrameFilter(fps, frameCount),
        ].filter(Boolean).join(',')
        const sourceArgs = clip.mediaKind === 'image'
          ? ['-loop', '1', '-i', input]
          : ['-ss', fmt(segment.srcStart), '-t', fmt(sourceSegmentDuration), '-i', input]
        await context.run([
          ...sourceArgs,
          ...(clip.mediaKind === 'image' ? ['-t', fmt(timelineSegmentDuration)] : []),
          '-vf', filter,
          ...VIDEO_ENCODING_ARGS, '-an', '-r', String(fps), '-threads', '1',
          '-y', output,
        ], `rendering video clip ${clipIndex + 1}, segment ${segmentIndex + 1}`,
          timelineSegmentDuration * (1 + segmentEffectsCost(segment.effects)))
        segmentFiles.push(output)
      }

      const maskOutput = context.file('video_mask_clip', '.mp4')
      const maskSourceArgs = clip.mediaKind === 'image'
        ? ['-loop', '1', '-i', input, '-t', fmt(clipDuration(clip))]
        : ['-ss', fmt(clip.inPoint), '-t', fmt(sourceDuration(clip)), '-i', input]
      await context.run([
        ...maskSourceArgs,
        '-vf', clipMaskFilter(clip, width, height, fps, fit),
        ...VIDEO_ENCODING_ARGS, '-an', '-r', String(fps), '-threads', '1',
        '-y', maskOutput,
      ], `rendering video clip ${clipIndex + 1} alpha mask`, clipDuration(clip) * VIDEO_MASK_WORK_FACTOR)
      maskFiles.push(maskOutput)
    } finally {
      await context.remove(input)
    }

    if (segmentFiles.length === 0) throw new Error(`video clip ${clipIndex + 1} produced no segments`)
    const clipOutput = context.file('video_clip', '.mp4')
    await context.concat(segmentFiles, clipOutput, `joining video clip ${clipIndex + 1}`)
    await context.remove(...segmentFiles)
    clipFiles.push(clipOutput)
  }

  const groups: VideoTrackGroup[] = []
  for (const [groupIndex, [start, end]] of groupOverlapping(clips).entries()) {
    const groupClips = clips.slice(start, end + 1)
    if (groupClips.length === 1) {
      groups.push({
        file: clipFiles[start],
        maskFile: maskFiles[start],
        start: groupClips[0].start,
        duration: clipDuration(groupClips[0]),
      })
      continue
    }
    const inputs = clipFiles.slice(start, end + 1)
    const maskInputs = maskFiles.slice(start, end + 1)
    const output = await renderXfadeGroup(
      context,
      groupClips,
      inputs,
      fps,
      start,
      xfadeByRight,
      `rendering video transition group ${groupIndex + 1}`,
    )
    const maskOutput = await renderXfadeGroup(
      context,
      groupClips,
      maskInputs,
      fps,
      start,
      xfadeByRight,
      `rendering video transition mask ${groupIndex + 1}`,
      'video_mask_xfade',
      VIDEO_MASK_WORK_FACTOR,
    )
    await context.remove(...inputs, ...maskInputs)
    groups.push({
      file: output,
      maskFile: maskOutput,
      start: groupClips[0].start,
      duration: clipEnd(groupClips.at(-1)!) - groupClips[0].start,
    })
  }

  const pieces: string[] = []
  const maskPieces: string[] = []
  let cursor = 0
  for (const group of groups) {
    const gap = group.start - cursor
    if (gap > GAP_EPS) {
      pieces.push(await generateBlackVideo(context, gap, width, height, fps))
      maskPieces.push(await generateBlackVideo(context, gap, width, height, fps, VIDEO_MASK_WORK_FACTOR))
    }
    pieces.push(group.file)
    maskPieces.push(group.maskFile)
    cursor = Math.max(cursor, group.start + group.duration)
  }
  const finalGap = totalDuration - cursor
  if (finalGap > GAP_EPS) {
    pieces.push(await generateBlackVideo(context, finalGap, width, height, fps))
    maskPieces.push(await generateBlackVideo(context, finalGap, width, height, fps, VIDEO_MASK_WORK_FACTOR))
  }

  const output = context.file(`video_track_${channelIndex}`, '.mp4')
  const maskOutput = context.file(`video_mask_track_${channelIndex}`, '.mp4')
  await context.concat(pieces, output, `joining video channel ${channelIndex + 1}`)
  await context.concat(maskPieces, maskOutput, `joining video channel ${channelIndex + 1} alpha mask`)
  await context.remove(...pieces, ...maskPieces)
  return { file: output, maskFile: maskOutput, channel: sortedChannel }
}

async function compositeVideoTracks(
  context: RenderContext,
  tracks: VideoTrack[],
  width: number,
  height: number,
  fps: number,
  totalDuration: number,
): Promise<string> {
  if (tracks.length === 0) throw new Error('video channels produced no files')
  let current = tracks[0].file
  // FFmpeg's overlay ends with the main input even when another layer is longer.
  const frameCount = Math.max(1, Math.round(totalDuration * fps))
  const baseFilter = `[0:v]setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=add:stop=-1,trim=end_frame=${frameCount},setpts=N/(${fps}*TB)[base];`
  if (tracks[0].channel.clips.some(hasClipCompositing)) {
    const output = context.file('video_composite_base', '.mp4')
    const filter = baseFilter + '[1:v]setpts=PTS-STARTPTS[top];[2:v]setpts=PTS-STARTPTS,format=gray[mask];[top][mask]alphamerge[layer];[base][layer]overlay=eof_action=pass:format=auto[v]'
    await context.run([
      '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${fmt(totalDuration)}`,
      '-i', current, '-i', tracks[0].maskFile,
      '-filter_complex_threads', '1', '-filter_complex', filter,
      '-map', '[v]', '-t', fmt(totalDuration), '-an',
      ...VIDEO_ENCODING_ARGS,
      '-r', String(fps), '-s', `${width}x${height}`, '-threads', '1',
      '-y', output,
    ], 'compositing base video channel', totalDuration)
    await context.remove(current, tracks[0].maskFile)
    current = output
  } else {
    await context.remove(tracks[0].maskFile)
  }
  for (let index = 1; index < tracks.length; index++) {
    const top = tracks[index]
    const enable = activeExpression(top.channel.clips)
    if (!enable) {
      await context.remove(top.file, top.maskFile)
      continue
    }
    const output = context.file('video_composite', '.mp4')
    const filter = baseFilter + `[1:v]setpts=PTS-STARTPTS[top];[2:v]setpts=PTS-STARTPTS,format=gray[mask];[top][mask]alphamerge[layer];[base][layer]overlay=eof_action=pass:format=auto:enable='${enable}'[v]`
    await context.run([
      '-i', current, '-i', top.file, '-i', top.maskFile,
      '-filter_complex_threads', '1', '-filter_complex', filter,
      '-map', '[v]', '-an',
      ...VIDEO_ENCODING_ARGS,
      '-r', String(fps), '-s', `${width}x${height}`, '-threads', '1',
      '-y', output,
    ], `compositing video channel ${index + 1}`, totalDuration)
    await context.remove(current, top.file, top.maskFile)
    current = output
  }
  return current
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function textOverlayX(item: RenderTextPayload): string {
  const x = Math.round(item.x)
  const motionStart = item.motionStart ?? item.start
  const motionSpan = item.motionDuration ?? item.duration
  if (item.animation === 'shake') {
    const motionDuration = Math.min(item.animationDuration ?? 0.45, motionSpan / 2)
    if (motionDuration <= 0) return String(x)
    const enterEnd = motionStart + motionDuration
    const enterProgress = `(t-${fmt(motionStart)})/${fmt(motionDuration)}`
    return `'if(lt(t,${fmt(enterEnd)}),${x}-0.08*w*cos(6*PI*${enterProgress})*pow(1-${enterProgress},2),${x})'`
  }
  if (item.animation !== 'slide-left' && item.animation !== 'slide-right') return String(x)
  const motionDuration = Math.min(item.animationDuration ?? 0.45, motionSpan / 2)
  if (motionDuration <= 0) return String(x)
  const enterEnd = motionStart + motionDuration
  const end = motionStart + motionSpan
  const exitStart = end - motionDuration
  const enterProgress = `(t-${fmt(motionStart)})/${fmt(motionDuration)}`
  const exitProgress = `(t-${fmt(exitStart)})/${fmt(motionDuration)}`
  const distance = item.animation === 'slide-left' ? `-(${x}+w)` : `+(W-${x})`
  return `'if(lt(t,${fmt(enterEnd)}),${x}${distance}*pow(1-${enterProgress},3),if(lt(t,${fmt(exitStart)}),${x},${x}${distance}*pow(${exitProgress},3)))'`
}

function textOverlayY(item: RenderTextPayload): string {
  const y = Math.round(item.y)
  const motionStart = item.motionStart ?? item.start
  const motionSpan = item.motionDuration ?? item.duration
  if (item.animation === 'float') {
    return `'${y}+0.025*H*(1-2*(t-${fmt(motionStart)})/${fmt(motionSpan)})'`
  }
  if (item.animation !== 'rise' && item.animation !== 'pop' && item.animation !== 'drop' && item.animation !== 'bounce') return String(y)
  const motionDuration = Math.min(item.animationDuration ?? 0.45, motionSpan / 2)
  if (motionDuration <= 0) return String(y)
  const enterEnd = motionStart + motionDuration
  const exitStart = motionStart + motionSpan - motionDuration
  const enterProgress = `(t-${fmt(motionStart)})/${fmt(motionDuration)}`
  const exitProgress = `(t-${fmt(exitStart)})/${fmt(motionDuration)}`
  const distance = item.animation === 'pop' ? '0.07*H' : item.animation === 'bounce' ? '0.08*H' : '0.12*H'
  const direction = item.animation === 'drop' ? '-' : '+'
  const entrance = item.animation === 'pop'
    ? `${distance}*pow(1-${enterProgress},5)`
    : item.animation === 'bounce'
      ? `${distance}*cos(3*PI*${enterProgress})*pow(1-${enterProgress},2)`
      : `${distance}*pow(1-${enterProgress},3)`
  return `'if(lt(t,${fmt(enterEnd)}),${y}${direction}${entrance},if(lt(t,${fmt(exitStart)}),${y},${y}${direction}${distance}*pow(${exitProgress},3)))'`
}

async function overlayTextItems(
  context: RenderContext,
  input: string,
  items: RenderTextPayload[],
  width: number,
  height: number,
  fps: number,
  totalDuration: number,
): Promise<string> {
  const args = ['-i', input]
  const filters = ['[0:v]setpts=PTS-STARTPTS[v0]']
  const images: string[] = []
  let overlayCount = 0
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (item.duration <= 0 || !item.image) continue
    const image = context.file(`text_${index}`, '.png')
    await context.write(image, decodeBase64(item.image))
    images.push(image)
    args.push('-loop', '1', '-i', image)
    const end = item.start + item.duration
    const inputIndex = images.length
    filters.push(`[${inputIndex}:v]format=rgba[text${overlayCount}]`)
    filters.push(`[v${overlayCount}][text${overlayCount}]overlay=x=${textOverlayX(item)}:y=${textOverlayY(item)}:eof_action=pass:enable='gte(t,${fmt(item.start)})*lt(t,${fmt(end)})'[v${overlayCount + 1}]`)
    overlayCount++
  }
  if (overlayCount === 0) return input
  const output = context.file('text_overlay', '.mp4')
  await context.run([
    ...args,
    '-filter_complex_threads', '1', '-filter_complex', filters.join(';'),
    '-map', `[v${overlayCount}]`, '-t', fmt(totalDuration), '-an',
    ...VIDEO_ENCODING_ARGS,
    '-r', String(fps), '-s', `${width}x${height}`, '-threads', '1',
    '-y', output,
  ], `rendering ${overlayCount} text layers`, totalDuration * (1 + Math.min(overlayCount, 20) * 0.01))
  await context.remove(input, ...images)
  return output
}

async function renderAcrossfadeGroup(
  context: RenderContext,
  clips: RenderClipPayload[],
  inputs: string[],
  label: string,
): Promise<string> {
  const args: string[] = []
  for (const input of inputs) args.push('-i', input)
  const filters = inputs.map(
    (_, index) => `[${index}:a]asettb=AVTB,asetpts=PTS-STARTPTS[a${index}]`,
  )

  let current = '[a0]'
  let accumulatedDuration = clipDuration(clips[0])
  for (let index = 1; index < clips.length; index++) {
    let overlap = clipEnd(clips[index - 1]) - clips[index].start
    overlap = Math.min(overlap, clipDuration(clips[index]) - TRANSITION_EPS)
    overlap = Math.min(overlap, accumulatedDuration - TRANSITION_EPS)
    const outputLabel = `[ax${index}]`
    filters.push(`${current}[a${index}]acrossfade=d=${fmt(overlap)}${outputLabel}`)
    current = outputLabel
    accumulatedDuration += clipDuration(clips[index]) - overlap
  }

  const output = context.file('audio_xfade', '.w64')
  await context.run([
    ...args,
    '-filter_complex_threads', '1', '-filter_complex', filters.join(';'),
    '-map', current,
    ...PCM_AUDIO_ENCODING_ARGS,
    '-y', output,
  ], label, accumulatedDuration * AUDIO_WORK_FACTOR)
  return output
}

async function generateSilence(context: RenderContext, duration: number): Promise<string> {
  const output = context.file('silence', '.w64')
  await context.run([
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', fmt(duration), ...PCM_AUDIO_ENCODING_ARGS,
    '-y', output,
  ], 'rendering silence', duration * SILENCE_WORK_FACTOR)
  return output
}

async function buildAudioTrack(
  context: RenderContext,
  channel: RenderChannelPayload,
  channelIndex: number,
  totalDuration: number,
  resolveSource: (clip: RenderClipPayload) => Promise<Blob | File>,
): Promise<string> {
  const clips = coalesceContinuousAudioClips(channel.clips)
  const keptClips: RenderClipPayload[] = []
  const audioFiles: string[] = []

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex]
    const duration = sourceDuration(clip)
    if (duration <= 0) continue
    const audioFilters = [
      ...atempoFilters(playbackRate(clip)),
      `volume=${fmt(clipGain(clip))}`,
    ]
    const input = await writeSource(
      context,
      await resolveSource(clip),
      clip.file,
      `audio_${channelIndex}_${clipIndex}_source`,
    )
    const output = context.file('audio_clip', '.w64')
    try {
      await context.run([
        '-ss', fmt(clip.inPoint), '-t', fmt(duration), '-i', input,
        '-af', audioFilters.join(','),
        '-vn', ...PCM_AUDIO_ENCODING_ARGS,
        '-y', output,
      ], `rendering audio clip ${clipIndex + 1}`, clipDuration(clip) * AUDIO_WORK_FACTOR)
    } finally {
      await context.remove(input)
    }
    keptClips.push(clip)
    audioFiles.push(output)
  }

  const groups: TrackGroup[] = []
  for (const [groupIndex, [start, end]] of groupOverlapping(keptClips).entries()) {
    const groupClips = keptClips.slice(start, end + 1)
    if (groupClips.length === 1) {
      groups.push({ file: audioFiles[start], start: groupClips[0].start, duration: clipDuration(groupClips[0]) })
      continue
    }
    const inputs = audioFiles.slice(start, end + 1)
    const output = await renderAcrossfadeGroup(
      context,
      groupClips,
      inputs,
      `rendering audio transition group ${groupIndex + 1}`,
    )
    await context.remove(...inputs)
    groups.push({
      file: output,
      start: groupClips[0].start,
      duration: clipEnd(groupClips.at(-1)!) - groupClips[0].start,
    })
  }

  const pieces: string[] = []
  let cursor = 0
  for (const group of groups) {
    const gap = group.start - cursor
    if (gap > GAP_EPS) pieces.push(await generateSilence(context, gap))
    pieces.push(group.file)
    cursor = Math.max(cursor, group.start + group.duration)
  }
  const finalGap = totalDuration - cursor
  if (finalGap > GAP_EPS) pieces.push(await generateSilence(context, finalGap))
  if (pieces.length === 0) throw new Error('audio track produced no pieces')

  const output = context.file(`audio_track_${channelIndex}`, '.w64')
  await context.concat(pieces, output, `joining audio channel ${channelIndex + 1}`)
  await context.remove(...pieces)
  return output
}

async function mixAudioTracks(context: RenderContext, inputs: string[], totalDuration: number): Promise<string> {
  if (inputs.length === 0) throw new Error('audio channels produced no files')
  if (inputs.length === 1) return inputs[0]

  const args: string[] = []
  const filters: string[] = []
  const labels: string[] = []
  for (let index = 0; index < inputs.length; index++) {
    args.push('-i', inputs[index])
    const label = `[a${index}]`
    filters.push(`[${index}:a]asetpts=PTS-STARTPTS${label}`)
    labels.push(label)
  }
  filters.push(
    `${labels.join('')}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0:normalize=0[a]`,
  )

  const output = context.file('audio_mix', '.w64')
  await context.run([
    ...args,
    '-filter_complex_threads', '1', '-filter_complex', filters.join(';'),
    '-map', '[a]', ...PCM_AUDIO_ENCODING_ARGS,
    '-threads', '1', '-y', output,
  ], 'mixing audio channels', totalDuration * AUDIO_WORK_FACTOR)
  await context.remove(...inputs)
  return output
}

async function finalizeOutput(
  context: RenderContext,
  videoFile: string | null,
  audioFile: string | null,
  totalDuration: number,
  format: RenderFormat,
  quality: RenderQuality,
): Promise<string> {
  const output = context.file('render_output', `.${format}`)
  const profile = OUTPUT_PROFILES[quality]
  const videoArgs = format === 'avi'
    ? ['-c:v', 'mpeg4', '-q:v', profile.aviQuality]
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', profile.mp4Crf, '-pix_fmt', 'yuv420p']
  const audioArgs = format === 'avi'
    ? ['-c:a', 'libmp3lame', '-b:a', profile.audioBitrate, '-ar', '44100', '-ac', '2']
    : ['-c:a', 'aac', '-b:a', profile.audioBitrate, '-ar', '44100', '-ac', '2']

  if (format === 'mp3') {
    if (!audioFile) throw new Error('MP3 export requires at least one active audio track')
    await context.run([
      '-i', audioFile, '-map', '0:a:0', '-vn',
      '-c:a', 'libmp3lame', '-b:a', profile.audioBitrate, '-ar', '44100', '-ac', '2',
      '-y', output,
    ], 'finalizing MP3 audio', totalDuration * FINAL_AUDIO_WORK_FACTOR)
    await context.remove(audioFile)
    return output
  }

  if (videoFile && audioFile) {
    await context.run([
      '-i', videoFile, '-i', audioFile,
      '-map', '0:v:0', '-map', '1:a:0',
      ...videoArgs, ...audioArgs,
      '-y', output,
    ], `finalizing ${format.toUpperCase()} video and audio`, totalDuration)
    await context.remove(videoFile, audioFile)
    return output
  }
  if (videoFile) {
    await context.run([
      '-i', videoFile, ...videoArgs, '-an', '-y', output,
    ], `finalizing ${format.toUpperCase()} video`, totalDuration)
    await context.remove(videoFile)
    return output
  }
  if (audioFile) {
    await context.run([
      '-i', audioFile, '-map', '0:a:0', '-vn',
      ...audioArgs, '-y', output,
    ], `finalizing ${format.toUpperCase()} audio`, totalDuration * FINAL_AUDIO_WORK_FACTOR)
    await context.remove(audioFile)
    return output
  }
  throw new Error('no rendered tracks')
}

export async function compileProjectLocal(
  payload: RenderPayload,
  options: LocalRenderOptions = {},
): Promise<{ blob: Blob; filename: string }> {
  const format = payload.format ?? 'mp4'
  const quality = payload.quality ?? 'normal'
  if (!(format in OUTPUT_MIME)) throw new Error('unsupported export format')
  if (!(quality in OUTPUT_PROFILES)) throw new Error('unsupported export quality')

  const videoChannels = format === 'mp3'
    ? []
    : payload.videoChannels.filter((channel) => channel.clips.length > 0)
  const audioChannels = payload.audioChannels.filter((channel) => channel.clips.length > 0)
  const textItems = format === 'mp3' ? [] : payload.textItems ?? []
  if (videoChannels.length === 0 && audioChannels.length === 0 && textItems.length === 0) throw new Error('nothing to render')
  if (format !== 'mp3' && (payload.resolution.w <= 0 || payload.resolution.h <= 0)) throw new Error('invalid resolution')
  if (textItems.length > 500) throw new Error('too many rendered text layers')

  const fps = payload.fps > 0 ? payload.fps : 30
  const allClips = [...videoChannels, ...audioChannels].flatMap((channel) => channel.clips)
  const clipDurationTotal = allClips.reduce((duration, clip) => Math.max(duration, clipEnd(clip)), 0)
  const totalDuration = textItems.reduce(
    (duration, item) => Math.max(duration, item.start + item.duration),
    clipDurationTotal,
  )
  const sourceCache = new Map<string, Promise<Blob | File>>()
  const resolveSource = (clip: RenderClipPayload): Promise<Blob | File> => {
    const sourceKey = clip.sourceMode === 'wasm'
      ? `wasm:${clip.sourceId ?? ''}`
      : `proxy:${clip.file}`
    let source = sourceCache.get(sourceKey)
    if (!source) {
      if (options.resolveSource) {
        source = options.resolveSource(clip.file, clip)
      } else if (clip.sourceMode === 'wasm') {
        const localSource = clip.sourceId ? getLocalSource(clip.sourceId) : undefined
        source = localSource
          ? Promise.resolve(localSource)
          : Promise.reject(new Error(`Local source is unavailable for ${clip.file}`))
      } else {
        source = isLiveSceneFile(clip.file) ? renderLiveSceneLocal(context, clip.file) : downloadFile(clip.file)
      }
      sourceCache.set(sourceKey, source)
    }
    return source
  }

  let loadRatio = 0
  options.onProgress?.({ ratio: 0, message: 'loading ffmpeg-wasm' })
  const inst = await createFFmpeg((ratio, message) => {
    loadRatio = Math.max(loadRatio, ratio * 0.02)
    options.onProgress?.({ ratio: loadRatio, message })
  })
  const prefix = `local_render_${Date.now()}_${++renderSequence}`
  const context = createContext(inst, prefix, estimateLocalRenderWork(payload, totalDuration), options.onProgress)

  try {
    const videoTracks: VideoTrack[] = []
    for (let index = 0; index < videoChannels.length; index++) {
      videoTracks.push(await buildVideoTrack(
        context,
        videoChannels[index],
        index,
        payload.resolution.w,
        payload.resolution.h,
        fps,
        totalDuration,
        resolveSource,
        payload.fit ?? 'contain',
      ))
    }
    let videoFile = videoTracks.length > 0
      ? await compositeVideoTracks(context, videoTracks, payload.resolution.w, payload.resolution.h, fps, totalDuration)
      : null
    if (!videoFile && textItems.length > 0) {
      videoFile = await generateBlackVideo(context, totalDuration, payload.resolution.w, payload.resolution.h, fps)
    }
    if (videoFile && textItems.length > 0) {
      videoFile = await overlayTextItems(
        context,
        videoFile,
        textItems,
        payload.resolution.w,
        payload.resolution.h,
        fps,
        totalDuration,
      )
    }

    const audioTracks: string[] = []
    for (let index = 0; index < audioChannels.length; index++) {
      audioTracks.push(await buildAudioTrack(
        context,
        audioChannels[index],
        index,
        totalDuration,
        resolveSource,
      ))
    }
    const audioFile = audioTracks.length > 0 ? await mixAudioTracks(context, audioTracks, totalDuration) : null
    const output = await finalizeOutput(context, videoFile, audioFile, totalDuration, format, quality)
    const data = await inst.readFile(output)
    if (!(data instanceof Uint8Array)) throw new Error('ffmpeg returned an invalid output file')
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: OUTPUT_MIME[format] })
    options.onProgress?.({ ratio: 1, message: 'local render complete' })
    return { blob, filename: `render_output.${format}` }
  } finally {
    try {
      await context.cleanup()
    } finally {
      try { inst.terminate() } catch {}
    }
  }
}

async function renderLiveSceneLocal(context: RenderContext, file: string): Promise<Blob> {
  const source = await loadLiveScene(file)
  const transparent = !!source.config.transparent
  const frameExtension = transparent ? '.png' : '.jpg'
  const videoExtension = transparent ? '.mov' : '.mp4'
  const encodingArgs = transparent ? ALPHA_SCENE_ENCODING_ARGS : VIDEO_ENCODING_ARGS
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none'
  document.body.appendChild(host)
  const player = new LiveScenePlayer(source, host)
  const canvas = document.createElement('canvas')
  const parts: string[] = []
  const framesPerPart = 30
  try {
    await player.ready()
    for (let first = 0; first < source.config.durationInFrames; first += framesPerPart) {
      const prefix = context.file('scene_frames', frameExtension).slice(0, -frameExtension.length)
      const names: string[] = []
      const count = Math.min(framesPerPart, source.config.durationInFrames - first)
      for (let offset = 0; offset < count; offset++) {
        const bitmap = await player.seek((first + offset) / source.config.fps, true, true)
        if (!bitmap) throw new Error('The scene did not return an export frame.')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
        bitmap.close()
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture the scene frame.')), transparent ? 'image/png' : 'image/jpeg', 0.95))
        const name = `${prefix}_${String(offset).padStart(6, '0')}${frameExtension}`
        await context.write(name, new Uint8Array(await blob.arrayBuffer()))
        names.push(name)
      }
      const part = context.file('scene_part', videoExtension)
      await context.run(['-framerate', String(source.config.fps), '-i', `${prefix}_%06d${frameExtension}`, '-frames:v', String(count), ...encodingArgs, '-y', part], `rendering live scene frames ${first + count}/${source.config.durationInFrames}`, count / source.config.fps)
      await context.remove(...names)
      parts.push(part)
    }
    const output = context.file('scene_source', videoExtension)
    await context.concat(parts, output, 'assembling live scene')
    const bytes = await context.inst.readFile(output)
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid rendered scene video.')
    await context.remove(...parts, output)
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: transparent ? 'video/quicktime' : 'video/mp4' })
  } finally {
    player.dispose()
    host.remove()
  }
}
