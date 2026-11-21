import { onDestroy } from 'svelte'

export function useClipboardFeedback() {
  let status = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(text: string, label = 'Copied to clipboard.') {
    try {
      await navigator.clipboard.writeText(text)
      status = label
    } catch {
      status = 'Clipboard unavailable. Select the text and copy it.'
    }
    clearTimeout(timer)
    timer = setTimeout(() => status = '', 3000)
  }

  onDestroy(() => clearTimeout(timer))

  return {
    copy,
    get status() { return status },
  }
}
