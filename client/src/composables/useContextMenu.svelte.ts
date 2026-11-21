import { onMount, tick } from 'svelte'
import type { ContextMenuAction } from '../lib/context-menu'

interface Options {
  getX: () => number
  getY: () => number
  getOnClose: () => () => void
}

export function useContextMenu(options: Options) {
  let menuEl = $state<HTMLDivElement>()
  let left = $state(0)
  let top = $state(0)
  let positioned = $state(false)
  const positionMenu = (): void => {
    if (!menuEl) return
    const margin = 8
    const rect = menuEl.getBoundingClientRect()
    left = Math.max(margin, Math.min(options.getX(), window.innerWidth - rect.width - margin))
    top = Math.max(margin, Math.min(options.getY(), window.innerHeight - rect.height - margin))
    positioned = true
  }
  const enabledItems = (): HTMLButtonElement[] => Array.from(menuEl?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])
  const moveFocus = (direction: 1 | -1): void => {
    const buttons = enabledItems()
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[current < 0 ? (direction > 0 ? 0 : buttons.length - 1) : (current + direction + buttons.length) % buttons.length].focus()
  }

  const onMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      options.getOnClose()()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const buttons = enabledItems()
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    }
  }

  const choose = (item: ContextMenuAction): void => {
    if (item.disabled) return
    options.getOnClose()()
    item.onSelect()
  }

  const chooseItem = (item: ContextMenuAction) => (): void => choose(item)
  const preventContextMenu = (event: MouseEvent): void => event.preventDefault()

  onMount(() => {
    const closeFromOutside = (event: Event): void => {
      if (!menuEl?.contains(event.target as Node)) options.getOnClose()()
    }

    const closeOnResize = (): void => options.getOnClose()()
    window.addEventListener('pointerdown', closeFromOutside, true)
    window.addEventListener('contextmenu', closeFromOutside, true)
    window.addEventListener('resize', closeOnResize)

    void tick().then(() => {
      positionMenu()
      enabledItems()[0]?.focus()
    })

    return () => {
      window.removeEventListener('pointerdown', closeFromOutside, true)
      window.removeEventListener('contextmenu', closeFromOutside, true)
      window.removeEventListener('resize', closeOnResize)
    }
  })

  return {
    onMenuKeyDown,
    preventContextMenu,
    choose,
    chooseItem,
    get menuEl() { return menuEl },
    set menuEl(value: HTMLDivElement | undefined) { menuEl = value },
    get left() { return left },
    get top() { return top },
    get positioned() { return positioned },
  }
}
