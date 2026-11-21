import { untrack } from 'svelte'
import { mountSvelteScene } from '@machinal/scenes/svelte'
import type { SceneController } from '@machinal/scenes/runtime'
import { loadNativePortComponent, nativePreviewSize, type NativeAspect, type NativePort } from '../lib/native-gallery-catalog'
import { createSyntheticImageFixtures, createSyntheticVideoFixture } from '../lib/native-gallery-fixtures'

const PREVIEW_DURATION = 26

type PreviewPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

export function useNativeScenePreview(getPort: () => NativePort | null, getAspect: () => NativeAspect) {
  let stage = $state<HTMLDivElement>()
  let host = $state<HTMLDivElement>()
  let phase = $state<PreviewPhase>({ kind: 'idle' })
  let transport = $state({ time: 0, playing: false, speed: 1 })
  let checkerboard = $state(false)
  let attempt = $state(0)
  let controller: SceneController | undefined
  let pendingDispose: Promise<void> = Promise.resolve()

  $effect(() => {
    const target = host
    const port = getPort()
    const aspect = getAspect()
    attempt
    if (!target || !port) {
      phase = { kind: 'idle' }
      return
    }

    let cancelled = false
    let mounted: SceneController | undefined
    const previous = pendingDispose
    controller = undefined
    const config = nativePreviewSize(aspect)
    phase = { kind: 'loading' }
    transport = { ...untrack(() => transport), time: 0, playing: false }

    const render = async () => {
      await previous
      if (cancelled) return
      const component = await loadNativePortComponent(port)
      const images = createSyntheticImageFixtures(port.requiredImages.length)
      const videoFixture = port.requiredVideos.length ? await createSyntheticVideoFixture() : undefined
      if (cancelled) return

      const videos = videoFixture
        ? Object.fromEntries(port.requiredVideos.map((video, index) => [video.id, videoFixture]).slice(0, 2))
        : {}

      mounted = mountSvelteScene(component, target, {
        version: 1,
        sceneId: `native-gallery-${port.id}`,
        seed: port.id,
        config,
        props: { images, videos },
      }, {}, { capture: false })
      controller = mounted
      await mounted.ready()
      if (cancelled) {
        await mounted.dispose()
        return
      }
      phase = { kind: 'ready' }
    }

    void render().catch(error => {
      if (cancelled) return
      transport = { ...transport, playing: false }
      phase = { kind: 'error', message: error instanceof Error ? error.message : 'The native Svelte preview failed.' }
    })

    return () => {
      cancelled = true
      if (controller === mounted) controller = undefined
      if (mounted) pendingDispose = mounted.dispose().catch(() => {})
    }
  })

  $effect(() => {
    const frame = stage
    const target = host
    const config = nativePreviewSize(getAspect())
    if (!frame || !target) return

    const fit = () => {
      const scale = Math.min(frame.clientWidth / config.width, frame.clientHeight / config.height)
      if (!Number.isFinite(scale) || scale <= 0) return
      target.style.width = `${config.width}px`
      target.style.height = `${config.height}px`
      target.style.transform = `translate(-50%, -50%) scale(${scale})`
    }

    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    fit()
    return () => observer.disconnect()
  })

  $effect(() => {
    if (phase.kind !== 'ready') return
    const activeController = controller
    const activePortId = getPort()?.id
    if (!activeController || !activePortId) return
    const config = nativePreviewSize(getAspect())
    const frame = Math.min(config.durationInFrames - 1, Math.floor(transport.time * config.fps))
    void activeController.seek(frame, {
      realtime: transport.playing,
      playbackRate: transport.speed,
      capture: false,
    }).catch(error => {
      if (getPort()?.id !== activePortId) return
      phase = { kind: 'error', message: error instanceof Error ? error.message : 'The native Svelte preview could not seek.' }
      transport = { ...transport, playing: false }
    })
  })

  $effect(() => {
    if (!transport.playing || phase.kind !== 'ready') return
    const config = nativePreviewSize(getAspect())
    const startTime = untrack(() => transport.time)
    const speed = transport.speed
    const startedAt = performance.now()
    let lastFrame = Math.floor(startTime * config.fps)
    let raf = 0

    const tick = (now: number) => {
      const time = Math.min(PREVIEW_DURATION, startTime + (now - startedAt) / 1000 * speed)
      const frame = Math.floor(time * config.fps)
      if (frame !== lastFrame) {
        transport.time = frame / config.fps
        lastFrame = frame
      }
      if (time >= PREVIEW_DURATION) {
        transport.time = PREVIEW_DURATION
        transport.playing = false
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  })

  function seek(time: number): void {
    const config = nativePreviewSize(getAspect())
    const frame = Math.max(0, Math.min(config.durationInFrames - 1, Math.round(time * config.fps)))
    transport = { ...transport, time: frame / config.fps, playing: false }
  }

  function togglePlayback(): void {
    if (phase.kind !== 'ready') return
    const time = transport.time >= PREVIEW_DURATION ? 0 : transport.time
    transport = { ...transport, time, playing: !transport.playing }
  }

  function reset(): void {
    transport = { ...transport, time: 0, playing: false }
  }

  function retry(): void {
    attempt++
  }

  function setSpeed(speed: number): void {
    transport = { ...transport, speed }
  }

  return {
    seek,
    togglePlayback,
    reset,
    retry,
    setSpeed,
    get stage() { return stage },
    set stage(value: HTMLDivElement | undefined) { stage = value },
    get host() { return host },
    set host(value: HTMLDivElement | undefined) { host = value },
    get phase() { return phase },
    get transport() { return transport },
    get checkerboard() { return checkerboard },
    set checkerboard(value: boolean) { checkerboard = value },
    get duration() { return PREVIEW_DURATION },
  }
}
