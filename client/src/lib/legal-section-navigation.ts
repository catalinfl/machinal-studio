import { scrollToPublicSection } from './public-section-navigation'

export function scrollToLegalSection(event: MouseEvent): void {
  scrollToPublicSection(event)
  if (!event.defaultPrevented) return
  const link = event.currentTarget as HTMLAnchorElement
  const section = document.getElementById(new URL(link.href).hash.slice(1))
  const destination = section?.querySelector<HTMLElement>('h2') ?? section
  if (!destination) return
  destination.tabIndex = -1
  destination.focus({ preventScroll: true })
}
