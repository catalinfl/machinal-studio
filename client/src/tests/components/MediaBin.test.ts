import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import MediaBin from '../../components/MediaBin.svelte'
import CompositionMenu from '../../components/CompositionMenu.svelte'
import * as api from '../../lib/api'
import * as scrubLib from '../../lib/scrub'
import { scrubSettings } from '../../stores/scrub.svelte'
import { editor } from '../../stores/editor.svelte'
import * as metadataLib from '../../lib/video-metadata'
import { MEDIA_NAME_MAX_LENGTH, clearMediaBinSources, getMediaBinSources, isGeneratedMediaSource, registerMediaBinSource, waitForMediaBinLoads } from '../../lib/media-bin'
import { buildAIProjectContext } from '../../lib/ai-edit'
import { mediaProcessing } from '../../stores/media-processing.svelte'
import { extractAudio } from '../../lib/wasm'
import * as localMedia from '../../lib/local-media'
import { addDroppedClip, type DropClipData } from '../../lib/drop'
import { compositionTimeline } from '../../lib/composition-adapter'
import type { Composition } from '../../lib/composition-types'

vi.mock('../../lib/wasm', () => ({
  createWasmScrub: vi.fn(),
  extractAudio: vi.fn().mockResolvedValue({ blobUrl: 'blob:audio', blob: new Blob() }),
}))

const mockAuthState = vi.hoisted(() => ({ isLogged: true }))

vi.mock('../../stores/auth.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/auth.svelte')>()
  return { ...actual, auth: mockAuthState }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function expectNoMediaDownloads(): void {
  expect(api.downloadFile).not.toHaveBeenCalled()
  expect(api.getVolumeSourcePreview).not.toHaveBeenCalled()
  expect(api.getVolumeProxyPreview).not.toHaveBeenCalled()
  expect(api.getScrubProxy).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
}

describe('MediaBin', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    mockAuthState.isLogged = true
    mediaProcessing.begin()
    mediaProcessing.end()
    scrubSettings.setMode('proxy')
    clearMediaBinSources()
    editor.clearTimeline()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    editor.clearSelection()
    editor.setCurrentTime(0)
    editor.clearHistory()
    editor.resetProjectAspect()
    editor.setResolution('1080p')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected media download')))
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    vi.spyOn(api, 'getMediaMetadata').mockResolvedValue({ duration: 7, width: 1920, height: 1080 })
    vi.spyOn(api, 'downloadFile').mockRejectedValue(new Error('Unexpected original download'))
    vi.spyOn(api, 'getVolumeSourcePreview').mockRejectedValue(new Error('Unexpected source preview download'))
    vi.spyOn(api, 'getVolumeProxyPreview').mockRejectedValue(new Error('Unexpected scrub download'))
    vi.spyOn(api, 'getScrubProxy').mockRejectedValue(new Error('Unexpected proxy generation'))
    vi.spyOn(api, 'getAudioPreview').mockResolvedValue('blob:audio')
    vi.spyOn(scrubLib, 'generateScrub').mockResolvedValue({ blobUrl: 'blob:timeline-video', duration: 7 })
    vi.mocked(extractAudio).mockResolvedValue({ blobUrl: 'blob:audio', blob: new Blob() })
    vi.spyOn(metadataLib, 'readVideoMetadata').mockResolvedValue({ duration: 7, width: 1920, height: 1080 })
    vi.spyOn(metadataLib, 'readAudioMetadata').mockResolvedValue({ duration: 18 })
    vi.spyOn(metadataLib, 'readImageMetadata').mockResolvedValue({ width: 1920, height: 1080 })
  })

  it('shows audio preparation failures instead of silently losing the audio channel', async () => {
    const { getByRole } = render(MediaBin)
    mediaProcessing.reportError('large.mp4: Cannot prepare audio: HTTP 500')
    await tick()
    expect(getByRole('alert')).toHaveTextContent('large.mp4: Cannot prepare audio: HTTP 500')
  })

  it('keeps search and secondary controls hidden until requested', async () => {
    const { getByLabelText, getByRole, queryByRole } = render(MediaBin)
    expect(getByLabelText('Open media search')).toBeTruthy()
    expect(queryByRole('searchbox')).toBeNull()
    expect(getByLabelText('Reload scrub list')).not.toBeVisible()
    expect(getByLabelText('Upload media')).toBeTruthy()
    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    expect(getByLabelText('Reload scrub list')).toBeVisible()
    expect(getByLabelText('Use server scrub')).toHaveAttribute('aria-pressed', 'true')
    expect(getByLabelText('Use local scrub')).toBeVisible()
  })

  it('focuses search on reveal and returns focus after clearing and collapsing with Escape', async () => {
    const { getByRole, queryByRole } = render(MediaBin)
    const trigger = getByRole('button', { name: 'Open media search' })
    await fireEvent.click(trigger)
    const search = getByRole('searchbox', { name: 'Search media' })
    expect(search).toHaveFocus()
    await fireEvent.input(search, { target: { value: 'missing' } })
    await fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    await fireEvent.keyDown(search, { key: 'Escape' })
    expect(queryByRole('searchbox')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the empty state when no items present', async () => {
    const { findByText } = render(MediaBin)
    expect(await findByText('Add your first files')).toBeTruthy()
  })

  it('renames media in a dialog without changing preview, drag or timeline source references', async () => {
    vi.mocked(api.listProxySources).mockResolvedValue([{ name: 'poster.png', size: 300, mediaKind: 'image' }])
    const view = render(MediaBin)
    await view.findByLabelText('Preview poster.png')
    await fireEvent.click(view.getByRole('button', { name: 'Rename poster.png' }))
    const input = view.getByRole('textbox', { name: 'Project name for poster.png' })
    expect(input).toHaveFocus()
    expect(input.closest('dialog')).toHaveAttribute('open')
    expect(view.getByRole('listitem', { name: 'Clip poster.png' })).not.toHaveAttribute('draggable', 'true')
    await fireEvent.input(input, { target: { value: ' Opening title ' } })
    await fireEvent.submit(input.closest('form')!)

    expect(view.getByRole('button', { name: 'Rename Opening title' })).toHaveFocus()
    const source = getMediaBinSources()[0]
    expect(source).toMatchObject({ name: 'poster.png', displayName: 'Opening title' })
    await fireEvent.click(view.getByRole('button', { name: 'Preview Opening title' }))
    expect(view.container.querySelector('.media-preview img')).toHaveAttribute('src', `${api.API_BASE}/download?file=poster.png`)
    await fireEvent.click(view.getByRole('button', { name: 'Close media preview' }))

    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    await fireEvent.dragStart(view.getByRole('listitem', { name: 'Clip Opening title' }), { dataTransfer: transfer, clientX: 10 })
    expect(JSON.parse(transfer.setData.mock.calls[0][1])).toMatchObject({ fileName: 'poster.png' })
    await fireEvent.click(view.getByRole('button', { name: 'Append Opening title to timeline' }))
    expect(editor.channels[0].clips[0].fileName).toBe('poster.png')

    await fireEvent.click(view.getByLabelText('Reload scrub list'))
    await waitForMediaBinLoads()
    expect(view.getByRole('button', { name: 'Preview Opening title' })).toBeInTheDocument()
    expect(api.getMediaMetadata).toHaveBeenLastCalledWith('poster.png')
    expectNoMediaDownloads()
  })

  it('cancels a rename with Escape and retains the original display name', async () => {
    registerMediaBinSource({ id: 'local', name: 'local.png', kind: 'image', duration: 10,
      sourceMode: 'wasm', sourceId: 'local', previewUrl: 'blob:local' })
    const view = render(MediaBin)
    await fireEvent.click(await view.findByRole('button', { name: 'Rename local.png' }))
    const input = view.getByRole('textbox', { name: 'Project name for local.png' })
    await fireEvent.input(input, { target: { value: 'Do not save' } })
    await fireEvent.keyDown(input, { key: 'Escape' })

    expect(view.queryByRole('textbox')).not.toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Rename local.png' })).toHaveFocus()
    expect(getMediaBinSources()[0].displayName).toBeUndefined()
  })

  it('blocks blank names and saving during processing but keeps cancellation available', async () => {
    registerMediaBinSource({ id: 'local', name: 'local.png', kind: 'image', duration: 10,
      sourceMode: 'wasm', sourceId: 'local', previewUrl: 'blob:local' })
    const view = render(MediaBin)
    await fireEvent.click(await view.findByRole('button', { name: 'Rename local.png' }))
    const input = view.getByRole('textbox', { name: 'Project name for local.png' })
    const save = view.getByRole('button', { name: 'Save media name' })
    await fireEvent.input(input, { target: { value: '   ' } })
    expect(save).toBeDisabled()
    await fireEvent.submit(input.closest('form')!)
    expect(view.getByRole('dialog', { name: 'Rename media' })).toBeInTheDocument()
    expect(getMediaBinSources()[0].displayName).toBeUndefined()

    await fireEvent.input(input, { target: { value: 'Do not save' } })
    mediaProcessing.begin()
    await tick()
    expect(input).toBeDisabled()
    expect(save).toBeDisabled()
    await fireEvent.submit(input.closest('form')!)
    await fireEvent.click(view.getByRole('button', { name: 'Cancel media rename' }))
    expect(view.queryByRole('dialog', { name: 'Rename media' })).not.toBeInTheDocument()
    expect(getMediaBinSources()[0].displayName).toBeUndefined()
    mediaProcessing.end()
    await tick()
  })

  it('retains the rename dialog on validation failure and clears the error when corrected', async () => {
    registerMediaBinSource({ id: 'local', name: 'local.png', kind: 'image', duration: 10,
      sourceMode: 'wasm', sourceId: 'local', previewUrl: 'blob:local' })
    const view = render(MediaBin)
    await fireEvent.click(await view.findByRole('button', { name: 'Rename local.png' }))
    const input = view.getByRole('textbox', { name: 'Project name for local.png' })
    expect(input).toHaveAttribute('maxlength', String(MEDIA_NAME_MAX_LENGTH))
    await fireEvent.input(input, { target: { value: 'a'.repeat(MEDIA_NAME_MAX_LENGTH + 1) } })
    await fireEvent.submit(input.closest('form')!)
    expect(view.getByRole('alert')).toHaveTextContent(`Use ${MEDIA_NAME_MAX_LENGTH} characters or fewer.`)
    expect(input).toHaveAttribute('aria-invalid', 'true')

    await fireEvent.input(input, { target: { value: 'Opening title' } })
    expect(view.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'false')
    await fireEvent.click(view.getByRole('button', { name: 'Save media name' }))
    expect(view.queryByRole('dialog', { name: 'Rename media' })).not.toBeInTheDocument()
    expect(getMediaBinSources()[0].displayName).toBe('Opening title')
  })

  it('supports project names for local imports, generated scenes and final renders', async () => {
    const sources = [
      { id: 'local', name: 'local.png', kind: 'image' as const, sourceMode: 'wasm' as const },
      { id: 'voice', name: 'voice_title_1234abcd.mp3', kind: 'audio' as const, generated: true },
      { id: 'scene', name: 'ai_scene_1234567890abcdef1234567890abcdef_01.scene.json', kind: 'video' as const, generated: true },
      { id: 'render', name: 'render_final.mp4', kind: 'video' as const, isRender: true },
    ]
    sources.forEach(source => registerMediaBinSource({ ...source, duration: 10 }))
    const view = render(MediaBin)
    for (const source of sources.slice(0, 3)) {
      await fireEvent.click(await view.findByRole('button', { name: `Rename ${source.name}` }))
      const input = view.getByRole('textbox', { name: `Project name for ${source.name}` })
      await fireEvent.input(input, { target: { value: `Named ${source.id}` } })
      await fireEvent.submit(input.closest('form')!)
    }
    await fireEvent.click(view.getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(view.getByRole('button', { name: /Renders/ }))
    await fireEvent.click(view.getByRole('button', { name: 'Rename render_final.mp4' }))
    const input = view.getByRole('textbox', { name: 'Project name for render_final.mp4' })
    await fireEvent.input(input, { target: { value: 'Final cut' } })
    await fireEvent.submit(input.closest('form')!)

    expect(getMediaBinSources().map(source => source.displayName)).toEqual(['Named local', 'Named voice', 'Named scene', 'Final cut'])
    expect(view.getByRole('button', { name: 'Rename Final cut' })).toBeInTheDocument()
  })

  it('searches both project names and original filenames', async () => {
    registerMediaBinSource({ id: 'poster', name: 'poster.png', displayName: 'Opening title', kind: 'image', duration: 10 })
    const view = render(MediaBin)
    await fireEvent.click(view.getByRole('button', { name: 'Open media search' }))
    const search = view.getByRole('searchbox', { name: 'Search media' })
    for (const value of ['Opening', 'poster.png']) {
      await fireEvent.input(search, { target: { value } })
      expect(view.getByRole('listitem', { name: 'Clip Opening title' })).toBeInTheDocument()
    }
  })

  it('keeps timeline deletion safeguards after a project rename', async () => {
    registerMediaBinSource({ id: 'poster', name: 'poster.png', displayName: 'Opening title', kind: 'image', duration: 10 })
    editor.addClip(editor.channels[0].id, {
      fileName: 'poster.png', mediaKind: 'image', scrubBlobUrl: null, sourceDuration: 10, inPoint: 0, outPoint: 5, start: 0,
    })
    const view = render(MediaBin)
    await fireEvent.click(view.getByRole('button', { name: 'Select media to delete', hidden: true }))
    await fireEvent.click(view.getByRole('button', { name: 'Select Opening title for deletion' }))
    await fireEvent.click(view.getByRole('button', { name: /^Delete/ }))

    expect(view.getByRole('alert')).toHaveTextContent('Opening title is used on the timeline')
    expect(view.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deletes by original filename and keeps failed selections with colon-containing project names', async () => {
    registerMediaBinSource({ id: 'poster', name: 'poster.png', displayName: 'Opening: title', kind: 'image', duration: 10 })
    const remove = vi.spyOn(api, 'deleteMediaFile').mockRejectedValue(new Error('Server unavailable'))
    const view = render(MediaBin)
    await fireEvent.click(view.getByRole('button', { name: 'Select media to delete', hidden: true }))
    await fireEvent.click(view.getByRole('button', { name: 'Select Opening: title for deletion' }))
    await fireEvent.click(view.getByRole('button', { name: /^Delete/ }))
    await fireEvent.click(view.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('Opening: title: Server unavailable'))
    expect(remove).toHaveBeenCalledExactlyOnceWith('poster.png')
    expect(view.getByRole('button', { name: 'Deselect Opening: title' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['proxy', 'wasm'] as const)('removes deleted %s media from a staged Recipe draft and saved composition metadata', async (mode) => {
    const assets = ['old', 'keep'].map((id) => ({ id, file: `${id}.mp4`, version: 'v1', kind: 'video' as const, duration: 7, local: mode === 'wasm' }))
    const composition: Composition = {
      id: 'compiled', documentRevision: 'document', compilerVersion: '1', catalogVersion: '1', duration: 0, textRenderKey: 'text',
      output: { aspect: 'landscape', resolution: '1080p', fps: 30, format: 'mp4', quality: 'normal' }, assets,
      tracks: editor.channels.map((channel) => ({ ...channel, clips: [] })), effects: [], transitions: [], textItems: [], segments: {},
    }
    editor.applyCompiledTimeline(compositionTimeline(composition, () => null), {
      kind: 'ready', composition, document: { version: 1, mode: 'assemble', tracks: composition.tracks }, assets, bindings: { shots: ['old', 'keep'] },
    }, editor.stateRevision)
    for (const asset of assets) registerMediaBinSource({ id: asset.id, name: asset.file, kind: asset.kind, duration: asset.duration, sourceMode: mode })
    vi.spyOn(api, 'deleteMediaFile').mockResolvedValue({ deleted: 'old.mp4', scrubDeleted: [] })
    const bin = render(MediaBin)
    const recipe = render(CompositionMenu)
    const recipeUI = within(recipe.container)
    const mediaUI = within(bin.container)
    await fireEvent.click(recipeUI.getByRole('button', { name: 'Recipe' }))
    await fireEvent.click(recipeUI.getByRole('tab', { name: 'Code DSL' }))
    const source = recipeUI.getByRole('textbox', { name: 'Recipe' }) as HTMLTextAreaElement
    await fireEvent.input(source, { target: { value: `${source.value}\n# Preserve my staged draft\n` } })
    expect(recipeUI.getByRole('complementary', { name: 'Media and bindings' })).toHaveTextContent('old.mp4')
    await fireEvent.click(recipeUI.getByRole('button', { name: 'Close video recipe' }))

    await fireEvent.click(mediaUI.getByRole('button', { name: 'Select media to delete', hidden: true }))
    await fireEvent.click(mediaUI.getByRole('button', { name: 'Select old.mp4 for deletion' }))
    await fireEvent.click(mediaUI.getByRole('button', { name: 'Delete (1)' }))
    await fireEvent.click(mediaUI.getByRole('button', { name: mode === 'proxy' ? 'Delete permanently' : 'Remove from session' }))
    await waitFor(() => expect(mediaUI.queryByRole('listitem', { name: 'Clip old.mp4' })).not.toBeInTheDocument())
    await fireEvent.click(recipeUI.getByRole('button', { name: 'Recipe' }))
    await fireEvent.click(recipeUI.getByRole('tab', { name: 'Code DSL' }))

    const available = recipeUI.getByRole('complementary', { name: 'Media and bindings' })
    expect(available).not.toHaveTextContent('old.mp4')
    expect(available).toHaveTextContent('keep.mp4')
    expect(source.value).toContain('# Preserve my staged draft')
    expect(editor.documentSession?.assets.map((asset) => asset.file)).toEqual(['keep.mp4'])
    expect(getMediaBinSources().map((item) => item.name)).toEqual(['keep.mp4'])
  })

  it('shows skeleton cards while the server inventory is loading', async () => {
    const gate = deferred<never[]>()
    vi.spyOn(api, 'listProxySources').mockReturnValue(gate.promise)
    const { container, queryByText, findByText } = render(MediaBin)
    await tick()

    expect(container.querySelectorAll('.bin-skeleton')).toHaveLength(6)
    expect(queryByText('Add your first files')).toBeNull()

    gate.resolve([])
    expect(await findByText('Add your first files')).toBeTruthy()
    await waitForMediaBinLoads()
    await tick()
    expect(container.querySelector('.bin-skeleton')).toBeNull()
  })

  it('shows a shimmer placeholder while a video preview loads from the server', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video', scrubName: 'clip_scrub.mp4' },
    ])
    const meta = deferred<{ duration: number; width: number; height: number }>()
    vi.spyOn(api, 'getMediaMetadata').mockReturnValue(meta.promise)
    const { container, findByText, findByLabelText } = render(MediaBin)
    await findByText('clip.mp4')
    await tick()

    expect(container.querySelector('.skel-thumb')).toBeTruthy()

    meta.resolve({ duration: 7, width: 1920, height: 1080 })
    await findByLabelText('Preview clip.mp4')
    expect(container.querySelector('.skel-thumb')).toBeNull()
  })

  it('disables media controls while a timeline clip is being added', async () => {
    const { getByLabelText } = render(MediaBin)
    mediaProcessing.begin()

    try {
      await waitFor(() => expect(getByLabelText('Upload media')).toBeDisabled())
      expect(getByLabelText('Reload scrub list')).toBeDisabled()
      expect(getByLabelText('Use server scrub')).toBeDisabled()
      expect(getByLabelText('Use local scrub')).toBeDisabled()
    } finally {
      mediaProcessing.end()
    }
  })

  it('reloads metadata and thumbnail URLs without downloading or regenerating scrub previews', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video', scrubName: 'clip_scrub.mp4' },
    ])
    const { container, getByLabelText, findByLabelText, getByRole } = render(MediaBin)
    await findByLabelText('Preview clip.mp4')
    await waitForMediaBinLoads()
    await fireEvent.click(getByLabelText('Reload scrub list'))
    await waitForMediaBinLoads()

    expect(api.listProxySources).toHaveBeenCalledTimes(2)
    expect(api.getMediaMetadata).toHaveBeenCalledWith('clip.mp4')
    await waitFor(() => expect(container.querySelector('.card img')).toHaveAttribute('src', `${api.API_BASE}/thumbnail?file=clip.mp4`))
    expect(container.querySelector('video')).toBeNull()
    expect(getMediaBinSources()).toEqual([expect.objectContaining({
      name: 'clip.mp4', duration: 7, width: 1920, height: 1080,
      previewUrl: `${api.API_BASE}/download?file=clip.mp4`,
      thumbnailUrl: `${api.API_BASE}/thumbnail?file=clip.mp4`,
      scrubBlobUrl: null,
    })])

    await fireEvent.click(getByRole('button', { name: 'Preview clip.mp4' }))
    expect(container.querySelector('.media-preview video')).toHaveAttribute('src', `${api.API_BASE}/download?file=clip.mp4`)
    expectNoMediaDownloads()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
  })

  it('reuses unchanged S3 previews when returning to the editor', async () => {
    vi.mocked(api.listProxySources).mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video', etag: 'version-1', s3Key: 'user/clip.mp4' },
    ])
    const firstVisit = render(MediaBin)
    await firstVisit.findByLabelText('Preview clip.mp4')
    await waitForMediaBinLoads()
    firstVisit.unmount()

    const nextVisit = render(MediaBin)
    await nextVisit.findByLabelText('Preview clip.mp4')
    await waitForMediaBinLoads()

    expect(api.listProxySources).toHaveBeenCalledTimes(2)
    expect(api.getMediaMetadata).toHaveBeenCalledTimes(1)
    expect(nextVisit.container.querySelector('.skel-thumb')).toBeNull()
    expectNoMediaDownloads()
  })

  it('reloads an S3 preview when the same filename has a new version', async () => {
    vi.mocked(api.listProxySources).mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video', etag: 'version-1', s3Key: 'user/clip.mp4' },
    ])
    const { findByLabelText, getByLabelText, container } = render(MediaBin)
    await findByLabelText('Preview clip.mp4')
    await waitForMediaBinLoads()
    vi.mocked(api.listProxySources).mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video', etag: 'version-2', s3Key: 'user/clip.mp4' },
    ])
    const metadata = deferred<Awaited<ReturnType<typeof api.getMediaMetadata>>>()
    vi.mocked(api.getMediaMetadata).mockReturnValue(metadata.promise)

    await fireEvent.click(getByLabelText('Reload scrub list'))
    try {
      await waitFor(() => expect(api.getMediaMetadata).toHaveBeenCalledTimes(2))
      expect(container.querySelector('.skel-thumb')).toBeTruthy()
      metadata.resolve({ duration: 20, width: 720, height: 1280 })
      await waitForMediaBinLoads()
      await findByLabelText('Preview clip.mp4')
      expect(getMediaBinSources()[0]).toMatchObject({ duration: 20, width: 720, height: 1280 })
    } finally {
      metadata.resolve({ duration: 20, width: 720, height: 1280 })
      await waitForMediaBinLoads()
    }
  })

  it('loads persisted audio and image sources from the volume', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'track.mp3', size: 200, mediaKind: 'audio' },
      { name: 'poster.png', size: 300, mediaKind: 'image' },
    ])
    vi.mocked(api.getMediaMetadata).mockImplementation(async (name) => name === 'track.mp3'
      ? { duration: 18, width: 0, height: 0 }
      : { duration: 0, width: 1920, height: 1080 })

    const { container, findByLabelText, getByRole } = render(MediaBin)
    await findByLabelText('Clip track.mp3')
    await findByLabelText('Clip poster.png')
    await waitForMediaBinLoads()

    expect(container.querySelector('.card img')).toHaveAttribute('src', `${api.API_BASE}/thumbnail?file=poster.png`)
    expect(api.getMediaMetadata).toHaveBeenCalledWith('track.mp3')
    expect(api.getMediaMetadata).toHaveBeenCalledWith('poster.png')
    expect(getMediaBinSources()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'track.mp3', kind: 'audio', duration: 18 }),
      expect.objectContaining({ name: 'poster.png', kind: 'image', duration: 10, width: 1920, height: 1080 }),
    ]))
    expect(metadataLib.readAudioMetadata).not.toHaveBeenCalled()
    expect(metadataLib.readImageMetadata).not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: 'Preview track.mp3' }))
    expect(container.querySelector('.media-preview audio')).toHaveAttribute('src', `${api.API_BASE}/download?file=track.mp3`)
    expect(container.querySelector('.media-preview')).toHaveTextContent('Audio')
    await fireEvent.click(getByRole('button', { name: 'Next media' }))
    expect(container.querySelector('.media-preview img')).toHaveAttribute('src', `${api.API_BASE}/download?file=poster.png`)
    expectNoMediaDownloads()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
  })

  it('loads metadata only as cards approach the viewport or AI requests pending sources', async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback
      observed: Set<Element>
    }> = []
    class IntersectionObserverMock {
      callback: IntersectionObserverCallback
      observed = new Set<Element>()
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        observers.push(this)
      }
      observe(element: Element): void { this.observed.add(element) }
      unobserve(element: Element): void { this.observed.delete(element) }
      disconnect(): void { this.observed.clear() }
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'first.mp4', size: 200, mediaKind: 'video', scrubName: 'first_scrub.mp4' },
      { name: 'second.mp4', size: 200, mediaKind: 'video', scrubName: 'second_scrub.mp4' },
    ])
    const loadMetadata = vi.mocked(api.getMediaMetadata)

    const { findByLabelText } = render(MediaBin)
    const firstCard = await findByLabelText('Clip first.mp4')
    await findByLabelText('Clip second.mp4')
    expect(loadMetadata).not.toHaveBeenCalled()

    const observer = observers[0]
    observer.callback([{
      target: firstCard,
      isIntersecting: true,
    } as unknown as IntersectionObserverEntry], observer as unknown as IntersectionObserver)

    await waitFor(() => expect(loadMetadata).toHaveBeenCalledTimes(1))
    expect(loadMetadata).toHaveBeenCalledWith('first.mp4')
    expect(loadMetadata).not.toHaveBeenCalledWith('second.mp4')

    await waitForMediaBinLoads()
    expect(loadMetadata).toHaveBeenCalledWith('second.mp4')
    expectNoMediaDownloads()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
  })

  it('prepares persisted video and audio metadata for AI by their exact Media Bin names', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: '1 Minute - Nature.mp4', size: 200, mediaKind: 'video' },
      { name: 'Assassination Red Magick.mp3', size: 300, mediaKind: 'audio' },
    ])
    vi.mocked(api.getMediaMetadata).mockImplementation(async (name) => name === '1 Minute - Nature.mp4'
      ? { duration: 60, width: 1920, height: 1080 }
      : { duration: 180, width: 0, height: 0 })

    render(MediaBin)

    await waitFor(() => expect(buildAIProjectContext().sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '1 Minute - Nature.mp4', kind: 'video', duration: 60 }),
      expect.objectContaining({ name: 'Assassination Red Magick.mp3', kind: 'audio', duration: 180 }),
    ])))
    expect(api.getMediaMetadata).toHaveBeenCalledWith('1 Minute - Nature.mp4')
    expect(api.getMediaMetadata).toHaveBeenCalledWith('Assassination Red Magick.mp3')
    expectNoMediaDownloads()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
  })

  it('limits in-flight metadata requests to four while loading the entire inventory', async () => {
    const entries = Array.from({ length: 9 }, (_, index) => ({
      name: `clip-${index}.mp4`, size: 200, mediaKind: 'video' as const,
    }))
    const requests = entries.map(() => deferred<Awaited<ReturnType<typeof api.getMediaMetadata>>>())
    const metadata = { duration: 7, width: 1920, height: 1080 }
    let active = 0
    let peak = 0
    vi.mocked(api.listProxySources).mockResolvedValue(entries)
    vi.mocked(api.getMediaMetadata).mockImplementation((name) => {
      active++
      peak = Math.max(peak, active)
      return requests[entries.findIndex((entry) => entry.name === name)].promise.finally(() => { active-- })
    })

    const { findByLabelText } = render(MediaBin)
    try {
      await waitFor(() => expect(api.getMediaMetadata).toHaveBeenCalledTimes(4))
      expect(active).toBe(4)

      for (const request of requests.slice(0, 4)) request.resolve(metadata)
      await waitFor(() => expect(api.getMediaMetadata).toHaveBeenCalledTimes(8))
      expect(active).toBeLessThanOrEqual(4)

      for (const request of requests.slice(4, 8)) request.resolve(metadata)
      await waitFor(() => expect(api.getMediaMetadata).toHaveBeenCalledTimes(9))
      requests[8].resolve(metadata)
      await waitForMediaBinLoads()

      expect(await findByLabelText('Preview clip-8.mp4')).toBeTruthy()
      expect(peak).toBeLessThanOrEqual(4)
      expect(active).toBe(0)
      expect(getMediaBinSources()).toHaveLength(9)
      expectNoMediaDownloads()
      expect(scrubLib.generateScrub).not.toHaveBeenCalled()
    } finally {
      for (const request of requests) request.resolve(metadata)
      await waitForMediaBinLoads()
    }
  })

  it('starts the next preview as soon as any request finishes', async () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      name: `clip-${index}.mp4`, size: 200, mediaKind: 'video' as const,
    }))
    const requests = entries.map(() => deferred<Awaited<ReturnType<typeof api.getMediaMetadata>>>())
    const metadata = { duration: 7, width: 1920, height: 1080 }
    vi.mocked(api.listProxySources).mockResolvedValue(entries)
    vi.mocked(api.getMediaMetadata).mockImplementation((name) =>
      requests[entries.findIndex((entry) => entry.name === name)].promise)
    render(MediaBin)

    try {
      await waitFor(() => expect(api.getMediaMetadata).toHaveBeenCalledTimes(4))
      requests[1].resolve(metadata)
      await waitFor(() => expect(api.getMediaMetadata).toHaveBeenCalledWith('clip-4.mp4'))
    } finally {
      for (const request of requests) request.resolve(metadata)
      await waitForMediaBinLoads()
    }
  })

  it.each([0.5, 60, 60.001, 301])('offers thumbnail and playback for a %s-second server video', async (duration) => {
    vi.mocked(api.listProxySources).mockResolvedValue([{ name: 'clip.mp4', size: 200, mediaKind: 'video' }])
    vi.mocked(api.getMediaMetadata).mockResolvedValue({ duration, width: 1920, height: 1080 })

    const { container, findByLabelText, getByRole } = render(MediaBin)
    await findByLabelText('Preview clip.mp4')

    expect(container.querySelector('.card img')).toHaveAttribute('src', `${api.API_BASE}/thumbnail?file=clip.mp4`)
    expect(container.querySelector('video')).toBeNull()
    await fireEvent.click(getByRole('button', { name: 'Preview clip.mp4' }))
    expect(container.querySelector('.media-preview video')).toHaveAttribute('src', `${api.API_BASE}/download?file=clip.mp4`)
    expectNoMediaDownloads()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
  })

  it('keeps a correctly proportioned skeleton until the first video frame loads and resets it on navigation', async () => {
    vi.mocked(api.listProxySources).mockResolvedValue([
      { name: 'portrait.mp4', size: 200, mediaKind: 'video' },
      { name: 'landscape.mp4', size: 200, mediaKind: 'video' },
    ])
    vi.mocked(api.getMediaMetadata).mockImplementation(async name => name === 'portrait.mp4'
      ? { duration: 7, width: 720, height: 1280 }
      : { duration: 7, width: 1920, height: 1080 })
    const { container, findByLabelText, getByRole, queryByRole } = render(MediaBin)
    await fireEvent.click(await findByLabelText('Preview portrait.mp4'))

    expect(getByRole('status', { name: 'Loading video preview' })).toBeTruthy()
    expect(container.querySelector('.video-frame')).toHaveStyle('--video-aspect: 0.5625')
    await fireEvent.loadedMetadata(container.querySelector('.media-preview video') as HTMLVideoElement)
    expect(getByRole('status', { name: 'Loading video preview' })).toBeTruthy()
    await fireEvent.loadedData(container.querySelector('.media-preview video') as HTMLVideoElement)
    expect(queryByRole('status', { name: 'Loading video preview' })).toBeNull()

    await fireEvent.click(getByRole('button', { name: 'Next media' }))
    expect(getByRole('status', { name: 'Loading video preview' })).toBeTruthy()
    expect(container.querySelector('.video-frame')).toHaveStyle('--video-aspect: 1.7777777777777777')
    await fireEvent.error(container.querySelector('.media-preview video') as HTMLVideoElement)
    expect(queryByRole('status', { name: 'Loading video preview' })).toBeNull()
    expect(getByRole('alert')).toHaveTextContent('Video preview could not load.')
  })

  it('keeps a server video with unknown duration appendable without any preview element', async () => {
    vi.mocked(api.listProxySources).mockResolvedValue([{ name: 'no-preview.mp4', size: 200, mediaKind: 'video' }])
    vi.mocked(api.getMediaMetadata).mockResolvedValue({ duration: 0, width: 1920, height: 1080 })
    const { container, findByText, getByLabelText, queryByLabelText } = render(MediaBin)

    await findByText('No preview')
    expect(container.querySelector('video, img')).toBeNull()
    expect(queryByLabelText('Preview no-preview.mp4')).toBeNull()
    expect(getByLabelText('Clip no-preview.mp4')).toHaveAttribute('draggable', 'true')
    expect(getByLabelText('Append no-preview.mp4 to timeline')).toBeEnabled()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
    expectNoMediaDownloads()

    await fireEvent.click(getByLabelText('Append no-preview.mp4 to timeline'))
    await waitFor(() => expect(editor.channels[0].clips).toHaveLength(1))
    await waitFor(() => expect(mediaProcessing.active).toBe(false))
    expect(scrubLib.generateScrub).toHaveBeenCalledExactlyOnceWith('no-preview.mp4', undefined, 'proxy', 'landscape')
    expect(editor.channels[0].clips[0].scrubBlobUrl).toBe('blob:timeline-video')
  })

  it.each([
    { name: 'broken.mp4', mediaKind: 'video' },
    { name: 'broken.mp3', mediaKind: 'audio' },
    { name: 'broken.png', mediaKind: 'image' },
  ] as const)('does not fall back to a download or proxy generation when metadata fails for $name', async ({ name, mediaKind }) => {
    vi.mocked(api.listProxySources).mockResolvedValue([{ name, size: 200, mediaKind }])
    vi.mocked(api.getMediaMetadata).mockRejectedValue(new Error('Metadata unavailable'))
    const { container, findByText, queryByLabelText } = render(MediaBin)

    await findByText(name)
    await waitForMediaBinLoads()
    await tick()

    expect(api.getMediaMetadata).toHaveBeenCalledExactlyOnceWith(name)
    expect(queryByLabelText(`Preview ${name}`)).toBeNull()
    expect(container.querySelector('video, audio, img')).toBeNull()
    expect(metadataLib.readVideoMetadata).not.toHaveBeenCalled()
    expect(metadataLib.readAudioMetadata).not.toHaveBeenCalled()
    expect(metadataLib.readImageMetadata).not.toHaveBeenCalled()
    expectNoMediaDownloads()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
  })

  it('includes the pointer offset from the card left edge in the drag payload', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video' },
    ])
    const { findByLabelText } = render(MediaBin)
    const card = await findByLabelText('Clip clip.mp4')
    Object.defineProperty(card, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 40 }) as DOMRect,
    })
    const payload: Record<string, string> = {}
    const dataTransfer = {
      setData: (type: string, value: string) => { payload[type] = value },
      effectAllowed: 'none',
      dropEffect: 'none',
    } as DataTransfer

    const event = new MouseEvent('dragstart', {
      clientX: 100,
      bubbles: true,
      cancelable: true,
    })
    ;(event as MouseEvent & { dataTransfer: DataTransfer }).dataTransfer = dataTransfer
    card.dispatchEvent(event)

    expect(JSON.parse(payload['application/x-cineedit-clip'])).toMatchObject({
      fileName: 'clip.mp4',
      sourceMode: 'proxy',
      dragOffsetX: 60,
    })
  })

  it('does not add a clip to the timeline when its card is clicked', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video' },
    ])
    const { findByLabelText } = render(MediaBin)
    const card = await findByLabelText('Clip clip.mp4')
    const clipCount = editor.channels.reduce((total, channel) => total + channel.clips.length, 0)

    await fireEvent.click(card)

    expect(editor.channels.reduce((total, channel) => total + channel.clips.length, 0)).toBe(clipCount)
  })

  it('opens audio preview in a dialog and restores focus when closed', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'track.mp3', size: 200, mediaKind: 'audio' },
    ])
    const { container, findByLabelText } = render(MediaBin)
    const card = await findByLabelText('Clip track.mp3')
    const previewButton = within(card).getByLabelText('Preview track.mp3')

    await fireEvent.click(previewButton)
    expect(container.querySelector('.media-preview audio')).toHaveAttribute('src', `${api.API_BASE}/download?file=track.mp3`)

    await fireEvent.click(within(container.querySelector('.media-preview') as HTMLElement).getByRole('button', { name: 'Close media preview' }))
    expect(container.querySelector('.media-preview')).toBeNull()
    await waitFor(() => expect(previewButton).toHaveFocus())
  })

  it('navigates only the previews in the current filter', async () => {
    registerMediaBinSource({ id: 'first', name: 'first.png', kind: 'image', duration: 10, sourceMode: 'wasm', previewUrl: 'blob:first' })
    registerMediaBinSource({ id: 'voice', name: 'voice.mp3', kind: 'audio', duration: 8, sourceMode: 'wasm', previewUrl: 'blob:voice' })
    registerMediaBinSource({ id: 'last', name: 'last.png', kind: 'image', duration: 10, sourceMode: 'wasm', previewUrl: 'blob:last' })
    const { container, getByRole } = render(MediaBin)

    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^Images/ }))
    await fireEvent.click(getByRole('button', { name: 'Preview first.png' }))

    const dialog = getByRole('dialog', { name: 'Preview first.png' })
    expect(within(dialog).getByRole('button', { name: 'Previous media' })).toBeDisabled()
    expect(dialog).toHaveTextContent('1 / 2')

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(container.querySelector('.media-preview img')).toHaveAttribute('src', 'blob:last')
    expect(getByRole('button', { name: 'Next media' })).toBeDisabled()
    expect(container.querySelector('.media-preview')).toHaveTextContent('2 / 2')
  })

  it('does not open preview when a video card is clicked', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video' },
    ])
    const { container, findByLabelText } = render(MediaBin)
    const card = await findByLabelText('Clip clip.mp4')

    await fireEvent.click(card)

    expect(container.querySelector('.media-preview')).toBeNull()
  })

  it('does not toggle audio preview when the card body or append button is clicked', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'track.mp3', size: 200, mediaKind: 'audio' },
    ])
    const { container, findByLabelText, getByLabelText } = render(MediaBin)
    await findByLabelText('Preview track.mp3')
    const card = await findByLabelText('Clip track.mp3')

    await fireEvent.click(card)
    expect(container.querySelector('.media-preview')).toBeNull()

    await fireEvent.click(getByLabelText('Preview track.mp3'))
    expect(container.querySelector('.media-preview audio')).not.toBeNull()

    await fireEvent.click(getByLabelText('Append track.mp3 to timeline'))
    expect(container.querySelector('.media-preview audio')).not.toBeNull()
    expect(editor.channels[1].clips).toHaveLength(1)
  })

  it('appends consecutive clips to the first compatible channel', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video', scrubName: 'clip_scrub.mp4' },
    ])
    vi.spyOn(scrubLib, 'generateScrub').mockResolvedValue({
      blobUrl: 'blob:timeline-video',
      duration: 7,
    })
    const videoChannel = editor.channels[0]
    const audioChannel = editor.channels[1]
    const { container, findByLabelText } = render(MediaBin)
    await findByLabelText('Preview clip.mp4')
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()

    await fireEvent.click(container.querySelector('[aria-label="Append clip.mp4 to timeline"]') as HTMLElement)
    await waitFor(() => expect(mediaProcessing.active).toBe(false))
    expect(videoChannel.clips.map((clip) => clip.start)).toEqual([0])
    expect(audioChannel.clips.map((clip) => clip.start)).toEqual([0])

    await fireEvent.click(container.querySelector('[aria-label="Append clip.mp4 to timeline"]') as HTMLElement)
    await waitFor(() => expect(videoChannel.clips).toHaveLength(2))
    await waitFor(() => expect(mediaProcessing.active).toBe(false))

    expect(videoChannel.clips.map((clip) => clip.start)).toEqual([0, 7])
    expect(audioChannel.clips.map((clip) => clip.start)).toEqual([0, 7])
    expect(videoChannel.clips[1].linkedClipId).toBe(audioChannel.clips[1].id)
    expect(editor.selectedClipIds).toEqual([videoChannel.clips[1].id])
    expect(scrubLib.generateScrub).toHaveBeenCalledWith('clip.mp4', undefined, 'proxy', 'landscape')
  })

  it('shows error banner when source listing fails', async () => {
    vi.spyOn(api, 'listProxySources').mockRejectedValue(new Error('network down'))

    const { getByLabelText, findByText } = render(MediaBin)
    await fireEvent.click(getByLabelText('Reload scrub list'))

    expect(await findByText(/network down/)).toBeTruthy()
  })

  it('keeps the Proxy volume inventory visible when new imports use WASM', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'original.mp4', size: 500, mediaKind: 'video' },
    ])
    const { getByLabelText, findByText, queryByText } = render(MediaBin)
    expect(await findByText('original.mp4')).toBeTruthy()
    await fireEvent.click(getByLabelText('Use local scrub'))

    expect(queryByText('original.mp4')).toBeTruthy()
    expect(queryByText('Add your first files')).toBeNull()
    expect(getByLabelText('Use local scrub')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps generated server images visible in the active WASM bin', async () => {
    scrubSettings.setMode('wasm')
    registerMediaBinSource({
      id: 'generated.png', name: 'generated.png', kind: 'image', duration: 10,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:generated', generated: true,
    })
    const { findByText } = render(MediaBin)

    expect(await findByText('generated.png')).toBeTruthy()
  })

  it('keeps WASM imports visible across modes and resolves their local source only on timeline drop', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    vi.spyOn(api, 'uploadFile').mockResolvedValue('uploaded')
    vi.spyOn(scrubLib, 'generateScrub').mockResolvedValue({
      blobUrl: 'blob:wasm',
      duration: 7,
    })
    const getLocalSource = vi.spyOn(localMedia, 'getLocalSource')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-source')

    const { container, getByLabelText, findByLabelText, findByText, queryByText } = render(MediaBin)
    await fireEvent.click(getByLabelText('Use local scrub'))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['video'], 'local.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [file] } })

    expect(await findByText('local.mp4')).toBeTruthy()
    await findByLabelText('Preview local.mp4')
    expect(container.querySelector('.item-tags')).toBeNull()
    expect(container.querySelector('.card video')).toHaveAttribute('src', 'blob:local-source')
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
    expect(getLocalSource).not.toHaveBeenCalled()
    expect(api.uploadFile).not.toHaveBeenCalled()
    expect(api.getMediaMetadata).not.toHaveBeenCalled()

    const card = await findByText('local.mp4').then((name) => name.closest('[draggable="true"]') as HTMLElement)
    const payload: Record<string, string> = {}
    const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dragEvent, 'dataTransfer', {
      value: { setData: (type: string, value: string) => { payload[type] = value } },
    })
    card.dispatchEvent(dragEvent)
    const clipData: DropClipData = JSON.parse(payload['application/x-cineedit-clip'])
    expect(clipData).toMatchObject({
      fileName: 'local.mp4',
      sourceMode: 'wasm',
      sourceId: expect.any(String),
    })
    expect(clipData.scrubBlobUrl).toBeUndefined()

    await fireEvent.click(getByLabelText('Use server scrub'))
    await waitFor(() => expect(queryByText('local.mp4')).toBeTruthy())
    await fireEvent.click(getByLabelText('Use local scrub'))
    expect(await findByText('local.mp4')).toBeTruthy()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
    expectNoMediaDownloads()

    const added = await addDroppedClip(editor.channels[0], clipData, 0)

    expect(getLocalSource).toHaveBeenCalledWith(clipData.sourceId)
    expect(getLocalSource).toHaveReturnedWith(file)
    expect(scrubLib.generateScrub).toHaveBeenCalledExactlyOnceWith('local.mp4', file, 'wasm', 'landscape')
    expect(added?.primary).toMatchObject({
      fileName: 'local.mp4', sourceMode: 'wasm', sourceId: clipData.sourceId, scrubBlobUrl: 'blob:wasm',
    })
  })

  it('filters and searches imported and AI-generated media in one library', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    registerMediaBinSource({
      id: 'voice.mp3', name: 'Romanian voice.mp3', kind: 'audio', duration: 8,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:voice', generated: true,
    })
    registerMediaBinSource({
      id: 'poster.png', name: 'Poster.png', kind: 'image', duration: 10,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:poster',
    })
    const { getByLabelText, getByRole, queryByText } = render(MediaBin)

    expect(queryByText('Romanian voice.mp3')).toBeTruthy()
    expect(queryByText('Poster.png')).toBeTruthy()
    expect(queryByText('AI voice')).toBeNull()
    expect(queryByText('AI generated')).not.toBeVisible()
    expect(isGeneratedMediaSource('Romanian voice.mp3')).toBe(true)

    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^AI/ }))
    expect(queryByText('Romanian voice.mp3')).toBeTruthy()
    expect(queryByText('Poster.png')).toBeNull()
    expect(getByRole('button', { name: 'Filter media' })).toHaveTextContent('AI generated')

    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^All/ }))
    await fireEvent.click(getByRole('button', { name: 'Open media search' }))
    await fireEvent.input(getByLabelText('Search media'), { target: { value: 'poster' } })
    expect(queryByText('Romanian voice.mp3')).toBeNull()
    expect(queryByText('Poster.png')).toBeTruthy()
  })

  it('keeps final exports in a dedicated Renders tab instead of Video', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 100, mediaKind: 'video', isRender: false },
      { name: 'render_a1b2c3d4e5f6.mp4', size: 200, mediaKind: 'video', isRender: true },
    ])
    const { getByRole, queryByText, findByText } = render(MediaBin)
    await findByText('clip.mp4')
    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^Renders/ }))
    await findByText('render_a1b2c3d4e5f6.mp4')

    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^Video/ }))
    expect(queryByText('clip.mp4')).toBeTruthy()
    expect(queryByText('render_a1b2c3d4e5f6.mp4')).toBeNull()

    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^Renders/ }))
    expect(queryByText('render_a1b2c3d4e5f6.mp4')).toBeTruthy()
    expect(queryByText('clip.mp4')).toBeNull()

    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^All/ }))
    expect(queryByText('clip.mp4')).toBeTruthy()
    expect(queryByText('render_a1b2c3d4e5f6.mp4')).toBeNull()
  })

  it('explains an empty Renders tab instead of the generic filter message', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'clip.mp4', size: 100, mediaKind: 'video', isRender: false },
    ])
    const { getByRole, findByText, queryByText } = render(MediaBin)
    await findByText('clip.mp4')
    await fireEvent.click(getByRole('button', { name: 'Filter media' }))
    await fireEvent.click(getByRole('button', { name: /^Renders/ }))
    expect(await findByText(/No renders yet/)).toBeTruthy()
    expect(queryByText(/No matching media/)).toBeNull()
  })

  it('opens a player for generated voices', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    registerMediaBinSource({
      id: 'voice.mp3', name: 'Voice.mp3', kind: 'audio', duration: 8,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:voice', generated: true,
    })
    const { container, getByLabelText, getByRole } = render(MediaBin)

    await fireEvent.click(getByLabelText('Preview Voice.mp3'))

    expect(container.querySelector('.media-preview audio[controls]')).toHaveAttribute('src', 'blob:voice')
    expect(getByLabelText('Close media preview')).toBeTruthy()

    await fireEvent.click(getByRole('button', { name: 'Open media search' }))
    await fireEvent.input(getByLabelText('Search media'), { target: { value: 'missing' } })
    expect(container.querySelector('.media-preview')).toBeNull()
  })

  it('persists Proxy uploads in the server volume', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    const upload = vi.spyOn(api, 'uploadFile').mockResolvedValue('uploaded')

    const { container, findByLabelText, queryByLabelText } = render(MediaBin)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['video'], 'proxy.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, expect.any(Function)))
    expect(upload).toHaveBeenCalledOnce()
    const card = await findByLabelText('Clip proxy.mp4')
    expect(card.querySelector('img')).toHaveAttribute('src', `${api.API_BASE}/thumbnail?file=proxy.mp4`)
    expect(card.querySelector('video')).toBeNull()
    expect(queryByLabelText('Media import progress')).toBeNull()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
    expectNoMediaDownloads()
  })

  it('shows reading, upload progress and server saving without taking the global processing lock', async () => {
    const metadata = deferred<Awaited<ReturnType<typeof metadataLib.readVideoMetadata>>>()
    const upload = deferred<string>()
    vi.mocked(metadataLib.readVideoMetadata).mockReturnValue(metadata.promise)
    const uploadFile = vi.spyOn(api, 'uploadFile').mockReturnValue(upload.promise)
    const beginProcessing = vi.spyOn(mediaProcessing, 'begin')
    registerMediaBinSource({
      id: 'existing.png', name: 'existing.png', kind: 'image', duration: 10,
      sourceMode: 'proxy', scrubBlobUrl: 'blob:existing',
    })
    const { container, getByLabelText, findByText, queryByLabelText } = render(MediaBin)
    await waitForMediaBinLoads()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(4 * 1024 * 1024)], 'upload.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [file] } })

    try {
      expect(await findByText('Reading file')).toBeTruthy()
      expect(within(getByLabelText('Media import progress')).getByText('upload.mp4')).toBeTruthy()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(mediaProcessing.active).toBe(false)
      expect(input).toBeDisabled()
      for (const label of ['Upload media', 'Reload scrub list', 'Use server scrub', 'Use local scrub']) {
        expect(getByLabelText(label)).toBeDisabled()
      }
      expect(getByLabelText('Append existing.png to timeline')).toBeEnabled()
      expect(getByLabelText('Clip existing.png')).toHaveAttribute('draggable', 'true')

      metadata.resolve({ duration: 7, width: 1920, height: 1080 })
      expect(await findByText('Uploading')).toBeTruthy()
      expect(uploadFile).toHaveBeenCalledExactlyOnceWith(file, expect.any(Function))
      const onProgress = uploadFile.mock.calls[0][1]!
      onProgress({ loaded: file.size / 2, total: file.size })
      await tick()

      expect(getByLabelText('Upload progress for upload.mp4')).toHaveAttribute('value', '50')
      expect(within(getByLabelText('Media import progress')).getByText('50%')).toBeTruthy()
      expect(within(getByLabelText('Media import progress')).getByText(/MB\/s$/)).toBeTruthy()
      expect(mediaProcessing.active).toBe(false)
      await fireEvent.change(input, { target: { files: [file] } })
      await fireEvent.click(getByLabelText('Reload scrub list'))
      await fireEvent.click(getByLabelText('Use local scrub'))
      expect(uploadFile).toHaveBeenCalledOnce()
      expect(api.listProxySources).toHaveBeenCalledOnce()
      expect(scrubSettings.mode).toBe('proxy')

      onProgress({ loaded: file.size, total: file.size })
      expect(await findByText('Saving on server')).toBeTruthy()
      expect(getByLabelText('Upload media')).toBeDisabled()
      expect(within(getByLabelText('Media import progress')).queryByText('50%')).toBeNull()
      expect(beginProcessing).not.toHaveBeenCalled()
      expect(scrubLib.generateScrub).not.toHaveBeenCalled()

      upload.resolve('uploaded')
      await waitFor(() => expect(queryByLabelText('Media import progress')).toBeNull())
      expect(getByLabelText('Clip upload.mp4')).toHaveAttribute('draggable', 'true')
      expect(input).toBeEnabled()
      for (const label of ['Upload media', 'Reload scrub list', 'Use server scrub', 'Use local scrub']) {
        expect(getByLabelText(label)).toBeEnabled()
      }
      expect(mediaProcessing.active).toBe(false)
      expectNoMediaDownloads()
    } finally {
      metadata.resolve({ duration: 7, width: 1920, height: 1080 })
      upload.resolve('uploaded')
      await waitForMediaBinLoads()
    }
  })

  it.each(['metadata', 'upload'] as const)('clears import progress and unlocks controls after a %s failure', async (phase) => {
    const pending = deferred<never>()
    if (phase === 'metadata') vi.mocked(metadataLib.readVideoMetadata).mockReturnValue(pending.promise)
    const uploadFile = vi.spyOn(api, 'uploadFile').mockReturnValue(phase === 'upload' ? pending.promise : Promise.resolve('uploaded'))
    const { container, findByText, findByRole, getByLabelText, queryByLabelText } = render(MediaBin)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['video'], 'failed.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [file] } })

    try {
      await findByText(phase === 'metadata' ? 'Reading file' : 'Uploading')
      expect(getByLabelText('Upload media')).toBeDisabled()
      expect(mediaProcessing.active).toBe(false)
      pending.reject(new Error('Import failed'))

      expect(await findByRole('alert')).toHaveTextContent('Import failed')
      expect(getByLabelText('Clip failed.mp4, error')).toHaveTextContent('Import failed')
      await waitFor(() => expect(queryByLabelText('Media import progress')).toBeNull())
      expect(input).toBeEnabled()
      for (const label of ['Upload media', 'Reload scrub list', 'Use server scrub', 'Use local scrub']) {
        expect(getByLabelText(label)).toBeEnabled()
      }
      expect(getByLabelText('Append failed.mp4 to timeline')).toBeDisabled()
      expect(mediaProcessing.active).toBe(false)
      expect(scrubLib.generateScrub).not.toHaveBeenCalled()
      if (phase === 'metadata') expect(uploadFile).not.toHaveBeenCalled()
      expectNoMediaDownloads()
    } finally {
      pending.reject(new Error('Import failed'))
      await waitForMediaBinLoads()
    }
  })

  it.each([
    { mode: 'proxy', duration: 301 },
    { mode: 'proxy', duration: 0 },
    { mode: 'wasm', duration: 301 },
    { mode: 'wasm', duration: 0 },
  ] as const)('finishes $mode video imports with duration $duration', async ({ mode, duration }) => {
    scrubSettings.setMode(mode)
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    vi.spyOn(api, 'uploadFile').mockResolvedValue('uploaded')
    vi.spyOn(metadataLib, 'readVideoMetadata').mockResolvedValue({
      duration,
      width: 1920,
      height: 1080,
    })
    const { container, findByLabelText, queryByLabelText, getByLabelText } = render(MediaBin)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['video'], 'long-video.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [file] } })

    const card = await findByLabelText('Clip long-video.mp4')
    await waitFor(() => expect(queryByLabelText('Media import progress')).toBeNull())
    expect(mediaProcessing.active).toBe(false)
    if (duration === 0) expect(card).toHaveTextContent('No preview')
    else expect(getByLabelText('Preview long-video.mp4')).toBeTruthy()
    expect(card).toHaveAttribute('draggable', 'true')
    if (duration === 0) {
      expect(container.querySelector('video, img')).toBeNull()
      expect(queryByLabelText('Preview long-video.mp4')).toBeNull()
    } else if (mode === 'proxy') {
      expect(container.querySelector('.card img')).toHaveAttribute('src', `${api.API_BASE}/thumbnail?file=long-video.mp4`)
    } else {
      expect(container.querySelector('.card video')).toHaveAttribute('src', expect.stringContaining('blob:'))
    }
    expect(getByLabelText('Append long-video.mp4 to timeline')).toBeEnabled()
    expect(getByLabelText('Upload media')).toBeEnabled()
    expect(scrubLib.generateScrub).not.toHaveBeenCalled()
    expectNoMediaDownloads()
  })

  it('locks the project to the first uploaded video orientation', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    vi.spyOn(api, 'uploadFile').mockResolvedValue('uploaded')
    vi.mocked(metadataLib.readVideoMetadata)
      .mockResolvedValueOnce({ duration: 5, width: 720, height: 1280 })
      .mockResolvedValueOnce({ duration: 5, width: 1920, height: 1080 })

    const { container } = render(MediaBin)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const portrait = new File(['portrait'], 'portrait.mp4', { type: 'video/mp4' })
    const landscape = new File(['landscape'], 'landscape.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [portrait, landscape] } })

    expect(editor.projectAspect).toBe('portrait')
    expect(editor.projectResolution).toEqual({ w: 1080, h: 1920 })
  })

  it('locks the project to a 4:3 uploaded video orientation', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    vi.spyOn(api, 'uploadFile').mockResolvedValue('uploaded')
    vi.mocked(metadataLib.readVideoMetadata)
      .mockResolvedValueOnce({ duration: 5, width: 1440, height: 1080 })

    const { container } = render(MediaBin)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const classic = new File(['classic'], 'classic.mp4', { type: 'video/mp4' })
    await fireEvent.change(input, { target: { files: [classic] } })

    expect(editor.projectAspect).toBe('classic')
    expect(editor.projectResolution).toEqual({ w: 1440, h: 1080 })
  })

  it('toggles selection mode without a per-card delete button', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'old.mp4', size: 200, mediaKind: 'video' },
    ])
    const { getByLabelText, getByRole, queryByLabelText, queryByRole } = render(MediaBin)
    await waitForMediaBinLoads()
    const card = await getByLabelText('Clip old.mp4')

    expect(queryByLabelText('Select old.mp4 for deletion')).toBeNull()
    expect(getByRole('button', { name: 'Append old.mp4 to timeline' })).toBeEnabled()

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))

    expect(getByLabelText('Select old.mp4 for deletion')).toBeTruthy()
    expect(queryByRole('button', { name: 'Append old.mp4 to timeline' })).toBeNull()
    expect(card).toHaveAttribute('draggable', 'false')
    expect(getByRole('button', { name: 'Filter media' })).toHaveTextContent('All files')
    expect(queryByRole('button', { name: 'Done' })).toBeNull()
    expect(queryByRole('button', { name: 'Select all' })).toBeNull()
    expect(getByRole('button', { name: 'Close media selection' })).toBeVisible()
    expect(getByRole('button', { name: 'Delete' })).toBeDisabled()

    await fireEvent.click(getByLabelText('Select old.mp4 for deletion'))
    expect(getByRole('button', { name: 'Delete (1)' })).toBeEnabled()

    await fireEvent.click(getByRole('button', { name: 'Close media selection' }))
    expect(queryByLabelText('Select old.mp4 for deletion')).toBeNull()
    expect(getByRole('button', { name: 'Append old.mp4 to timeline' })).toBeEnabled()
    expect(getByRole('button', { name: 'Filter media' })).toHaveTextContent('All files')
  })

  it('selects through the whole-card control without opening preview', async () => {
    vi.mocked(api.listProxySources).mockResolvedValue([
      { name: 'clip.mp4', size: 200, mediaKind: 'video' },
    ])
    const { container, findByLabelText, getByRole } = render(MediaBin)
    const preview = await findByLabelText('Preview clip.mp4')

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))
    expect(preview).toBeDisabled()
    await fireEvent.click(preview)
    expect(container.querySelector('.media-preview')).toBeNull()

    await fireEvent.click(getByRole('button', { name: 'Select clip.mp4 for deletion' }))
    expect(getByRole('button', { name: 'Deselect clip.mp4' })).toHaveAttribute('aria-pressed', 'true')
    expect(getByRole('button', { name: 'Delete (1)' })).toBeEnabled()
    expect(container.querySelector('.media-preview')).toBeNull()

    await fireEvent.click(getByRole('button', { name: 'Deselect clip.mp4' }))
    expect(getByRole('button', { name: 'Delete' })).toBeDisabled()
    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(preview).toBeEnabled()
    await fireEvent.click(preview)
    expect(container.querySelector('.media-preview')).not.toBeNull()
  })

  it('permanently deletes a server file after confirmation', async () => {
    vi.mocked(api.listProxySources)
      .mockResolvedValueOnce([{ name: 'old.mp4', size: 200, mediaKind: 'video' }])
      .mockResolvedValue([])
    const remove = vi.spyOn(api, 'deleteMediaFile').mockResolvedValue({ deleted: 'old.mp4', scrubDeleted: [] })
    const { getByLabelText, getByRole, findByText, queryByText } = render(MediaBin)
    await findByText('old.mp4')

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))
    await fireEvent.click(getByLabelText('Select old.mp4 for deletion'))
    await fireEvent.click(getByRole('button', { name: 'Delete (1)' }))

    const dialog = getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete 1 file?')
    expect(dialog).toHaveTextContent('Permanently delete 1 file from server storage?')
    expect(within(dialog).getByText('old.mp4')).toBeTruthy()

    await fireEvent.click(getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('old.mp4'))
    await waitFor(() => expect(queryByText('old.mp4')).toBeNull())
    expect(await findByText('Add your first files')).toBeTruthy()
    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    expect(getByRole('button', { name: 'Select media to delete' })).toHaveAttribute('aria-pressed', 'false')
    expect(getMediaBinSources()).toHaveLength(0)
  })

  it('blocks deletion of files used on the timeline and names them', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'used.mp4', size: 200, mediaKind: 'video' },
      { name: 'free.mp4', size: 200, mediaKind: 'video' },
    ])
    const remove = vi.spyOn(api, 'deleteMediaFile').mockResolvedValue({ deleted: 'free.mp4', scrubDeleted: [] })
    editor.channels[0].clips.push({
      id: 'c1', fileName: 'used.mp4', sourceMode: 'proxy', scrubBlobUrl: null,
      sourceDuration: 7, inPoint: 0, outPoint: 7, start: 0,
    })
    const { getByLabelText, getByRole, findByText, queryByRole } = render(MediaBin)
    await findByText('used.mp4')
    await findByText('free.mp4')

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))
    await fireEvent.click(getByLabelText('Select used.mp4 for deletion'))
    await fireEvent.click(getByLabelText('Select free.mp4 for deletion'))
    await fireEvent.click(getByRole('button', { name: 'Delete (2)' }))

    expect(await findByText(/used\.mp4 is used on the timeline/)).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    expect(getByRole('alertdialog')).toHaveTextContent('Delete 1 file?')

    await fireEvent.click(getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('free.mp4'))
    expect(editor.channels[0].clips).toHaveLength(1)
  })

  it('removes browser-local media without calling the server', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([])
    registerMediaBinSource({
      id: 'local1', name: 'local.mp4', kind: 'video', duration: 7,
      sourceMode: 'wasm', sourceId: 'local1', previewUrl: 'blob:local',
    })
    const remove = vi.spyOn(api, 'deleteMediaFile')
    const { getByLabelText, getByRole, findByText, queryByText } = render(MediaBin)
    await findByText('local.mp4')

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))
    await fireEvent.click(getByLabelText('Select local.mp4 for deletion'))
    await fireEvent.click(getByRole('button', { name: 'Delete (1)' }))

    const dialog = getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Remove 1 file from this session?')
    await fireEvent.click(getByRole('button', { name: 'Remove from session' }))

    await waitFor(() => expect(queryByText('local.mp4')).toBeNull())
    expect(remove).not.toHaveBeenCalled()
    expect(getMediaBinSources()).toHaveLength(0)
  })

  it('keeps failed deletions selected and reports them', async () => {
    vi.mocked(api.listProxySources)
      .mockResolvedValueOnce([
        { name: 'gone.mp4', size: 200, mediaKind: 'video' },
        { name: 'stuck.mp4', size: 200, mediaKind: 'video' },
      ])
      .mockResolvedValue([])
    vi.spyOn(api, 'deleteMediaFiles').mockImplementation(async (names) => {
      if (names.includes('stuck.mp4')) {
        return { deleted: ['gone.mp4'], scrubDeleted: [], failed: [{ file: 'stuck.mp4', error: 'locked by another process' }] }
      }
      return { deleted: names, scrubDeleted: [], failed: [] }
    })
    const { getByLabelText, getByRole, findByText, queryByText } = render(MediaBin)
    await findByText('gone.mp4')
    await findByText('stuck.mp4')

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))
    await fireEvent.click(getByLabelText('Select gone.mp4 for deletion'))
    await fireEvent.click(getByLabelText('Select stuck.mp4 for deletion'))
    await fireEvent.click(getByRole('button', { name: 'Delete (2)' }))
    await fireEvent.click(getByRole('button', { name: 'Delete permanently' }))

    expect(await findByText(/Could not delete stuck\.mp4/)).toBeTruthy()
    await waitFor(() => expect(queryByText('gone.mp4')).toBeNull())
    expect(queryByText('stuck.mp4')).toBeTruthy()
    expect(getByRole('button', { name: 'Delete (1)' })).toBeVisible()
  })

  it('exits selection mode on Escape', async () => {
    vi.spyOn(api, 'listProxySources').mockResolvedValue([
      { name: 'old.mp4', size: 200, mediaKind: 'video' },
    ])
    const { getByRole, findByText, queryByLabelText } = render(MediaBin)
    await findByText('old.mp4')

    await fireEvent.click(getByRole('button', { name: 'Media bin options' }))
    await fireEvent.click(getByRole('button', { name: 'Select media to delete' }))
    expect(queryByLabelText('Select old.mp4 for deletion')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(queryByLabelText('Select old.mp4 for deletion')).toBeNull()
  })

  it('lists Server before Local when logged in', () => {
    mockAuthState.isLogged = true
    const { getByLabelText } = render(MediaBin)
    const local = getByLabelText('Use local scrub')
    const server = getByLabelText('Use server scrub')
    expect(server.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lists Local before Server when logged out', () => {
    mockAuthState.isLogged = false
    const { getByLabelText } = render(MediaBin)
    const local = getByLabelText('Use local scrub')
    const server = getByLabelText('Use server scrub')
    expect(local.compareDocumentPosition(server) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the upload action with visible text', () => {
    const { getByLabelText } = render(MediaBin)
    const upload = getByLabelText('Upload media')
    expect(upload).toHaveTextContent('Import')
  })

  it('gates the Server tab behind login when logged out', async () => {
    mockAuthState.isLogged = false
    scrubSettings.setMode('proxy')
    const { getByLabelText, getByText, queryByText } = render(MediaBin)

    expect(await getByText('Server media needs an account')).toBeTruthy()
    expect(getByLabelText('Upload media')).toBeDisabled()
    expect(getByLabelText('Reload scrub list')).toBeDisabled()
    expect(queryByText('Add your first files')).toBeNull()
  })

  it('keeps the Local library open while logged out', async () => {
    mockAuthState.isLogged = false
    scrubSettings.setMode('wasm')
    const { findByText, queryByText } = render(MediaBin)

    expect(await findByText('Add your first files')).toBeTruthy()
    expect(queryByText('Server media needs an account')).toBeNull()
  })
})
