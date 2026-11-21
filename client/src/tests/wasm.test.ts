import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execCode: 0,
  execError: null as Error | null,
  fetchFile: vi.fn(),
  instances: [] as any[],
}))

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    loaded = false
    load = vi.fn(async () => {
      this.loaded = true
      return true
    })
    writeFile = vi.fn(async () => true)
    readFile = vi.fn(async () => new Uint8Array([1, 2, 3]))
    deleteFile = vi.fn(async () => true)
    exec = vi.fn(async () => {
      if (mocks.execError) throw mocks.execError
      return mocks.execCode
    })
    on = vi.fn()
    off = vi.fn()
    terminate = vi.fn(() => {
      this.loaded = false
    })

    constructor() {
      mocks.instances.push(this)
    }
  },
}))

vi.mock('@ffmpeg/util', () => ({
  fetchFile: mocks.fetchFile,
}))

import {
  createWasmScrub,
  renderAudioTransition,
  renderSegment,
  renderTransition,
  terminateFFmpeg,
} from '../lib/wasm'
import { DEFAULT_CLIP_TRANSFORM } from '../lib/clip-transform'

function mockVideoDuration(duration: number): void {
  const video = {
    duration,
    preload: '',
    onloadedmetadata: null as (() => void) | null,
    onerror: null as (() => void) | null,
    removeAttribute: vi.fn(),
    load: vi.fn(),
    remove: vi.fn(),
    set src(_value: string) {
      queueMicrotask(() => this.onloadedmetadata?.())
    },
  }
  vi.spyOn(document, 'createElement').mockReturnValue(video as unknown as HTMLVideoElement)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
}

describe('ffmpeg-wasm transitions', () => {
  beforeEach(() => {
    terminateFFmpeg()
    mocks.execCode = 0
    mocks.execError = null
    mocks.fetchFile.mockReset().mockResolvedValue(new Uint8Array([4, 5, 6]))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rendered')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('seeks each video input independently and renders video only', async () => {
    await renderTransition({
      inputA: 'blob:a',
      startA: 4,
      inputB: 'blob:b',
      startB: 0.5,
      durationSec: 1,
      xfade: 'wipeleft',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 12)).toEqual([
      '-ss', '4.000', '-t', '1.000', '-i', expect.stringMatching(/^tra_/),
      '-ss', '0.500', '-t', '1.000', '-i', expect.stringMatching(/^trb_/),
    ])
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter.match(/setpts=PTS-STARTPTS/g)).toHaveLength(2)
    expect(filter).toContain('xfade=transition=wipeleft:duration=1.000:offset=0')
    expect(filter).not.toContain('acrossfade')
    expect(args).toContain('-an')
    expect(args).not.toContain('-c:a')
    expect(inst.deleteFile).toHaveBeenCalledTimes(3)
  })

  it('resolves a whitelisted custom transition expression', async () => {
    await renderTransition({
      inputA: 'blob:a',
      startA: 0,
      inputB: 'blob:b',
      startB: 0,
      durationSec: 0.6,
      xfade: 'custom-whip-left',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain("xfade=transition=custom:expr='min(255,if(lt(X/W,(1-P)),B,A)")
    expect(filter).toContain(':duration=0.600:offset=0[v]')
  })

  it('cuts a root effect in source time and retimes it once', async () => {
    const result = await renderSegment({
      input: 'blob:source',
      startSec: 3,
      durationSec: 4,
      playbackRate: 2,
      filter: 'hue=s=0',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 7)).toEqual([
      '-ss', '3.000', '-t', '4.000', '-i', expect.stringMatching(/^in_/), '-vf',
    ])
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'setpts=(PTS-STARTPTS)/2,hue=s=0,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    )
    expect(args).toEqual(expect.arrayContaining(['-crf', '27', '-pix_fmt', 'yuv420p']))
    expect(result.durationSec).toBe(2)
  })

  it('does not retime an effect child whose parent already has baked speed', async () => {
    await renderSegment({
      input: 'blob:parent',
      startSec: 0.5,
      durationSec: 2,
      filter: 'vignette',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 7)).toEqual([
      '-i', expect.stringMatching(/^in_/), '-ss', '0.500', '-t', '2.000', '-vf',
    ])
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'vignette,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    )
  })

  it('loops a still image for the full effect duration', async () => {
    await renderSegment({
      input: 'blob:image',
      startSec: 4,
      durationSec: 10,
      playbackRate: 1,
      mediaKind: 'image',
      fileName: 'photo.jpg',
      filter: 'vignette',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 8)).toEqual([
      '-loop', '1', '-framerate', '30', '-t', '10.000', '-i', expect.stringMatching(/^in_.*\.jpg$/),
    ])
    expect(args).not.toContain('4.000')
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'setpts=PTS-STARTPTS,scale=720:720:force_original_aspect_ratio=decrease,vignette,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    )
  })

  it('cuts and retimes each video transition input at its own rate', async () => {
    await renderTransition({
      inputA: 'blob:a',
      startA: 4,
      inputB: 'blob:b',
      startB: 0.5,
      durationSec: 1,
      playbackRateA: 2,
      playbackRateB: 0.5,
      xfade: 'fade',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 12)).toEqual([
      '-ss', '4.000', '-t', '2.000', '-i', expect.stringMatching(/^tra_/),
      '-ss', '0.500', '-t', '0.500', '-i', expect.stringMatching(/^trb_/),
    ])
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('setpts=(PTS-STARTPTS)/2')
    expect(filter).toContain('setpts=(PTS-STARTPTS)/0.5')
    expect(filter).toContain('xfade=transition=fade:duration=1.000:offset=0')
  })

  it('loops still images instead of seeking their virtual source time', async () => {
    await renderTransition({
      inputA: 'blob:image',
      startA: 7,
      mediaKindA: 'image',
      fileNameA: 'photo.jpg',
      inputB: 'blob:video',
      startB: 0.5,
      mediaKindB: 'video',
      durationSec: 1,
      xfade: 'fade',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 13)).toEqual([
      '-loop', '1', '-framerate', '30', '-t', '1.000', '-i', expect.stringMatching(/^tra_.*\.jpg$/),
      '-ss', '0.500', '-t', '1.000', '-i',
    ])
    expect(args).not.toContain('7.000')
    expect(args).toEqual(expect.arrayContaining(['-map', '[v]', '-an', '-t', '1.000']))
  })

  it('concatenates effected regions and transforms each transition side independently', async () => {
    await renderTransition({
      inputA: 'blob:a',
      startA: 0,
      inputB: 'blob:b',
      startB: 0,
      durationSec: 1,
      segmentsA: [
        { input: new Blob(['a0']), start: 0.5, durationSec: 0.4 },
        { input: new Blob(['a1']), start: 0, durationSec: 0.6 },
      ],
      segmentsB: [{ input: new Blob(['b0']), start: 0.25, durationSec: 1 }],
      transformA: { ...DEFAULT_CLIP_TRANSFORM, positionX: -10 },
      transformKeyframesA: [
        { time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM } },
        { time: 4, transform: { ...DEFAULT_CLIP_TRANSFORM, positionX: -10 } },
      ],
      transformOffsetA: 3,
      transformB: { ...DEFAULT_CLIP_TRANSFORM, positionX: 12, rotation: 5 },
      transformOffsetB: 0,
      xfade: 'fade',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('[as0][as1]concat=n=2:v=1:a=0[ajoined]')
    expect(filter).toContain('shear@transition_a_shear')
    expect(filter).toContain('shear@transition_b_shear')
    expect(filter).toContain('[v0][v1]xfade=transition=fade')
    expect(filter).toContain('on/30+3')
    expect(args.filter((item) => item === '-i')).toHaveLength(3)
    expect(inst.deleteFile).toHaveBeenCalledTimes(4)
  })

  it('creates an all-I-frame scrub proxy for a short source', async () => {
    const input = new File(['source'], 'source.mov', { type: 'video/quicktime' })
    mockVideoDuration(12.5)

    const result = await createWasmScrub({ input })

    const inst = mocks.instances.at(-1)
    expect(mocks.fetchFile).toHaveBeenCalledWith(input)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args).toEqual(expect.arrayContaining([
      '-vf', 'scale=480:-2,setsar=1,format=yuv420p',
      '-g', '1',
      '-keyint_min', '1',
      '-sc_threshold', '0',
      '-crf', '27',
      '-preset', 'ultrafast',
    ]))
    expect(result.durationSec).toBe(12.5)
    expect(result.blobUrl).toBe('blob:rendered')
    expect(inst.deleteFile).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rendered')
  })

  it('reduces frame rate and keyframe frequency for a source over two minutes', async () => {
    const input = new File(['source'], 'long-source.mov', { type: 'video/quicktime' })
    mockVideoDuration(120.001)

    await createWasmScrub({ input, aspect: 'portrait' })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args).toEqual(expect.arrayContaining([
      '-vf', 'fps=15,scale=-2:480,setsar=1,format=yuv420p',
      '-g', '30',
      '-keyint_min', '30',
    ]))
  })

  it('normalizes transition previews to encoder-safe even dimensions', async () => {
    await renderTransition({
      inputA: 'blob:a',
      startA: 0,
      inputB: 'blob:b',
      startB: 0,
      durationSec: 1,
      xfade: 'fade',
      aspect: 'portrait',
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('scale=406:720:force_original_aspect_ratio=decrease:force_divisible_by=2')
    expect(filter).toContain('pad=406:720')
  })

  it('center-crops both transition inputs when fill framing is selected', async () => {
    await renderTransition({
      inputA: 'blob:a', startA: 0, inputB: 'blob:b', startB: 0,
      durationSec: 1, xfade: 'fade', aspect: 'portrait', fit: 'cover',
    })
    const args = mocks.instances.at(-1).exec.mock.calls[0][0] as string[]
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter.match(/crop=406:720:\(iw-ow\)\/2:\(ih-oh\)\/2/g)).toHaveLength(2)
    expect(filter).not.toContain('pad=406:720')
  })

  it('seeks each audio input independently and resets timestamps', async () => {
    await renderAudioTransition({
      inputA: 'blob:a',
      startA: 3.25,
      inputB: 'blob:b',
      startB: 1,
      durationSec: 0.75,
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 12)).toEqual([
      '-ss', '3.250', '-t', '0.750', '-i', expect.stringMatching(/^atina_/),
      '-ss', '1.000', '-t', '0.750', '-i', expect.stringMatching(/^atinb_/),
    ])
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter.match(/asetpts=PTS-STARTPTS/g)).toHaveLength(2)
    expect(filter).toContain('acrossfade=d=0.750')
  })

  it('cuts and atempo-retimes each audio transition input at its own rate', async () => {
    await renderAudioTransition({
      inputA: 'blob:a',
      startA: 3.25,
      inputB: 'blob:b',
      startB: 1,
      durationSec: 0.75,
      playbackRateA: 4,
      playbackRateB: 0.25,
    })

    const inst = mocks.instances.at(-1)
    const args = inst.exec.mock.calls[0][0] as string[]
    expect(args.slice(0, 12)).toEqual([
      '-ss', '3.250', '-t', '3.000', '-i', expect.stringMatching(/^atina_/),
      '-ss', '1.000', '-t', '0.188', '-i', expect.stringMatching(/^atinb_/),
    ])
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('[0:a]atempo=2,atempo=2,asetpts=PTS-STARTPTS[a0]')
    expect(filter).toContain('[1:a]atempo=0.5,atempo=0.5,asetpts=PTS-STARTPTS[a1]')
    expect(filter).toContain('acrossfade=d=0.750')
  })

  it('cleans transition files when ffmpeg exits with an error', async () => {
    mocks.execCode = 1

    await expect(renderTransition({
      inputA: 'blob:a',
      startA: 0,
      inputB: 'blob:b',
      startB: 0,
      durationSec: 1,
      xfade: 'fade',
    })).rejects.toThrow('ffmpeg exited with code 1')

    const inst = mocks.instances.at(-1)
    expect(inst.deleteFile).toHaveBeenCalledTimes(3)
  })
})
