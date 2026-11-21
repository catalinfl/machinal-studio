export function useInspector(getOnClose: () => () => void) {
  const onWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    getOnClose()()
  }
  return {
    onWindowKeydown,
  }
}
