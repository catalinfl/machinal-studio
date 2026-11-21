export function useConveyorMotion() {
  let paused = $state(false)
  let environment = $state({ inView: false, pageVisible: true, reducedMotion: false, compact: false })
  const running = $derived(!paused && environment.inView && environment.pageVisible && !environment.reducedMotion)

  function observe(node: HTMLElement) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const compact = window.matchMedia('(max-width: 640px)')
    const updateMedia = () => {
      environment = { ...environment, reducedMotion: reducedMotion.matches, compact: compact.matches }
    }

    const updateVisibility = () => {
      environment.pageVisible = !document.hidden
    }

    const observer = new IntersectionObserver(([entry]) => {
      environment.inView = entry.isIntersecting
    }, { threshold: 0.05 })

    updateMedia()
    updateVisibility()
    observer.observe(node)
    reducedMotion.addEventListener('change', updateMedia)
    compact.addEventListener('change', updateMedia)
    document.addEventListener('visibilitychange', updateVisibility)

    return {
      destroy() {
        observer.disconnect()
        reducedMotion.removeEventListener('change', updateMedia)
        compact.removeEventListener('change', updateMedia)
        document.removeEventListener('visibilitychange', updateVisibility)
      },
    }
  }

  function toggle() {
    paused = !paused
  }

  return {
    observe,
    toggle,
    get paused() { return paused },
    get running() { return running },
    get reducedMotion() { return environment.reducedMotion },
    get compact() { return environment.compact },
  }
}
