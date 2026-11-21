<script lang="ts">
  import { mountSvelteScene } from '@machinal/scenes/svelte'
  import type { SceneController } from '@machinal/scenes/runtime'
  import { findNativePort, loadNativePortComponent, nativePreviewSize, type NativeAspect } from '../lib/native-gallery-catalog'

  let { id, aspect, time, scale, width, height, includePending }: { id: string; aspect: NativeAspect; time: number; scale: number; width?: number; height?: number; includePending?: boolean } = $props()

  let host = $state<HTMLDivElement>()

  $effect(() => {
    const target = host
    const port = findNativePort(id, includePending)
    if (!target) return
    if (!port) {
      document.documentElement.dataset.error = `Unknown port "${id}"`
      return
    }

    let disposed = false
    let controller: SceneController | undefined
    const preset = nativePreviewSize(aspect)
    // Upstream artboards are not all the 1920x1080 / 1080x1920 presets; a
    // verification harness may mount the exact declared artboard instead.
    const config = width && height ? { ...preset, width, height } : preset

    const seek = async (seconds: number) => {
      if (!controller) throw new Error('The scene is not mounted yet.')
      await controller.seek(Math.round(seconds * config.fps), { realtime: false, capture: false })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await settleFonts()
    }

    // Ports carry their webfont imports in component CSS, which Svelte injects
    // after mount, so the imported @font-face rules appear asynchronously. Wait
    // until the font set stops changing before sampling a frame.
    const settleFonts = async () => {
      let previous = -1
      let stable = 0
      for (let frame = 0; frame < 120 && stable < 3; frame += 1) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        const size = document.fonts.size
        stable = size === previous && document.fonts.status === 'loaded' ? stable + 1 : 0
        previous = size
      }
      await document.fonts.ready
    }

    void (async () => {
      const component = await loadNativePortComponent(port)
      if (disposed) return
      controller = mountSvelteScene(component, target, {
        version: 1,
        sceneId: `native-port-${port.id}`,
        seed: port.id,
        config,
        props: { images: {}, videos: {} },
      }, {}, { capture: false })
      await controller.ready()
      await settleFonts()
      await seek(time)
      if (disposed) return
      Object.assign(window, { __nativePortSeek: seek })
      document.documentElement.dataset.ready = 'true'
    })().catch(error => {
      document.documentElement.dataset.error = error instanceof Error ? error.message : String(error)
    })

    return () => {
      disposed = true
      void controller?.dispose()
    }
  })
</script>

<div class="native-port-stage" style:transform="scale({scale})">
  <div class="native-port-host" bind:this={host}></div>
</div>

<style>
  .native-port-stage {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }

  .native-port-host {
    position: relative;
  }
</style>
