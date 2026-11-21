import { editor, type Channel, type Clip, type Transition } from '../stores/editor.svelte'
import { render } from '../stores/render.svelte'
import { auth } from '../stores/auth.svelte'
import type { AIFeature } from '../lib/ai-access'
import { fetchIsPaid, isPaidRequiredError } from '../lib/paid'
import { friendlyErrorMessage, type RenderClipPayload, type RenderFormat, type RenderPayload, type RenderQuality } from '../lib/api'
import { compileProjectLocal } from '../lib/local-render'
import { xfadeName } from '../lib/effects'
import { buildRenderTextOverlays } from '../lib/text-render'
import { clipFadeIn, clipFadeOut, clipOpacity } from '../lib/clip-compositing'
import { estimateRenderWork, formatRenderTime, hasSceneRenderWork, RenderProgressEstimator, type RenderProgressSnapshot } from '../lib/render-progress'
import { renderDocument, projectForRender, reconcileDocument } from '../lib/compositions'
import type { VideoFit } from '../lib/video-fit'

export const FORMAT_OPTIONS: Array<{ value: RenderFormat; label: string; detail: string }> = [
  { value: 'mp4', label: 'MP4', detail: 'Compatible video' },
  { value: 'avi', label: 'AVI', detail: 'Legacy video' },
  { value: 'mp3', label: 'MP3', detail: 'Audio tracks only' },
]

export const QUALITY_OPTIONS: Array<{ value: RenderQuality; label: string; detail: string }> = [
  { value: 'low', label: 'Low', detail: 'Smaller file' },
  { value: 'normal', label: 'Normal', detail: 'Balanced' },
  { value: 'high', label: 'High', detail: 'Best quality' },
]

export type RenderExportState =
  | { kind: 'idle' }
  | { kind: 'compiling'; target: 'server' | 'local'; message: string; progress: RenderProgressSnapshot | null }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

export type RenderSettings = {
  format: RenderFormat
  quality: RenderQuality
}

type RenderClipBase = Pick<Clip, 'fileName' | 'sourceMode' | 'sourceId' | 'mediaKind' | 'inPoint' | 'outPoint' | 'start' | 'playbackRate'>

export function baseRenderClipPayload(clip: RenderClipBase): RenderClipPayload {
  return {
    file: clip.fileName,
    sourceMode: clip.sourceMode,
    sourceId: clip.sourceId,
    mediaKind: clip.mediaKind,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    start: clip.start,
    playbackRate: clip.playbackRate ?? 1,
    segments: [],
  }
}

export function buildVideoClipPayload(clip: Clip, segments: RenderClipPayload['segments']): RenderClipPayload {
  return {
    ...baseRenderClipPayload(clip),
    transform: clip.transform,
    transformKeyframes: clip.transformKeyframes,
    opacity: clipOpacity(clip),
    fadeIn: clipFadeIn(clip),
    fadeOut: clipFadeOut(clip),
    segments,
  }
}

export function buildAudioClipPayload(clip: Clip): RenderClipPayload {
  return {
    ...baseRenderClipPayload(clip),
    volume: clip.volume ?? 100,
  }
}

export function validateRender(
  target: 'server' | 'local',
  format: RenderFormat,
  hasLocalMedia: boolean,
  hasExportContent: boolean,
): string | null {
  if (target === 'server' && hasLocalMedia) return 'Local media can only be rendered on this device'
  if (hasExportContent) return null
  return format === 'mp3' ? 'Add an active audio clip to export MP3' : 'no clips to export'
}

export function buildRenderPayload(
  settings: RenderSettings,
  resolution: { w: number; h: number },
  fps: number,
  videoChannels: RenderPayload['videoChannels'],
  audioChannels: RenderPayload['audioChannels'],
  textItems: RenderPayload['textItems'],
  fit: VideoFit = 'contain',
): RenderPayload {
  return {
    format: settings.format,
    quality: settings.quality,
    fit,
    resolution,
    fps,
    videoChannels: settings.format === 'mp3' ? [] : videoChannels,
    audioChannels,
    textItems: settings.format === 'mp3' ? [] : textItems,
  }
}

function sortedClips(channel: Channel): Clip[] {
  return [...channel.clips].sort((left, right) => left.start - right.start)
}

function buildVideoChannels(
  channels: Channel[],
  transitions: Transition[],
  flattenClip: (clipId: string) => RenderClipPayload['segments'],
): RenderPayload['videoChannels'] {
  return channels.filter((channel) => channel.type === 'video').map((channel) => {
    const clips = sortedClips(channel)
    const payloadClips = clips.map((clip) => buildVideoClipPayload(clip, flattenClip(clip.id)))

    const channelTransitions = transitions
      .filter((transition) => transition.channelId === channel.id)
      .map((transition) => ({
        rightClipIndex: clips.findIndex((clip) => clip.id === transition.rightClipId),
        xfade: xfadeName(transition.effectId),
      }))
      .filter((transition) => transition.rightClipIndex > 0)
    return { clips: payloadClips, transitions: channelTransitions }
  })
}

function buildAudioChannels(channels: Channel[]): RenderPayload['audioChannels'] {
  return channels.filter((channel) => channel.type === 'audio').map((channel) => ({
    clips: sortedClips(channel).map(buildAudioClipPayload),
  }))
}

function errorMessage(cause: unknown): string {
  return friendlyErrorMessage(cause, 'render')
}

function downloadExport(result: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(result.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function useRenderMenu(options?: { getOnRequireAccess?: () => ((feature: AIFeature) => void) | undefined }) {
  let open = $state(false)
  let dialogEl = $state<HTMLDialogElement>()
  let exportState = $state<RenderExportState>({ kind: 'idle' })
  let renderSettings = $state<RenderSettings>({ format: 'mp4', quality: 'normal' })
  let exportProgressTimer: ReturnType<typeof setInterval> | null = null

  const hasLocalMedia = $derived(editor.channels.some((channel) => (
    !channel.hidden
      && !channel.muted
      && (renderSettings.format !== 'mp3' || channel.type === 'audio')
      && channel.clips.some((clip) => clip.sourceMode === 'wasm')
  )))

  const openDialog = (): void => {
    // Logged-out users get the same login/pricing flow as the other
    // gated features instead of the render menu.
    const requireAccess = options?.getOnRequireAccess?.()
    if (!auth.isLogged && requireAccess) {
      requireAccess('render')
      return
    }
    open = true
  }

  const closeDialog = (): void => {
    if (dialogEl?.open) dialogEl.close()
    open = false
  }

  const stopProgressTimer = (): void => {
    if (exportProgressTimer === null) return
    clearInterval(exportProgressTimer)
    exportProgressTimer = null
  }

  const selectFormat = (format: RenderFormat): void => { renderSettings.format = format }
  const selectQuality = (quality: RenderQuality): void => { renderSettings.quality = quality }
  const selectFormatOption = (format: RenderFormat) => (): void => selectFormat(format)
  const selectQualityOption = (quality: RenderQuality) => (): void => selectQuality(quality)
  const exportThrough = (target: 'server' | 'local') => (): Promise<void> => onExport(target)

  async function buildExportPayload(settings: RenderSettings, rasterize = true): Promise<RenderPayload> {
    const activeChannels = editor.channels.filter((channel) => !channel.hidden && !channel.muted && channel.clips.length > 0)

    const videoChannels = buildVideoChannels(
      activeChannels,
      editor.transitions,
      (clipId) => (editor.documentSession?.kind === 'ready' ? editor.documentSession.composition.segments[clipId] ?? [] : render.flatten(clipId)).map((segment) => ({
        srcStart: segment.srcStart,
        srcEnd: segment.srcEnd,
        effects: segment.effects,
      })),
    )

    const audioChannels = buildAudioChannels(activeChannels)
    const preset = editor.projectResolution

    const textItems = settings.format === 'mp3' || !rasterize
      ? []
      : await buildRenderTextOverlays(editor.textItems, preset.w, preset.h, editor.effectiveProjectAspect)

    return buildRenderPayload(
      settings,
      { w: preset.w, h: preset.h },
      editor.fps,
      videoChannels,
      audioChannels,
      textItems,
      editor.videoFit,
    )
  }

  function setCompiling(target: 'server' | 'local', message: string): void {
    exportState = { kind: 'compiling', target, message, progress: null }
  }

  function updateProgress(progress: RenderProgressSnapshot): void {
    if (exportState.kind !== 'compiling') return
    exportState = { ...exportState, message: progress.message, progress }
  }

  function isCompiling(): boolean {
    return exportState.kind === 'compiling'
  }

  async function hasServerAccess(): Promise<boolean> {
    const requireAccess = options?.getOnRequireAccess?.()
    if (!requireAccess) return true
    if (!auth.isLogged) {
      requireAccess('render')
      return false
    }
    if (auth.isPaid) return true
    try {
      if (await fetchIsPaid()) return true
    } catch {
      // The render endpoint remains the authority when entitlement lookup fails.
      return true
    }
    requireAccess('render')
    return false
  }

  function startProgressEstimation(target: 'server' | 'local', payload: RenderPayload) {
    stopProgressTimer()
    const message = target === 'local' ? 'preparing local render…' : 'rendering on server…'
    const estimator = new RenderProgressEstimator(target, estimateRenderWork(payload), { nonlinearWork: target === 'server' && hasSceneRenderWork(payload) })
    exportState = { kind: 'compiling', target, message, progress: estimator.snapshot(message) }
    exportProgressTimer = setInterval(() => {
      if (exportState.kind === 'compiling') updateProgress(estimator.snapshot(exportState.message))
    }, 500)
    return ({ ratio, message }: { ratio: number; message: string }): void => {
      updateProgress(estimator.update({ ratio, message }))
    }
  }

  async function onExport(target: 'server' | 'local'): Promise<void> {
    if (isCompiling()) return

    const settings = { ...renderSettings }
    const activeChannels = editor.channels.filter((channel) => !channel.hidden && !channel.muted && channel.clips.length > 0)

    const hasExportContent = settings.format === 'mp3'
      ? activeChannels.some((channel) => channel.type === 'audio')
      : activeChannels.length > 0 || editor.textItems.length > 0

    const validationError = validateRender(target, settings.format, hasLocalMedia, hasExportContent)
    if (validationError) {
      exportState = { kind: 'error', message: validationError }
      return
    }

    if (target === 'server' && !(await hasServerAccess())) return
    if (isCompiling()) return

    const initialMessage = settings.format !== 'mp3' && editor.textItems.length > 0
      ? 'preparing text…'
      : target === 'local' ? 'preparing local render…' : 'rendering on server…'
    setCompiling(target, initialMessage)

    try {
      if (target === 'local' && editor.documentSession) await reconcileDocument()
      const payload = await buildExportPayload(settings, target === 'local')
      const onProgress = startProgressEstimation(target, payload)

      const result = target === 'local'
        ? await compileProjectLocal(payload, { onProgress })
        : await renderDocument(projectForRender(settings), onProgress)

      downloadExport(result)
      exportState = { kind: 'done', message: `exported ${result.filename}` }
    } catch (cause) {
      const message = errorMessage(cause)
      if (target === 'server' && isPaidRequiredError(message)) {
        options?.getOnRequireAccess?.()?.('render')
      }
      exportState = { kind: 'error', message }
    } finally {
      stopProgressTimer()
    }
  }

  $effect(() => {
    if (!open || !dialogEl || dialogEl.open) return
    if (dialogEl.showModal) dialogEl.showModal()
    else dialogEl.setAttribute('open', '')
  })

  $effect(() => () => stopProgressTimer())

  return {
    editor,
    formatOptions: FORMAT_OPTIONS,
    qualityOptions: QUALITY_OPTIONS,
    formatRenderTime,
    openDialog,
    closeDialog,
    selectFormat,
    selectQuality,
    selectFormatOption,
    selectQualityOption,
    onExport,
    exportThrough,
    get open() { return open },
    get dialogEl() { return dialogEl },
    set dialogEl(value: HTMLDialogElement | undefined) { dialogEl = value },
    get exportState() { return exportState },
    get outputFormat() { return renderSettings.format },
    get outputQuality() { return renderSettings.quality },
    get hasLocalMedia() { return hasLocalMedia },
  }
}
