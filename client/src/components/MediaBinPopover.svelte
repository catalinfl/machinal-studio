<script lang="ts">
  import { tick, type Snippet } from 'svelte'

  let { label, title = label, active = false, iconOnly = false, align = 'start', trigger, children }: {
    label: string
    title?: string
    active?: boolean
    iconOnly?: boolean
    align?: 'start' | 'end'
    trigger: Snippet
    children: Snippet<[() => void]>
  } = $props()

  const id = $props.id()
  let root: HTMLDivElement
  let button: HTMLButtonElement
  let panel: HTMLDivElement
  let open = $state(false)
  let position = $state({ top: 0, left: 0 })

  function close(restoreFocus = true): void {
    if (!open) return
    open = false
    panel?.hidePopover?.()
    if (restoreFocus) button?.focus()
  }

  async function toggle(): Promise<void> {
    if (open) return close()
    open = true
    await tick()
    panel.showPopover?.()
    const rect = button.getBoundingClientRect()
    const top = rect.bottom + 6
    const left = align === 'end' ? rect.right - panel.offsetWidth : rect.left
    position = {
      top: top + panel.offsetHeight <= window.innerHeight - 12 ? top : Math.max(12, rect.top - panel.offsetHeight - 6),
      left: Math.max(12, Math.min(left, window.innerWidth - panel.offsetWidth - 12)),
    }
    const first = panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)')
      ?? panel.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
  }

  function handleOutsideClick(event: MouseEvent): void {
    if (!root.contains(event.target as Node)) close(false)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  function handleFocusout(event: FocusEvent): void {
    if (event.relatedTarget && !root.contains(event.relatedTarget as Node)) close(false)
  }
</script>

<svelte:window onclick={handleOutsideClick} onresize={() => close(false)} />

<div class="library-disclosure" role="presentation" bind:this={root} onkeydown={handleKeydown} onfocusout={handleFocusout}>
  <button type="button" class="library-disclosure-trigger" class:active class:icon-only={iconOnly}
    bind:this={button} aria-label={label} {title} aria-expanded={open} aria-controls={id} onclick={toggle}>
    {@render trigger()}
  </button>
  <div {id} class="library-popover" role="group" aria-label={label} bind:this={panel} popover="auto"
    hidden={!open} style:display={open ? 'grid' : 'none'} style:top={`${position.top}px`} style:left={`${position.left}px`}
    ontoggle={event => { open = (event as ToggleEvent).newState === 'open' }}>
    {@render children(() => close())}
  </div>
</div>
