import { onMount, onDestroy } from 'svelte'
import type { Action } from 'svelte/action'
import {
  getMediaMetadata,
  listProxySources,
  deleteMediaFile,
  deleteMediaFiles,
  mediaKindForFileName,
  mediaSourceUrl,
  mediaThumbnailUrl,
  scrubProxyName,
  uploadFile,
} from '../lib/api'
import { forgetLocalSource, rememberLocalSource } from '../lib/local-media'
import { scrubSettings, scrubModeAfterAuthChange, type ScrubMode } from '../stores/scrub.svelte'
import { auth } from '../stores/auth.svelte'
import { clipEnd, editor, type MediaKind, type ProjectAspect } from '../stores/editor.svelte'
import { readAudioMetadata, readImageMetadata, readVideoMetadata } from '../lib/video-metadata'
import {
  deferMediaBinLoad,
  getMediaBinSource,
  getMediaBinSources,
  isGeneratedMediaSource,
  registerMediaBinSource,
  renameMediaBinSource,
  subscribeMediaBinRemovals,
  subscribeMediaBinSources,
  trackMediaBinLoad,
  unregisterMediaBinSource,
  type MediaBinSource,
} from '../lib/media-bin'
import { mediaProcessing } from '../stores/media-processing.svelte'
import { addDroppedClip, type DropClipData } from '../lib/drop'
import type { MediaItem, MediaImportProgress } from '../lib/media-item'
import { isLiveSceneFile, loadLiveScene } from '../lib/live-scene'

const IMAGE_DURATION = 10
const PREVIEW_CONCURRENCY = 4
const FILTER_IDS: readonly MediaFilter[] = ['all', 'video', 'audio', 'image', 'ai', 'renders']

export type MediaFilter = 'all' | MediaKind | 'ai' | 'renders'

type PreviewJob = {
  item: MediaItem
  generation: number
  resolve: () => void
}

type DeleteState =
  | { kind: 'idle' }
  | { kind: 'confirming'; items: MediaItem[] }
  | { kind: 'deleting'; items: MediaItem[] }

export function useMediaBin() {
  let proxyItems = $state<MediaItem[]>([])
  let wasmItems = $state<MediaItem[]>([])
  let items = $derived([...proxyItems, ...wasmItems])
  let filter = $state<MediaFilter>('all')
  let search = $state('')
  let previewId = $state('')
  let importProgress = $state<MediaImportProgress | null>(null)
  let selecting = $state(false)
  let selectedKeys = $state<Set<string>>(new Set())
  let deleteState = $state<DeleteState>({ kind: 'idle' })
  const pendingDelete = $derived(deleteState.kind === 'idle' ? [] : deleteState.items)
  const confirming = $derived(deleteState.kind !== 'idle')
  const deleting = $derived(deleteState.kind === 'deleting')

  // Renders live strictly in their own tab: final exports never appear in
  // All/Video/Audio/Image/AI and have no link to source clips.
  // - All: sources only, renders excluded
  // - Video/Audio/Image: sources only, renders excluded
  // - AI: generated sources only, renders excluded
  // - Renders: final exports only
  let filteredItems = $derived(items.filter((item) => {
    const matchesFilter = filter === 'all' && !item.isRender
      || filter === 'renders' && item.isRender
      || filter === 'ai' && !item.isRender && item.generated
      || (filter === 'video' || filter === 'audio' || filter === 'image') && !item.isRender && filter === item.mediaKind

    const term = search.trim().toLocaleLowerCase()
    return matchesFilter && (!term || item.displayName.toLocaleLowerCase().includes(term)
      || item.fileName.toLocaleLowerCase().includes(term))
  }))

  let previewItem = $derived(items.find((item) => itemKey(item) === previewId) ?? null)

  const availablePreviews = $derived(filteredItems.filter(
    (item) => item.state === 'ready' && (!!item.blobUrl || !!item.scene) && item.previewState !== 'skipped',
  ))

  let filterCounts = $derived<Record<MediaFilter, number>>({
    all: items.filter((item) => !item.isRender).length,
    video: items.filter((item) => !item.isRender && item.mediaKind === 'video').length,
    audio: items.filter((item) => !item.isRender && item.mediaKind === 'audio').length,
    image: items.filter((item) => !item.isRender && item.mediaKind === 'image').length,
    ai: items.filter((item) => !item.isRender && item.generated).length,
    renders: items.filter((item) => item.isRender).length,
  })

  let error = $state('')
  // True while the server inventory (S3) is being listed. The list starts
  // empty, so without this the panel flashes "No media clips yet" instead of
  // showing skeleton cards on first load.
  let refreshing = $state(true)
  let selectionBusy = $derived(mediaProcessing.active || !!importProgress || deleting)

  function itemKey(item: MediaItem): string {
    return `${item.mode}:${item.sourceId ?? item.fileName}`
  }

  function isSelectable(item: MediaItem): boolean {
    return item.state === 'ready'
  }

  let selectedItems = $derived(items.filter((item) => selectedKeys.has(itemKey(item))))
  let selectableFilteredItems = $derived(filteredItems.filter(isSelectable))
  let selectedCount = $derived(selectedItems.length)

  let allFilteredSelected = $derived(
    selectableFilteredItems.length > 0
      && selectableFilteredItems.every((item) => selectedKeys.has(itemKey(item))),
  )

  let pendingProxyCount = $derived(pendingDelete.filter((item) => item.mode === 'proxy').length)
  let pendingLocalCount = $derived(pendingDelete.filter((item) => item.mode === 'wasm').length)
  let fileInput: HTMLInputElement | undefined
  let globalDrag = $state(false)
  let dragDepth = 0
  let generation = 0
  let unsubscribeSources: (() => void) | null = null
  let unsubscribeRemovals: (() => void) | null = null
  let listEl: HTMLDivElement | undefined
  let previewObserver: IntersectionObserver | null = null
  const observedItems = new Map<Element, MediaItem>()
  const previewStarters = new Map<MediaItem, () => Promise<void>>()
  const deferredPreviewCleanups = new Map<MediaItem, () => void>()
  const previewJobs: PreviewJob[] = []
  let activePreviewLoads = 0

  $effect(() => {
    if (previewItem && !filteredItems.includes(previewItem)) previewId = ''
  })

  function projectAspectForSource(source: MediaBinSource): ProjectAspect | undefined {
    if (!source.width || !source.height) return undefined
    const ratio = source.width / source.height
    return ratio < 1 ? 'portrait' : ratio < 1.5 ? 'classic' : 'landscape'
  }

  function syncRegisteredSource(source: MediaBinSource): void {
    const mode = source.sourceMode ?? 'proxy'
    const target = mode === 'proxy' ? proxyItems : wasmItems
    const index = target.findIndex((item) => item.fileName.toLowerCase() === source.name.toLowerCase())
    const existing = index >= 0 ? target[index] : undefined

    const registeredItem: MediaItem = {
      fileName: source.name,
      displayName: source.displayName || source.name,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      mediaKind: source.kind,
      scrubName: existing?.scrubName ?? '',
      blobUrl: source.previewUrl ?? source.scrubBlobUrl ?? null,
      thumbnailUrl: source.thumbnailUrl ?? existing?.thumbnailUrl,
      duration: source.duration,
      sourceWidth: source.width,
      sourceHeight: source.height,
      projectAspect: projectAspectForSource(source),
      mode,
      generated: source.generated ?? existing?.generated ?? isGeneratedMediaSource(source.name),
      scene: source.scene,
      isRender: source.isRender ?? existing?.isRender ?? false,
      state: 'ready',
      previewState: source.scene ? 'loaded' : source.kind === 'video' && source.duration <= 0
        ? 'skipped'
        : source.previewUrl || source.scrubBlobUrl ? 'loaded' : existing?.previewState ?? 'idle',
    }
    if (existing) {
      Object.assign(existing, registeredItem)
      return
    }
    const next = [...target, registeredItem]
    if (mode === 'proxy') proxyItems = next
    else wasmItems = next
  }

  function removeUnregisteredItem(name: string): void {
    const lowered = name.toLowerCase()
    proxyItems = proxyItems.filter((item) => item.fileName.toLowerCase() !== lowered)
    wasmItems = wasmItems.filter((item) => item.fileName.toLowerCase() !== lowered)
    selectedKeys = new Set([...selectedKeys].filter((key) => {
      const item = items.find((candidate) => itemKey(candidate) === key)
      return item !== undefined
    }))
    if (deleteState.kind === 'confirming') {
      const remaining = deleteState.items.filter((item) => item.fileName.toLowerCase() !== lowered)
      deleteState = remaining.length > 0 ? { kind: 'confirming', items: remaining } : { kind: 'idle' }
    }
  }

  onMount(() => {
    if (typeof IntersectionObserver !== 'undefined') {
      previewObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const item = observedItems.get(entry.target)
          if (item) startPreview(item)
          previewObserver?.unobserve(entry.target)
          observedItems.delete(entry.target)
        }
      }, {
        root: listEl,
        rootMargin: '320px 0px',
      })
    }
    unsubscribeSources = subscribeMediaBinSources(syncRegisteredSource)
    unsubscribeRemovals = subscribeMediaBinRemovals(removeUnregisteredItem)
    for (const source of getMediaBinSources()) syncRegisteredSource(source)
    window.addEventListener('dragenter', handleWindowDragEnter)
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('drop', handleWindowDrop)
    window.addEventListener('dragleave', handleWindowDragLeave)
    refresh()
  })

  onDestroy(() => {
    unsubscribeSources?.()
    unsubscribeRemovals?.()
    previewObserver?.disconnect()
    generation++
    clearDeferredPreviews()
    window.removeEventListener('dragenter', handleWindowDragEnter)
    window.removeEventListener('dragover', handleWindowDragOver)
    window.removeEventListener('drop', handleWindowDrop)
    window.removeEventListener('dragleave', handleWindowDragLeave)
  })

  function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }

  function hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
  }

  function mediaKindForFile(file: File): MediaKind | null {
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    if (file.type.startsWith('image/')) return 'image'
    return mediaKindForFileName(file.name)
  }

  function serverNeedsLogin(): boolean {
    return scrubSettings.mode === 'proxy' && !auth.isLogged
  }

  function handleWindowDragEnter(event: DragEvent): void {
    if (!hasFiles(event) || mediaProcessing.active || importProgress || serverNeedsLogin()) return
    dragDepth++
    globalDrag = true
  }

  function handleWindowDragOver(event: DragEvent): void {
    if (!hasFiles(event) || mediaProcessing.active || importProgress || serverNeedsLogin()) return
    event.preventDefault()
    globalDrag = true
  }

  function handleWindowDragLeave(event: DragEvent): void {
    if (!hasFiles(event) || mediaProcessing.active || importProgress || serverNeedsLogin()) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) globalDrag = false
  }

  async function handleWindowDrop(event: DragEvent): Promise<void> {
    if (!hasFiles(event)) return
    event.preventDefault()
    globalDrag = false
    dragDepth = 0
    if (mediaProcessing.active || importProgress || serverNeedsLogin()) return
    const mediaFiles = Array.from(event.dataTransfer?.files ?? [])
      .filter((file) => mediaKindForFile(file) !== null)
    await importFiles(mediaFiles)
  }

  function refresh(): Promise<void> {
    if (mediaProcessing.active || importProgress) return Promise.resolve()
    return trackMediaBinLoad(refreshProxySources())
  }

  async function refreshProxySources(): Promise<void> {
    const refreshGeneration = ++generation
    // Logged-out users cannot list server media: clear the server inventory
    // instead of flashing a 401 error, the login wall covers the Server tab.
    if (!auth.isLogged) {
      proxyItems = []
      refreshing = false
      clearDeferredPreviews()
      error = ''
      return
    }
    refreshing = true
    clearDeferredPreviews()
    error = ''
    try {
      const entries = await listProxySources()
      if (refreshGeneration !== generation) return

      const registeredByName = new Map(
        getMediaBinSources().map((source) => [source.name.toLowerCase(), source] as const),
      )

      proxyItems = entries.map((entry) => {
        const mediaKind = entry.mediaKind ?? mediaKindForFileName(entry.name) ?? 'video'
        const sourceRevision = entry.etag ? JSON.stringify([entry.s3Key ?? entry.name, entry.etag, entry.size]) : undefined
        const source = registeredByName.get(entry.name.toLowerCase())
        // Scene filenames are immutable; an S3 ETag is not the pinned SHA-256 asset version.
        const immutableScene = isLiveSceneFile(entry.name)

        const registered = source?.sourceMode !== 'wasm' && (immutableScene || !source?.sourceRevision || source.sourceRevision === sourceRevision)
          ? source
          : undefined

        const cachedPreview = sourceRevision && registered?.sourceRevision === sourceRevision
          && !!(registered.previewUrl || registered.scrubBlobUrl)

        const isRender = entry.isRender ?? registered?.isRender ?? false
        return {
          fileName: entry.name,
          displayName: source?.displayName || entry.name,
          sourceId: registered?.sourceId,
          sourceRevision: registered && immutableScene ? registered.sourceRevision : sourceRevision,
          scene: registered?.scene,
          mediaKind,
          scrubName: mediaKind === 'video' && !isRender ? (entry.scrubName ?? scrubProxyName(entry.name)) : '',
          blobUrl: registered?.previewUrl ?? registered?.scrubBlobUrl ?? null,
          thumbnailUrl: registered?.thumbnailUrl,
          duration: registered?.duration ?? 0,
          sourceWidth: registered?.width,
          sourceHeight: registered?.height,
          projectAspect: registered ? projectAspectForSource(registered) : undefined,
          mode: 'proxy' as const,
          generated: registered?.generated ?? isGeneratedMediaSource(entry.name),
          isRender,
          state: mediaKind === 'video' || registered ? 'ready' as const : 'loading' as const,
          previewState: registered?.scene ? 'loaded' as const : cachedPreview
            ? mediaKind === 'video' && (registered?.duration ?? 0) <= 0 ? 'skipped' as const : 'loaded' as const
            : 'idle' as const,
        }
      })
      const listedNames = new Set(entries.map((entry) => entry.name.toLowerCase()))
      for (const source of registeredByName.values()) {
        if (!listedNames.has(source.name.toLowerCase())) syncRegisteredSource(source)
      }
      for (let i = 0; i < entries.length; i++) {
        schedulePreview(proxyItems[i], refreshGeneration)
      }
    } catch (cause) {
      if (refreshGeneration !== generation) return
      error = errorMessage(cause)
    } finally {
      if (refreshGeneration === generation) refreshing = false
    }
  }

  function clearDeferredPreviews(): void {
    for (const cleanup of deferredPreviewCleanups.values()) cleanup()
    deferredPreviewCleanups.clear()
    previewStarters.clear()
  }

  function schedulePreview(item: MediaItem, refreshGeneration: number): void {
    if (item.previewState === 'loaded' || item.previewState === 'skipped') return
    let started = false
    let unregister = () => {}

    const start = async () => {
      if (started) return
      started = true
      unregister()
      deferredPreviewCleanups.delete(item)
      previewStarters.delete(item)
      item.previewState = 'loading'
      await new Promise<void>((resolve) => {
        previewJobs.push({ item, generation: refreshGeneration, resolve })
        runQueuedPreviews()
      })
    }

    unregister = deferMediaBinLoad(start)
    deferredPreviewCleanups.set(item, unregister)
    previewStarters.set(item, start)
  }

  function runQueuedPreviews(): void {
    while (activePreviewLoads < PREVIEW_CONCURRENCY && previewJobs.length > 0) {
      const job = previewJobs.shift()!
      activePreviewLoads++
      void loadPreviewJob(job)
    }
  }

  async function loadPreviewJob(job: PreviewJob): Promise<void> {
    try {
      if (isCurrentProxyItem(job.item, job.generation)) await loadSourceMetadata(job.item, job.generation)
    } finally {
      activePreviewLoads--
      job.resolve()
      runQueuedPreviews()
    }
  }

  function startPreview(item: MediaItem): void {
    const start = previewStarters.get(item)
    if (start) void trackMediaBinLoad(start())
  }

  function observePreview(node: HTMLElement, item: MediaItem): ReturnType<Action<HTMLElement, MediaItem>> {
    const observe = (nextItem: MediaItem) => {
      previewObserver?.unobserve(node)
      observedItems.delete(node)
      if (nextItem.previewState !== 'idle') return
      if (!previewObserver) {
        startPreview(nextItem)
        return
      }
      observedItems.set(node, nextItem)
      previewObserver.observe(node)
    }
    observe(item)
    return {
      update: observe,
      destroy: () => {
        previewObserver?.unobserve(node)
        observedItems.delete(node)
      },
    }
  }

  function isCurrentProxyItem(item: MediaItem, refreshGeneration: number): boolean {
    return refreshGeneration === generation && proxyItems.includes(item)
  }

  async function loadSourceMetadata(item: MediaItem, refreshGeneration: number): Promise<void> {
    try {
      if (isLiveSceneFile(item.fileName)) {
        const source = await loadLiveScene(item.fileName)
        if (!isCurrentProxyItem(item, refreshGeneration)) return
        item.scene = source
        item.duration = source.config.durationInFrames / source.config.fps
        item.sourceWidth = source.config.width
        item.sourceHeight = source.config.height
        item.blobUrl = null
        item.state = 'ready'
        item.previewState = 'loaded'
        registerItem(item)
        return
      }
      const metadata = await getMediaMetadata(item.fileName)
      if (!isCurrentProxyItem(item, refreshGeneration)) return
      item.duration = item.mediaKind === 'image' ? IMAGE_DURATION : metadata.duration
      item.sourceWidth = metadata.width || undefined
      item.sourceHeight = metadata.height || undefined
      item.blobUrl = mediaSourceUrl(item.fileName)
      const skipPreview = item.mediaKind === 'video' && item.duration <= 0
      item.thumbnailUrl = item.mediaKind !== 'audio' && !skipPreview ? mediaThumbnailUrl(item.fileName) : null
      item.state = 'ready'
      item.previewState = skipPreview ? 'skipped' : 'loaded'
      registerItem(item)
    } catch (cause) {
      if (!isCurrentProxyItem(item, refreshGeneration)) return
      item.previewState = 'error'
      if (item.mediaKind !== 'video') item.state = 'error'
      item.errorMsg = errorMessage(cause)
    }
  }

  function registerItem(item: MediaItem): void {
    registerMediaBinSource({
      id: item.sourceId ?? item.fileName,
      name: item.fileName,
      displayName: item.displayName === item.fileName ? undefined : item.displayName,
      kind: item.mediaKind,
      duration: item.duration,
      width: item.sourceWidth,
      height: item.sourceHeight,
      sourceMode: item.mode,
      sourceId: item.sourceId,
      sourceRevision: item.sourceRevision,
      scrubBlobUrl: item.mediaKind === 'video' ? null : item.blobUrl,
      previewUrl: item.blobUrl,
      thumbnailUrl: item.thumbnailUrl,
      generated: item.generated,
      isRender: item.isRender,
      scene: item.scene,
    })
  }

  function selectMode(mode: ScrubMode): void {
    if (mediaProcessing.active || importProgress || mode === scrubSettings.mode) return
    scrubSettings.setMode(mode)
    error = ''
  }

  // Follow the account across login/logout without a page reload (inline
  // login): fresh logins land on the Server tab so uploads go to the server
  // volume, logouts fall back to Local where the Server tab needs an account.
  // Only the transition itself switches — a manual in-session choice is left
  // alone, and mounting never flips (tests and deep links keep their mode).
  let wasLogged = auth.isLogged

  $effect(() => {
    const logged = auth.isLogged
    const next = scrubModeAfterAuthChange(scrubSettings.mode, wasLogged, logged)
    wasLogged = logged
    if (next !== scrubSettings.mode) selectMode(next)
  })

  function selectProxyMode(): void {
    selectMode('proxy')
  }

  function selectWasmMode(): void {
    selectMode('wasm')
  }

  function selectFilter(event: MouseEvent): void {
    const value = (event.currentTarget as HTMLElement).dataset.filter
    if (value && FILTER_IDS.includes(value as MediaFilter)) filter = value as MediaFilter
  }

  function filterCount(id: string): number {
    return filterCounts[id as MediaFilter] ?? 0
  }

  function openFilePicker(): void {
    if (serverNeedsLogin()) return
    fileInput?.click()
  }

  async function handleUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    if (!input.files?.length) return
    if (mediaProcessing.active || importProgress || serverNeedsLogin()) return
    try {
      await importFiles(Array.from(input.files))
    } finally {
      input.value = ''
    }
  }

  function addUploadingItem(file: File, mode: ScrubMode, mediaKind: MediaKind): MediaItem {
    const item: MediaItem = {
      fileName: file.name,
      displayName: file.name,
      mediaKind,
      scrubName: mode === 'proxy' ? scrubProxyName(file.name) : '',
      blobUrl: null,
      duration: 0,
      mode,
      generated: false,
      isRender: false,
      state: mode === 'proxy' ? 'loading' : 'scrubbing',
      previewState: 'loading',
    }
    if (mode === 'proxy') {
      proxyItems = [...proxyItems, item]
      return proxyItems[proxyItems.length - 1]
    }
    wasmItems = [...wasmItems, item]
    return wasmItems[wasmItems.length - 1]
  }

  async function importFiles(files: File[]): Promise<void> {
    if (serverNeedsLogin()) return
    // Invalidate an older inventory request before adding local upload cards.
    generation++
    refreshing = false
    clearDeferredPreviews()
    const startedAt = Date.now()
    try {
      for (const [index, file] of files.entries()) {
        importProgress = { phase: 'metadata', fileName: file.name, index: index + 1, total: files.length, startedAt }
        await trackMediaBinLoad(prepareUploadedMedia(file))
      }
    } finally {
      importProgress = null
      for (const item of proxyItems) {
        if (item.previewState === 'idle' || item.previewState === 'loading' && item.state === 'ready') {
          item.previewState = 'idle'
          schedulePreview(item, generation)
        }
      }
    }
  }

  async function prepareUploadedMedia(file: File): Promise<void> {
    const mode = scrubSettings.mode
    error = ''
    const mediaKind = mediaKindForFile(file)
    if (!mediaKind) return
    const item = addUploadingItem(file, mode, mediaKind)
    try {
      if (mediaKind === 'video') {
        const metadata = await readVideoMetadata(file)
        item.duration = metadata.duration
        item.sourceWidth = metadata.width
        item.sourceHeight = metadata.height
      } else if (mediaKind === 'audio') {
        const metadata = await readAudioMetadata(file)
        item.duration = metadata.duration
      } else {
        const metadata = await readImageMetadata(file)
        item.duration = IMAGE_DURATION
        item.sourceWidth = metadata.width
        item.sourceHeight = metadata.height
      }
      if (mode === 'proxy' && importProgress) {
        importProgress = { ...importProgress, phase: 'uploading', loaded: 0, size: file.size, uploadStartedAt: Date.now() }
        await uploadFile(file, ({ loaded, total }) => {
          if (importProgress?.phase !== 'uploading') return
          importProgress = loaded >= total
            ? { ...importProgress, phase: 'saving' }
            : { ...importProgress, loaded, size: total }
        })
      }
      const projectAspect = item.sourceWidth && item.sourceHeight
        ? editor.initializeProjectAspect(item.sourceWidth, item.sourceHeight)
        : undefined
      item.projectAspect = projectAspect
      if (mode === 'wasm') item.sourceId = rememberLocalSource(file)
      item.blobUrl = mode === 'wasm' ? URL.createObjectURL(file) : mediaSourceUrl(file.name)
      const skipPreview = mediaKind === 'video' && item.duration <= 0
      item.thumbnailUrl = !skipPreview && mediaKind !== 'audio'
        ? mode === 'proxy' ? mediaThumbnailUrl(file.name) : mediaKind === 'image' ? item.blobUrl : null
        : null
      item.state = 'ready'
      item.previewState = skipPreview ? 'skipped' : 'loaded'
      registerItem(item)
    } catch (cause) {
      item.state = 'error'
      item.previewState = 'error'
      item.errorMsg = errorMessage(cause)
      error = item.errorMsg
    }
  }

  function isSelected(item: MediaItem): boolean {
    return selectedKeys.has(itemKey(item))
  }

  function enterSelection(): void {
    if (selectionBusy) return
    selecting = true
    error = ''
  }

  function exitSelection(): void {
    if (deleting) return
    selecting = false
    selectedKeys = new Set()
    deleteState = { kind: 'idle' }
    error = ''
  }

  function toggleSelect(item: MediaItem): (event: MouseEvent) => void {
    return (event: MouseEvent): void => {
      event.stopPropagation()
      if (!isSelectable(item) || deleting) return
      const key = itemKey(item)
      const next = new Set(selectedKeys)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      selectedKeys = next
    }
  }

  function toggleSelectAll(): void {
    if (deleting) return
    selectedKeys = allFilteredSelected
      ? new Set()
      : new Set(selectableFilteredItems.map((item) => itemKey(item)))
  }

  function isUsedOnTimeline(item: MediaItem): boolean {
    const name = item.fileName.toLowerCase()
    return editor.channels.some((channel) => channel.clips.some((clip) =>
      (clip.sourceMode ?? 'proxy') === item.mode
      && (clip.fileName.toLowerCase() === name
        || (item.sourceId !== undefined && clip.sourceId === item.sourceId)),
    ))
  }

  function requestDelete(): void {
    if (deleting) return
    const ready = selectedItems.filter(isSelectable)
    if (ready.length === 0) return
    const blocked = ready.filter(isUsedOnTimeline)
    const deletable = ready.filter((item) => !isUsedOnTimeline(item))
    if (blocked.length > 0) {
      const names = blocked.map((item) => item.displayName).join(', ')
      error = blocked.length === 1
        ? `${names} is used on the timeline. Remove its timeline clips first.`
        : `${names} are used on the timeline. Remove their timeline clips first.`
      selectedKeys = new Set(deletable.map((item) => itemKey(item)))
    }
    if (deletable.length === 0) return
    deleteState = { kind: 'confirming', items: deletable }
  }

  function cancelDelete(): void {
    if (deleting) return
    deleteState = { kind: 'idle' }
  }

  function dropItem(item: MediaItem): void {
    if (item.blobUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(item.blobUrl) } catch {}
    }
    if (item.mode === 'wasm' && item.sourceId) forgetLocalSource(item.sourceId)
    const sourceName = 'fileName' in item && typeof item.fileName === 'string' ? item.fileName : item.displayName
    unregisterMediaBinSource(sourceName)
    editor.forgetDocumentAsset(sourceName)
    proxyItems = proxyItems.filter((candidate) => candidate !== item)
    wasmItems = wasmItems.filter((candidate) => candidate !== item)
    if (previewItem && itemKey(previewItem) === itemKey(item)) previewId = ''
  }

  async function confirmDelete(): Promise<void> {
    if (deleteState.kind !== 'confirming' || deleteState.items.length === 0) return
    const targets = [...deleteState.items]
    deleteState = { kind: 'deleting', items: targets }
    error = ''
    const failed: string[] = []
    const failedKeys = new Set<string>()
    const proxyTargets = targets.filter((item) => item.mode === 'proxy')
    if (proxyTargets.length > 1) {
      try {
        const result = await deleteMediaFiles(proxyTargets.map((item) => item.fileName))
        const bulkFailedNames = new Set(result.failed.map((entry) => entry.file))
        for (const item of targets) {
          if (item.mode !== 'proxy') { dropItem(item); continue }
          if (bulkFailedNames.has(item.fileName)) {
            const detail = result.failed.find((entry) => entry.file === item.fileName)?.error || 'delete failed'
            failed.push(`${item.displayName}: ${detail}`)
            failedKeys.add(itemKey(item))
          } else {
            dropItem(item)
          }
        }
      } catch (cause) {
        for (const item of targets) {
          if (item.mode !== 'proxy') { dropItem(item); continue }
          failed.push(`${item.displayName}: ${errorMessage(cause)}`)
          failedKeys.add(itemKey(item))
        }
      }
    } else {
      for (const item of targets) {
        try {
          if (item.mode === 'proxy') await deleteMediaFile(item.fileName)
          dropItem(item)
        } catch (cause) {
          failed.push(`${item.displayName}: ${errorMessage(cause)}`)
          failedKeys.add(itemKey(item))
        }
      }
    }
    selectedKeys = new Set([...selectedKeys].filter((key) => failedKeys.has(key)))
    deleteState = { kind: 'idle' }
    if (failed.length === 0) {
      exitSelection()
      await refresh()
      return
    }
    error = failed.length === 1
      ? `Could not delete ${failed[0]}`
      : `Could not delete ${failed.length} files: ${failed.join('; ')}`
  }

  function togglePreview(item: MediaItem): (event: MouseEvent) => void {
    return (event: MouseEvent): void => {
      event.stopPropagation()
      if (selecting || item.previewState === 'skipped') return
      const key = itemKey(item)
      previewId = previewId === key ? '' : key
    }
  }

  function closePreview(): void {
    previewId = ''
  }

  function navigatePreview(direction: -1 | 1): void {
    const index = availablePreviews.findIndex((item) => itemKey(item) === previewId)
    const next = availablePreviews[index + direction]
    if (next) previewId = itemKey(next)
  }

  let previewPosition = $derived.by(() => {
    return { index: availablePreviews.findIndex((item) => itemKey(item) === previewId), total: availablePreviews.length }
  })

  function clearFilters(): void {
    filter = 'all'
    search = ''
  }

  function renameItem(item: MediaItem, name: string): void {
    if (item.state !== 'ready' || mediaProcessing.active) return
    if (!getMediaBinSource(item.fileName)) registerItem(item)
    renameMediaBinSource(item.fileName, name)
  }

  function timelineClipData(item: MediaItem): DropClipData {
    return {
      fileName: item.fileName,
      sourceId: item.sourceId,
      sourceMode: item.mode,
      mediaKind: item.mediaKind,
      scrubBlobUrl: item.mediaKind !== 'video'
        ? item.blobUrl ?? undefined
        : undefined,
      sourceDuration: item.duration,
      sourceWidth: item.sourceWidth,
      sourceHeight: item.sourceHeight,
      projectAspect: item.projectAspect,
      scrubMode: item.mode,
    }
  }

  function appendToTimeline(item: MediaItem): (event: MouseEvent) => Promise<void> {
    return async (event: MouseEvent): Promise<void> => {
      if (event.button !== 0 || mediaProcessing.active || item.state !== 'ready') return
      event.preventDefault()

      const channelType = item.mediaKind === 'audio' ? 'audio' : 'video'
      const channel = editor.channels.find((candidate) => candidate.type === channelType)
      if (channel?.locked) return
      const startSec = channel ? Math.max(0, ...channel.clips.map(clipEnd)) : 0

      editor.beginHistory()
      try {
        const target = channel ?? editor.addChannel(channelType)
        const added = await addDroppedClip(target, timelineClipData(item), startSec)
        if (added) editor.selectClip(added.primary.id)
      } finally {
        editor.endHistory()
      }
    }
  }

  function writeTimelineDragPayload(item: MediaItem): (event: DragEvent) => void {
    return (event: DragEvent): void => {
      if (mediaProcessing.active || item.state !== 'ready') {
        event.preventDefault()
        return
      }
      const dataTransfer = event.dataTransfer
      if (!dataTransfer) {
        event.preventDefault()
        return
      }
      const dragSource = event.currentTarget as HTMLElement
      const dragOffsetX = Math.max(0, event.clientX - dragSource.getBoundingClientRect().left)
      dataTransfer.setData('application/x-cineedit-clip', JSON.stringify({
        ...timelineClipData(item),
        dragOffsetX,
      }))
      dataTransfer.effectAllowed = 'copy'
      dataTransfer.dropEffect = 'copy'
    }
  }

  return {
    mediaProcessing,
    get items() { return items },
    get filteredItems() { return filteredItems },
    get filter() { return filter },
    get scrubMode() { return scrubSettings.mode },
    get search() { return search },
    set search(value: string) { search = value },
    get previewItem() { return previewItem },
    get previewPosition() { return previewPosition },
    get error() { return error },
    get refreshing() { return refreshing },
    get importProgress() { return importProgress },
    get selecting() { return selecting },
    get selectedCount() { return selectedCount },
    get allFilteredSelected() { return allFilteredSelected },
    get confirming() { return confirming },
    get deleting() { return deleting },
    get pendingDelete() { return pendingDelete },
    get pendingProxyCount() { return pendingProxyCount },
    get pendingLocalCount() { return pendingLocalCount },
    get selectionBusy() { return selectionBusy },
    get globalDrag() { return globalDrag },
    get listEl() { return listEl },
    set listEl(value: HTMLDivElement | undefined) { listEl = value },
    get fileInput() { return fileInput },
    set fileInput(value: HTMLInputElement | undefined) { fileInput = value },
    refresh,
    openFilePicker,
    handleUpload,
    enterSelection,
    exitSelection,
    toggleSelect,
    toggleSelectAll,
    isSelected,
    isSelectable,
    requestDelete,
    cancelDelete,
    confirmDelete,
    selectProxyMode,
    selectWasmMode,
    selectFilter,
    filterCount,
    clearFilters,
    closePreview,
    navigatePreview,
    renameItem,
    observePreview: observePreview as Action<HTMLElement, MediaItem>,
    togglePreview,
    appendToTimeline,
    writeTimelineDragPayload,
  }
}
