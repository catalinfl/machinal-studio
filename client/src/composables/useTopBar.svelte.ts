import { editor } from '../stores/editor.svelte'
import { mediaProcessing } from '../stores/media-processing.svelte'
import { formatTimecode } from '../lib/format'

interface Options {
  getShowMediaBin: () => boolean; getShowEffects: () => boolean; getShowPresets: () => boolean; getShowTransitions: () => boolean
  getShowText: () => boolean; getShowSpeech: () => boolean; getShowImage: () => boolean; getShowAI: () => boolean
  getOnToggleMediaBin: () => (() => void) | undefined; getOnToggleEffects: () => (() => void) | undefined; getOnTogglePresets: () => (() => void) | undefined
  getOnToggleTransitions: () => (() => void) | undefined; getOnToggleText: () => (() => void) | undefined; getOnToggleSpeech: () => (() => void) | undefined
  getOnToggleImage: () => (() => void) | undefined; getOnToggleAI: () => (() => void) | undefined
}

export function useTopBar(options: Options) {
  let panelMenuOpen = $state(false)
  let panelMenuButton = $state<HTMLButtonElement>()
  const panelLabel = $derived(options.getShowMediaBin() ? 'Media Bin' : options.getShowImage() ? 'Image' : options.getShowAI() ? 'AI Edit' : options.getShowText() ? 'Text' : options.getShowSpeech() ? 'Text to Speech' : options.getShowEffects() ? 'Effects' : options.getShowPresets() ? 'Styles' : options.getShowTransitions() ? 'Transitions' : 'Panels')
  const closePanelMenu = (): void => { panelMenuOpen = false }
  const togglePanelMenu = (event: MouseEvent): void => { event.stopPropagation(); panelMenuOpen = !panelMenuOpen }
  const togglePanel = (action: (() => void) | undefined): void => { closePanelMenu(); action?.() }
  const panelAction = (action: (() => void) | undefined) => (): void => togglePanel(action)
  const onWindowClick = (event: MouseEvent): void => {
    if (panelMenuOpen && panelMenuButton && !panelMenuButton.contains(event.target as Node)) panelMenuOpen = false
  }
  const onWindowKeydown = (event: KeyboardEvent): void => { if (event.key === 'Escape') closePanelMenu() }
  const undo = (): void => { editor.undo() }
  const redo = (): void => { editor.redo() }

  return {
    editor,
    mediaProcessing,
    formatTimecode,
    togglePanelMenu,
    panelAction,
    onWindowClick,
    onWindowKeydown,
    undo,
    redo,
    get panelMenuOpen() { return panelMenuOpen },
    get panelLabel() { return panelLabel },
    get panelMenuButton() { return panelMenuButton },
    set panelMenuButton(value: HTMLButtonElement | undefined) { panelMenuButton = value },
  }
}
