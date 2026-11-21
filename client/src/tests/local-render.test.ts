import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderPayload } from '../lib/api'

const mocks = vi.hoisted(() => {
  const commands: string[][] = []
  const files = new Map<string, Uint8Array<ArrayBuffer>>()
  const inst = {
    loaded: true,
    writeFile: vi.fn(async (name: string, data: Uint8Array<ArrayBuffer>) => {
      files.set(name, data)
      return true
    }),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    deleteFile: vi.fn(async (name: string) => {
      files.delete(name)
      return true
    }),
    terminate: vi.fn(() => undefined),
  }
  return { commands, files, inst, fetchFile: vi.fn() }
})

vi.mock('@ffmpeg/util', () => ({
  fetchFile: mocks.fetchFile,
}))

vi.mock('../lib/wasm', () => ({
  createFFmpeg: vi.fn(async (onProgress?: (ratio: number, message: string) => void) => {
    onProgress?.(1, 'ready')
    return mocks.inst
  }),
  execGuarded: vi.fn(async (
    _inst: unknown,
    args: string[],
    onProgress?: (ratio: number) => void,
  ) => {
    mocks.commands.push([...args])
    onProgress?.(1)
  }),
}))

import { compileProjectLocal } from '../lib/local-render'
import { rememberLocalSource } from '../lib/local-media'
import { DEFAULT_CLIP_TRANSFORM, TRANSFORM_PRESETS, transformPreset, type TransformPreset } from '../lib/clip-transform'

function commandWith(option: string, value: string): string[] | undefined {
  return mocks.commands.find((args) => {
    const index = args.indexOf(option)
    return index >= 0 && args[index + 1]?.includes(value)
  })
}

describe('local ffmpeg-wasm render', () => {
  beforeEach(() => {
    mocks.commands.length = 0
    mocks.files.clear()
    mocks.inst.loaded = true
    mocks.inst.writeFile.mockClear()
    mocks.inst.readFile.mockClear()
    mocks.inst.deleteFile.mockClear()
    mocks.inst.terminate.mockClear()
    mocks.fetchFile.mockReset().mockResolvedValue(new Uint8Array([9, 8, 7]))
  })

  it('reproduces the server video, audio, composite, mix, and mux stages', async () => {
    const payload: RenderPayload = {
      resolution: { w: 1280, h: 720 },
      fps: 25,
      videoChannels: [
        {
          clips: [
            {
              file: 'source.mp4', inPoint: 0, outPoint: 3, start: 1,
              segments: [
                { srcStart: 0, srcEnd: 1, effects: [] },
                { srcStart: 1, srcEnd: 3, effects: [{ id: 'blur', params: {
                  lumaRadius: 18,
                  lumaPower: 2,
                  chromaRadius: 9,
                  chromaPower: 1,
                } }] },
              ],
            },
            {
              file: 'source.mp4', inPoint: 3, outPoint: 6, start: 3,
              segments: [],
            },
          ],
          transitions: [{ rightClipIndex: 1, xfade: 'wipeleft' }],
        },
        {
          clips: [{
            file: 'overlay.mov', inPoint: 0, outPoint: 2, start: 2, segments: [],
          }],
        },
      ],
      audioChannels: [
        {
          clips: [
            { file: 'source.mp4', inPoint: 0, outPoint: 3, start: 0, volume: 0, segments: [] },
            { file: 'source.mp4', inPoint: 3, outPoint: 6, start: 2, volume: 50, segments: [] },
          ],
        },
        {
          clips: [{ file: 'music.wav', inPoint: 0, outPoint: 2, start: 1, volume: 150, segments: [] }],
        },
      ],
    }
    const progress: number[] = []
    const resolveSource = vi.fn(async () => new Blob(['source']))

    const result = await compileProjectLocal(payload, {
      resolveSource,
      onProgress: ({ ratio }) => progress.push(ratio),
    })

    expect(result.filename).toBe('render_output.mp4')
    expect(result.blob.type).toBe('video/mp4')
    expect(result.blob.size).toBe(4)
    expect(resolveSource).toHaveBeenCalledTimes(3)

    const effectCommand = commandWith('-vf', 'boxblur=luma_radius=')
    expect(effectCommand).toEqual(expect.arrayContaining([
      '-vf', expect.stringContaining('scale=1280:720:force_original_aspect_ratio=decrease'),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-r', '25',
    ]))
    const videoEncodeCommands = mocks.commands.filter((args) => (
      args.includes('libx264') && !args.at(-1)?.includes('render_output')
    ))
    expect(videoEncodeCommands.length).toBeGreaterThan(0)
    expect(videoEncodeCommands.every((args) => {
      const preset = args.indexOf('-preset')
      return preset >= 0 && args[preset + 1] === 'ultrafast'
    })).toBe(true)

    const xfadeCommand = commandWith('-filter_complex', 'xfade=transition=wipeleft')!
    const xfadeFilter = xfadeCommand[xfadeCommand.indexOf('-filter_complex') + 1]
    expect(xfadeFilter).toContain('duration=1:offset=2')

    const overlayCommand = commandWith('-filter_complex', "overlay=eof_action=pass")!
    expect(overlayCommand[overlayCommand.indexOf('-filter_complex') + 1])
      .toContain("enable='between(t,2,4)'")

    const acrossfadeCommand = commandWith('-filter_complex', 'acrossfade=d=1')
    expect(acrossfadeCommand).toBeTruthy()
    expect(commandWith('-filter_complex', 'amix=inputs=2:duration=longest')).toBeTruthy()
    const audioVolumeFilters = mocks.commands
      .filter((args) => args.includes('-af'))
      .map((args) => args[args.indexOf('-af') + 1])
    expect(audioVolumeFilters).toEqual(['volume=0', 'volume=0.5', 'volume=1.5'])

    const muxCommand = mocks.commands.find((args) => args.includes('0:v:0') && args.includes('1:a:0'))
    expect(muxCommand).toEqual(expect.arrayContaining([
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '160k',
    ]))
    expect(mocks.commands.some((args) => args.includes('color=c=black:s=1280x720:r=25'))).toBe(true)
    expect(mocks.commands.some((args) => args.includes('anullsrc=r=44100:cl=stereo'))).toBe(true)
    expect(progress.at(-1)).toBe(1)
    expect(mocks.files.size).toBe(0)
    expect(mocks.inst.terminate).toHaveBeenCalledOnce()
  })

  it('uses a local File directly instead of downloading an uploaded source', async () => {
    const localFile = new File(['local video'], 'browser-only.mp4', { type: 'video/mp4' })
    const sourceId = rememberLocalSource(localFile)
    const fetchMock = vi.fn(() => Promise.reject(new Error('network should not be used')))
    vi.stubGlobal('fetch', fetchMock)
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [{
        clips: [{
          file: localFile.name,
          sourceMode: 'wasm',
          sourceId,
          inPoint: 0,
          outPoint: 1,
          start: 0,
          segments: [],
        }],
      }],
      audioChannels: [],
    }

    await compileProjectLocal(payload)

    expect(mocks.fetchFile).toHaveBeenCalledWith(localFile)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crops footage and its alpha mask identically before portrait transitions', async () => {
    await compileProjectLocal({
      fit: 'cover', resolution: { w: 720, h: 1280 }, fps: 30,
      videoChannels: [{ clips: [
        { file: 'first.mp4', inPoint: 0, outPoint: 2, start: 0, segments: [] },
        { file: 'second.mp4', inPoint: 0, outPoint: 2, start: 1, segments: [] },
      ], transitions: [{ rightClipIndex: 1, xfade: 'fade' }] }],
      audioChannels: [],
    }, { resolveSource: async () => new Blob(['source']) })

    const filters = mocks.commands.filter(args => args.includes('-vf')).map(args => args[args.indexOf('-vf') + 1])
    const cropped = filters.filter(filter => filter.includes('crop=720:1280:(iw-ow)/2:(ih-oh)/2'))
    expect(cropped).toHaveLength(4)
    expect(cropped.filter(filter => filter.includes('alphaextract'))).toHaveLength(2)
    expect(cropped.every(filter => !filter.includes('pad=720:1280'))).toBe(true)
    expect(commandWith('-filter_complex', 'xfade=transition=fade')).toBeDefined()
  })

  it('exports MP3 from audio channels only using the selected quality', async () => {
    const payload: RenderPayload = {
      format: 'mp3',
      quality: 'high',
      resolution: { w: 1920, h: 1080 },
      fps: 30,
      videoChannels: [{
        clips: [{ file: 'ignored-video.mp4', inPoint: 0, outPoint: 2, start: 0, segments: [] }],
      }],
      audioChannels: [{
        clips: [{ file: 'voice.wav', inPoint: 0, outPoint: 2, start: 0, segments: [] }],
      }],
    }
    const resolveSource = vi.fn(async () => new Blob(['source']))

    const result = await compileProjectLocal(payload, { resolveSource })

    expect(result.filename).toBe('render_output.mp3')
    expect(result.blob.type).toBe('audio/mpeg')
    expect(resolveSource).toHaveBeenCalledOnce()
    expect(resolveSource).toHaveBeenCalledWith('voice.wav', expect.any(Object))
    expect(mocks.commands.some((args) => args.includes('libx264'))).toBe(false)
    expect(mocks.commands.at(-1)).toEqual(expect.arrayContaining([
      '-vn', '-c:a', 'libmp3lame', '-b:a', '256k',
    ]))
    expect(mocks.commands.at(-1)?.at(-1)).toMatch(/render_output.*\.mp3$/)
  })

  it('exports low-quality AVI with MPEG-4 video and MP3 audio', async () => {
    const payload: RenderPayload = {
      format: 'avi',
      quality: 'low',
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [{
        clips: [{ file: 'video.mp4', inPoint: 0, outPoint: 1, start: 0, segments: [] }],
      }],
      audioChannels: [{
        clips: [{ file: 'audio.wav', inPoint: 0, outPoint: 1, start: 0, segments: [] }],
      }],
    }

    const result = await compileProjectLocal(payload, {
      resolveSource: async () => new Blob(['source']),
    })

    expect(result.filename).toBe('render_output.avi')
    expect(result.blob.type).toBe('video/x-msvideo')
    expect(mocks.commands.at(-1)).toEqual(expect.arrayContaining([
      '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'libmp3lame', '-b:a', '96k',
    ]))
  })

  it('fails without a network request when a WASM source is unavailable', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network should not be used')))
    vi.stubGlobal('fetch', fetchMock)
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [{
        clips: [{
          file: 'missing-local.mp4',
          sourceMode: 'wasm',
          sourceId: 'missing-source',
          inPoint: 0,
          outPoint: 1,
          start: 0,
          segments: [],
        }],
      }],
      audioChannels: [],
    }

    await expect(compileProjectLocal(payload)).rejects.toThrow('Local source is unavailable for missing-local.mp4')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('coalesces continuous source cuts and AAC-encodes only the completed PCM timeline', async () => {
    const boundaries = [0, 0.431, 0.917, 1.376, 2]
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [],
      audioChannels: [{
        clips: boundaries.slice(0, -1).map((start, index) => ({
          file: 'continuous.wav',
          mediaKind: 'audio',
          inPoint: start,
          outPoint: boundaries[index + 1],
          start,
          volume: 100,
          segments: [],
        })),
      }],
    }
    const resolveSource = vi.fn(async () => new Blob(['continuous audio']))

    await compileProjectLocal(payload, { resolveSource })

    const pcmClipCommands = mocks.commands.filter((args) => {
      const codec = args.indexOf('-c:a')
      return args.includes('-ss') && codec >= 0 && args[codec + 1] === 'pcm_f32le'
    })
    expect(pcmClipCommands).toHaveLength(1)
    expect(pcmClipCommands[0]).toEqual(expect.arrayContaining([
      '-ss', '0', '-t', '2', '-af', 'volume=1',
    ]))
    expect(pcmClipCommands[0].at(-1)).toMatch(/audio_clip.*\.w64$/)

    const aacCommands = mocks.commands.filter((args) => {
      const codec = args.indexOf('-c:a')
      return codec >= 0 && args[codec + 1] === 'aac'
    })
    expect(aacCommands).toHaveLength(1)
    expect(aacCommands[0].at(-1)).toMatch(/render_output.*\.mp4$/)
    expect(resolveSource).toHaveBeenCalledOnce()
    expect(mocks.fetchFile).toHaveBeenCalledOnce()
  })

  it('renders source spans at per-clip rates and uses timeline durations for transitions and gaps', async () => {
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [{
        clips: [
          {
            file: 'video.mp4', inPoint: 0, outPoint: 4, start: 0, playbackRate: 2,
            segments: [{ srcStart: 0, srcEnd: 4, effects: [] }],
          },
          {
            file: 'video.mp4', inPoint: 4, outPoint: 5, start: 1, playbackRate: 0.5,
            segments: [],
          },
        ],
        transitions: [{ rightClipIndex: 1, xfade: 'fade' }],
      }],
      audioChannels: [{
        clips: [
          {
            file: 'audio.wav', inPoint: 10, outPoint: 11, start: 0, playbackRate: 0.25,
            volume: 25, segments: [],
          },
          {
            file: 'audio.wav', inPoint: 20, outPoint: 24, start: 4, playbackRate: 4,
            volume: 100, segments: [],
          },
        ],
      }],
    }

    await compileProjectLocal(payload, {
      resolveSource: async () => new Blob(['source']),
    })

    const fastVideo = commandWith('-vf', 'setpts=(PTS-STARTPTS)/2')!
    expect(fastVideo).toEqual(expect.arrayContaining(['-ss', '0', '-t', '4']))
    const slowVideo = commandWith('-vf', 'setpts=(PTS-STARTPTS)/0.5')!
    expect(slowVideo).toEqual(expect.arrayContaining(['-ss', '4', '-t', '1']))

    const xfade = commandWith('-filter_complex', 'xfade=transition=fade')!
    expect(xfade[xfade.indexOf('-filter_complex') + 1]).toContain('duration=1:offset=1')

    const slowAudio = commandWith('-af', 'atempo=0.5,atempo=0.5,volume=0.25')!
    expect(slowAudio).toEqual(expect.arrayContaining(['-ss', '10', '-t', '1']))
    const fastAudio = commandWith('-af', 'atempo=2,atempo=2,volume=1')!
    expect(fastAudio).toEqual(expect.arrayContaining(['-ss', '20', '-t', '4']))

    const finalBlackGap = mocks.commands.find((args) => args.includes('color=c=black:s=640x360:r=30'))!
    expect(finalBlackGap).toEqual(expect.arrayContaining(['-t', '2']))
  })

  it('pins effected video segments to cumulative timeline frame boundaries', async () => {
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [{
        clips: [
          {
            file: 'effected.mp4', inPoint: 0, outPoint: 3, start: 0,
            segments: [
              { srcStart: 0, srcEnd: 1.05, effects: [{ id: 'grayscale', params: {} }] },
              { srcStart: 1.05, srcEnd: 3, effects: [] },
            ],
          },
          {
            file: 'next.mp4', inPoint: 0, outPoint: 3, start: 3,
            segments: [],
          },
        ],
      }],
      audioChannels: [{
        clips: [{ file: 'next.mp4', inPoint: 0, outPoint: 3, start: 3, segments: [] }],
      }],
    }

    await compileProjectLocal(payload, { resolveSource: async () => new Blob(['source']) })

    const segmentFilters = mocks.commands
      .filter((args) => args.includes('-vf'))
      .map((args) => args[args.indexOf('-vf') + 1])
    expect(segmentFilters).toEqual(expect.arrayContaining([
      expect.stringContaining('hue=s=0,scale=640:360'),
      expect.stringContaining('trim=end_frame=32,setpts=N/(30*TB)'),
      expect.stringContaining('trim=end_frame=58,setpts=N/(30*TB)'),
      expect.stringContaining('trim=end_frame=90,setpts=N/(30*TB)'),
    ]))
    expect(segmentFilters.every((filter) => filter.includes('tpad=stop_mode=clone:stop=-1'))).toBe(true)
  })

  it('composites an effected image b-roll with opacity and edge fades', async () => {
    const payload: RenderPayload = {
      resolution: { w: 1280, h: 720 },
      fps: 30,
      videoChannels: [
        {
          clips: [{
            file: 'base.jpg', mediaKind: 'image', inPoint: 0, outPoint: 5, start: 0, segments: [],
          }],
        },
        {
          clips: [{
            file: 'b-roll.png', mediaKind: 'image', inPoint: 0, outPoint: 3, start: 1,
            opacity: 0.8, fadeIn: 0.5, fadeOut: 0.75,
            transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 0.5, zoomY: 0.5, positionX: 20 },
            segments: [{ srcStart: 0, srcEnd: 3, effects: [{ id: 'grayscale', params: {} }] }],
          }],
        },
      ],
      audioChannels: [],
    }

    await compileProjectLocal(payload, { resolveSource: async () => new Blob(['image']) })

    const effectCommand = commandWith('-vf', 'hue=s=0')
    expect(effectCommand).toEqual(expect.arrayContaining(['-loop', '1']))
    const maskCommand = mocks.commands.find((args) => {
      const filter = args.indexOf('-vf')
      return filter >= 0 && args[filter + 1].includes("lut=y='val*0.8'")
    })!
    const mask = maskCommand[maskCommand.indexOf('-vf') + 1]
    expect(mask).toContain("lut=y='val*0.8'")
    expect(mask).toContain('fade=t=in:st=0:d=0.5:color=black')
    expect(mask).toContain('fade=t=out:st=2.25:d=0.75:color=black')
    expect(mask).toContain('perspective=x0=')
    expect(mask).toContain('shear@mask_transform_shear=')
    const compositeCommand = commandWith('-filter_complex', 'alphamerge[layer]')!
    const composite = compositeCommand[compositeCommand.indexOf('-filter_complex') + 1]
    expect(composite).toContain("overlay=eof_action=pass:format=auto:enable='between(t,1,4)'")
  })

  it.each([1, 0.5])('bounds every composite to the project timeline with base opacity %s', async (opacity) => {
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [
        { clips: [{ file: 'base.mp4', inPoint: 0, outPoint: 1, start: 0, opacity, segments: [] }] },
        { clips: [{ file: 'overlay.png', mediaKind: 'image', inPoint: 0, outPoint: 3, start: 1.5, segments: [] }] },
      ],
      audioChannels: [],
    }

    await compileProjectLocal(payload, { resolveSource: async () => new Blob(['source']) })

    const composites = mocks.commands
      .filter((args) => args.at(-1)?.includes('video_composite'))
      .map((args) => args[args.indexOf('-filter_complex') + 1])
    expect(composites).toHaveLength(opacity === 1 ? 1 : 2)
    for (const filter of composites) {
      expect(filter).toContain('[0:v]setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=add:stop=-1,trim=end_frame=135,setpts=N/(30*TB)[base]')
      expect(filter).not.toContain('stop_mode=clone')
    }
  })

  it('renders a text-only project on black video with a timed PNG overlay', async () => {
    const payload: RenderPayload = {
      resolution: { w: 1920, h: 1080 },
      fps: 30,
      videoChannels: [],
      audioChannels: [],
      textItems: [{
        start: 1.25,
        duration: 2.5,
        x: 120,
        y: 240,
        image: btoa('png bytes'),
      }],
    }

    const result = await compileProjectLocal(payload)

    expect(result.blob.type).toBe('video/mp4')
    expect(mocks.commands.some((args) => args.includes('color=c=black:s=1920x1080:r=30'))).toBe(true)
    const overlay = commandWith('-filter_complex', 'overlay=x=120:y=240')!
    expect(overlay[overlay.indexOf('-filter_complex') + 1]).toContain("enable='gte(t,1.25)*lt(t,3.75)'")
    expect(overlay).toEqual(expect.arrayContaining(['-loop', '1', '-t', '3.75']))
  })

  it('renders animated shear through numeric commands instead of t expressions', async () => {
    const payload: RenderPayload = {
      resolution: { w: 640, h: 360 },
      fps: 30,
      videoChannels: [{
        clips: [{
          file: 'transform.mp4',
          inPoint: 0,
          outPoint: 1.2,
          start: 0,
          transformKeyframes: [
            { time: 0, transform: { ...DEFAULT_CLIP_TRANSFORM } },
            { time: 1.2, transform: { ...DEFAULT_CLIP_TRANSFORM, pitch: 10, yaw: 20 } },
          ],
          segments: [],
        }],
      }],
      audioChannels: [],
    }

    await compileProjectLocal(payload, { resolveSource: async () => new Blob(['source']) })

    const command = commandWith('-vf', 'shear@transform_shear=shx=0:shy=0:fillcolor=black')!
    const filter = command[command.indexOf('-vf') + 1]
    expect(filter).toContain("sendcmd=c='")
    expect(filter).toContain('shear@transform_shear shx -')
    expect(filter).toContain('shear@transform_shear shy -')
    expect(filter).not.toContain("shear=shx='")
    expect(filter).toContain('pad=648:368:4:4:color=black,perspective=')
    expect(filter).toContain(',crop=640:360:4:4,rotate=')
  })

  it('keeps every motion preset centered while zoom changes', async () => {
    const presets: TransformPreset[] = TRANSFORM_PRESETS
      .filter(({ value }) => value !== 'none')
      .map(({ value }) => value)
    for (const preset of presets) {
      mocks.commands.length = 0
      const animation = transformPreset(preset, 2)
      await compileProjectLocal({
        resolution: { w: 640, h: 360 },
        fps: 30,
        videoChannels: [{
          clips: [{
            file: `${preset}.mp4`,
            inPoint: 0,
            outPoint: 2,
            start: 0,
            transform: animation.transform,
            transformKeyframes: animation.keyframes,
            segments: [],
          }],
        }],
        audioChannels: [],
      }, { resolveSource: async () => new Blob(['source']) })

      const command = commandWith('-vf', 'scale=640:360:force_original_aspect_ratio=decrease')
      expect(command, preset).toBeDefined()
      const filter = command![command!.indexOf('-vf') + 1]
      expect(filter).toContain("perspective=x0='")
      expect(filter).toContain('on/30')
      expect(filter).toContain(':eval=frame:interpolation=cubic:sense=source')
      expect(filter).not.toContain("scale=w='max(")
      expect(filter).toContain('crop=640:360:4:4')
    }
  })

  it('renders a text banner with cubic slide-in and slide-out positions', async () => {
    const payload: RenderPayload = {
      resolution: { w: 1920, h: 1080 },
      fps: 30,
      videoChannels: [],
      audioChannels: [],
      textItems: [{
        start: 1,
        duration: 3,
        x: 120,
        y: 700,
        animation: 'slide-left',
        animationDuration: 0.5,
        image: btoa('png bytes'),
      }],
    }

    await compileProjectLocal(payload)

    const overlay = commandWith('-filter_complex', "overlay=x='if(lt(t,1.5)")!
    const filter = overlay[overlay.indexOf('-filter_complex') + 1]
    expect(filter).toContain('120-(120+w)*pow(1-(t-1)/0.5,3)')
    expect(filter).toContain('120-(120+w)*pow((t-3.5)/0.5,3)')
  })

  it('renders a hook pop with matching vertical entrance and exit motion', async () => {
    const payload: RenderPayload = {
      resolution: { w: 1080, h: 1920 },
      fps: 30,
      videoChannels: [],
      audioChannels: [],
      textItems: [{
        start: 0,
        duration: 2,
        x: 120,
        y: 320,
        animation: 'pop',
        animationDuration: 0.25,
        image: btoa('png bytes'),
      }],
    }

    await compileProjectLocal(payload)

    const overlay = commandWith('-filter_complex', "overlay=x=120:y='if(lt(t,0.25)")!
    const filter = overlay[overlay.indexOf('-filter_complex') + 1]
    expect(filter).toContain('0.07*H*pow(1-(t-0)/0.25,5)')
    expect(filter).toContain('320+0.07*H*pow((t-1.75)/0.25,3)')
  })

  it('keeps an active-word overlay on its parent caption bounce trajectory', async () => {
    const payload: RenderPayload = {
      resolution: { w: 1080, h: 1920 },
      fps: 30,
      videoChannels: [],
      audioChannels: [],
      textItems: [{
        start: 2,
        duration: 0.5,
        x: 120,
        y: 320,
        animation: 'bounce',
        animationDuration: 0.25,
        motionStart: 1,
        motionDuration: 3,
        image: btoa('png bytes'),
      }],
    }

    await compileProjectLocal(payload)

    const overlay = commandWith('-filter_complex', "overlay=x=120:y='if(lt(t,1.25)")!
    const filter = overlay[overlay.indexOf('-filter_complex') + 1]
    expect(filter).toContain('320+0.08*H*cos(3*PI*(t-1)/0.25)*pow(1-(t-1)/0.25,2)')
    expect(filter).toContain('320+0.08*H*pow((t-3.75)/0.25,3)')
    expect(filter).toContain("enable='gte(t,2)*lt(t,2.5)'")
  })
})
