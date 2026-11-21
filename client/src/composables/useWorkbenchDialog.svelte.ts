import { onMount } from 'svelte'

const noop = (): void => {}

interface WorkbenchDialogOptions {
  getOnClose: () => (() => void) | undefined
}

export function useWorkbenchDialog(options: WorkbenchDialogOptions) {
  let dialogEl = $state<HTMLDialogElement>()
  let closeNotified = false
  const notifyClose = (): void => {
    if (closeNotified) return
    closeNotified = true
    ;(options.getOnClose() ?? noop)()
  }
  const closeDialog = (): void => {
    if (dialogEl && typeof dialogEl.close === 'function') {
      dialogEl.close()
      return
    }
    dialogEl?.removeAttribute('open')
    notifyClose()
  }

  onMount(() => {
    if (!dialogEl || dialogEl.open) return
    if (typeof dialogEl.showModal === 'function') dialogEl.showModal()
    else dialogEl.setAttribute('open', '')
  })
  return {
    get dialogEl() { return dialogEl },
    set dialogEl(value: HTMLDialogElement | undefined) { dialogEl = value },
    notifyClose,
    closeDialog,
  }
}
