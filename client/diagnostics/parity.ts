import { Application, Rectangle, Sprite, Texture } from 'pixi.js'
import { EFFECTS, buildFilterChain, defaultEffectParams, effectSupportsRamp, rampIntensityAt, xfadeFilter, type EffectDef } from '../src/lib/effects'
import { createPixiFilters, createPixiTransitionFilter, planPixiEffect, planPixiTransition, HISTORY_EFFECTS, type PixiBuiltFilters } from '../src/lib/effects-pixi'
import { PixiHistory } from '../src/lib/pixi-history'
import { createFFmpeg } from '../src/lib/wasm'

export const WIDTH = 160
export const HEIGHT = 90
const FPS = 12
const FRAMES = 12
const SAMPLES = [0, 3, 6, 9]
const BYTES = WIDTH * HEIGHT * 4
const ramp = { mode: 'in', curve: 'linear', amount: 1, blockDuration: 1, offset: 0 } as const

export interface Sample {
  time: number
  mae: number
  max: number
  changedPercent: number
  pixi: string
  ffmpeg: string
  difference: string
  overlay: string
}

export interface Result {
  id: string
  kind: string
  variant: string
  params: Record<string, Record<string, number>>
  graph: string
  plans: unknown[]
  status: 'measured' | 'partial' | 'error'
  notes: string[]
  samples: Sample[]
  error?: string
}

export interface Report {
  date: string
  environment: string
  ffmpegVersion: string
  fixture: string
  results: Result[]
}

export interface ParityOptions {
  ids?: string[]
  ramps?: boolean
  signal?: AbortSignal
  profile?: 'rgba' | 'yuv420p'
  params?: Record<string, Record<string, number>>
  sampleFrames?: number[]
}

interface InputSequence {
  name: string
  bytes: Uint8Array
  preview: Uint8Array
}

function inputArgs(name: string, profile: 'rgba' | 'yuv420p'): string[] {
  return ['-f', 'rawvideo', '-pixel_format', profile, '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', name]
}

async function prepareInputs(profile: 'rgba' | 'yuv420p'): Promise<InputSequence[]> {
  const sequences: InputSequence[] = ([['moving.raw', true, false], ['a.raw', false, false], ['b.raw', false, true]] as const).map(([name, moving, second]) => {
    const bytes = new Uint8Array(BYTES * FRAMES)
    for (let frame = 0; frame < FRAMES; frame++) bytes.set(fixture(moving ? frame : 0, second), frame * BYTES)
    return { name, bytes, preview: bytes }
  })
  if (profile === 'rgba') return sequences
  const ffmpeg = await createFFmpeg()
  try {
    for (const sequence of sequences) {
      await ffmpeg.writeFile('source.raw', sequence.bytes.slice())
      const encode = await ffmpeg.exec([...inputArgs('source.raw', 'rgba'), '-pix_fmt', profile, '-f', 'rawvideo', '-y', 'video.raw'])
      const decode = await ffmpeg.exec([...inputArgs('video.raw', profile), '-pix_fmt', 'rgba', '-f', 'rawvideo', '-y', 'preview.raw'])
      if (encode !== 0 || decode !== 0) throw new Error('Failed to prepare YUV parity fixture')
      sequence.bytes = await ffmpeg.readFile('video.raw') as Uint8Array
      sequence.preview = await ffmpeg.readFile('preview.raw') as Uint8Array
    }
    return sequences
  } finally {
    ffmpeg.terminate()
  }
}

function fixture(frame: number, second = false): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(BYTES)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      const checker = ((x >> 2) + (y >> 2)) % 2
      const square = x >= 12 + frame * 5 && x < 34 + frame * 5 && y > 18 && y < 50
      pixels[i] = second ? 255 - x / WIDTH * 255 : x / (WIDTH - 1) * 255
      pixels[i + 1] = y / (HEIGHT - 1) * 255
      pixels[i + 2] = y > 60 ? checker * 255 : (second ? 190 : 65)
      if (square) { pixels[i] = 245; pixels[i + 1] = 40; pixels[i + 2] = 30 }
      pixels[i + 3] = 255
    }
  }
  return pixels
}

function canvas(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const output = document.createElement('canvas')
  output.width = WIDTH
  output.height = HEIGHT
  output.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT), 0, 0)
  return output
}

function compare(pixi: Uint8ClampedArray, ffmpeg: Uint8ClampedArray, time: number): Sample {
  const difference = new Uint8ClampedArray(BYTES)
  const overlay = new Uint8ClampedArray(BYTES)
  let sum = 0
  let max = 0
  let changed = 0
  for (let i = 0; i < BYTES; i += 4) {
    let pixelMax = 0
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(pixi[i + c] - ffmpeg[i + c])
      sum += delta
      max = Math.max(max, delta)
      pixelMax = Math.max(pixelMax, delta)
      difference[i + c] = delta * 4
      overlay[i + c] = (pixi[i + c] + ffmpeg[i + c]) / 2
    }
    if (pixelMax > 8) changed++
    difference[i + 3] = overlay[i + 3] = 255
  }
  return {
    time, mae: sum / (WIDTH * HEIGHT * 3), max,
    changedPercent: changed / (WIDTH * HEIGHT) * 100,
    pixi: canvas(pixi).toDataURL(), ffmpeg: canvas(ffmpeg).toDataURL(),
    difference: canvas(difference).toDataURL(), overlay: canvas(overlay).toDataURL(),
  }
}

async function renderPixi(app: Application, ids: string[], params: Result['params'], inputs: InputSequence[], frame: number, variant: string, history: PixiHistory, transition?: EffectDef) {
  const time = frame / FPS
  const size = { w: WIDTH, h: HEIGHT, fps: FPS }
  const plans = transition
    ? [{ kind: 'custom' as const, ...planPixiTransition(transition.id, time).reveal! }]
    : ids.flatMap(id => planPixiEffect(id, params[id], variant === 'ramp' ? rampIntensityAt(ramp, time) : 1, time, size, variant === 'ramp').map((plan, index) => ({ ...plan, key: `${id}/${index}` })))
  const built: PixiBuiltFilters = transition ? { filters: [], transform: null } : createPixiFilters(plans, size, { x: 1, y: 1 }, history)
  if (transition) built.filters = [createPixiTransitionFilter(planPixiTransition(transition.id, time).reveal, size)!]
  const textures: Texture[] = []
  const add = (pixels: Uint8ClampedArray) => {
    const texture = Texture.from(canvas(pixels))
    textures.push(texture)
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5)
    sprite.position.set(WIDTH / 2, HEIGHT / 2)
    app.stage.addChild(sprite)
    return sprite
  }
  const sourceFrame = (index: number) => new Uint8ClampedArray(inputs[index].preview.slice(frame * BYTES, (frame + 1) * BYTES))
  if (transition) add(sourceFrame(1))
  const sprite = add(sourceFrame(transition ? 2 : 0))
  sprite.filters = built.filters
  const t = built.transform
  if (t) {
    sprite.position.set(WIDTH / 2 + t.dx, HEIGHT / 2 + t.dy)
    sprite.rotation = t.rotation * Math.PI / 180
    sprite.skew.set(t.shearX, t.shearY)
    sprite.scale.set(t.scaleX * (t.mirrorH ? -1 : 1), t.scaleY * (t.mirrorV ? -1 : 1))
  }
  const shaderErrors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    shaderErrors.push(args.map(String).join(' '))
    originalError(...args)
  }
  try {
    app.render()
    // Read the screen, not auto-bounds of the filtered sprite: preserve black
    // borders, transforms, and the backdrop required by the transition shader.
    const pixels = app.renderer.extract.pixels({ target: app.stage, frame: new Rectangle(0, 0, WIDTH, HEIGHT) }).pixels
    if (shaderErrors.length) throw new Error(shaderErrors.join('\n'))
    return { pixels: new Uint8ClampedArray(pixels), plans }
  } finally {
    console.error = originalError
    app.stage.removeChildren().forEach(child => child.destroy())
    built.filters.forEach(filter => filter.destroy())
    textures.forEach(texture => texture.destroy(true))
  }
}

export async function runParity(onResult: (result: Result, done: number, total: number) => void, options: ParityOptions = {}): Promise<Report> {
  const profile = options.profile ?? 'rgba'
  const inputs = await prepareInputs(profile)
  const sampleFrames = options.sampleFrames ?? SAMPLES
  const report: Report = {
    date: new Date().toISOString(), environment: navigator.userAgent, ffmpegVersion: '',
    fixture: `${WIDTH}x${HEIGHT}, ${profile}, ${FPS} fps, 1s; moving square, gradients, checkerboard; transitions use static A/B; samples ${sampleFrames.map(frame => frame / FPS).join('/')}s; Pixi uses the same decoded input; WebGL resolution=1`,
    results: [],
  }
  const app = new Application()
  await app.init({ width: WIDTH, height: HEIGHT, resolution: 1, preference: 'webgl', useBackBuffer: true, background: 0, antialias: false, autoStart: false })
  let ffmpeg: Awaited<ReturnType<typeof createFFmpeg>> | undefined
  const logs: string[] = []
  const shaderFailures = new Map<string, string>()
  const log = ({ message }: { message: string }) => {
    if (message.startsWith('ffmpeg version')) report.ffmpegVersion = message
    logs.push(message)
    if (logs.length > 30) logs.shift()
  }
  const definitions = EFFECTS.filter(def => !options.ids || options.ids.includes(def.id))
  const cases = [
    { ids: [] as string[], variant: 'baseline', transition: undefined as EffectDef | undefined },
    ...definitions.flatMap(def => {
      const entry = { ids: [def.id], variant: 'default', transition: def.kind === 'transition' ? def : undefined }
      return options.ramps && effectSupportsRamp(def.id) ? [entry, { ...entry, variant: 'ramp' }] : [entry]
    }),
    ...(!options.ids ? [['glow-bloom', 'contrast-pop', 'vignette'], ['comic-book', 'color-boost', 'sharpen-edges'], ['thermal', 'glitch-bands', 'scanlines']].map(ids => ({ ids, variant: 'stack', transition: undefined })) : []),
  ]
  try {
    for (const entry of cases) {
      if (options.signal?.aborted) break
      const { ids, variant, transition } = entry
      const result: Result = { id: ids.join(' + ') || 'baseline', kind: transition ? 'transition' : 'effect', variant, params: Object.fromEntries(ids.map(id => [id, { ...defaultEffectParams(id), ...options.params?.[id] }])), graph: '', plans: [], status: 'measured', notes: [], samples: [] }
      logs.length = 0
      const history = new PixiHistory()
      try {
        // A failed native filter can corrupt WASM memory. Each case owns a fresh
        // worker so one crash cannot invalidate the rest of the catalog.
        ffmpeg = await createFFmpeg()
        ffmpeg.on('log', log)
        for (const input of inputs) await ffmpeg.writeFile(input.name, input.bytes.slice())
        const chain = ids.length && !transition ? buildFilterChain(ids.map(id => ({ id, params: result.params[id], ramp: variant === 'ramp' ? ramp : null })), 1) : 'null'
        result.graph = transition ? `[0:v]format=rgb24,format=yuv444p[ta];[1:v]format=rgb24,format=yuv444p[tb];[ta][tb]xfade=${xfadeFilter(transition.xfade!)}:duration=1:offset=0` : chain
        // Geometry effects (crop+scale wobble) output a larger frame than the
        // project size; the real export scales back to project afterwards,
        // while the Pixi preview fills the frame directly. Normalize FFmpeg
        // output to the frame size with bilinear resampling (Pixi uses linear
        // sampling too) so the comparison measures content, not dimensions.
        // Identity for same-size outputs; baseline verifies it stays exact.
        const normalize = `scale=${WIDTH}:${HEIGHT}:flags=bilinear`
        const args = transition ? [...inputArgs('a.raw', profile), ...inputArgs('b.raw', profile), '-filter_complex', `${result.graph},${normalize}[out]`, '-map', '[out]'] : [...inputArgs('moving.raw', profile), '-vf', `${result.graph},${normalize}`]
        const code = await ffmpeg.exec(['-v', 'info', ...args, '-frames:v', String(FRAMES), '-pix_fmt', 'rgba', '-f', 'rawvideo', '-y', 'out.rgba'], 30_000)
        if (code !== 0) throw new Error(`FFmpeg exit ${code}: ${logs.join('\n')}`)
        const output = await ffmpeg.readFile('out.rgba')
        if (!(output instanceof Uint8Array)) throw new Error('Expected binary FFmpeg output')
        const renderFrames = ids.some(id => HISTORY_EFFECTS.has(id)) ? Array.from({ length: Math.max(...sampleFrames) + 1 }, (_, index) => index) : sampleFrames
        for (const frame of renderFrames) {
          const cachedFailure = ids.map(id => shaderFailures.get(id)).find(Boolean)
          if (cachedFailure) throw new Error(`Previously failed shader in this renderer: ${cachedFailure}`)
          const rendered = await renderPixi(app, ids, result.params, inputs, frame, variant, history, transition).catch(error => {
            if (/shader|Index expression|Loop index/i.test(String(error))) ids.forEach(id => shaderFailures.set(id, String(error)))
            throw error
          })
          if (!sampleFrames.includes(frame)) continue
          result.plans.push({ time: frame / FPS, plans: rendered.plans })
          const skipped = rendered.plans.filter(plan => plan.kind === 'skip')
          if (skipped.length) {
            result.status = 'partial'
            for (const plan of skipped) if (plan.kind === 'skip' && !result.notes.includes(plan.reason)) result.notes.push(plan.reason)
          }
          if (output.length < (frame + 1) * BYTES) {
            result.status = 'partial'
            result.notes.push(`No output frame ${frame}; cadence/history requires editor-level testing.`)
            continue
          }
          result.samples.push(compare(rendered.pixels, new Uint8ClampedArray(output.slice(frame * BYTES, (frame + 1) * BYTES)), frame / FPS))
        }
      } catch (error) {
        result.status = 'error'
        result.error = String(error)
      } finally {
        history.dispose()
        ffmpeg?.terminate()
        ffmpeg = undefined
      }
      report.results.push(result)
      onResult(result, report.results.length, cases.length)
    }
    return report
  } finally {
    ffmpeg?.terminate()
    app.destroy(true, { children: true })
  }
}
