export interface PointerDragListeners {
  onMove: (event: PointerEvent) => void
  onEnd: (event: PointerEvent) => void
}

export function addPointerDragListeners({ onMove, onEnd }: PointerDragListeners): () => void {
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)

  return () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
  }
}
