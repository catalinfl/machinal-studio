import { onDestroy, onMount } from 'svelte'
import { useAIEdit } from './useAIEdit.svelte'

export interface AIPanelProps {
  get instruction(): string
  set instruction(value: string)
  get floating(): boolean
  set floating(value: boolean)
  get panelX(): number
  set panelX(value: number)
  get panelY(): number
  set panelY(value: number)
  get onDock(): (() => void) | undefined
}

export function useAIPanel(props: AIPanelProps) {
  const aiEdit = useAIEdit()
  let dragging = $state(false)
  let dragOffsetX = 0
  let dragOffsetY = 0
  let pendingX = 0
  let pendingY = 0
  let dragFrame: number | null = null
  let panelShell: HTMLDivElement | undefined

  function clampPosition(x = props.panelX, y = props.panelY): void {
    if (!props.floating || typeof window === 'undefined') return
    const margin = 8
    const top = 44 + margin
    const width = panelShell?.offsetWidth ?? 320
    const height = panelShell?.offsetHeight ?? 600
    props.panelX = Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin))
    props.panelY = Math.min(Math.max(top, y), Math.max(top, window.innerHeight - height - margin))
  }

  function undockAtTopRight(): void {
    if (props.floating || typeof window === 'undefined') return
    props.floating = true
    props.panelX = Math.max(8, window.innerWidth - (panelShell?.offsetWidth ?? 320) - 8)
    props.panelY = 52
    requestAnimationFrame(() => clampPosition())
  }

  function startDragging(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 2) return
    const target = event.target as Element
    if (!target.closest('.browser-panel-head')) return
    if (target.closest('button:not(.drag-handle), input, textarea, select, a')) return
    const bounds = panelShell?.getBoundingClientRect()
    if (!bounds) return
    dragOffsetX = event.clientX - bounds.left
    dragOffsetY = event.clientY - bounds.top
    props.panelX = bounds.left
    props.panelY = bounds.top
    props.floating = true
    dragging = true
    panelShell?.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  function preventHeaderContextMenu(event: MouseEvent): void {
    if ((event.target as Element).closest('.browser-panel-head')) event.preventDefault()
  }

  function movePanel(event: PointerEvent): void {
    if (!dragging) return
    pendingX = event.clientX - dragOffsetX
    pendingY = event.clientY - dragOffsetY
    if (dragFrame !== null) return
    dragFrame = requestAnimationFrame(() => {
      dragFrame = null
      clampPosition(pendingX, pendingY)
    })
  }

  function stopDragging(): void {
    dragging = false
  }

  function movePanelWithKeyboard(event: KeyboardEvent): void {
    if (!props.floating || !event.key.startsWith('Arrow')) return
    const distance = event.shiftKey ? 40 : 10
    const dx = event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0
    const dy = event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0
    clampPosition(props.panelX + dx, props.panelY + dy)
    event.preventDefault()
  }

  function dockPanel(): void {
    props.floating = false
    dragging = false
    props.onDock?.()
  }

  function submitForm(event: SubmitEvent): void {
    event.preventDefault()
    void aiEdit.submit(props.instruction, aiEdit.fast)
  }

  function handleResize(): void {
    clampPosition()
  }

  function applyRecommendation(): void {
    void aiEdit.applyRecommendation()
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void aiEdit.submit(props.instruction, aiEdit.fast)
    }
  }

  onMount(() => {
    if (props.floating) requestAnimationFrame(() => clampPosition())
  })

  onDestroy(() => {
    if (dragFrame !== null) cancelAnimationFrame(dragFrame)
  })

  return {
    aiEdit,
    get dragging() { return dragging },
    get panelShell() { return panelShell },
    set panelShell(value: HTMLDivElement | undefined) { panelShell = value },
    get style() { return props.floating ? `left:${props.panelX}px;top:${props.panelY}px` : undefined },
    clampPosition,
    handleResize,
    undockAtTopRight,
    startDragging,
    preventHeaderContextMenu,
    movePanel,
    stopDragging,
    movePanelWithKeyboard,
    dockPanel,
    submitForm,
    applyRecommendation,
    onKeydown,
  }
}
