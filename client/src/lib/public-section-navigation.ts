export function scrollToPublicSection(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.currentTarget as HTMLAnchorElement
  const destination = new URL(link.href)
  if (destination.origin !== location.origin || destination.pathname !== location.pathname || destination.search !== location.search || !destination.hash) return
  const section = document.getElementById(destination.hash.slice(1))
  if (!section) return
  event.preventDefault()
  section.scrollIntoView({ block: 'start' })
  history.replaceState(history.state, '', destination.href)
}
