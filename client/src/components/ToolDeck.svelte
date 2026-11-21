<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import type { EditorPanel } from '../composables/useEditorPage.svelte'

  let { active, mobileOpen, overlay = false, onClose, children, assistant }: {
    active: EditorPanel | null
    mobileOpen: boolean
    overlay?: boolean
    onClose?: () => void
    children: Snippet
    assistant?: Snippet
  } = $props()

  let preferredWidth: number | null = null
  let width = $state(320)
  let resizing = $state(false)
  let closeButton = $state<HTMLButtonElement>()
  let startX = 0
  let startWidth = 0

  function clampWidth(value: number): number {
    return Math.max(272, Math.min(value, Math.min(560, window.innerWidth - 600)))
  }

  function move(event: PointerEvent): void {
    if (resizing) preferredWidth = width = clampWidth(startWidth + event.clientX - startX)
  }

  function stop(): void {
    resizing = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }

  function start(event: PointerEvent): void {
    event.preventDefault()
    startX = event.clientX
    startWidth = width
    resizing = true
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    preferredWidth = width = clampWidth(width + (event.key === 'ArrowRight' ? 24 : -24))
  }

  onMount(() => {
    const syncWidth = () => {
      const defaultWidth = window.innerWidth >= 1440 && window.innerHeight > 800 ? 560 : Math.max(320, window.innerWidth - 1040)
      width = clampWidth(preferredWidth ?? defaultWidth)
    }
    syncWidth()
    window.addEventListener('resize', syncWidth)
    return () => { stop(); window.removeEventListener('resize', syncWidth) }
  })

  $effect(() => {
    if (overlay && mobileOpen && active) void tick().then(() => closeButton?.focus())
  })

  function onPanelKeydown(event: KeyboardEvent): void {
    if (overlay && event.key === 'Escape' && !event.defaultPrevented && (event.target as Element)?.closest('.tool-deck')) {
      event.stopPropagation()
      onClose?.()
    }
  }

</script>

<svelte:window onkeydown={onPanelKeydown} />

<div class="tool-deck" class:overlay class:closed={!active || (overlay && !mobileOpen)} class:mobile-open={mobileOpen} class:resizing style:--deck-width={`${width}px`} role="region" aria-label="Editing tools">
  {#key active}
    <div class="sheet">
      {#if overlay && mobileOpen}<button bind:this={closeButton} class="sheet-close" type="button" onclick={onClose} aria-label="Close tool panel"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4-6 6 6 6M6 10h11" /></svg><span>Back to composition</span></button>{/if}
      {@render children()}
    </div>
  {/key}
  {#if assistant}<div class="assistant-slot">{@render assistant()}</div>{/if}
  <div class="resize-handle" role="slider" tabindex="0" aria-label="Resize tool deck" aria-orientation="horizontal" aria-valuemin="272" aria-valuemax="560" aria-valuenow={width} onpointerdown={start} onkeydown={resizeWithKeyboard}><span></span></div>
</div>

<style>
  .tool-deck { display: flex; flex: 0 0 var(--deck-width); width: var(--deck-width); min-width: 0; height: 100%; position: relative; z-index: 3; background: var(--surface); border-right: 1px solid var(--border); }
  .sheet { display: flex; flex: 1; min-width: 0; height: 100%; overflow: hidden; container: tool-sheet / inline-size; }
  .sheet :global(aside) { flex: 1 1 auto; width: 100%; min-width: 0; border-right: 0; }
  .sheet-close { display: none; }
  .assistant-slot { position: absolute; inset: 0; pointer-events: none; }
  .assistant-slot :global(.ai-panel-shell) { width: 100%; pointer-events: auto; }
   .assistant-slot :global(.ai-panel-shell.floating) { width: min(320px, calc(100vw - 16px)); }
  .resize-handle { position: absolute; top: 0; right: -5px; bottom: 0; z-index: 5; width: 10px; cursor: ew-resize; touch-action: none; }
  .resize-handle span { position: absolute; width: 2px; height: 42px; top: 50%; left: 4px; transform: translateY(-50%); background: var(--border-strong); opacity: 0; }
  .resize-handle:hover span, .resize-handle:focus-visible span, .resizing .resize-handle span { background: var(--primary); opacity: 1; }
  .resize-handle:focus-visible { outline: 2px solid var(--primary); outline-offset: -3px; }
  .tool-deck.closed { display: none; }
  .tool-deck.overlay { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; z-index: 40; }
  .overlay .resize-handle { display: none; }
  .overlay .sheet-close { display: flex; }
  .overlay .sheet { width: 100%; flex-direction: column; }
  .overlay .assistant-slot { inset: 38px 0 0; }
  .overlay .assistant-slot :global(.ai-panel-shell.floating) { width: 100%; }
  @media (max-height: 500px) and (orientation: landscape) { .assistant-slot { top: 32px; } }
</style>
