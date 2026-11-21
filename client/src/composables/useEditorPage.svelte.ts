import { onMount, tick } from 'svelte'
import { editor } from '../stores/editor.svelte'
import { render } from '../stores/render.svelte'
import { mediaProcessing } from '../stores/media-processing.svelte'
import { captions } from '../stores/captions.svelte'
import { useProjects } from './useProjects.svelte'
import { startDocumentSync } from '../lib/compositions'
import type { AIFeature } from '../lib/ai-access'
import { useAIFeatureAccess } from './useAIFeatureAccess.svelte'

export type EditorPanel = 'media' | 'effects' | 'presets' | 'transitions' | 'text' | 'speech' | 'image' | 'ai'

export function useEditorPage() {
  const projects = useProjects()
  const aiAccess = useAIFeatureAccess()
  let selectedPanel = $state<EditorPanel | null>('media')
  let sceneDialogOpen = $state(false)
  let aiInstruction = $state('')
  let aiPanelVisible = $state(false)
  let aiPanelFloating = $state(false)
  let aiPanelPosition = $state({ x: 0, y: 0 })
  let isMobile = $state(false)
  let overlayTools = $state(false)
  let workspaceFocus = $state<'balanced' | 'preview' | 'timeline'>('balanced')
  let panelTrigger: HTMLElement | null = null
  let editorEl = $state<HTMLDivElement | undefined>()
  let bottomEl = $state<HTMLDivElement | undefined>()
  let timelineHeight = $state<number | null>(null)
  let timelineBounds = $state({ minimum: 220, maximum: 800, current: 340 })
  let resizingTimeline = $state(false)
  let clipInspectorOpen = $state(false)
  let effectInspectorOpen = $state(false)
  let textInspectorOpen = $state(false)
  let resizeStartY = 0
  let resizeStartHeight = 0
  const showMediaBin = $derived(selectedPanel === 'media')
  const showEffects = $derived(selectedPanel === 'effects')
  const showPresets = $derived(selectedPanel === 'presets')
  const showTransitions = $derived(selectedPanel === 'transitions')
  const showText = $derived(selectedPanel === 'text')
  const showSpeech = $derived(selectedPanel === 'speech')
  const showImage = $derived(selectedPanel === 'image')
  const showAI = $derived(aiPanelVisible)

  const mobilePanelOpen = $derived(
    selectedPanel !== null && (selectedPanel !== 'ai' || !aiPanelFloating),
  )

  const activePanel = $derived(selectedPanel === 'ai' && aiPanelFloating ? 'media' : selectedPanel)

  const clipInspectorVisible = $derived(
    clipInspectorOpen && !showText && editor.selectedClipIds.length > 0,
  )

  const effectInspectorVisible = $derived(
    effectInspectorOpen && editor.selectedEffectBlockIds.length > 0,
  )

  const textInspectorVisible = $derived(
    textInspectorOpen && editor.selectedTextItemIds.length > 0,
  )

  const inspectorOpen = $derived(
    textInspectorVisible
      || effectInspectorVisible
      || clipInspectorVisible,
  )

  $effect(() => {
    if (showText || editor.selectedClipIds.length === 0) clipInspectorOpen = false
  })

  $effect(() => {
    if (editor.selectedEffectBlockIds.length === 0) effectInspectorOpen = false
  })

  $effect(() => {
    if (editor.selectedTextItemIds.length === 0) textInspectorOpen = false
  })

  function openClipInspector(): void {
    if (selectedPanel === 'text' || selectedPanel === 'speech') selectedPanel = null
    clipInspectorOpen = true
  }

  function openEffectInspector(): void {
    effectInspectorOpen = true
  }

  function openTextInspector(): void {
    textInspectorOpen = true
  }

  function measureTimeline(): void {
    const editorHeight = editorEl?.getBoundingClientRect().height ?? window.innerHeight
    const compact = isMobile && window.innerHeight <= 500
    const style = bottomEl ? window.getComputedStyle(bottomEl) : null
    const minHeight = parseFloat(style?.minHeight ?? '') || (compact ? 140 : 220)
    const maxHeight = parseFloat(style?.maxHeight ?? '') || Number.POSITIVE_INFINITY
    const previewHeight = compact ? 100 : 160
    timelineBounds = {
      minimum: minHeight,
      maximum: Math.max(minHeight, Math.min(maxHeight, editorHeight - previewHeight)),
      current: bottomEl?.getBoundingClientRect().height ?? 340,
    }
  }

  function clampTimelineHeight(height: number): number {
    measureTimeline()
    return Math.max(timelineBounds.minimum, Math.min(height, timelineBounds.maximum))
  }

  $effect(() => {
    if (!editorEl || !bottomEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureTimeline)
    observer.observe(editorEl)
    observer.observe(bottomEl)
    return () => observer.disconnect()
  })

  function resizeTimeline(event: PointerEvent): void {
    if (!resizingTimeline) return
    timelineHeight = clampTimelineHeight(resizeStartHeight + resizeStartY - event.clientY)
  }

  function stopTimelineResize(): void {
    resizingTimeline = false
    window.removeEventListener('pointermove', resizeTimeline)
    window.removeEventListener('pointerup', stopTimelineResize)
    window.removeEventListener('pointercancel', stopTimelineResize)
  }

  function startTimelineResize(event: PointerEvent): void {
    event.preventDefault()
    resizeStartY = event.clientY
    resizeStartHeight = bottomEl?.getBoundingClientRect().height ?? 0
    resizingTimeline = true
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    window.addEventListener('pointermove', resizeTimeline)
    window.addEventListener('pointerup', stopTimelineResize)
    window.addEventListener('pointercancel', stopTimelineResize)
  }

  function resizeTimelineWithKeyboard(event: KeyboardEvent): void {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentHeight = bottomEl?.getBoundingClientRect().height ?? 0
    if (event.key === 'ArrowUp') timelineHeight = clampTimelineHeight(currentHeight + 24)
    else if (event.key === 'ArrowDown') timelineHeight = clampTimelineHeight(currentHeight - 24)
    else if (event.key === 'Home') timelineHeight = clampTimelineHeight(0)
    else timelineHeight = clampTimelineHeight(Number.POSITIVE_INFINITY)
  }

  function closePanels(): void {
    selectedPanel = null
    if (!aiPanelFloating) aiPanelVisible = false
  }

  function isPanelOpen(panel: EditorPanel): boolean {
    return selectedPanel === panel
  }

  function openPanel(panel: EditorPanel): void {
    if (overlayTools && selectedPanel === null) panelTrigger = document.activeElement as HTMLElement
    workspaceFocus = 'balanced'
    selectedPanel = panel
    if (panel === 'ai') aiPanelVisible = true
    else if (!aiPanelFloating) aiPanelVisible = false
  }

  function togglePanel(panel: EditorPanel): void {
    if (panel === 'image' || panel === 'ai' || panel === 'speech') {
      requestFeatureGrant(panel === 'speech' ? 'tts' : panel)
      return
    }
    const shouldClose = overlayTools && isPanelOpen(panel)
    closePanels()
    if (shouldClose) return
    openPanel(panel)
  }

  // Paid grant targets: what "the feature works" means once entitlement is
  // confirmed. Panels open like their free counterparts; captions starts the
  // normal transcription flow; render needs no grant (the render menu drives
  // paid users straight to export and only blocked users reach the dialog).
  function grantedOpenerFor(next: AIFeature): (() => void) | undefined {
    switch (next) {
      case 'image': return () => togglePaidPanel('image')
      case 'ai': return () => togglePaidPanel('ai')
      case 'tts': return () => togglePaidPanel('speech')
      case 'captions': return () => { void captions.generateSubtitles() }
      case 'render': return undefined
      case 'scenes': return () => { sceneDialogOpen = true }
    }
  }

  function requestFeatureGrant(next: AIFeature): void {
    aiAccess.request(next, grantedOpenerFor(next))
  }

  function openPaidPanel(panel: 'image' | 'ai' | 'speech'): void {
    if (panel === 'ai' && aiPanelFloating) {
      aiPanelVisible = true
      return
    }
    openPanel(panel)
  }

  function togglePaidPanel(panel: 'image' | 'ai' | 'speech'): void {
    if (panel === 'ai' && aiPanelVisible) {
      aiPanelVisible = false
      if (selectedPanel === 'ai') selectedPanel = null
      return
    }
    if (isPanelOpen(panel)) {
      closePanels()
      return
    }
    openPaidPanel(panel)
  }

  function selectPanel(panel: EditorPanel): void {
    if (panel === 'media' && mediaProcessing.active) return
    if (panel === 'image' || panel === 'ai' || panel === 'speech') {
      requestFeatureGrant(panel === 'speech' ? 'tts' : panel)
      return
    }
    if (panel === activePanel && !overlayTools) {
      workspaceFocus = 'balanced'
      return
    }
    togglePanel(panel)
  }

  function dockAIPanel(): void {
    openPanel('ai')
  }

  async function closeToolPanel(): Promise<void> {
    closePanels()
    await tick()
    if (panelTrigger?.isConnected && panelTrigger.getClientRects().length) {
      panelTrigger.focus()
      return
    }
    const navigation = isMobile ? '.mobile-panels' : '.editor-taskbar'
    document.querySelector<HTMLButtonElement>(`${navigation} button[aria-label="Media Bin"]`)?.focus()
  }

  function toggleWorkspaceFocus(target: 'preview' | 'timeline'): void {
    workspaceFocus = workspaceFocus === target ? 'balanced' : target
    if (overlayTools && workspaceFocus !== 'balanced') closePanels()
  }

  function onWorkspaceKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || workspaceFocus === 'balanced') return
    workspaceFocus = 'balanced'
  }

  function closeSpeechPanel(): void {
    if (selectedPanel === 'speech') closePanels()
    if (!overlayTools) openPanel('media')
  }

  function closeImagePanel(): void {
    if (selectedPanel === 'image') closePanels()
    if (!overlayTools) openPanel('media')
  }

  function retryWasm(): void {
    void render.ensureWasm()
  }

  function retryPlayback(): void {
    void render.startPlayback()
  }

  onMount(() => {
    const resumed = aiAccess.resume()
    if (resumed) requestFeatureGrant(resumed)
    const stopDocumentSync = startDocumentSync()
    if (typeof window.matchMedia !== 'function') return stopDocumentSync
    const mediaQuery = window.matchMedia('(max-width: 1024px)')
    const overlayQuery = window.matchMedia('(max-width: 1279px)')
    const syncLayout = () => {
      const enteringOverlay = overlayQuery.matches && !overlayTools
      const leavingOverlay = !overlayQuery.matches && overlayTools
      isMobile = mediaQuery.matches
      overlayTools = overlayQuery.matches
      if (enteringOverlay) {
        aiPanelFloating = false
        closePanels()
      }
      if (leavingOverlay && selectedPanel === null) openPanel('media')
      if (timelineHeight !== null) timelineHeight = clampTimelineHeight(timelineHeight)
    }
    syncLayout()
    window.addEventListener('resize', syncLayout)
    window.addEventListener('keydown', onWorkspaceKeydown)
    return () => {
      window.removeEventListener('resize', syncLayout)
      window.removeEventListener('keydown', onWorkspaceKeydown)
      stopTimelineResize()
      stopDocumentSync()
    }
  })

  return {
    projects,
    get showMediaBin() { return showMediaBin },
    get showEffects() { return showEffects },
    get showPresets() { return showPresets },
    get showTransitions() { return showTransitions },
    get showText() { return showText },
    get showSpeech() { return showSpeech },
    get showImage() { return showImage },
    get showAI() { return showAI },
    get sceneDialogOpen() { return sceneDialogOpen },
    closeSceneDialog: () => { sceneDialogOpen = false },
    get activePanel() { return activePanel },
    get mobilePanelOpen() { return mobilePanelOpen },
    get isMobile() { return isMobile },
    get overlayTools() { return overlayTools },
    get workspaceFocus() { return workspaceFocus },
    toggleWorkspaceFocus,
    get aiInstruction() { return aiInstruction },
    set aiInstruction(value: string) { aiInstruction = value },
    get aiPanelFloating() { return aiPanelFloating },
    set aiPanelFloating(value: boolean) {
      aiPanelFloating = value
      if (value && selectedPanel === 'ai') selectedPanel = 'media'
    },
    get aiPanelX() { return aiPanelPosition.x },
    set aiPanelX(value: number) { aiPanelPosition.x = value },
    get aiPanelY() { return aiPanelPosition.y },
    set aiPanelY(value: number) { aiPanelPosition.y = value },
    get editorEl() { return editorEl },
    set editorEl(value: HTMLDivElement | undefined) { editorEl = value },
    get bottomEl() { return bottomEl },
    set bottomEl(value: HTMLDivElement | undefined) { bottomEl = value },
    get timelineHeight() { return timelineHeight },
    get timelineBounds() { return timelineBounds },
    get resizingTimeline() { return resizingTimeline },
    get clipInspectorVisible() { return clipInspectorVisible },
    get effectInspectorVisible() { return effectInspectorVisible },
    get textInspectorVisible() { return textInspectorVisible },
    get inspectorOpen() { return inspectorOpen },
    editor,
    aiAccess,
    render,
    mediaProcessing,
    openClipInspector,
    openEffectInspector,
    openTextInspector,
    toggleMediaBin: () => togglePanel('media'),
    toggleEffects: () => togglePanel('effects'),
    togglePresets: () => togglePanel('presets'),
    toggleTransitions: () => togglePanel('transitions'),
    toggleText: () => togglePanel('text'),
    toggleSpeech: () => togglePanel('speech'),
    toggleImage: () => togglePanel('image'),
    toggleAI: () => togglePanel('ai'),
    requestFeatureGrant,
    closeSpeechPanel,
    closeMobilePanel: closeToolPanel,
    closeImagePanel,
    dockAIPanel,
    selectPanel,
    startTimelineResize,
    resizeTimelineWithKeyboard,
    retryWasm,
    retryPlayback,
  }
}
