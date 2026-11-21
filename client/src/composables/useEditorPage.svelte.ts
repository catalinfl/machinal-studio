import { onMount } from 'svelte'
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
  let editorEl = $state<HTMLDivElement | undefined>()
  let bottomEl = $state<HTMLDivElement | undefined>()
  let timelineHeight = $state<number | null>(null)
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

  const activePanel = $derived(selectedPanel === 'ai' && aiPanelFloating ? 'media' : selectedPanel ?? 'media')

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

  function clampTimelineHeight(height: number): number {
    const editorHeight = editorEl?.getBoundingClientRect().height ?? window.innerHeight
    const compact = isMobile && window.innerHeight <= 500
    const minHeight = compact ? 140 : 220
    const previewHeight = compact ? 100 : 160
    return Math.max(minHeight, Math.min(height, Math.max(minHeight, editorHeight - previewHeight)))
  }

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
    selectedPanel = panel
    if (panel === 'ai') aiPanelVisible = true
    else if (!aiPanelFloating) aiPanelVisible = false
  }

  function togglePanel(panel: EditorPanel): void {
    if (panel === 'image' || panel === 'ai' || panel === 'speech') {
      requestFeatureGrant(panel === 'speech' ? 'tts' : panel)
      return
    }
    const shouldClose = isMobile && isPanelOpen(panel)
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
    if (panel === activePanel && !isMobile) return
    togglePanel(panel)
  }

  function dockAIPanel(): void {
    openPanel('ai')
  }

  function closeSpeechPanel(): void {
    if (selectedPanel === 'speech') closePanels()
    if (!isMobile) openPanel('media')
  }

  function closeImagePanel(): void {
    if (selectedPanel === 'image') closePanels()
    if (!isMobile) openPanel('media')
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
    const syncLayout = () => {
      const enteringMobile = mediaQuery.matches && !isMobile
      isMobile = mediaQuery.matches
      if (enteringMobile) {
        aiPanelFloating = false
        closePanels()
      }
      if (timelineHeight !== null) timelineHeight = clampTimelineHeight(timelineHeight)
    }
    syncLayout()
    mediaQuery.addEventListener('change', syncLayout)
    return () => {
      mediaQuery.removeEventListener('change', syncLayout)
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
    closeMobilePanel: closePanels,
    closeImagePanel,
    dockAIPanel,
    selectPanel,
    startTimelineResize,
    resizeTimelineWithKeyboard,
    retryWasm,
    retryPlayback,
  }
}
