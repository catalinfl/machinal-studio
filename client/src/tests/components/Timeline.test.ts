import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/svelte'
import Timeline from '../../components/Timeline.svelte'
import { editor, type Clip } from '../../stores/editor.svelte'
import { extractAudio } from '../../lib/wasm'
import { compileProject } from '../../lib/api'
import { renderDocument } from '../../lib/compositions'
import { compileProjectLocal } from '../../lib/local-render'
import { TEXT_DRAG_MIME } from '../../lib/text-render'
import { mediaProcessing } from '../../stores/media-processing.svelte'
import { rememberLocalSource } from '../../lib/local-media'

vi.mock('../../lib/wasm', () => ({
  getFFmpeg: vi.fn().mockResolvedValue(undefined),
  renderSegment: vi.fn(),
  extractAudio: vi.fn().mockResolvedValue({ blobUrl: 'blob:audio', blob: {} }),
}))

vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  compileProject: vi.fn(),
}))

vi.mock('../../lib/local-render', () => ({
  compileProjectLocal: vi.fn(),
}))

vi.mock('../../lib/compositions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/compositions')>(),
  renderDocument: vi.fn(),
}))

function makeDataTransfer(data: Record<string, string> = {}): DataTransfer {
  return {
    getData: (type: string) => data[type] ?? '',
    setData: (type: string, val: string) => {
      data[type] = val
    },
    types: Object.keys(data),
    effectAllowed: 'copy',
    dropEffect: 'copy',
    files: [],
    items: [],
  } as unknown as DataTransfer
}

function mockRect(el: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0, right: 800, top: 0, bottom: 300,
      width: 800, height: 300, x: 0, y: 0,
      toJSON: () => ({}),
      ...rect,
    }),
  })
}

function addClip(channelId: string, over: Partial<Clip> = {}): Clip {
  return editor.addClip(channelId, {
    fileName: 'test.mp4',
    scrubBlobUrl: 'blob:abc',
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
    ...over,
  })
}

describe('Timeline', () => {
  beforeEach(() => {
    vi.mocked(renderDocument).mockClear()
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.selectClip(null)
    editor.setCurrentTime(0)
    editor.setPlaying(false)
    editor.setFps(30)
    editor.setPixelsPerSecond(40)
    editor.setResolution('1080p')
    editor.resetProjectAspect()
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    editor.clearHistory()
  })

  it('does not render a separate Timeline Effects disclosure', () => {
    editor.addEffectBlock(editor.channels[0].id, 'sepia', 1, 2)
    const { queryByText, queryByLabelText } = render(Timeline)
    expect(queryByText('Timeline Effects')).not.toBeInTheDocument()
    expect(queryByLabelText('Effects on the timeline')).not.toBeInTheDocument()
  })

  it('renders the timecode from currentTime and totalDuration', () => {
    editor.setFps(30)
    editor.setCurrentTime(1.5)
    addClip(editor.channels[0].id, { outPoint: 10, start: 0 })
    const { getByText } = render(Timeline)
    expect(getByText('00:00:01:15')).toBeTruthy()
  })

  it('renders transport buttons', () => {
    const { getByLabelText } = render(Timeline)
    expect(getByLabelText('Go to start')).toBeTruthy()
    expect(getByLabelText('Previous frame')).toBeTruthy()
    expect(getByLabelText('Play / Pause')).toBeTruthy()
    expect(getByLabelText('Next frame')).toBeTruthy()
    expect(getByLabelText('Go to end')).toBeTruthy()
  })

  it('go to start / end set currentTime', async () => {
    addClip(editor.channels[0].id, { outPoint: 8, start: 0 })
    const { getByLabelText } = render(Timeline)
    await fireEvent.click(getByLabelText('Go to end'))
    expect(editor.currentTime).toBeCloseTo(8)
    await fireEvent.click(getByLabelText('Go to start'))
    expect(editor.currentTime).toBe(0)
  })

  it('play/pause toggles playing', async () => {
    const { getByLabelText } = render(Timeline)
    const play = getByLabelText('Play / Pause')
    await fireEvent.click(play)
    expect(editor.playing).toBe(true)
    await fireEvent.click(play)
    expect(editor.playing).toBe(false)
  })

  it('+V / +A add channels', async () => {
    const before = editor.channels.length
    const { getByTitle } = render(Timeline)
    await fireEvent.click(getByTitle('Add video track'))
    expect(editor.channels.length).toBe(before + 1)
    await fireEvent.click(getByTitle('Add audio track'))
    expect(editor.channels.length).toBe(before + 2)
  })

  it('scrolls to a clip routed to another channel after an overlapping drop', async () => {
    const firstVideo = editor.channels[0]
    addClip(firstVideo.id, { sourceDuration: 5, outPoint: 5 })
    const originalScrollIntoView = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    try {
      const { container, getByLabelText } = render(Timeline)
      const dropZone = getByLabelText(`Drop zone: ${firstVideo.name}`)
      const dataTransfer = makeDataTransfer({
        'application/x-cineedit-clip': JSON.stringify({
          fileName: 'routed.mp4',
          mediaKind: 'video',
          scrubBlobUrl: 'blob:routed',
          sourceDuration: 4,
        }),
      })

      await fireEvent.drop(dropZone, { dataTransfer, clientX: 0 })
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())

      const routedClip = editor.channels
        .filter((channel) => channel.type === 'video')[1]
        .clips[0]
      const routedElement = container.querySelector(`[data-timeline-clip-id="${routedClip.id}"]`)
      expect(scrollIntoView.mock.contexts[0]).toBe(routedElement)
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        })
      } else {
        delete (Element.prototype as { scrollIntoView?: typeof Element.prototype.scrollIntoView }).scrollIntoView
      }
    }
  })

  it('selects one or multiple channels from their headers', async () => {
    editor.addChannel('audio')
    const { container } = render(Timeline)
    const headers = Array.from(container.querySelectorAll<HTMLElement>('.thead.audio'))

    await fireEvent.click(headers[0])
    expect(editor.selectedChannelIds).toEqual([editor.channels[1].id])

    await fireEvent.click(headers[1], { ctrlKey: true })
    expect(editor.selectedChannelIds).toEqual([editor.channels[1].id, editor.channels[2].id])
  })

  it('zoom slider updates pixelsPerSecond in steps of 10', async () => {
    editor.setPixelsPerSecond(40)
    const { getByLabelText } = render(Timeline)
    const slider = getByLabelText('Timeline zoom') as HTMLInputElement

    expect(slider.min).toBe('10')
    expect(slider.max).toBe('200')
    expect(slider.step).toBe('10')
    await fireEvent.input(slider, { target: { value: '120' } })
    expect(editor.pixelsPerSecond).toBe(120)
  })

  it('shows only format and quality choices in output settings', async () => {
    const { container, getByRole } = render(Timeline)
    await fireEvent.click(getByRole('button', { name: 'Render' }))

    expect(getByRole('dialog', { name: 'Render project' })).toBeTruthy()
    expect(container.querySelector('#render-resolution')).toBeNull()
    expect(container.querySelector('#render-aspect')).toBeNull()
    expect(container.querySelector('#render-fps')).toBeNull()
    expect(getByRole('button', { name: /MP4 Compatible video/ })).toBeTruthy()
    expect(getByRole('button', { name: /AVI Legacy video/ })).toBeTruthy()
    expect(getByRole('button', { name: /MP3 Audio tracks only/ })).toBeTruthy()
    expect(getByRole('button', { name: /Normal Balanced/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the text track hidden until the first text item is added', async () => {
    const { queryByLabelText, getByLabelText } = render(Timeline)
    expect(queryByLabelText('Text timeline track')).toBeNull()

    const item = editor.addTextItem(0, { text: 'Visible title' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getByLabelText('Text timeline track')).toBeTruthy()

    editor.removeTextItem(item.id)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queryByLabelText('Text timeline track')).toBeNull()
  })

  it('culls text blocks outside the visible timeline range', async () => {
    for (let index = 0; index < 100; index++) {
      editor.addTextItem(index, { text: `Caption ${index}`, duration: 0.25 })
    }
    const { container } = render(Timeline)
    const scrollElement = container.querySelector('.tl-track-scroll') as HTMLDivElement
    Object.defineProperty(scrollElement, 'clientWidth', { configurable: true, value: 200 })

    window.dispatchEvent(new Event('resize'))

    await waitFor(() => expect(container.querySelectorAll('.text-block')).toHaveLength(21))
  })

  it('creates the text track by dropping a text preset at the pointer time', async () => {
    const { container, queryByLabelText, getByLabelText } = render(Timeline)
    const timeline = container.querySelector('.tl-right') as HTMLElement
    const ruler = getByLabelText('Timeline ruler')
    mockRect(ruler, { left: 260, right: 1260, width: 1000 })
    const dataTransfer = makeDataTransfer({
      [TEXT_DRAG_MIME]: JSON.stringify({
        values: { text: 'Dropped subtitle', fontSize: 54, backgroundOpacity: 0.7 },
      }),
    })
    expect(queryByLabelText('Text timeline track')).toBeNull()

    const dragEvent = (type: 'dragover' | 'drop') => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(event, {
        dataTransfer: { value: dataTransfer },
        clientX: { value: 460 },
        clientY: { value: 120 },
      })
      return event
    }
    await fireEvent(timeline, dragEvent('dragover'))
    expect(container.querySelector('.text-drop-guide')).toBeTruthy()
    await fireEvent(timeline, dragEvent('drop'))

    expect(editor.textItems).toHaveLength(1)
    expect(editor.textItems[0]).toMatchObject({
      text: 'Dropped subtitle',
      start: 5,
      fontSize: 54,
      backgroundOpacity: 0.7,
    })
    expect(editor.selectedTextItemId).toBe(editor.textItems[0].id)
    expect(getByLabelText('Text timeline track')).toBeTruthy()
    expect(container.querySelector('.text-drop-guide')).toBeNull()
  })

  it('previews an effect drop with a fake playhead at the pointer time', async () => {
    const { container, getByLabelText, getByText } = render(Timeline)
    const track = getByLabelText(`Drop zone: ${editor.channels[0].name}`)
    mockRect(track, { left: 260, right: 1260, width: 1000 })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-effect': JSON.stringify({ effectId: 'sepia' }),
    })

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOver, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 460 },
      clientY: { value: 120 },
    })
    await fireEvent(track, dragOver)

    const guide = container.querySelector('.palette-drop-guide.effect') as HTMLElement
    expect(guide).toBeTruthy()
    expect(guide.style.left).toBe('200px')
    expect(getByText('Drop effect at 5.00s')).toBeTruthy()
  })

  it('previews a transition at a valid junction with both clip names', async () => {
    addClip(editor.channels[0].id, { fileName: 'intro.mp4', start: 0, outPoint: 5 })
    addClip(editor.channels[0].id, { fileName: 'scene.mp4', start: 5, outPoint: 5 })
    const { container, getByLabelText, getByText } = render(Timeline)
    const track = getByLabelText(`Drop zone: ${editor.channels[0].name}`)
    mockRect(track, { left: 260, right: 1260, width: 1000 })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-transition': JSON.stringify({ effectId: 'cross-dissolve' }),
    })

    const dragOver = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOver, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 460 },
      clientY: { value: 120 },
    })
    await fireEvent(track, dragOver)

    const guide = container.querySelector('.palette-drop-guide.transition') as HTMLElement
    expect(guide).toBeTruthy()
    expect(guide.style.left).toBe('200px')
    expect(getByText('Between intro.mp4 and scene.mp4')).toBeTruthy()
  })

  it('preserves an existing overlap when dropping a transition', async () => {
    const channel = editor.channels[0]
    const left = addClip(channel.id, { start: 0 })
    const right = addClip(channel.id, { fileName: 'scene.mp4', start: 5 })
    editor.moveClip(channel.id, right.id, 4.8)
    const { getByLabelText } = render(Timeline)
    const track = getByLabelText(`Drop zone: ${channel.name}`)
    mockRect(track, { left: 260, right: 1260, width: 1000 })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-transition': JSON.stringify({ effectId: 'cross-dissolve' }),
    })

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(drop, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 456 },
      clientY: { value: 120 },
    })
    await fireEvent(track, drop)

    expect(editor.transitions).toHaveLength(1)
    expect(editor.getClipOverlap(channel.id, editor.getClipById(right.id)!.clip).left).toBeCloseTo(0.2)
  })

  it('adds a dropped transition only to the nearest junction', async () => {
    const channel = editor.channels[0]
    const first = addClip(channel.id, { start: 0 })
    const second = addClip(channel.id, { start: 4 })
    const third = addClip(channel.id, { start: 8 })
    const { getByLabelText } = render(Timeline)
    const track = getByLabelText(`Drop zone: ${channel.name}`)
    mockRect(track, { left: 260, right: 1260, width: 1000 })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-transition': JSON.stringify({ effectId: 'wipe-left' }),
    })

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(drop, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 460 },
      clientY: { value: 120 },
    })
    await fireEvent(track, drop)

    expect(editor.transitions).toHaveLength(1)
    expect(editor.transitions[0]).toMatchObject({
      effectId: 'wipe-left',
      leftClipId: first.id,
      rightClipId: second.id,
    })
    expect(editor.getTransitionBetween(second.id, third.id)).toBeUndefined()
  })

  it('keeps project FPS unchanged when selecting an output preset', async () => {
    const { container, getByRole } = render(Timeline)
    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByRole('button', { name: /High Best quality/ }))

    expect(container.querySelector('#render-fps')).toBeNull()
    expect(editor.fps).toBe(30)
  })

  it('renders channel headers with mute/lock/remove buttons', () => {
    const { getByLabelText } = render(Timeline)
    expect(getByLabelText(`Mute ${editor.channels[0].name}`)).toBeTruthy()
    expect(getByLabelText(`Lock ${editor.channels[0].name}`)).toBeTruthy()
    expect(getByLabelText(`Remove ${editor.channels[0].name}`)).toBeTruthy()
  })

  it('mute/lock/remove buttons toggle state', async () => {
    const ch = editor.channels[0]
    const id = ch.id
    const { getByLabelText } = render(Timeline)
    await fireEvent.click(getByLabelText(`Mute ${ch.name}`))
    expect(editor.channels.find((c) => c.id === id)!.muted).toBe(true)
    await fireEvent.click(getByLabelText(`Lock ${ch.name}`))
    expect(editor.channels.find((c) => c.id === id)!.locked).toBe(true)
    await fireEvent.click(getByLabelText(`Remove ${ch.name}`))
    expect(editor.channels.find((c) => c.id === id)).toBeUndefined()
  })

  it('shows empty state when all channels removed', async () => {
    editor.removeChannel(editor.channels[0].id)
    editor.removeChannel(editor.channels[0].id)
    const { getByText } = render(Timeline)
    expect(getByText(/No tracks/)).toBeTruthy()
  })

  it('export button shows error when no video clips', async () => {
    const { getByRole, getByTitle, findByText } = render(Timeline)
    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByTitle('Render on the server'))
    expect(await findByText(/no clips to export/)).toBeTruthy()
  })

  it('ruler has slider role and aria attributes', () => {
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    expect(ruler).toBeTruthy()
    expect(ruler.getAttribute('aria-valuemin')).toBe('0')
  })

  it('playhead has slider role and aria attributes', () => {
    const { getByRole } = render(Timeline)
    const ph = getByRole('slider', { name: 'Playhead' })
    expect(ph).toBeTruthy()
  })

  it('exports video and audio clips grouped by channel', async () => {
    addClip(editor.channels[0].id, { fileName: 'video-1.mp4' })
    addClip(editor.channels[1].id, { fileName: 'audio-1.mp4', volume: 0 })
    const secondVideo = editor.addChannel('video')
    const secondAudio = editor.addChannel('audio')
    addClip(secondVideo.id, { fileName: 'video-2.mp4' })
    addClip(secondAudio.id, { fileName: 'audio-2.mp4', volume: 150 })
    vi.mocked(renderDocument).mockRejectedValueOnce(new Error('stop after document capture'))
    const { getByRole, getByTitle } = render(Timeline)

    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByTitle('Render on the server'))

    expect(renderDocument).toHaveBeenCalledOnce()
    const project = vi.mocked(renderDocument).mock.calls[0][0]
    const tracks = project.document.tracks ?? []
    const sourceFile = (id: string) => project.assets.find((asset) => asset.id === id)?.file
    expect(tracks.filter((track) => track.type === 'video').map((channel) => channel.clips.map((clip) => sourceFile(clip.assetId)))).toEqual([
      ['video-1.mp4'],
      ['video-2.mp4'],
    ])
    expect(tracks.filter((track) => track.type === 'audio').map((channel) => channel.clips.map((clip) => sourceFile(clip.assetId)))).toEqual([
      ['audio-1.mp4'],
      ['audio-2.mp4'],
    ])
    expect(tracks.filter((track) => track.type === 'audio').map((channel) => channel.clips.map((clip) => clip.volume))).toEqual([
      [0],
      [150],
    ])
  })

  it('exports MP3 from active audio channels only with the selected quality', async () => {
    addClip(editor.channels[0].id, { fileName: 'video.mp4' })
    addClip(editor.channels[1].id, { fileName: 'voice.wav', mediaKind: 'audio' })
    vi.mocked(renderDocument).mockRejectedValueOnce(new Error('stop after document capture'))
    const { getByRole, getByTitle } = render(Timeline)

    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByRole('button', { name: /MP3 Audio tracks only/ }))
    await fireEvent.click(getByRole('button', { name: /High Best quality/ }))
    await fireEvent.click(getByTitle('Render on the server'))

    const project = vi.mocked(renderDocument).mock.calls.at(-1)?.[0]
    expect(project?.document.output).toMatchObject({ format: 'mp3', quality: 'high' })
    const audio = project?.document.tracks?.find((track) => track.type === 'audio')
    expect(project?.assets.find((asset) => asset.id === audio?.clips[0].assetId)?.file).toBe('voice.wav')
  })

  it('exports image layer opacity and fade timing', async () => {
    const clip = addClip(editor.channels[0].id, { fileName: 'b-roll.png', mediaKind: 'image' })
    editor.setClipCompositing(clip.id, { opacity: 0.7, fadeIn: 4, fadeOut: 0.6 })
    editor.trimClip(clip.id, 'right', -3)
    vi.mocked(renderDocument).mockRejectedValueOnce(new Error('stop after document capture'))
    const { getByRole, getByTitle } = render(Timeline)

    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByTitle('Render on the server'))

    expect(vi.mocked(renderDocument).mock.calls.at(-1)?.[0].document.tracks?.[0].clips[0]).toMatchObject({
      opacity: 0.7,
      fadeIn: 2,
      fadeOut: 0.6,
    })
  })

  it('exports a portrait project at the selected vertical resolution', async () => {
    editor.initializeProjectAspect(720, 1280)
    editor.setResolution('720p')
    addClip(editor.channels[0].id, { fileName: 'portrait.mp4' })
    vi.mocked(renderDocument).mockRejectedValueOnce(new Error('stop after document capture'))
    const { getByRole, getByTitle } = render(Timeline)

    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByTitle('Render on the server'))

    expect(vi.mocked(renderDocument).mock.calls.at(-1)?.[0].document.output).toMatchObject({ resolution: '720p', aspect: 'portrait' })
  })

  it('renders locally without calling the server render route', async () => {
    const sourceId = rememberLocalSource(new File(['synthetic'], 'local.mp4', { type: 'video/mp4' }))
    addClip(editor.channels[0].id, {
      fileName: 'local.mp4',
      sourceMode: 'wasm',
      sourceId,
    })
    vi.mocked(compileProject).mockClear()
    vi.mocked(compileProjectLocal).mockRejectedValueOnce(new Error('stop after local payload capture'))
    const { getByRole, getByTitle } = render(Timeline)

    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByTitle('Render on this device'))

    expect(compileProjectLocal).toHaveBeenCalledOnce()
    expect(vi.mocked(compileProjectLocal).mock.calls[0][0].videoChannels[0].clips[0].file).toBe('local.mp4')
    expect(compileProject).not.toHaveBeenCalled()
  })

  it('requires explicit upload permission before enabling server export of WASM media', async () => {
    const sourceId = rememberLocalSource(new File(['synthetic'], 'browser-only.mp4', { type: 'video/mp4' }))
    addClip(editor.channels[0].id, {
      fileName: 'browser-only.mp4',
      sourceMode: 'wasm',
      sourceId,
    })
    const { getByRole, getByTitle } = render(Timeline)

    await fireEvent.click(getByRole('button', { name: 'Render' }))

    const serverRender = getByTitle('Approve uploading the required local originals to enable server export')
    expect(serverRender).toBeDisabled()
    expect(serverRender).toHaveTextContent('Upload required originals, then render')
    const approval = getByRole('checkbox', { name: /Upload this export/ })
    expect(approval).not.toBeChecked()
    await fireEvent.click(approval)
    expect(serverRender).toBeEnabled()
  })

  it('exports volumes changed by dragging a line on multiple selected audio clips', async () => {
    const audioChannel = editor.channels.find((channel) => channel.type === 'audio')!
    const clips = [0, 6, 12].map((start) => addClip(audioChannel.id, {
      fileName: `audio-${start}.mp4`,
      start,
    }))
    editor.selectClips(clips.map((clip) => clip.id))
    vi.mocked(compileProjectLocal).mockClear()
    vi.mocked(compileProjectLocal).mockRejectedValueOnce(new Error('stop after local payload capture'))
    const { container, getByRole, getByTitle } = render(Timeline)
    const firstClip = container.querySelector(`[data-timeline-clip-id="${clips[0].id}"]`) as HTMLElement
    const volumeLine = firstClip.querySelector('.vol-line') as HTMLElement
    firstClip.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      height: 100,
      width: 200,
      left: 0,
      right: 200,
      bottom: 100,
    } as DOMRect))

    await fireEvent.mouseDown(volumeLine, { clientY: 50 })
    await fireEvent.mouseMove(window, { clientY: 100 })
    await fireEvent.mouseUp(window, { clientY: 100 })
    expect(clips.map((clip) => editor.getClipById(clip.id)?.clip.volume)).toEqual([0, 0, 0])

    await fireEvent.click(getByRole('button', { name: 'Render' }))
    await fireEvent.click(getByTitle('Render on this device'))

    expect(compileProjectLocal).toHaveBeenCalledOnce()
    const payload = vi.mocked(compileProjectLocal).mock.calls[0][0]
    expect(payload.audioChannels[0].clips.map((clip) => clip.volume)).toEqual([0, 0, 0])
  })

  it('keeps the playhead position when grabbed away from the visible line', async () => {
    addClip(editor.channels[0].id, { outPoint: 10 })
    editor.setCurrentTime(2)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    const playhead = getByRole('slider', { name: 'Playhead' }) as HTMLElement
    mockRect(ruler, { left: 0 })
    Object.defineProperty(playhead, 'setPointerCapture', { value: vi.fn() })

    await fireEvent.pointerDown(playhead, { clientX: 90, pointerId: 1 })
    expect(editor.currentTime).toBe(2)
    await fireEvent.pointerMove(window, { clientX: 130, pointerId: 1 })
    expect(editor.currentTime).toBe(3)
    await fireEvent.pointerUp(window, { clientX: 130, pointerId: 1 })
  })

  it('snaps the dragged playhead to an effect block edge within 3px', async () => {
    editor.addEffectBlock(editor.channels[0].id, 'grayscale', 2, 3)
    editor.setCurrentTime(4)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    const playhead = getByRole('slider', { name: 'Playhead' }) as HTMLElement
    mockRect(ruler, { left: 0 })
    Object.defineProperty(playhead, 'setPointerCapture', { value: vi.fn() })

    await fireEvent.pointerDown(playhead, { clientX: 160, pointerId: 1 })
    await fireEvent.pointerMove(window, { clientX: 198, pointerId: 1 })
    expect(editor.currentTime).toBe(5)

    await fireEvent.pointerMove(window, { clientX: 196, pointerId: 1 })
    expect(editor.currentTime).toBeCloseTo(4.9)
    await fireEvent.pointerUp(window, { clientX: 196, pointerId: 1 })
  })

  it('snaps ruler clicks to a nearby effect block edge', async () => {
    editor.addEffectBlock(editor.channels[0].id, 'grayscale', 2, 3)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    mockRect(ruler, { left: 0 })

    await fireEvent.click(ruler, { clientX: 82 })
    expect(editor.currentTime).toBe(2)
  })

  it('snaps the dragged playhead to a clip edge within 3px', async () => {
    addClip(editor.channels[0].id, { start: 2, inPoint: 0, outPoint: 5 })
    editor.setCurrentTime(4)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    const playhead = getByRole('slider', { name: 'Playhead' }) as HTMLElement
    mockRect(ruler, { left: 0 })
    Object.defineProperty(playhead, 'setPointerCapture', { value: vi.fn() })

    await fireEvent.pointerDown(playhead, { clientX: 160, pointerId: 1 })
    await fireEvent.pointerMove(window, { clientX: 278, pointerId: 1 })
    expect(editor.currentTime).toBe(7)

    await fireEvent.pointerMove(window, { clientX: 276, pointerId: 1 })
    expect(editor.currentTime).toBeCloseTo(6.9)
    await fireEvent.pointerUp(window, { clientX: 276, pointerId: 1 })
  })

  it('snaps ruler clicks to a nearby clip edge', async () => {
    addClip(editor.channels[0].id, { start: 2, inPoint: 0, outPoint: 5 })
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    mockRect(ruler, { left: 0 })

    await fireEvent.click(ruler, { clientX: 82 })
    expect(editor.currentTime).toBe(2)
  })

  it('ArrowLeft key on ruler steps backward one frame', () => {
    addClip(editor.channels[0].id, { outPoint: 10, start: 0 })
    editor.setCurrentTime(2)
    editor.setFps(30)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(editor.currentTime).toBeCloseTo(2 - 1 / 30)
  })

  it('ArrowRight key on ruler steps forward one frame', () => {
    addClip(editor.channels[0].id, { outPoint: 10, start: 0 })
    editor.setCurrentTime(2)
    editor.setFps(30)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(editor.currentTime).toBeCloseTo(2 + 1 / 30)
  })

  it('Home key on ruler goes to start', () => {
    editor.setCurrentTime(5)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(editor.currentTime).toBe(0)
  })

  it('End key on ruler goes to end', () => {
    addClip(editor.channels[0].id, { outPoint: 8, start: 0 })
    editor.setCurrentTime(0)
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })
    ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(editor.currentTime).toBeCloseTo(8)
  })

  it('Ctrl+A unlinks two selected clips that are already linked', () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'linked.mp4',
      scrubBlobUrl: 'blob:abc',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const audioClip = editor.addClip(editor.channels[1].id, {
      fileName: 'audio.mp4',
      scrubBlobUrl: 'blob:abc',
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const vClip = editor.channels[0].clips.find((c) => c.id === clip.id)!
    const aClip = editor.channels[1].clips.find((c) => c.id === audioClip.id)!
    vClip.linkedClipId = aClip.id
    aClip.linkedClipId = vClip.id
    editor.selectClips([clip.id, audioClip.id])

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))
    expect(vClip.linkedClipId).toBeUndefined()
    expect(aClip.linkedClipId).toBeUndefined()
  })

  it('Ctrl+A links exactly two selected video and audio clips', () => {
    const video = addClip(editor.channels[0].id)
    const audio = addClip(editor.channels[1].id)
    editor.selectClip(video.id)
    editor.selectClip(audio.id, true)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))

    expect(editor.getClipById(video.id)!.clip.linkedClipId).toBe(audio.id)
    expect(editor.getClipById(audio.id)!.clip.linkedClipId).toBe(video.id)
  })

  it('Escape clears any clip selection', () => {
    const video = addClip(editor.channels[0].id)
    const audio = addClip(editor.channels[1].id)
    editor.selectClip(video.id)
    editor.selectClip(audio.id, true)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(editor.selectedClipIds).toEqual([])
  })

  it('Delete removes selected clips across channels without clip focus', () => {
    const video = addClip(editor.channels[0].id)
    const audio = addClip(editor.channels[1].id)
    editor.selectClips([video.id, audio.id])
    const { getByRole } = render(Timeline)
    const ruler = getByRole('slider', { name: 'Timeline ruler' })

    ruler.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

    expect(editor.getClipById(video.id)).toBeNull()
    expect(editor.getClipById(audio.id)).toBeNull()
    expect(editor.selectedClipIds).toEqual([])
  })

  it('Ctrl+C and Ctrl+V duplicate all effects in a selection at the paste point', () => {
    addClip(editor.channels[0].id, { sourceDuration: 20, outPoint: 20 })
    const first = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
    const second = editor.addEffectBlock(editor.channels[0].id, 'sepia', 4, 1)!
    editor.selectItems([], [first.id, second.id])
    editor.setCurrentTime(8)
    render(Timeline)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }))

    expect(editor.effectBlocks).toHaveLength(4)
    const originalIds = new Set([first.id, second.id])
    const pasted = editor.effectBlocks.filter((candidate) => !originalIds.has(candidate.id))
    expect(pasted.map((block) => block.start)).toEqual([8, 11])
    expect(editor.selectedEffectBlockIds).toEqual(pasted.map((block) => block.id))
  })

  it('Shift+A selects every clip across all channels', () => {
    const video = addClip(editor.channels[0].id)
    const audio = addClip(editor.channels[1].id)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }))

    expect(editor.selectedClipIds).toEqual([video.id, audio.id])
  })

  it('clicking the timeline background clears a single selection', async () => {
    const clip = addClip(editor.channels[0].id)
    editor.selectClip(clip.id)
    const { container } = render(Timeline)

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, { button: 0, pointerId: 1 })

    expect(editor.selectedClipIds).toEqual([])
  })

  it('clicking the timeline background clears a multi-selection', async () => {
    const video = addClip(editor.channels[0].id)
    const audio = addClip(editor.channels[1].id)
    editor.selectClip(video.id)
    editor.selectClip(audio.id, true)
    const { container } = render(Timeline)

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, { button: 0, pointerId: 1 })

    expect(editor.selectedClipIds).toEqual([])
  })

  it('clicking a clip does not clear its selection through the timeline handler', async () => {
    const clip = addClip(editor.channels[0].id)
    const { container } = render(Timeline)

    await fireEvent.mouseDown(container.querySelector('.clip')!)
    await fireEvent.mouseUp(window)
    await fireEvent.click(container.querySelector('.clip')!)

    expect(editor.selectedClipIds).toEqual([clip.id])
  })

  it('selects every clip intersected by a background marquee', async () => {
    const first = addClip(editor.channels[0].id, { start: 0 })
    const second = addClip(editor.channels[1].id, { start: 6 })
    const { container } = render(Timeline)
    const clips = container.querySelectorAll<HTMLElement>('[data-timeline-clip-id]')
    mockRect(clips[0], { left: 100, right: 200, top: 80, bottom: 130, width: 100, height: 50 })
    mockRect(clips[1], { left: 340, right: 440, top: 150, bottom: 200, width: 100, height: 50 })

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, {
      button: 0,
      pointerId: 1,
      clientX: 90,
      clientY: 70,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 210, clientY: 140 })

    expect(editor.selectedClipIds).toEqual([first.id])
    expect(container.querySelector('.selection-marquee')).toBeTruthy()

    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 450, clientY: 210 })
    expect(editor.selectedClipIds).toEqual([first.id, second.id])
    await fireEvent.pointerUp(window, { pointerId: 1 })
    expect(container.querySelector('.selection-marquee')).toBeNull()
  })

  it('selects clips and effects together with the marquee', async () => {
    const clip = addClip(editor.channels[0].id)
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
    const { container } = render(Timeline)
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    const blockEl = container.querySelector<HTMLElement>(`[data-timeline-effect-id="${block.id}"]`)!
    mockRect(clipEl, { left: 100, right: 200, top: 80, bottom: 130, width: 100, height: 50 })
    mockRect(blockEl, { left: 120, right: 190, top: 135, bottom: 155, width: 70, height: 20 })

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, {
      button: 0,
      pointerId: 1,
      clientX: 90,
      clientY: 70,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 210, clientY: 165 })

    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.selectedEffectBlockIds).toEqual([block.id])
    await fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('adds marquee hits to the existing selection with Ctrl', async () => {
    const first = addClip(editor.channels[0].id, { start: 0 })
    const second = addClip(editor.channels[1].id, { start: 6 })
    editor.selectClip(first.id)
    const { container } = render(Timeline)
    const secondEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${second.id}"]`)!
    mockRect(secondEl, { left: 340, right: 440, top: 150, bottom: 200, width: 100, height: 50 })

    await fireEvent.pointerDown(container.querySelectorAll('.clips-area')[1], {
      button: 0,
      pointerId: 1,
      ctrlKey: true,
      clientX: 330,
      clientY: 140,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 450, clientY: 210 })

    expect(editor.selectedClipIds).toEqual([first.id, second.id])
    await fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('grows the marquee to the left and selects intersected clips', async () => {
    const clip = addClip(editor.channels[0].id, { start: 2 })
    const { container } = render(Timeline)
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    mockRect(clipEl, { left: 180, right: 280, top: 80, bottom: 130, width: 100, height: 50 })
    const background = container.querySelector('.clips-area')!

    await fireEvent.pointerDown(background, {
      button: 0,
      pointerId: 1,
      clientX: 320,
      clientY: 150,
    })
    await fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 170,
      clientY: 70,
    })

    const marquee = container.querySelector<HTMLElement>('.selection-marquee')!
    expect(marquee.style.left).toBe('170px')
    expect(marquee.style.width).toBe('150px')
    expect(editor.selectedClipIds).toEqual([clip.id])
    await fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('clips the marquee to the visible timeline body', async () => {
    const { container } = render(Timeline)
    mockRect(container.querySelector('.tl-body')!, {
      left: 250, right: 1000, top: 100, bottom: 500, width: 750, height: 400,
    })
    const background = container.querySelector('.clips-area')!

    await fireEvent.pointerDown(background, {
      button: 0,
      pointerId: 1,
      clientX: 320,
      clientY: 150,
    })
    await fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 170,
      clientY: 70,
    })

    expect(container.querySelector<HTMLElement>('.selection-marquee')!.style.clipPath)
      .toBe('inset(30px 0px 0px 80px)')
    await fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('creates the selection marquee by dragging with the right mouse button', async () => {
    const clip = addClip(editor.channels[0].id, { start: 2 })
    const { container } = render(Timeline)
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    mockRect(clipEl, { left: 180, right: 280, top: 80, bottom: 130, width: 100, height: 50 })
    const background = container.querySelector('.clips-area')!

    await fireEvent.pointerDown(background, {
      button: 2,
      buttons: 2,
      pointerId: 1,
      clientX: 320,
      clientY: 150,
    })
    await fireEvent.pointerMove(window, {
      button: -1,
      buttons: 2,
      pointerId: 1,
      clientX: 170,
      clientY: 70,
    })

    expect(container.querySelector('.selection-marquee')).toBeTruthy()
    expect(editor.selectedClipIds).toEqual([clip.id])

    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    expect(background.dispatchEvent(contextMenu)).toBe(false)
    await fireEvent.pointerUp(window, { button: 2, pointerId: 1 })
  })

  it('does not clear selection from a click emitted after dragging a clip', async () => {
    const clip = addClip(editor.channels[0].id)
    const { container } = render(Timeline)
    const clipEl = container.querySelector('.clip')!

    await fireEvent.mouseDown(clipEl, { clientX: 0, clientY: 20 })
    await fireEvent.mouseMove(window, { clientX: 40, clientY: 20 })
    await fireEvent.mouseUp(window, { clientX: 40, clientY: 20 })
    await fireEvent.click(container.querySelector('.clips-area')!)

    expect(editor.selectedClipIds).toEqual([clip.id])
  })

  it('C key splits the selected clip at the playhead', () => {
    const clip = addClip(editor.channels[0].id, { inPoint: 0, outPoint: 5, start: 0 })
    editor.selectClip(clip.id)
    editor.setCurrentTime(2)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    expect(editor.channels[0].clips).toHaveLength(2)
    const left = editor.channels[0].clips.find((c) => c.id === clip.id)!
    const right = editor.channels[0].clips.find((c) => c.id !== clip.id)!
    expect(left.outPoint).toBeCloseTo(2)
    expect(right.inPoint).toBeCloseTo(2)
    expect(right.start).toBe(2)
  })

  it('C key with no selection splits every clip under the playhead', () => {
    addClip(editor.channels[0].id, { inPoint: 0, outPoint: 5, start: 0 })
    addClip(editor.channels[1].id, { inPoint: 0, outPoint: 5, start: 0 })
    editor.setCurrentTime(2)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    expect(editor.channels[0].clips).toHaveLength(2)
    expect(editor.channels[1].clips).toHaveLength(2)
  })

  it('Ctrl+C and Ctrl+V copy and paste without triggering split', () => {
    const clip = addClip(editor.channels[0].id, { inPoint: 0, outPoint: 5, start: 0 })
    editor.selectClip(clip.id)
    editor.setCurrentTime(2)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
    expect(editor.channels[0].clips).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }))
    expect(editor.channels[0].clips).toHaveLength(2)
    expect(editor.channels[0].clips[1].start).toBe(5)
    expect(editor.selectedClipIds).toEqual([editor.channels[0].clips[1].id])
  })

  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes timeline edits', () => {
    const clip = addClip(editor.channels[0].id)
    editor.clearHistory()
    editor.moveClip(editor.channels[0].id, clip.id, 3)
    render(Timeline)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(3)
  })

  it('Ctrl+Y redoes and history shortcuts leave inputs alone', async () => {
    const clip = addClip(editor.channels[0].id)
    editor.clearHistory()
    editor.moveClip(editor.channels[0].id, clip.id, 3)
    const { getByLabelText } = render(Timeline)

    editor.undo()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(3)

    const zoomInput = getByLabelText('Timeline zoom')
    zoomInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(3)
  })

  it('Ctrl+U redoes a clip edit', () => {
    const clip = addClip(editor.channels[0].id)
    editor.clearHistory()
    editor.moveClip(editor.channels[0].id, clip.id, 3)
    render(Timeline)

    editor.undo()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true }))

    expect(editor.getClipById(clip.id)!.clip.start).toBe(3)
  })

  it('undoes and redoes a clip after a real drag interaction', async () => {
    const clip = addClip(editor.channels[0].id)
    editor.clearHistory()
    const { container } = render(Timeline)
    const clipEl = container.querySelector(`[data-timeline-clip-id="${clip.id}"]`)!

    await fireEvent.mouseDown(clipEl, { clientX: 0, clientY: 20 })
    await fireEvent.mouseMove(window, { clientX: 120, clientY: 20 })
    await fireEvent.mouseUp(window, { clientX: 120, clientY: 20 })
    expect(editor.getClipById(clip.id)!.clip.start).toBe(3)

    clipEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true }))
    expect(editor.getClipById(clip.id)!.clip.start).toBe(3)
  })

  it('split button splits at the playhead', async () => {
    const clip = addClip(editor.channels[0].id, { inPoint: 0, outPoint: 5, start: 0 })
    editor.selectClip(clip.id)
    editor.setCurrentTime(3)

    const { getByLabelText } = render(Timeline)
    await fireEvent.click(getByLabelText('Split at playhead'))
    expect(editor.channels[0].clips).toHaveLength(2)
    const right = editor.channels[0].clips.find((c) => c.id !== clip.id)!
    expect(right.inPoint).toBeCloseTo(3)
  })

  it('C key does nothing when the playhead is outside every clip', () => {
    addClip(editor.channels[0].id, { inPoint: 0, outPoint: 5, start: 0 })
    editor.setCurrentTime(9)

    render(Timeline)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))
    expect(editor.channels[0].clips).toHaveLength(1)
  })

  it('renders a drop zone below the channels for creating a new track', () => {
    const { getByLabelText } = render(Timeline)
    expect(getByLabelText('Drop zone: create new track')).toBeTruthy()
  })

  it('dragging a timeline clip below all channels creates a matching track and moves it', async () => {
    const source = editor.channels[0]
    const clip = addClip(source.id)
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('test.mp4').closest('.clip') as HTMLElement
    const zone = getByLabelText('Drop zone: create new track') as HTMLElement
    mockRect(zone, { top: 180, bottom: 300 })

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 50 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 220 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 60, clientY: 220 }))

    const target = editor.channels[editor.channels.length - 1]
    expect(target.type).toBe('video')
    expect(target.clips[0].id).toBe(clip.id)
    expect(source.clips).toHaveLength(0)
  })

  it('drags a multi-selection to an existing compatible channel', async () => {
    const source = editor.channels[0]
    const target = editor.addChannel('video')
    const first = addClip(source.id, { fileName: 'first.mp4', outPoint: 2, start: 0 })
    const second = addClip(source.id, { fileName: 'second.mp4', outPoint: 2, start: 3 })
    const { container, getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('first.mp4').closest('.clip') as HTMLElement
    const secondClipEl = getByText('second.mp4').closest('.clip') as HTMLElement
    const sourceRow = getByLabelText(`Drop zone: ${source.name}`)
    const targetRow = getByLabelText(`Drop zone: ${target.name}`)
    mockRect(clipEl, { left: 100, right: 180, top: 40, bottom: 80, width: 80, height: 40 })
    mockRect(secondClipEl, { left: 220, right: 300, top: 40, bottom: 80, width: 80, height: 40 })
    mockRect(sourceRow, { top: 30, bottom: 94, height: 64 })
    mockRect(targetRow, { top: 158, bottom: 222, height: 64 })

    await fireEvent.pointerDown(container.querySelector('.clips-area')!, {
      button: 0,
      pointerId: 1,
      clientX: 90,
      clientY: 30,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 310, clientY: 90 })
    await fireEvent.pointerUp(window, { pointerId: 1 })
    expect(editor.selectedClipIds).toEqual([first.id, second.id])

    await fireEvent.mouseDown(clipEl, { clientX: 120, clientY: 60 })
    await fireEvent.mouseMove(window, { clientX: 160, clientY: 180 })
    await fireEvent.mouseUp(window, { clientX: 160, clientY: 180 })

    expect(source.clips).toHaveLength(0)
    const liveTarget = editor.channels.find((channel) => channel.id === target.id)!
    expect(liveTarget.clips.map((clip) => clip.id)).toEqual([first.id, second.id])
    expect(liveTarget.clips[1].start - liveTarget.clips[0].start).toBe(3)
  })

  it('drags clips from separate source tracks to separate destination tracks', async () => {
    const firstSource = editor.channels[0]
    const secondSource = editor.addChannel('video')
    const firstTarget = editor.addChannel('video')
    const secondTarget = editor.addChannel('video')
    const first = addClip(firstSource.id, { fileName: 'first.mp4', start: 0 })
    const second = addClip(secondSource.id, { fileName: 'second.mp4', start: 0 })
    editor.selectClips([first.id, second.id])
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('first.mp4').closest('.clip') as HTMLElement
    const targetRow = getByLabelText(`Drop zone: ${firstTarget.name}`)
    mockRect(targetRow, { left: 0, right: 800, top: 158, bottom: 222, width: 800, height: 64 })

    await fireEvent.mouseDown(clipEl, { clientX: 120, clientY: 60 })
    await fireEvent.mouseMove(window, { clientX: 160, clientY: 180 })
    await fireEvent.mouseUp(window, { clientX: 160, clientY: 180 })

    expect(editor.getClipById(first.id)!.channel.id).toBe(firstTarget.id)
    expect(editor.getClipById(second.id)!.channel.id).toBe(secondTarget.id)
  })

  it('drags a multi-selection below all channels into a new compatible channel', async () => {
    const source = editor.channels[0]
    const first = addClip(source.id, { fileName: 'first.mp4', outPoint: 2, start: 0 })
    const second = addClip(source.id, { fileName: 'second.mp4', outPoint: 2, start: 3 })
    editor.selectClips([first.id, second.id])
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('first.mp4').closest('.clip') as HTMLElement
    const zone = getByLabelText('Drop zone: create new track') as HTMLElement
    mockRect(zone, { top: 180, bottom: 300 })

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 50 })
    await fireEvent.mouseMove(window, { clientX: 60, clientY: 220 })
    await fireEvent.mouseUp(window, { clientX: 60, clientY: 220 })

    const target = editor.channels[editor.channels.length - 1]
    expect(target.type).toBe('video')
    expect(target.clips.map((clip) => clip.id)).toEqual([first.id, second.id])
    expect(source.clips).toHaveLength(0)
  })

  it('moves selected effects and text with a clip into a new channel', async () => {
    const source = editor.channels[0]
    const clip = addClip(source.id, { start: 0 })
    const block = editor.addEffectBlock(source.id, 'blur', 0, 1)!
    const text = editor.addTextItem(0, { text: 'Title', duration: 1 })
    editor.selectItems([clip.id], [block.id], [text.id])
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('test.mp4').closest('.clip') as HTMLElement
    const zone = getByLabelText('Drop zone: create new track') as HTMLElement
    mockRect(zone, { top: 180, bottom: 300 })

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 50 })
    await fireEvent.mouseMove(window, { clientX: 60, clientY: 220 })
    await fireEvent.mouseUp(window, { clientX: 60, clientY: 220 })

    const target = editor.channels[editor.channels.length - 1]
    expect(editor.getClipById(clip.id)!.channel.id).toBe(target.id)
    expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)).toMatchObject({
      channelId: target.id,
      start: 1,
    })
    expect(editor.textItems.find((candidate) => candidate.id === text.id)?.start).toBe(1)
  })

  it('creates separate tracks for separate source tracks in the new-track zone', async () => {
    const firstSource = editor.channels[0]
    const secondSource = editor.addChannel('video')
    const first = addClip(firstSource.id, { fileName: 'first.mp4', start: 0 })
    const second = addClip(secondSource.id, { fileName: 'second.mp4', start: 0 })
    editor.selectClips([first.id, second.id])
    const channelIdsBefore = new Set(editor.channels.map((channel) => channel.id))
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('first.mp4').closest('.clip') as HTMLElement
    const zone = getByLabelText('Drop zone: create new track') as HTMLElement
    mockRect(zone, { left: 0, right: 800, top: 180, bottom: 300, width: 800, height: 120 })

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 50 })
    await fireEvent.mouseMove(window, { clientX: 60, clientY: 220 })
    await fireEvent.mouseUp(window, { clientX: 60, clientY: 220 })

    const created = editor.channels.filter((channel) => !channelIdsBefore.has(channel.id))
    expect(created).toHaveLength(2)
    expect(editor.getClipById(first.id)!.channel.id).toBe(created[0].id)
    expect(editor.getClipById(second.id)!.channel.id).toBe(created[1].id)
  })

  it('moves a timeline clip back to the first compatible channel using the full row height', async () => {
    const first = editor.channels[0]
    const second = editor.addChannel('video')
    const clip = addClip(second.id)
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('test.mp4').closest('.clip') as HTMLElement
    const firstRow = getByLabelText(`Drop zone: ${first.name}`)
    const secondRow = getByLabelText(`Drop zone: ${second.name}`)
    mockRect(firstRow, { top: 30, bottom: 94, height: 64 })
    mockRect(secondRow, { top: 158, bottom: 222, height: 64 })

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 180 })
    await fireEvent.mouseMove(window, { clientX: 60, clientY: 60 })
    await fireEvent.mouseUp(window, { clientX: 60, clientY: 60 })

    expect(first.clips[0].id).toBe(clip.id)
    expect(second.clips).toHaveLength(0)
  })

  it('uses the destination channel while moving left across tracks', async () => {
    const source = editor.channels[0]
    const target = editor.addChannel('video')
    addClip(source.id, { fileName: 'blocker.mp4', start: 0 })
    const moving = addClip(source.id, { fileName: 'moving.mp4', start: 8 })
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('moving.mp4').closest('.clip') as HTMLElement
    const sourceRow = getByLabelText(`Drop zone: ${source.name}`)
    const targetRow = getByLabelText(`Drop zone: ${target.name}`)
    mockRect(sourceRow, { top: 30, bottom: 94, height: 64 })
    mockRect(targetRow, { top: 158, bottom: 222, height: 64 })

    await fireEvent.mouseDown(clipEl, { clientX: 400, clientY: 60 })
    await fireEvent.mouseMove(window, { clientX: 80, clientY: 180 })
    expect(editor.getClipById(moving.id)!.clip.start).toBe(0)
    await fireEvent.mouseUp(window, { clientX: 80, clientY: 180 })

    expect(editor.getClipById(moving.id)!.channel.id).toBe(target.id)
    expect(editor.getClipById(moving.id)!.clip.start).toBe(0)
  })

  it('detects the channel under the dragged clip center instead of the grab point', async () => {
    const source = editor.channels[0]
    const channelAbove = editor.addChannel('video')
    const target = editor.addChannel('video')
    const moving = addClip(source.id, { fileName: 'edge-drag.mp4', start: 0 })
    const { getByText, getByLabelText } = render(Timeline)
    const clipEl = getByText('edge-drag.mp4').closest('.clip') as HTMLElement
    const sourceRow = getByLabelText(`Drop zone: ${source.name}`)
    const rowAbove = getByLabelText(`Drop zone: ${channelAbove.name}`)
    const targetRow = getByLabelText(`Drop zone: ${target.name}`)
    mockRect(sourceRow, { left: 260, right: 700, top: 30, bottom: 94, height: 64 })
    mockRect(rowAbove, { left: 260, right: 700, top: 94, bottom: 158, height: 64 })
    mockRect(targetRow, { left: 260, right: 700, top: 158, bottom: 222, height: 64 })
    mockRect(clipEl, { left: 500, right: 700, top: 34, bottom: 90, width: 200, height: 56 })

    // The pointer remains over channelAbove, but the clip center is over target.
    await fireEvent.mouseDown(clipEl, { clientX: 680, clientY: 38 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, clientY: 140 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 900, clientY: 140 }))

    expect(editor.getClipById(moving.id)!.channel.id).toBe(target.id)
  })

  it('dropping below all channels creates a new track pair at the drop position', async () => {
    const before = editor.channels.length
    const { getByLabelText, container } = render(Timeline)
    const zone = getByLabelText('Drop zone: create new track')
    const ruler = container.querySelector('.tl-ruler') as HTMLElement
    mockRect(ruler, {})
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'new.mp4',
        scrubBlobUrl: 'blob:new',
        sourceDuration: 7,
        dragOffsetX: 40,
      }),
    })
    fireDragOver(zone, 320, 300)
    await fireEvent.drop(zone, { dataTransfer: dt, clientX: 320 })
    await new Promise((r) => setTimeout(r, 10))
    // a fresh video channel AND a fresh audio channel are created
    expect(editor.channels.length).toBe(before + 2)
    const videoCh = editor.channels[before]
    const audioCh = editor.channels[before + 1]
    expect(videoCh.type).toBe('video')
    expect(audioCh.type).toBe('audio')
    expect(videoCh.clips).toHaveLength(1)
    expect(videoCh.clips[0].fileName).toBe('new.mp4')
    expect(videoCh.clips[0].outPoint).toBe(7)
    expect(videoCh.clips[0].start).toBe(7)
    // the linked audio clip lands on the NEW audio channel, not the first one
    expect(audioCh.clips).toHaveLength(1)
    expect(audioCh.clips[0].start).toBe(7)
    expect(editor.channels[1].clips).toHaveLength(0)
    expect(videoCh.clips[0].linkedClipId).toBe(audioCh.clips[0].id)
  })

  it('places delayed audio at the video current position', async () => {
    let resolveExtraction!: (value: { blobUrl: string; blob: Blob }) => void
    vi.mocked(extractAudio).mockImplementationOnce(() => new Promise((resolve) => {
      resolveExtraction = resolve
    }))
    const videoChannel = editor.channels[0]
    const audioChannel = editor.channels[1]
    const { getByLabelText, getByText } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${videoChannel.name}`)
    mockRect(row, { left: 0 })
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'delayed-audio.mp4',
        scrubBlobUrl: 'blob:delayed-audio',
        sourceDuration: 7,
      }),
    })

    await fireEvent.drop(row, { dataTransfer: dt, clientX: 0 })
    await Promise.resolve()
    expect(mediaProcessing.active).toBe(true)
    expect(getByText('Adding your clip…')).toBeTruthy()
    const videoClip = editor.getClipById(videoChannel.clips[0].id)!.clip
    editor.moveClip(videoChannel.id, videoClip.id, 6)
    resolveExtraction({ blobUrl: 'blob:audio', blob: new Blob() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await waitFor(() => expect(mediaProcessing.active).toBe(false))

    const audioClip = editor.channels.find((channel) => channel.id === audioChannel.id)!.clips[0]
    expect(videoClip.start).toBe(6)
    expect(audioClip.start).toBe(6)
    expect(videoClip.linkedClipId).toBe(audioClip.id)
    expect(audioClip.linkedClipId).toBe(videoClip.id)
    expect(editor.selectedClipIds).toEqual([videoClip.id])
  })

  it('shows video audio dropped on an audio track at 100 percent volume', async () => {
    const audioChannel = editor.channels[1]
    const { container, getByLabelText } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${audioChannel.name}`)
    mockRect(row, { left: 0 })
    const dataTransfer = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'video-on-audio.mp4',
        mediaKind: 'video',
        scrubBlobUrl: 'blob:video-on-audio',
        sourceDuration: 5,
      }),
    })

    await fireEvent.drop(row, { dataTransfer, clientX: 0 })
    await waitFor(() => expect(audioChannel.clips).toHaveLength(1))

    const audioClip = audioChannel.clips[0]
    const volumeLine = container.querySelector(`[data-timeline-clip-id="${audioClip.id}"] .vol-line`) as HTMLElement
    expect(audioClip.volume).toBe(100)
    expect(volumeLine).toHaveAttribute('aria-valuenow', '100')
    expect(volumeLine.style.top).toBe('50%')
  })

  it('uses the global preparation modal instead of the timeline message for long media', async () => {
    let resolveExtraction!: (value: { blobUrl: string; blob: Blob }) => void
    vi.mocked(extractAudio).mockImplementationOnce(() => new Promise((resolve) => {
      resolveExtraction = resolve
    }))
    const videoChannel = editor.channels[0]
    const { getByLabelText, queryByText } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${videoChannel.name}`)
    mockRect(row, { left: 0 })
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'long-video.mp4',
        scrubBlobUrl: 'blob:long-video',
        sourceDuration: 20,
      }),
    })

    await fireEvent.drop(row, { dataTransfer: dt, clientX: 0 })
    await waitFor(() => expect(mediaProcessing.longVideoActive).toBe(true))
    expect(queryByText('Adding your clip…')).toBeNull()

    resolveExtraction({ blobUrl: 'blob:audio', blob: new Blob() })
    await waitFor(() => expect(mediaProcessing.longVideoActive).toBe(false))
  })

  it('blocks split commands while a Media Bin clip audio is still loading', async () => {
    let resolveExtraction!: (value: { blobUrl: string; blob: Blob }) => void
    vi.mocked(extractAudio).mockImplementationOnce(() => new Promise((resolve) => {
      resolveExtraction = resolve
    }))
    const videoChannel = editor.channels[0]
    const audioChannel = editor.channels[1]
    const { container, getByLabelText, getByRole } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${videoChannel.name}`)
    mockRect(row, { left: 0 })
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'loading-audio.mp4',
        scrubBlobUrl: 'blob:loading-audio',
        sourceDuration: 7,
      }),
    })

    await fireEvent.drop(row, { dataTransfer: dt, clientX: 0 })
    await waitFor(() => expect(mediaProcessing.active).toBe(true))
    await waitFor(() => expect(videoChannel.clips).toHaveLength(1))
    editor.setCurrentTime(3)

    try {
      const splitButton = getByLabelText('Split at playhead')
      expect(splitButton).toBeDisabled()
      await fireEvent.click(splitButton)
      await fireEvent.keyDown(window, { key: 'c' })
      expect(videoChannel.clips).toHaveLength(1)

      const clipElement = container.querySelector(`[data-timeline-clip-id="${videoChannel.clips[0].id}"]`)!
      await fireEvent.contextMenu(clipElement, { clientX: 140, clientY: 120 })
      expect(getByRole('menuitem', { name: /Split at playhead/ })).toBeDisabled()
      expect(videoChannel.clips).toHaveLength(1)
    } finally {
      resolveExtraction({ blobUrl: 'blob:audio', blob: new Blob() })
      await waitFor(() => expect(mediaProcessing.active).toBe(false))
    }

    expect(videoChannel.clips).toHaveLength(1)
    expect(audioChannel.clips).toHaveLength(1)
    expect(audioChannel.clips[0]).toMatchObject({ inPoint: 0, outPoint: 7, start: 0 })
    expect(videoChannel.clips[0].linkedClipId).toBe(audioChannel.clips[0].id)
  })

  it('puts Media Bin audio on the next empty channel when the channel below overlaps', async () => {
    const videoChannel = editor.channels[0]
    const occupiedAudio = editor.channels[1]
    addClip(occupiedAudio.id, { fileName: 'existing-audio.mp4' })
    const emptyAudio = editor.addChannel('audio')
    const { getByLabelText } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${videoChannel.name}`)
    mockRect(row, { left: 0 })
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'media-bin.mp4',
        scrubBlobUrl: 'blob:media-bin',
        sourceDuration: 7,
      }),
    })

    await fireEvent.drop(row, { dataTransfer: dt, clientX: 0 })
    await new Promise((r) => setTimeout(r, 10))

    const liveOccupiedAudio = editor.channels.find((channel) => channel.id === occupiedAudio.id)!
    const liveEmptyAudio = editor.channels.find((channel) => channel.id === emptyAudio.id)!
    const liveVideoChannel = editor.channels.find((channel) => channel.id === videoChannel.id)!
    expect(liveOccupiedAudio.clips).toHaveLength(1)
    expect(liveEmptyAudio.clips).toHaveLength(1)
    expect(liveEmptyAudio.clips[0].fileName).toBe('media-bin.mp4')
    expect(liveVideoChannel.clips[0].linkedClipId).toBe(liveEmptyAudio.clips[0].id)
  })

  it('reuses the audio channel below when its clips do not overlap the drop', async () => {
    const videoChannel = editor.channels[0]
    const audioChannel = editor.channels[1]
    addClip(videoChannel.id, { fileName: 'existing-video.mp4', start: 0 })
    addClip(audioChannel.id, { fileName: 'existing-audio.mp4', start: 0 })
    const emptyAudio = editor.addChannel('audio')
    const { getByLabelText } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${videoChannel.name}`)
    mockRect(row, { left: 0 })
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'later-media.mp4',
        scrubBlobUrl: 'blob:later-media',
        sourceDuration: 5,
      }),
    })

    fireDragOver(row, 400, 100)
    await fireEvent.drop(row, { dataTransfer: dt, clientX: 400 })
    await new Promise((r) => setTimeout(r, 10))

    const liveAudioChannel = editor.channels.find((channel) => channel.id === audioChannel.id)!
    const liveEmptyAudio = editor.channels.find((channel) => channel.id === emptyAudio.id)!
    expect(liveAudioChannel.clips).toHaveLength(2)
    expect(liveAudioChannel.clips[1].fileName).toBe('later-media.mp4')
    expect(liveAudioChannel.clips[1].start).toBe(10)
    expect(liveEmptyAudio.clips).toHaveLength(0)
  })

  it('creates an audio channel below the video when no empty one exists', async () => {
    const videoChannel = editor.channels[0]
    const occupiedAudio = editor.channels[1]
    addClip(occupiedAudio.id, { fileName: 'existing-audio.mp4' })
    const { getByLabelText } = render(Timeline)
    const row = getByLabelText(`Drop zone: ${videoChannel.name}`)
    mockRect(row, { left: 0 })
    const dt = makeDataTransfer({
      'application/x-cineedit-clip': JSON.stringify({
        fileName: 'media-bin.mp4',
        scrubBlobUrl: 'blob:media-bin',
        sourceDuration: 7,
      }),
    })

    await fireEvent.drop(row, { dataTransfer: dt, clientX: 0 })
    await new Promise((r) => setTimeout(r, 10))

    const videoIndex = editor.channels.findIndex((channel) => channel.id === videoChannel.id)
    const createdAudio = editor.channels[videoIndex + 1]
    expect(createdAudio.type).toBe('audio')
    expect(createdAudio.id).not.toBe(occupiedAudio.id)
    expect(createdAudio.clips[0].fileName).toBe('media-bin.mp4')
    expect(editor.channels.find((channel) => channel.id === occupiedAudio.id)!.clips).toHaveLength(1)
  })

  it('ignores drop on the new-track zone with invalid JSON', async () => {
    const before = editor.channels.length
    const { getByLabelText } = render(Timeline)
    const zone = getByLabelText('Drop zone: create new track')
    const dt = makeDataTransfer({ 'application/x-cineedit-clip': 'not-json{' })
    await fireEvent.drop(zone, { dataTransfer: dt })
    expect(editor.channels.length).toBe(before)
  })

  function fireDragOver(el: Element, clientX: number, clientY: number) {
    const event = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY })
    el.dispatchEvent(event)
  }

  it('auto-scrolls vertically when dragging near the bottom edge', async () => {
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-body') as HTMLElement
    mockRect(scroll, { bottom: 300, height: 300 })
    fireDragOver(scroll, 10, 295)
    await new Promise((r) => setTimeout(r, 60))
    expect(scroll.scrollTop).toBeGreaterThan(0)
    window.dispatchEvent(new Event('dragend'))
  })

  it('auto-scrolls horizontally when dragging near the right edge', async () => {
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const scrollbar = container.querySelector('.tl-scrollbar') as HTMLElement
    const content = container.querySelector('.tl-right-canvas') as HTMLElement
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540 })
    const initialWidth = parseFloat(content.style.width)

    fireDragOver(scroll, 795, 150)
    await new Promise((r) => setTimeout(r, 60))

    expect(scroll.scrollLeft).toBeGreaterThan(0)
    expect(scroll.scrollTop).toBe(0)
    expect(parseFloat(content.style.width)).toBeGreaterThan(initialWidth)
    expect(scrollbar).toHaveClass('drag-active')
    window.dispatchEvent(new Event('dragend'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scrollbar).not.toHaveClass('drag-active')
  })

  it('extends drag scrolling linearly instead of compounding the canvas width', async () => {
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const content = container.querySelector('.tl-right-canvas') as HTMLElement
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540 })

    fireDragOver(scroll, 795, 150)
    await new Promise((resolve) => setTimeout(resolve, 80))

    const width = parseFloat(content.style.width)
    expect(width - scroll.scrollLeft).toBeLessThan(620)
    window.dispatchEvent(new Event('dragend'))
  })

  it('auto-scrolls and expands a marquee near the right and bottom edges', async () => {
    const clip = addClip(editor.channels[0].id, { start: 20 })
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const body = container.querySelector('.tl-body') as HTMLElement
    const background = container.querySelector('.clips-area')!
    const clipEl = container.querySelector<HTMLElement>(`[data-timeline-clip-id="${clip.id}"]`)!
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540, height: 300 })
    mockRect(body, { left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300 })
    Object.defineProperty(clipEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 850 - scroll.scrollLeft,
        right: 930 - scroll.scrollLeft,
        top: 350 - body.scrollTop,
        bottom: 400 - body.scrollTop,
        width: 80,
        height: 50,
        x: 850 - scroll.scrollLeft,
        y: 350 - body.scrollTop,
        toJSON: () => ({}),
      }),
    })

    await fireEvent.pointerDown(background, {
      button: 0,
      pointerId: 1,
      clientX: 300,
      clientY: 100,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 795, clientY: 295 })
    await new Promise((resolve) => setTimeout(resolve, 140))

    expect(scroll.scrollLeft).toBeGreaterThan(50)
    expect(body.scrollTop).toBeGreaterThan(50)
    expect(editor.selectedClipIds).toContain(clip.id)
    await fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('auto-scrolls a marquee toward the left and top edges', async () => {
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const body = container.querySelector('.tl-body') as HTMLElement
    const background = container.querySelector('.clips-area')!
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540, height: 300 })
    mockRect(body, { left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300 })
    scroll.scrollLeft = 200
    body.scrollTop = 200

    await fireEvent.pointerDown(background, {
      button: 0,
      pointerId: 1,
      clientX: 500,
      clientY: 150,
    })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 265, clientY: 5 })
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(scroll.scrollLeft).toBeLessThan(200)
    expect(body.scrollTop).toBeLessThan(200)
    await fireEvent.pointerUp(window, { pointerId: 1 })
  })

  it('scrolls vertically faster as the pointer moves deeper past the edge', async () => {
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-body') as HTMLElement
    const left = container.querySelector('.tl-left') as HTMLElement
    mockRect(scroll, { left: 0, right: 800, top: 0, bottom: 300, height: 300 })
    mockRect(left, { left: 0, right: 260, width: 260 })

    fireDragOver(scroll, 500, 245)
    await new Promise((r) => setTimeout(r, 80))
    const shallowDistance = scroll.scrollTop
    window.dispatchEvent(new Event('dragend'))

    scroll.scrollTop = 0
    fireDragOver(scroll, 500, 330)
    await new Promise((r) => setTimeout(r, 80))
    const deepDistance = scroll.scrollTop
    window.dispatchEvent(new Event('dragend'))

    expect(shallowDistance).toBeGreaterThan(0)
    expect(deepDistance).toBeGreaterThan(shallowDistance)
  })

  it('does not accelerate farther inside the left channel headers', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    try {
      const { container } = render(Timeline)
      const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
      mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540, height: 300 })

      scroll.scrollLeft = 1000
      fireDragOver(scroll, 260, 150)
      await vi.advanceTimersByTimeAsync(80)
      const edgeDistance = 1000 - scroll.scrollLeft
      window.dispatchEvent(new Event('dragend'))

      scroll.scrollLeft = 1000
      fireDragOver(scroll, 100, 150)
      await vi.advanceTimersByTimeAsync(80)
      const farDistance = 1000 - scroll.scrollLeft
      window.dispatchEvent(new Event('dragend'))

      expect(edgeDistance).toBeGreaterThan(0)
      expect(farDistance).toBeGreaterThan(edgeDistance * 0.6)
      expect(farDistance).toBeLessThan(edgeDistance * 1.4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('auto-scrolls horizontally during a clip drag without requiring vertical movement', async () => {
    const clip = addClip(editor.channels[0].id, { start: 30 })
    const { container, getByText } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const clipEl = getByText('test.mp4').closest('.clip') as HTMLElement
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540 })

    await fireEvent.mouseDown(clipEl, { clientX: 700, clientY: 295 })
    await fireEvent.mouseMove(window, { clientX: 795, clientY: 295 })
    const startBeforeScroll = editor.getClipById(clip.id)!.clip.start
    await new Promise((r) => setTimeout(r, 60))

    expect(scroll.scrollLeft).toBeGreaterThan(0)
    expect(scroll.scrollTop).toBe(0)
    expect(editor.getClipById(clip.id)!.clip.start).toBeGreaterThan(startBeforeScroll)
    expect(clipEl.style.transform).toBe('translateY(0px)')
    await fireEvent.mouseUp(window, { clientX: 795, clientY: 295 })
  })

  it('keeps the scrollable width stable while dragging the last clip left', async () => {
    addClip(editor.channels[0].id, { start: 30 })
    const { container, getByText } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const canvas = container.querySelector('.tl-right-canvas') as HTMLElement
    const clipEl = getByText('test.mp4').closest('.clip') as HTMLElement
    const initialWidth = parseFloat(canvas.style.width)
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540 })
    Object.defineProperty(scroll, 'scrollWidth', { configurable: true, value: initialWidth })
    scroll.scrollLeft = 800

    await fireEvent.mouseDown(clipEl, { clientX: 700, clientY: 100 })
    await fireEvent.mouseMove(window, { clientX: 400, clientY: 100 })

    expect(parseFloat(canvas.style.width)).toBe(initialWidth)
    await fireEvent.mouseUp(window, { clientX: 400, clientY: 100 })
  })

  it('keeps a down-left drag aligned while scrolling past source-channel blockers', async () => {
    const video = editor.channels[0]
    const audio = editor.channels[1]
    addClip(video.id, { fileName: 'video-blocker.mp4', sourceDuration: 25, outPoint: 25, start: 0 })
    addClip(audio.id, { fileName: 'audio-blocker.mp4', sourceDuration: 25, outPoint: 25, start: 0 })
    const movingVideo = addClip(video.id, { fileName: 'moving-video.mp4', start: 30 })
    const movingAudio = addClip(audio.id, { fileName: 'moving-audio.mp4', start: 30 })
    movingVideo.linkedClipId = movingAudio.id
    movingAudio.linkedClipId = movingVideo.id
    editor.selectClips([movingVideo.id, movingAudio.id])

    const { container, getByText, getByLabelText } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const body = container.querySelector('.tl-body') as HTMLElement
    const clipEl = getByText('moving-video.mp4').closest('.clip') as HTMLElement
    const videoRow = getByLabelText(`Drop zone: ${video.name}`)
    const audioRow = getByLabelText(`Drop zone: ${audio.name}`)
    const zone = getByLabelText('Drop zone: create new track')
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540, height: 300 })
    mockRect(body, { left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300 })
    mockRect(videoRow, { left: 260, right: 800, top: 30, bottom: 94, height: 64 })
    mockRect(audioRow, { left: 260, right: 800, top: 94, bottom: 158, height: 64 })
    mockRect(zone, { left: 260, right: 800, top: 158, bottom: 400, width: 540, height: 242 })
    mockRect(clipEl, { left: 600, right: 800, top: 34, bottom: 90, width: 200, height: 56 })
    scroll.scrollLeft = 800

    await fireEvent.mouseDown(clipEl, { clientX: 780, clientY: 38 })
    await fireEvent.mouseMove(window, { clientX: 200, clientY: 180 })
    await new Promise((resolve) => setTimeout(resolve, 80))

    const expectedStart = Math.max(0, 30 + (200 - 780 + scroll.scrollLeft - 800) / 40)
    expect(editor.getClipById(movingVideo.id)!.clip.start).toBeCloseTo(expectedStart)
    expect(editor.getClipById(movingAudio.id)!.clip.start).toBeCloseTo(expectedStart)
    expect(zone).toHaveClass('drop-active')
    await fireEvent.mouseUp(window, { clientX: 200, clientY: 180 })
  })

  it('auto-scrolls horizontally while dragging the playhead near either edge', async () => {
    addClip(editor.channels[0].id, { sourceDuration: 60, outPoint: 60 })
    editor.setCurrentTime(10)
    const { container, getByLabelText } = render(Timeline)
    const scroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const body = container.querySelector('.tl-body') as HTMLElement
    const ruler = getByLabelText('Timeline ruler')
    const playhead = getByLabelText('Playhead')
    mockRect(scroll, { left: 260, right: 800, top: 0, bottom: 300, width: 540, height: 300 })
    mockRect(body, { left: 0, right: 800, top: 0, bottom: 300, width: 800, height: 300 })
    Object.defineProperty(ruler, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 260 - scroll.scrollLeft,
        right: 2660 - scroll.scrollLeft,
        top: 0,
        bottom: 26,
        width: 2400,
        height: 26,
        x: 260 - scroll.scrollLeft,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    await fireEvent.pointerDown(playhead, { pointerId: 1, clientX: 660, clientY: 20 })
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 1000, clientY: 20 })
    const timeBeforeRightScroll = editor.currentTime
    expect(260 - scroll.scrollLeft + editor.currentTime * editor.pixelsPerSecond).toBe(800)
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(scroll.scrollLeft).toBeGreaterThan(0)
    expect(scroll.scrollTop).toBe(0)
    expect(editor.currentTime).toBeGreaterThan(timeBeforeRightScroll)
    expect(260 - scroll.scrollLeft + editor.currentTime * editor.pixelsPerSecond).toBeCloseTo(800)
    await fireEvent.pointerUp(window, { pointerId: 1 })

    scroll.scrollLeft = 200
    editor.setCurrentTime(10)
    await fireEvent.pointerDown(playhead, { pointerId: 2, clientX: 460, clientY: 20 })
    await fireEvent.pointerMove(window, { pointerId: 2, clientX: 100, clientY: 20 })
    const timeBeforeLeftScroll = editor.currentTime
    expect(260 - scroll.scrollLeft + editor.currentTime * editor.pixelsPerSecond).toBe(260)
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(scroll.scrollLeft).toBeLessThan(200)
    expect(editor.currentTime).toBeLessThan(timeBeforeLeftScroll)
    expect(260 - scroll.scrollLeft + editor.currentTime * editor.pixelsPerSecond).toBeCloseTo(260)
    await fireEvent.pointerUp(window, { pointerId: 2 })
  })

  it('auto-scrolls vertically when moving a timeline clip near the bottom edge', async () => {
    addClip(editor.channels[0].id)
    const { container, getByText } = render(Timeline)
    const scroll = container.querySelector('.tl-body') as HTMLElement
    const clipEl = getByText('test.mp4').closest('.clip') as HTMLElement
    mockRect(scroll, { bottom: 300, height: 300 })

    await fireEvent.mouseDown(clipEl, { clientX: 20, clientY: 100 })
    await fireEvent.mouseMove(window, { clientX: 20, clientY: 295 })
    await new Promise((r) => setTimeout(r, 60))

    expect(scroll.scrollTop).toBeGreaterThan(0)
    expect(parseFloat(clipEl.style.transform.replace('translateY(', ''))).toBeGreaterThan(195)
    await fireEvent.mouseUp(window, { clientX: 20, clientY: 295 })
  })

  it('stops auto-scroll at the end of the new-track drop zone', async () => {
    const { container, getByLabelText } = render(Timeline)
    const scroll = container.querySelector('.tl-body') as HTMLElement
    const zone = getByLabelText('Drop zone: create new track')
    mockRect(scroll, { bottom: 300, height: 300 })
    mockRect(zone, { top: 250, bottom: 400, height: 150 })

    fireDragOver(scroll, 10, 295)
    await new Promise((r) => setTimeout(r, 250))

    expect(scroll.scrollTop).toBeGreaterThan(0)
    expect(scroll.scrollTop).toBeLessThanOrEqual(100)
    window.dispatchEvent(new Event('dragend'))
  })

  it('does not auto-scroll when dragging in the middle', async () => {
    const { container } = render(Timeline)
    const scroll = container.querySelector('.tl-body') as HTMLElement
    mockRect(scroll, { bottom: 300, height: 300 })
    fireDragOver(scroll, 10, 150)
    await new Promise((r) => setTimeout(r, 60))
    expect(scroll.scrollTop).toBe(0)
    window.dispatchEvent(new Event('dragend'))
  })

  it('keeps headers and tracks in the same vertical scroll body', () => {
    const { container } = render(Timeline)
    // Vertical scrolling stays shared; only the track column scrolls horizontally.
    expect(container.querySelectorAll('.tl-body')).toHaveLength(1)
    const left = container.querySelector('.tl-left') as HTMLElement
    const body = container.querySelector('.tl-body') as HTMLElement
    const right = container.querySelector('.tl-right') as HTMLElement
    const trackScroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const horizontalScrollbar = container.querySelector('.tl-scrollbar') as HTMLElement
    expect(body.contains(left)).toBe(true)
    expect(body.contains(right)).toBe(true)
    expect(right.contains(trackScroll)).toBe(true)
    expect(body.contains(horizontalScrollbar)).toBe(true)
    expect(left.contains(horizontalScrollbar)).toBe(false)
    expect(right).not.toBe(body)
  })

  it('keeps the visible horizontal scrollbar synced with the clip scroller', () => {
    const { container } = render(Timeline)
    const trackScroll = container.querySelector('.tl-track-scroll') as HTMLElement
    const horizontalScrollbar = container.querySelector('.tl-scrollbar') as HTMLElement

    trackScroll.scrollLeft = 120
    trackScroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(horizontalScrollbar.scrollLeft).toBe(120)

    horizontalScrollbar.scrollLeft = 240
    horizontalScrollbar.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(trackScroll.scrollLeft).toBe(240)
  })

  it.each([
    ['.tl-scrollbar', '.tl-track-scroll', 120, 360],
    ['.tl-scrollbar', '.tl-track-scroll', 360, 120],
    ['.tl-track-scroll', '.tl-scrollbar', 120, 360],
    ['.tl-track-scroll', '.tl-scrollbar', 360, 120],
  ])('does not rewind %s from %s when scrolling from %i to %i', (sourceSelector, followerSelector, start, next) => {
    const { container, getByLabelText } = render(Timeline)
    const source = container.querySelector<HTMLElement>(sourceSelector)!
    const follower = container.querySelector<HTMLElement>(followerSelector)!

    source.scrollLeft = start
    source.dispatchEvent(new Event('scroll'))
    expect(follower.scrollLeft).toBe(start)

    // Native scrolling can advance before the mirrored scroll event is delivered.
    source.scrollLeft = next
    follower.dispatchEvent(new Event('scroll'))
    expect(source.scrollLeft).toBe(next)

    source.dispatchEvent(new Event('scroll'))
    follower.dispatchEvent(new Event('scroll'))
    expect(follower.scrollLeft).toBe(next)
    expect(getByLabelText('Timeline ruler').style.transform).toBe(`translateX(${-next}px)`)
  })

  it('accepts a new scroll from the follower before its mirrored event arrives', () => {
    const { container, getByLabelText } = render(Timeline)
    const tracks = container.querySelector<HTMLElement>('.tl-track-scroll')!
    const scrollbar = container.querySelector<HTMLElement>('.tl-scrollbar')!

    scrollbar.scrollLeft = 120
    scrollbar.dispatchEvent(new Event('scroll'))
    tracks.scrollLeft = 300
    tracks.dispatchEvent(new Event('scroll'))

    expect(scrollbar.scrollLeft).toBe(300)
    expect(getByLabelText('Timeline ruler').style.transform).toBe('translateX(-300px)')
  })

  it('keeps fractional scrolling aligned with the tracks and ruler', () => {
    const { container, getByLabelText } = render(Timeline)
    const tracks = container.querySelector<HTMLElement>('.tl-track-scroll')!
    const scrollbar = container.querySelector<HTMLElement>('.tl-scrollbar')!

    for (const position of [120, 120.5, 121, 120.25]) {
      scrollbar.scrollLeft = position
      scrollbar.dispatchEvent(new Event('scroll'))
      tracks.dispatchEvent(new Event('scroll'))

      expect(tracks.scrollLeft).toBe(position)
      expect(scrollbar.scrollLeft).toBe(position)
      expect(getByLabelText('Timeline ruler').style.transform).toBe(`translateX(${-position}px)`)
    }
  })

  it('uses the clamped track position without writing back into the active scrollbar', () => {
    const { container, getByLabelText } = render(Timeline)
    const tracks = container.querySelector<HTMLElement>('.tl-track-scroll')!
    const scrollbar = container.querySelector<HTMLElement>('.tl-scrollbar')!
    let trackPosition = 0
    Object.defineProperty(tracks, 'scrollLeft', {
      configurable: true,
      get: () => trackPosition,
      set: (value: number) => { trackPosition = Math.min(value, 238) },
    })

    scrollbar.scrollLeft = 240
    scrollbar.dispatchEvent(new Event('scroll'))
    expect(getByLabelText('Timeline ruler').style.transform).toBe('translateX(-238px)')

    tracks.dispatchEvent(new Event('scroll'))
    expect(scrollbar.scrollLeft).toBe(240)
    expect(tracks.scrollLeft).toBe(238)
  })

  it('preserves the ruler offset when zoom changes the canvas width', async () => {
    const { container, getByLabelText } = render(Timeline)
    const tracks = container.querySelector<HTMLElement>('.tl-track-scroll')!
    const ruler = getByLabelText('Timeline ruler')
    tracks.scrollLeft = 120
    tracks.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)

    await fireEvent.input(getByLabelText('Timeline zoom'), { target: { value: '120' } })

    expect(ruler.style.width).toBe('1320px')
    expect(ruler.style.transform).toBe('translateX(-120px)')
  })

  it('adds responsive end clearance while an inspector covers the timeline', () => {
    const { container } = render(Timeline, { inspectorOpen: true })
    const content = container.querySelector('.tl-content') as HTMLElement
    expect(content).toHaveClass('inspector-open')
    expect(getComputedStyle(content).boxSizing).toBe('content-box')
  })

  it('preserves the horizontal scroll position when the inspector opens', async () => {
    const { container, rerender } = render(Timeline, { inspectorOpen: false })
    const body = container.querySelector('.tl-track-scroll') as HTMLElement
    const scrollAssignments: number[] = []
    let scrollLeft = 180
    Object.defineProperty(body, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value
        scrollAssignments.push(value)
      },
    })

    await rerender({ inspectorOpen: true })
    await Promise.resolve()

    expect(scrollAssignments).toContain(180)
    expect(body.scrollLeft).toBe(180)
  })

  it('does not let inspector scroll clearance extend the playhead range', async () => {
    addClip(editor.channels[0].id, { outPoint: 5 })
    render(Timeline, { inspectorOpen: true })

    editor.setCurrentTime(8)

    await vi.waitFor(() => expect(editor.currentTime).toBe(5))
  })
})
