// ffmpeg-wasm service — a lazily-loaded singleton that runs ffmpeg in the
// browser via WebAssembly. Used for preview renders, optional local scrub
// proxy generation, and full-resolution local exports.
//
// The core (@ffmpeg/core, ESM build) is vendored under /public/ffmpeg/core and
// served same-origin, so load() never depends on an external CDN.

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import type { MediaKind, ProjectAspect } from '../stores/editor.svelte'
import type { ClipTransform, ClipTransformKeyframe } from './clip-transform'
import { buildClipTransformFilter } from './ffmpeg-transform'
import { xfadeFilter } from './effects'
import { videoFitFilter, type VideoFit } from './video-fit'

// The core is vendored under /public/ffmpeg/core (copied from
// @ffmpeg/core@0.12.6/dist/esm). Serving it same-origin makes load() fast and
// removes the runtime CDN dependency: a slow/blocked unpkg used to leave the
// LOAD promise pending forever (no worker.onerror handler exists upstream),
// which wedged the whole preview pipeline on "loading ffmpeg-wasm".
const CORE_BASE = '/ffmpeg/core'

// Guard rails so a wedged worker can never block the queue indefinitely.
const LOAD_TIMEOUT_MS = 60000 // 60s
const EXEC_TIMEOUT_MS = 120000 // 120s
const PREVIEW_LONG_EDGE = 720
const PREVIEW_SHORT_EDGE = 406
// WASM scrub proxies match the server profile (480p long edge): fewer pixels
// to decode/encode/hold in MEMFS than PREVIEW_LONG_EDGE, and uniform previews
// across proxy/wasm modes. GOP stays small on purpose: effect renders seek
// these proxies with input-side -ss, which is exact only on all-I-frame input.
const SCRUB_LONG_EDGE = 480
const LONG_SCRUB_THRESHOLD_SECONDS = 2 * 60
const LONG_SCRUB_FRAME_RATE = 15
const LONG_SCRUB_GOP = 30

let ffmpeg: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export type LoadProgress = (ratio: number, msg: string) => void


// generic timeout 
function withTimeout<T>(promise: Promise<T>, ms: number, typeOfTimeout: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${typeOfTimeout} timed out after ${Math.round(ms / 1000)}s`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

async function loadCore(progress?: LoadProgress): Promise<FFmpeg> {
  const inst = new FFmpeg()
  progress?.(0, 'loading ffmpeg-core.js')
  // ESM core: the module worker does `await import(coreURL)`, which needs a real
  // same-origin ES module. Serving from /public keeps it verbatim and bypasses
  // Vite's dep optimizer (which mangles the in-package worker URL).
  const coreURL = `${CORE_BASE}/ffmpeg-core.js`
  progress?.(0.4, 'loading ffmpeg-core.wasm')
  const wasmURL = `${CORE_BASE}/ffmpeg-core.wasm`
  progress?.(0.8, 'initializing core')
  await withTimeout(
    inst.load({ classWorkerURL: '/ffmpeg/worker.js', coreURL, wasmURL }),
    LOAD_TIMEOUT_MS,
    'ffmpeg core load',
  ).catch((err) => {
    // A failed/wedged load must not poison the singleton: tear down so the next
    // attempt creates a fresh worker instead of awaiting the dead one forever.
    try { inst.terminate() } catch {}
    throw err
  })
  progress?.(1, 'ready')
  return inst
}

export function createFFmpeg(progress?: LoadProgress): Promise<FFmpeg> {
  return loadCore(progress)
}

export async function getFFmpeg(progress?: LoadProgress): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg
  if (loadPromise) return loadPromise
  loadPromise = loadCore(progress).then(
    (inst) => {
      ffmpeg = inst
      return inst
    },
    (err) => {
      // Clear the cached instance on failure so the next call retries from
      // scratch instead of re-awaiting the rejected promise.
      ffmpeg = null
      throw err
    },
  )
  try {
    return await loadPromise
  } finally {
    loadPromise = null
  }
}

export interface RenderOptions {
  // Input source: a blob: URL, File, Blob, or any URL fetchFile accepts.
  input: string | Blob | File
  // Cut window inside the input (seconds).
  startSec?: number
  durationSec: number
  // When present, this is a root effect render from original media. The source
  // cut is retimed into timeline seconds; child effect renders omit it because
  // their parent output already has speed baked in.
  playbackRate?: number
  mediaKind?: MediaKind
  fileName?: string
  // ffmpeg -vf filter chain.
  filter: string
  // Optional progress callback (0..1).
  onProgress?: (ratio: number) => void
}

export interface RenderResult {
  blobUrl: string
  blob: Blob
  durationSec: number
}

let jobSeq = 0

function normalizePlaybackRate(rate: number | undefined): number {
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 1
}

function formatRate(rate: number): string {
  return String(Number(rate.toFixed(6)))
}

function setptsForRate(rate: number): string {
  return rate === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${formatRate(rate)}`
}

// Keep every factor in FFmpeg's broadly-supported 0.5..2 atempo range.
function atempoChain(rate: number): string {
  const factors: number[] = []
  let remaining = rate
  while (remaining > 2) {
    factors.push(2)
    remaining /= 2
  }
  while (remaining < 0.5) {
    factors.push(0.5)
    remaining /= 0.5
  }
  if (remaining !== 1) factors.push(remaining)
  return factors.map((factor) => `atempo=${formatRate(factor)}`).join(',')
}

// exec() settles only when the worker replies. If the core dies mid-job (OOM,
// worker kill) the reply never comes and the promise stays pending forever,
// which used to wedge a node in 'rendering' and kill the whole queue. The
// timeout surfaces the failure as a normal node error instead.
export async function execGuarded(
  ffmpegInstance: FFmpeg,
  args: string[],
  onProgress?: (ratio: number) => void,
  timeoutMs = EXEC_TIMEOUT_MS,
): Promise<void> {
  const logLines: string[] = []
  const logHandler = ({ message }: { message: string }) => {
    if (!message.trim()) return
    logLines.push(message.trim())
    if (logLines.length > 8) logLines.shift()
  }
  ffmpegInstance.on('log', logHandler)
  // run returns exit code of exec
  const run = (async () => {
    if (onProgress) {
      const handler = ({ progress }: { progress: number }) => {
        if (progress >= 0 && progress <= 1) onProgress(progress)
      }
      ffmpegInstance.on('progress', handler)
      try {
        return await ffmpegInstance.exec(args)
      } finally {
        ffmpegInstance.off('progress', handler)
      }
    }
    return await ffmpegInstance.exec(args)
  })()
  let code: number
  try {
    code = await withTimeout(run, timeoutMs, 'ffmpeg exec')
  } catch (err) {
    // A rejected or timed-out worker call cannot be trusted for later jobs.
    // terminate() also rejects the still-pending exec promise on worker OOM.
    try { ffmpegInstance.terminate() } catch {}
    if (ffmpeg === ffmpegInstance) ffmpeg = null
    loadPromise = null
    throw err
  } finally {
    ffmpegInstance.off('log', logHandler)
  }
  if (code !== 0) {
    const details = logLines.length > 0 ? `: ${logLines.join('\n')}` : ''
    throw new Error(`ffmpeg exited with code ${code}${details}`)
  }
}

async function deleteFiles(inst: FFmpeg, names: string[]): Promise<void> {
  if (!inst.loaded) return
  for (const name of names) {
    try { await inst.deleteFile(name) } catch {}
  }
}

export interface CreateScrubOptions {
  input: string | Blob | File
  aspect?: ProjectAspect
  onProgress?: (ratio: number) => void
}

async function readVideoDuration(input: string | Blob | File): Promise<number> {
  const video = document.createElement('video')
  const src = typeof input === 'string' ? input : URL.createObjectURL(input)
  const objectUrl = typeof input === 'string' ? null : src

  try {
    return await new Promise<number>((resolve, reject) => {
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        const duration = video.duration
        if (Number.isFinite(duration) && duration > 0) resolve(duration)
        else reject(new Error('cannot determine source duration'))
      }
      video.onerror = () => reject(new Error('cannot read source video metadata'))
      video.src = src
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

// Build the same lightweight proxy as the server scrub route, but keep the
// complete transcode in the browser.
export async function createWasmScrub(opts: CreateScrubOptions): Promise<RenderResult> {
  const inst = await getFFmpeg()
  const job = ++jobSeq
  const inName = `scrub_in_${job}`
  const outName = `scrub_out_${job}.mp4`

  let out: Uint8Array<ArrayBuffer>
  const durationSec = await readVideoDuration(opts.input)
  try {
    await inst.writeFile(inName, await fetchFile(opts.input))

    const scale = opts.aspect === 'portrait' ? `-2:${SCRUB_LONG_EDGE}` : `${SCRUB_LONG_EDGE}:-2`
    const isLongVideo = durationSec > LONG_SCRUB_THRESHOLD_SECONDS
    const videoFilter = `${isLongVideo ? `fps=${LONG_SCRUB_FRAME_RATE},` : ''}scale=${scale},setsar=1,format=yuv420p`
    const gop = isLongVideo ? LONG_SCRUB_GOP : 1
    await execGuarded(inst, [
      '-i', inName,
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-crf', '27',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-g', String(gop),
      '-keyint_min', String(gop),
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-y', outName,
    ], opts.onProgress)
    out = (await inst.readFile(outName)) as Uint8Array<ArrayBuffer>
  } finally {
    await deleteFiles(inst, [inName, outName])
  }

  const blob = new Blob([out], { type: 'video/mp4' })
  const blobUrl = URL.createObjectURL(blob)
  return { blobUrl, blob, durationSec }
}

// Render one segment through ffmpeg-wasm and return a blob URL.
// Re-encodes to a bounded, fast-decode preview so effects remain legible
// without making the single-threaded WASM render prohibitively expensive.
export async function renderSegment(opts: RenderOptions): Promise<RenderResult> {
  const inst = await getFFmpeg()
  const job = ++jobSeq
  const imageExtension = opts.fileName?.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '.img'
  const isRootRender = opts.playbackRate !== undefined
  const isImage = isRootRender && opts.mediaKind === 'image'
  const inName = `in_${job}${isImage ? imageExtension : '.mp4'}`
  const outName = `out_${job}.mp4`

  const args: string[] = []
  const start = opts.startSec ?? 0
  const dur = opts.durationSec
  const playbackRate = normalizePlaybackRate(opts.playbackRate)
  if (isImage) {
    args.push(
      '-loop', '1',
      '-framerate', '30',
      '-t', (dur / playbackRate).toFixed(3),
      '-i', inName,
    )
  } else if (isRootRender) {
    // Original scrub proxies are all-I-frame, so input-side seeking is exact.
    // Cut in source time before changing PTS so -t cannot be interpreted in the
    // shorter/longer output timeline.
    if (start > 0) args.push('-ss', start.toFixed(3))
    if (dur > 0) args.push('-t', dur.toFixed(3))
    args.push('-i', inName)
  } else {
    // Child outputs may not be all-I-frame. Output-side seeking keeps their
    // first frame exact, and they are already expressed in timeline seconds.
    args.push('-i', inName)
    if (start > 0) args.push('-ss', start.toFixed(3))
    if (dur > 0) args.push('-t', dur.toFixed(3))
  }
  const filter = isImage
    ? `setpts=PTS-STARTPTS,scale=${PREVIEW_LONG_EDGE}:${PREVIEW_LONG_EDGE}:force_original_aspect_ratio=decrease,${opts.filter}`
    : isRootRender
      ? `setpts=${setptsForRate(playbackRate)},${opts.filter}`
      : opts.filter
  const encoderSafeFilter = `${filter},scale=trunc(iw/2)*2:trunc(ih/2)*2`
  args.push(
    '-vf', encoderSafeFilter,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '27',
    '-tune', 'fastdecode',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    '-y', outName,
  )

  let out: Uint8Array<ArrayBuffer>
  try {
    await inst.writeFile(inName, await fetchFile(opts.input))
    await execGuarded(inst, args, opts.onProgress)
    out = (await inst.readFile(outName)) as Uint8Array<ArrayBuffer>
  } finally {
    await deleteFiles(inst, [inName, outName])
  }

  const blob = new Blob([out], { type: 'video/mp4' })
  const blobUrl = URL.createObjectURL(blob)
  return { blobUrl, blob, durationSec: isRootRender ? dur / playbackRate : dur }
}

export interface RenderTransitionSegment {
  input: string | Blob | File
  start: number
  durationSec: number
  playbackRate?: number
  mediaKind?: MediaKind
  fileName?: string
}

export interface RenderTransitionOptions {
  // Left clip input + the source time where its transition tail begins.
  inputA: string | Blob | File
  startA: number
  mediaKindA?: MediaKind
  fileNameA?: string
  // Right clip input + the source time where its transition head begins.
  inputB: string | Blob | File
  startB: number
  mediaKindB?: MediaKind
  fileNameB?: string
  // Overlap duration (seconds).
  durationSec: number
  playbackRateA?: number
  playbackRateB?: number
  // Optional independently rendered effect regions. When supplied, these are
  // concatenated before the clip transform and transition are applied.
  segmentsA?: RenderTransitionSegment[]
  segmentsB?: RenderTransitionSegment[]
  transformA?: ClipTransform
  transformKeyframesA?: ClipTransformKeyframe[]
  transformOffsetA?: number
  transformB?: ClipTransform
  transformKeyframesB?: ClipTransformKeyframe[]
  transformOffsetB?: number
  // ffmpeg xfade transition name ('fade', 'wipeleft', …).
  xfade: string
  aspect?: ProjectAspect
  fit?: VideoFit
  fps?: number
  onProgress?: (ratio: number) => void
}

// Render a video transition between two clips. Audio is rendered separately on
// its linked audio channel, so keeping this job video-only saves substantial
// memory in the single-threaded WASM core.
export async function renderTransition(opts: RenderTransitionOptions): Promise<RenderResult> {
  const inst = await getFFmpeg()
  const job = ++jobSeq
  const imageExtension = (fileName?: string): string => fileName?.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '.img'
  const outName = `trout_${job}.mp4`

  const dur = opts.durationSec
  const segmentsA = opts.segmentsA?.length ? opts.segmentsA : [{
    input: opts.inputA,
    start: opts.startA,
    durationSec: dur,
    playbackRate: opts.playbackRateA,
    mediaKind: opts.mediaKindA,
    fileName: opts.fileNameA,
  }]
  const segmentsB = opts.segmentsB?.length ? opts.segmentsB : [{
    input: opts.inputB,
    start: opts.startB,
    durationSec: dur,
    playbackRate: opts.playbackRateB,
    mediaKind: opts.mediaKindB,
    fileName: opts.fileNameB,
  }]
  const inputName = (side: 'a' | 'b', index: number, segment: RenderTransitionSegment): string => {
    const suffix = index === 0 ? '' : `_${index}`
    const extension = segment.mediaKind === 'image' ? imageExtension(segment.fileName) : '.mp4'
    return `tr${side}_${job}${suffix}${extension}`
  }
  const namesA = segmentsA.map((segment, index) => inputName('a', index, segment))
  const namesB = segmentsB.map((segment, index) => inputName('b', index, segment))
  const allSegments = [...segmentsA, ...segmentsB]
  const allNames = [...namesA, ...namesB]
  // Normalize geometry, frame rate, timebase, and timestamps. xfade requires
  // both inputs to begin at PTS 0 and use the same timebase.
  const preview = opts.aspect === 'portrait'
    ? { w: PREVIEW_SHORT_EDGE, h: PREVIEW_LONG_EDGE }
    : opts.aspect === 'classic'
      ? { w: 540, h: PREVIEW_SHORT_EDGE }
      : { w: PREVIEW_LONG_EDGE, h: PREVIEW_SHORT_EDGE }
  const fps = Math.max(1, Math.round(opts.fps ?? 30))
  const norm = `${videoFitFilter(preview.w, preview.h, opts.fit, { forceDivisibleBy: 2 })},format=rgb24,format=yuv444p,settb=AVTB`
  const sideFilter = (
    segments: RenderTransitionSegment[],
    inputOffset: number,
    side: 'a' | 'b',
    transform: ClipTransform | undefined,
    transformKeyframes: ClipTransformKeyframe[] | undefined,
    transformOffset: number,
    output: string,
  ): string => {
    const transformFilter = buildClipTransformFilter(
      { transform, transformKeyframes },
      preview.w,
      preview.h,
      transformOffset,
      dur,
      fps,
      `transition_${side}_shear`,
    )
    if (segments.length === 1) {
      const rate = normalizePlaybackRate(segments[0].playbackRate)
      return `[${inputOffset}:v]${norm},setpts=${setptsForRate(rate)},fps=${fps}${transformFilter ? `,${transformFilter}` : ''}[${output}]`
    }

    const filters = segments.map((segment, index) => {
      const rate = normalizePlaybackRate(segment.playbackRate)
      return `[${inputOffset + index}:v]${norm},setpts=${setptsForRate(rate)},fps=${fps},` +
        `trim=duration=${segment.durationSec.toFixed(3)},setpts=PTS-STARTPTS[${side}s${index}]`
    })
    const inputs = segments.map((_, index) => `[${side}s${index}]`).join('')
    const concatOutput = transformFilter ? `${side}joined` : output
    filters.push(`${inputs}concat=n=${segments.length}:v=1:a=0[${concatOutput}]`)
    if (transformFilter) filters.push(`[${concatOutput}]${transformFilter}[${output}]`)
    return filters.join(';')
  }
  const leftFilter = sideFilter(
    segmentsA,
    0,
    'a',
    opts.transformA,
    opts.transformKeyframesA,
    opts.transformOffsetA ?? 0,
    'v0',
  )
  const rightFilter = sideFilter(
    segmentsB,
    segmentsA.length,
    'b',
    opts.transformB,
    opts.transformKeyframesB,
    opts.transformOffsetB ?? 0,
    'v1',
  )
  const fc =
    `${leftFilter};${rightFilter};` +
    `[v0][v1]xfade=${xfadeFilter(opts.xfade)}:duration=${dur.toFixed(3)}:offset=0[v]`

  // Preview proxies are all-I-frame (-g 1), so input-side seeking is exact and
  // prevents WASM from decoding each complete source before the transition.
  // Still images have a virtual timeline in the editor, so loop their single
  // frame instead of trying to seek into the original image file.
  const inputArgs = (input: string, segment: RenderTransitionSegment): string[] => {
    const rate = normalizePlaybackRate(segment.playbackRate)
    return segment.mediaKind === 'image'
      ? ['-loop', '1', '-framerate', String(fps), '-t', (segment.durationSec * rate).toFixed(3), '-i', input]
      : ['-ss', segment.start.toFixed(3), '-t', (segment.durationSec * rate).toFixed(3), '-i', input]
  }
  const args = [
    ...allSegments.flatMap((segment, index) => inputArgs(allNames[index], segment)),
    '-filter_complex', fc,
    '-map', '[v]', '-an',
    '-t', dur.toFixed(3),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-tune', 'fastdecode',
    '-movflags', '+faststart',
    '-y', outName,
  ]

  let out: Uint8Array<ArrayBuffer>
  try {
    // Transfer one source at a time instead of retaining all fetched buffers.
    for (let index = 0; index < allSegments.length; index++) {
      await inst.writeFile(allNames[index], await fetchFile(allSegments[index].input))
    }
    await execGuarded(inst, args, opts.onProgress)
    out = (await inst.readFile(outName)) as Uint8Array<ArrayBuffer>
  } finally {
    await deleteFiles(inst, [...allNames, outName])
  }

  const blob = new Blob([out], { type: 'video/mp4' })
  const blobUrl = URL.createObjectURL(blob)
  return { blobUrl, blob, durationSec: dur }
}

export interface RenderAudioTransitionOptions {
  inputA: string | Blob | File
  startA: number
  inputB: string | Blob | File
  startB: number
  durationSec: number
  playbackRateA?: number
  playbackRateB?: number
  onProgress?: (ratio: number) => void
}

// Render an audio-only transition between two clips (acrossfade).
export async function renderAudioTransition(opts: RenderAudioTransitionOptions): Promise<RenderResult> {
  const inst = await getFFmpeg()
  const job = ++jobSeq
  const inA = `atina_${job}.m4a`
  const inB = `atinb_${job}.m4a`
  const outName = `atout_${job}.m4a`

  const dur = opts.durationSec
  const playbackRateA = normalizePlaybackRate(opts.playbackRateA)
  const playbackRateB = normalizePlaybackRate(opts.playbackRateB)
  const atempoA = atempoChain(playbackRateA)
  const atempoB = atempoChain(playbackRateB)
  const args = [
    '-ss', opts.startA.toFixed(3), '-t', (dur * playbackRateA).toFixed(3), '-i', inA,
    '-ss', opts.startB.toFixed(3), '-t', (dur * playbackRateB).toFixed(3), '-i', inB,
    '-filter_complex',
    `[0:a]${atempoA ? `${atempoA},` : ''}asetpts=PTS-STARTPTS[a0];` +
      `[1:a]${atempoB ? `${atempoB},` : ''}asetpts=PTS-STARTPTS[a1];` +
      `[a0][a1]acrossfade=d=${dur.toFixed(3)}[a]`,
    '-map', '[a]',
    '-c:a', 'aac', '-b:a', '96k',
    '-y', outName,
  ]

  let out: Uint8Array<ArrayBuffer>
  try {
    await inst.writeFile(inA, await fetchFile(opts.inputA))
    await inst.writeFile(inB, await fetchFile(opts.inputB))
    await execGuarded(inst, args, opts.onProgress)
    out = (await inst.readFile(outName)) as Uint8Array<ArrayBuffer>
  } finally {
    await deleteFiles(inst, [inA, inB, outName])
  }

  const blob = new Blob([out], { type: 'audio/mp4' })
  const blobUrl = URL.createObjectURL(blob)
  return { blobUrl, blob, durationSec: dur }
}

export interface ExtractAudioOptions {
  input: string | Blob | File
  onProgress?: (ratio: number) => void
}

export async function extractAudio(opts: ExtractAudioOptions): Promise<{ blobUrl: string; blob: Blob }> {
  const inst = await getFFmpeg()
  const job = ++jobSeq
  const inName = `audio_in_${job}.mp4`
  const outName = `audio_out_${job}.m4a`

  const args = [
    '-i', inName,
    '-vn',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-y', outName,
  ]

  let out: Uint8Array<ArrayBuffer>
  try {
    await inst.writeFile(inName, await fetchFile(opts.input))
    await execGuarded(inst, args, opts.onProgress)
    out = (await inst.readFile(outName)) as Uint8Array<ArrayBuffer>
  } finally {
    await deleteFiles(inst, [inName, outName])
  }

  const blob = new Blob([out], { type: 'audio/mp4' })
  const blobUrl = URL.createObjectURL(blob)
  return { blobUrl, blob }
}

export function terminateFFmpeg(): void {
  if (ffmpeg) {
    ffmpeg.terminate()
    ffmpeg = null
    loadPromise = null
  }
}
