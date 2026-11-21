import { onMount } from 'svelte'
import { Application, Rectangle, Sprite, Texture, type Filter } from 'pixi.js'
import { createPixiFilters, createPixiTransitionFilter, pixiIntensityAt, planPixiEffectStack, planPixiTransition } from '../lib/effects-pixi'
import { resolveClipLook } from '../lib/clip-looks'
import { normalizeEffectParams } from '../lib/effects'
import { clipTransformAt } from '../lib/clip-transform'
import { DEMO_CLIP_DURATION, DEMO_OVERLAP, DEMO_SCENES, demoLayout, type DemoClip, type DemoProject } from '../lib/landing'
import { createDemoArtwork, DEMO_FRAME } from '../lib/landing-artwork'

type RendererPhase = { kind: 'loading' | 'ready' } | { kind: 'error'; message: string }

export function useLandingRenderer(getProject: () => DemoProject) {
  let host: HTMLDivElement | undefined
  let phase = $state<RendererPhase>({ kind: 'loading' })
  let app: Application | undefined
  const textures = new Map<string, Texture>()
  const sprites: Sprite[] = []
  let filters: Filter[] = []
  let disposed = false

  function effectsFor(clip: DemoClip, time: number) {
    const look = clip.look ? resolveClipLook(clip.look, DEMO_CLIP_DURATION, DEMO_FRAME.fps) : null

    const effects = look?.effects.filter(effect => time >= effect.offset && time < effect.offset + effect.duration).map((effect, index) => ({
      blockId: `${clip.id}-look-${index}`,
      effectId: effect.effectId,
      params: effect.params,
      intensity: pixiIntensityAt(effect.ramp, effect.offset, effect.duration, time),
      progress: time / DEMO_CLIP_DURATION,
      timeSec: time,
    })) ?? []
    if (clip.effect) effects.push({ blockId: `${clip.id}-effect`, effectId: clip.effect, params: normalizeEffectParams(clip.effect, {}), intensity: 1, progress: time / DEMO_CLIP_DURATION, timeSec: time })
    return { effects, look }
  }

  function render(project: DemoProject) {
    if (!app) return
    app.stage.removeChildren()
    for (const sprite of sprites) sprite.destroy()
    sprites.length = 0
    for (const filter of filters) filter.destroy()
    filters = []
    const active = demoLayout(project).filter(clip => project.time >= clip.start && project.time < clip.end)
    active.forEach((clip, index) => {
      const sprite = new Sprite(textures.get(clip.id)!)
      const time = project.time - clip.start
      const { effects, look } = effectsFor(clip, time)
      const built = createPixiFilters(planPixiEffectStack(effects, time, DEMO_FRAME), DEMO_FRAME)
      const transform = look ? clipTransformAt({ transform: look.transform, transformKeyframes: look.transformKeyframes }, time) : null
      sprite.anchor.set(.5)
      sprite.position.set(DEMO_FRAME.w / 2, DEMO_FRAME.h / 2)
      if (transform) {
        sprite.scale.set(transform.zoomX, transform.zoomY)
        sprite.position.x += transform.positionX / 100 * DEMO_FRAME.w
        sprite.position.y += transform.positionY / 100 * DEMO_FRAME.h
        sprite.rotation = transform.rotation * Math.PI / 180
      }
      if (index === 1 && project.transition) {
        const transition = createPixiTransitionFilter(planPixiTransition(project.transition, time / DEMO_OVERLAP).reveal, DEMO_FRAME)
        if (transition) built.filters.push(transition)
      }
      sprite.filters = built.filters
      // Pixi transforms filterArea from sprite-local coordinates, including its centered anchor.
      sprite.filterArea = new Rectangle(-sprite.anchor.x * sprite.texture.width, -sprite.anchor.y * sprite.texture.height, sprite.texture.width, sprite.texture.height)
      filters.push(...built.filters)
      sprites.push(sprite)
      app!.stage.addChild(sprite)
    })
    app.renderer.render(app.stage)
  }

  async function initialize() {
    try {
      await document.fonts.ready
      if (disposed || !host) return
      app = new Application()
      await app.init({
        width: DEMO_FRAME.w,
        height: DEMO_FRAME.h,
        preference: 'webgl',
        antialias: true,
        autoStart: false,
        background: '#222833',
        useBackBuffer: true,
      })
      if (disposed) { app.destroy(true); app = undefined; return }
      host.appendChild(app.canvas)
      for (const scene of DEMO_SCENES) textures.set(scene.id, Texture.from(createDemoArtwork(scene.id)))
      phase = { kind: 'ready' }
      render(getProject())
    } catch {
      if (!disposed) phase = { kind: 'error', message: 'Live preview needs WebGL. You can still explore the timeline and recipes.' }
    }
  }

  onMount(() => {
    void initialize()
    return () => {
      disposed = true
      if (app?.renderer) app.destroy(true, { children: true })
      for (const filter of filters) filter.destroy()
      for (const texture of textures.values()) texture.destroy(true)
    }
  })

  $effect(() => {
    const project = getProject()
    const snapshot = { ...project, clips: project.clips.map(clip => ({ ...clip })) }
    if (phase.kind === 'ready') render(snapshot)
  })

  return {
    get host() { return host },
    set host(value: HTMLDivElement | undefined) { host = value },
    get phase() { return phase },
  }
}
