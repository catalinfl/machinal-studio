import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { API_BASE, compileProject, downloadFile, friendlyHttpError, getAudioPreview, getMediaMetadata, getScrubProxy, isRenderFileName, listFiles, listProxySources, listScrubs, listSourceVideos, mediaSourceUrl, mediaThumbnailUrl, requestAIEdit, requestAIImage, scrubProxyName, uploadFile } from '../../lib/api'

describe('api', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([
    ['', ''],
    ['http://localhost:8080', 'http://localhost:8080'],
    [' http://127.0.0.1:8080/ ', 'http://127.0.0.1:8080'],
    ['api.example.test/', 'https://api.example.test'],
  ])('normalizes VITE_API_BASE %j to %j', async (raw, expected) => {
    vi.stubEnv('VITE_API_BASE', raw)
    vi.resetModules()
    const api = await import('../../lib/api')
    expect(api.API_BASE).toBe(expected)
  })

  it('listFiles parses tab-separated lines', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('foo.mp4\t1024 bytes\nbar_scrub.mp4\t2048 bytes\n', { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const files = await listFiles()
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/list`, expect.objectContaining({ headers: expect.any(Object) }))
    expect(files).toEqual([
      { name: 'foo.mp4', size: 1024 },
      { name: 'bar_scrub.mp4', size: 2048 },
    ])
  })

  it('listFiles throws on non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    )
    await expect(listFiles()).rejects.toThrow('Something went wrong on the server')
  })

  it('listScrubs filters and renames scrub files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          'video.mp4\t100\nclip_scrub.mp4\t200\naudio_scrub.wav\t300\nfile_scrub.txt\t400\nclip_scrub_landscape_720.mp4\t500\n',
          { status: 200 }
        )
      )
    )
    const scrubs = await listScrubs()
    expect(scrubs).toHaveLength(4)
    expect(scrubs[0]).toEqual({
      scrubName: 'clip_scrub.mp4',
      displayName: 'clip.mp4',
      size: 200,
    })
    expect(scrubs.find((s) => s.scrubName === 'file_scrub.txt')?.displayName).toBe(
      'file.txt'
    )
    expect(scrubs.find((s) => s.scrubName === 'clip_scrub_landscape_720.mp4')?.displayName).toBe('clip.mp4')
  })

  it('listSourceVideos returns originals without generated scrub files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(
        'clip.mp4\t100\nclip_scrub.mp4\t80\nclip_scrub_landscape_720.mp4\t120\nmovie.mkv\t200\nnotes.txt\t20\n',
        { status: 200 },
      )),
    )

    await expect(listSourceVideos()).resolves.toEqual([
      { name: 'clip.mp4', size: 100 },
      { name: 'movie.mkv', size: 200 },
    ])
  })

  it('associates volume sources with their existing scrub previews', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(
        'clip.mp4\t100 bytes\nclip_scrub.mp4\t80 bytes\nclip_scrub_landscape_720.mp4\t120 bytes\nclip_scrub_landscape_480.mp4\t90 bytes\nmovie.mov\t200 bytes\n',
        { status: 200 },
      )),
    )

    await expect(listProxySources()).resolves.toEqual([
      { name: 'clip.mp4', size: 100, mediaKind: 'video', scrubName: 'clip_scrub_landscape_480.mp4', isRender: false },
      { name: 'movie.mov', size: 200, mediaKind: 'video', scrubName: undefined, isRender: false },
    ])
  })

  it('includes persisted audio and image sources in the proxy inventory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'track.mp3\t100 bytes\nposter.png\t200 bytes\nposter_scrub.png\t50 bytes\n',
      { status: 200 },
    )))

    await expect(listProxySources()).resolves.toEqual([
      { name: 'track.mp3', size: 100, mediaKind: 'audio', isRender: false },
      { name: 'poster.png', size: 200, mediaKind: 'image', isRender: false },
    ])
  })

  it('derives the matching volume proxy name from a source name', () => {
    expect(scrubProxyName('clip.mp4')).toBe('clip_scrub_480.mp4')
    expect(scrubProxyName('clip.final.mov')).toBe('clip.final_scrub_480.mov')
    expect(scrubProxyName('clip')).toBe('clip_scrub_480')
    expect(scrubProxyName('clip.mp4', 'portrait')).toBe('clip_scrub_portrait_480.mp4')
  })

  it('fetches only the audio preview for a server video', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('au', {
      status: 206,
      headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-1/12000000' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const url = await getAudioPreview('large clip.mp4')
    expect(url).toBe(`${API_BASE}/audio-preview?file=large%20clip.mp4`)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/audio-preview?file=large%20clip.mp4`, { headers: { Range: 'bytes=0-1' } })
  })

  it('distinguishes silent videos from audio processing failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('encoder failed', { status: 500 }))
      .mockResolvedValueOnce(new Response('not audio', { headers: { 'content-type': 'text/html' } })))
    await expect(getAudioPreview('silent.mp4')).resolves.toBeNull()
    await expect(getAudioPreview('broken.mp4')).rejects.toThrow('We could not prepare the audio preview')
    await expect(getAudioPreview('wrong.mp4')).rejects.toThrow('We could not prepare the audio preview')
  })

  it('requests the proxy endpoint with the source file from the volume', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getScrubProxy('clip.mp4')).rejects.toThrow('We could not find this media file')
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/scrub-proxy?file=clip.mp4&aspect=landscape`, { headers: { Range: 'bytes=0-1' } })
  })

  it('requests an orientation-specific portrait proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getScrubProxy('vertical clip.mp4', 'portrait')).rejects.toThrow('We could not find this media file')
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/scrub-proxy?file=vertical%20clip.mp4&aspect=portrait`, { headers: { Range: 'bytes=0-1' } })
  })

  it('streams the proxy URL without downloading the body', async () => {
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      const url = String(input)
      if (url.includes('/media-metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ duration: 720.5, width: 1280, height: 720 }), {
          headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response('or', {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/800000000' },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await getScrubProxy('Aldous Huxley 1.mp4', 'portrait')
    expect(result.blobUrl).toBe(`${API_BASE}/scrub-proxy?file=Aldous%20Huxley%201.mp4&aspect=portrait`)
    expect(result.duration).toBe(720.5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a proxy probe with a non-video content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getScrubProxy('clip.mp4')).rejects.toThrow('We could not prepare the video preview')
  })

  it('downloadFile fetches the original file, not the scrub route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('video', {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadFile('clip test.mp4')

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/download?file=clip%20test.mp4`, expect.objectContaining({ headers: expect.any(Object) }))
    expect(result.type).toBe('video/mp4')
  })

  it('builds encoded thumbnail and playable source URLs without fetching media', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(mediaThumbnailUrl('clip #1 & final.mp4')).toBe(`${API_BASE}/thumbnail?file=clip%20%231%20%26%20final.mp4`)
    expect(mediaSourceUrl('clip #1 & final.mp4')).toBe(`${API_BASE}/download?file=clip%20%231%20%26%20final.mp4`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { duration: 12.5, width: 1920, height: 1080 },
    { duration: 180, width: 0, height: 0 },
    { duration: 0, width: 1920, height: 1080 },
    { duration: 0, width: 0, height: 0 },
  ])('reads server metadata without downloading media: %j', async (metadata) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMediaMetadata('clip #1.mp4')).resolves.toEqual(metadata)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/media-metadata?file=clip%20%231.mp4`, expect.objectContaining({ headers: expect.any(Object) }))
  })

  it('reports metadata HTTP failures without requesting a proxy or original', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('probe failed', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMediaMetadata('broken.mp4')).rejects.toThrow('We could not prepare this media')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${API_BASE}/media-metadata?file=broken.mp4`, expect.objectContaining({ headers: expect.any(Object) }))
  })

  it.each([
    { duration: -1, width: 1920, height: 1080 },
    { duration: 7, width: -1, height: 1080 },
    { duration: 7, width: 1920, height: -1 },
    { duration: '7', width: 1920, height: 1080 },
    { duration: 7, width: '1920', height: 1080 },
    { duration: 7, width: 1920, height: null },
    { width: 1920, height: 1080 },
    {},
  ])('rejects invalid metadata fields: %j', async (metadata) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMediaMetadata('broken.mp4')).rejects.toThrow('We could not read the metadata for this media')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uploadFile sends FormData and returns response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('uploaded: foo.mp4', { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const xhr = vi.fn()
    vi.stubGlobal('XMLHttpRequest', xhr)

    const file = new File(['data'], 'foo.mp4', { type: 'video/mp4' })
    const result = await uploadFile(file)
    expect(result).toBe('uploaded: foo.mp4')
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/upload`,
      expect.objectContaining({ method: 'POST' })
    )
    const sentBody = fetchMock.mock.calls[0][1].body
    expect(sentBody).toBeInstanceOf(FormData)
    expect((sentBody as FormData).get('file')).toBe(file)
    expect(xhr).not.toHaveBeenCalled()
  })

  it('uploadFile throws on non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }))
    )
    await expect(uploadFile(new File([], 'x'))).rejects.toThrow('You do not have permission')
  })

  describe('uploadFile with progress', () => {
    let request: {
      open: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      setRequestHeader: ReturnType<typeof vi.fn>
      upload: { onprogress: ((event: ProgressEvent) => void) | null }
      onload: (() => void) | null
      onerror: (() => void) | null
      onabort: (() => void) | null
      status: number
      responseText: string
    }

    beforeEach(() => {
      request = {
        open: vi.fn(), send: vi.fn(), setRequestHeader: vi.fn(), upload: { onprogress: null },
        onload: null, onerror: null, onabort: null, status: 200, responseText: 'uploaded: foo.mp4',
      }
      vi.stubGlobal('XMLHttpRequest', vi.fn(function () { return request }))
      vi.stubGlobal('fetch', vi.fn())
    })

    it('sends FormData via XHR and reports computable progress until the server responds', async () => {
      const file = new File(['data'], 'foo.mp4', { type: 'video/mp4' })
      const onProgress = vi.fn()
      const settled = vi.fn()
      const upload = uploadFile(file, onProgress)
      void upload.then(settled)

      expect(XMLHttpRequest).toHaveBeenCalledOnce()
      expect(request.open).toHaveBeenCalledExactlyOnceWith('POST', `${API_BASE}/upload`)
      expect(request.send).toHaveBeenCalledOnce()
      const form = request.send.mock.calls[0][0] as FormData
      expect(form).toBeInstanceOf(FormData)
      expect(form.get('file')).toBe(file)
      expect([...form.keys()]).toEqual(['file'])
      expect(fetch).not.toHaveBeenCalled()

      request.upload.onprogress!(new ProgressEvent('progress', { lengthComputable: false, loaded: 1, total: 0 }))
      expect(onProgress).not.toHaveBeenCalled()
      request.upload.onprogress!(new ProgressEvent('progress', { lengthComputable: true, loaded: 2, total: 4 }))
      request.upload.onprogress!(new ProgressEvent('progress', { lengthComputable: true, loaded: 4, total: 4 }))
      expect(onProgress.mock.calls).toEqual([[{ loaded: 2, total: 4 }], [{ loaded: 4, total: 4 }]])
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()

      request.onload!()
      await expect(upload).resolves.toBe('uploaded: foo.mp4')
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([201, 204, 299])('accepts HTTP %s success responses', async (status) => {
      request.status = status
      request.responseText = status === 204 ? '' : 'saved'
      const upload = uploadFile(new File(['data'], 'foo.mp4'), vi.fn())
      request.onload!()

      await expect(upload).resolves.toBe(request.responseText)
    })

    it.each([
      { status: 302, message: 'Upload rejected' },
      { status: 408, message: 'The upload timed out. Please try again.' },
      { status: 403, message: 'You do not have permission' },
      { status: 500, message: 'We could not upload this file' },
    ])('rejects HTTP $status responses with friendly messages', async ({ status, message }) => {
      request.status = status
      request.responseText = 'Upload rejected'
      const upload = uploadFile(new File([], 'foo.mp4'), vi.fn())
      const rejected = expect(upload).rejects.toThrow(message)
      request.onload!()

      await rejected
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      { event: 'onerror', message: 'Upload failed. Check your connection and try again.' },
      { event: 'onabort', message: 'Upload canceled' },
    ] as const)('rejects $event without falling back to fetch', async ({ event, message }) => {
      const upload = uploadFile(new File([], 'foo.mp4'), vi.fn())
      const rejected = expect(upload).rejects.toThrow(message)
      request[event]!()

      await rejected
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('hides provider details from caption errors', () => {
    expect(friendlyHttpError(502, 'OpenRouter returned no timestamped segments', 'captions'))
      .toBe('We could not generate captions for this media. Please check that it has clear audio and try again.')
  })

  it('hides HTTP status codes from provider errors', () => {
    const message = friendlyHttpError(502, 'OpenRouter HTTP 502: upstream unavailable', 'image')
    expect(message).toBe('We could not generate the image right now. Please try again in a moment.')
    expect(message).not.toContain('502')
    expect(message).not.toContain('OpenRouter')
  })

  it('sends AI instructions and compact timeline context to the Go endpoint', async () => {
    const plan = { revision: 'rev-1', summary: 'No changes', operations: [] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(plan), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const project = {
      duration: 0,
      fps: 30,
      aspect: 'landscape' as const,
      focus: { playhead: 0, selectedClipIds: [], selectedTrackIds: [], selectedEffectIds: [], selectedTextIds: [] },
      tracks: [],
      effects: [],
      transitions: [],
      texts: [],
      sources: [],
    }

    await expect(requestAIEdit('Tighten the intro', 'rev-1', project)).resolves.toEqual(plan)
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/ai/edit`, expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      instruction: 'Tighten the intro',
      revision: 'rev-1',
      project,
    })
  })

  it('sends AI edit session privately for server-side media analysis', async () => {
    localStorage.setItem('scrub-project-session-id', 'u_editor')
    try {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 'rev-1', summary: 'Done', operations: [] }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const project = {
        duration: 0, fps: 30, aspect: 'landscape' as const,
        focus: { playhead: 0, selectedClipIds: [], selectedTrackIds: [], selectedEffectIds: [], selectedTextIds: [] },
        tracks: [], effects: [], transitions: [], texts: [], sources: [],
      }
      await requestAIEdit('Keep the best moments', 'rev-1', project)
      expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/ai/edit`, expect.objectContaining({
        headers: expect.objectContaining({ 'X-Session-Id': 'u_editor' }),
      }))
    } finally {
      localStorage.removeItem('scrub-project-session-id')
    }
  })

  it('treats a null AI operation list as empty instead of crashing on length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ revision: 'rev-1', summary: 'Kept everything', operations: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const project = {
      duration: 0,
      fps: 30,
      aspect: 'landscape' as const,
      focus: { playhead: 0, selectedClipIds: [], selectedTrackIds: [], selectedEffectIds: [], selectedTextIds: [] },
      tracks: [],
      effects: [],
      transitions: [],
      texts: [],
      sources: [],
    }

    const plan = await requestAIEdit('Cut and let only important parts', 'rev-1', project)
    expect(plan.operations).toEqual([])
    expect(plan.operations.length).toBe(0)
  })

  it('rejects WASM media before requesting the server render route', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(compileProject({
      resolution: { w: 1280, h: 720 },
      fps: 30,
      videoChannels: [{
        clips: [{
          file: 'browser-only.mp4',
          sourceMode: 'wasm',
          sourceId: 'local-source',
          inPoint: 0,
          outPoint: 1,
          start: 0,
          segments: [],
        }],
      }],
      audioChannels: [],
    })).rejects.toThrow('Local media can only be rendered on this device')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests a transparent AI image through the protected image route', async () => {
    const image = { id: 'asset-1', name: 'ai_image_asset-1.png', mediaType: 'image/png', width: 1280, height: 720, sourceMode: 'proxy' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(image), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestAIImage({
      prompt: 'A clean calendar cutout',
      model: 'openai/gpt-image-2.5-sunburst',
      aspect: '16:9',
      background: 'transparent',
    })).resolves.toEqual(image)
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/ai/images`, expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      prompt: 'A clean calendar cutout',
      model: 'openai/gpt-image-2.5-sunburst',
      aspect: '16:9',
      background: 'transparent',
    })
  })

  it('ignores browser-only video media when exporting server-side MP3 audio', async () => {
    const events = `${JSON.stringify({ type: 'complete', filename: 'render_output.mp3' })}\n`
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(events, { status: 200 }))
      .mockResolvedValueOnce(new Response('audio', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '5' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await compileProject({
      format: 'mp3',
      quality: 'normal',
      resolution: { w: 0, h: 0 },
      fps: 30,
      videoChannels: [{
        clips: [{
          file: 'browser-only.mp4', sourceMode: 'wasm', sourceId: 'local-video',
          inPoint: 0, outPoint: 1, start: 0, segments: [],
        }],
      }],
      audioChannels: [{
        clips: [{ file: 'voice.wav', inPoint: 0, outPoint: 1, start: 0, segments: [] }],
      }],
    })

    expect(result.filename).toBe('render_output.mp3')
    expect(result.blob.type).toBe('audio/mpeg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('streams server render progress before downloading the result', async () => {
    const events = [
      JSON.stringify({ type: 'progress', ratio: 0.25, message: 'rendering video' }),
      JSON.stringify({ type: 'progress', ratio: 1, message: 'finalizing output' }),
      JSON.stringify({ type: 'complete', filename: 'render_output.mp4' }),
      '',
    ].join('\n')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(events, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      }))
      .mockResolvedValueOnce(new Response('video', {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '5' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []

    const result = await compileProject({
      resolution: { w: 1280, h: 720 },
      fps: 30,
      videoChannels: [{
        clips: [{ file: 'source.mp4', inPoint: 0, outPoint: 1, start: 0, segments: [] }],
      }],
      audioChannels: [],
    }, {
      onProgress: ({ ratio }) => progress.push(ratio),
    })

    expect(result.filename).toBe('render_output.mp4')
    expect(result.blob.type).toBe('video/mp4')
    expect(progress[0]).toBeCloseTo(0.25 * 0.97)
    expect(progress.at(-1)).toBe(1)
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE}/render`, expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/x-ndjson' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE}/download?file=render_output.mp4`)
  })

  it('surfaces errors reported after a streamed render starts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      `${JSON.stringify({ type: 'error', message: 'ffmpeg failed' })}\n`,
      { status: 200 },
    )))

    await expect(compileProject({
      resolution: { w: 1280, h: 720 },
      fps: 30,
      videoChannels: [{
        clips: [{ file: 'source.mp4', inPoint: 0, outPoint: 1, start: 0, segments: [] }],
      }],
      audioChannels: [],
    })).rejects.toThrow('We could not finish the export')
  })

  it('listFiles handles empty response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))
    const files = await listFiles()
    expect(files).toEqual([])
  })

  it('listFiles skips malformed lines', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nonum.mp4\nok.mp4\t500\nbad.mp4\textra\t100 bytes\n', { status: 200 }))
    )
    const files = await listFiles()
    expect(files).toEqual([
      { name: 'ok.mp4', size: 500 },
    ])
  })

  it('detects final exports by file name', async () => {
    expect(isRenderFileName('render_a1b2c3d4e5f6.mp4')).toBe(true)
    expect(isRenderFileName('RENDER_output.mp3')).toBe(true)
    expect(isRenderFileName('render_output.avi')).toBe(true)
    expect(isRenderFileName('clip.mp4')).toBe(false)
    expect(isRenderFileName('my_render_clip.mp4')).toBe(false)
  })

  it('marks server renders separately from source media', async () => {
    const payload = JSON.stringify([
      { name: 'clip.mp4', size: 100, cached: true },
      { name: 'render_a1b2c3d4e5f6.mp4', size: 200, s3_key: 'u_1/renders/render_a1b2c3d4e5f6.mp4', cached: false, render: true },
      { name: 'render_legacy.mp4', size: 50, cached: true },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(
        payload,
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))),
    )
    const files = await listFiles()
    expect(files).toEqual([
      { name: 'clip.mp4', size: 100, cached: true },
      { name: 'render_a1b2c3d4e5f6.mp4', size: 200, s3Key: 'u_1/renders/render_a1b2c3d4e5f6.mp4', cached: false, render: true },
      { name: 'render_legacy.mp4', size: 50, cached: true, render: true },
    ])
    const sources = await listProxySources()
    const render = sources.find((source) => source.name === 'render_a1b2c3d4e5f6.mp4')
    expect(render?.isRender).toBe(true)
    expect(render?.scrubName).toBeUndefined()
    expect(sources.find((source) => source.name === 'clip.mp4')?.isRender).toBe(false)
  })

  it('excludes renders from the source video inventory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(
        'clip.mp4\t100\nrender_a1b2c3.mp4\t200\n',
        { status: 200 },
      )),
    )
    await expect(listSourceVideos()).resolves.toEqual([
      { name: 'clip.mp4', size: 100 },
    ])
  })
})
