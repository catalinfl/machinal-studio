import type { ProjectAspect, TextItem } from '../stores/editor.svelte'
import { textDesignSize, textSafeInsets } from '../stores/editor.svelte'
import { textAnchorRatio, textRasterSize } from './text-render'

export interface PositionCell {
  id: string
  col: number
  row: number
  label: string
}

export const TEXT_POSITION_CELLS: PositionCell[] = [
  { id: 'tl', col: 0, row: 0, label: 'top left' }, { id: 'tc', col: 1, row: 0, label: 'top center' }, { id: 'tr', col: 2, row: 0, label: 'top right' },
  { id: 'ml', col: 0, row: 1, label: 'middle left' }, { id: 'mc', col: 1, row: 1, label: 'middle center' }, { id: 'mr', col: 2, row: 1, label: 'middle right' },
  { id: 'bl', col: 0, row: 2, label: 'bottom left' }, { id: 'bc', col: 1, row: 2, label: 'bottom center' }, { id: 'br', col: 2, row: 2, label: 'bottom right' },
]

export function textPositionCellCenter(item: TextItem, cell: PositionCell, aspect: ProjectAspect): { x: number; y: number } {
  const box = textRasterSize(item)
  const design = textDesignSize(aspect)
  const safe = textSafeInsets(aspect)
  const leftEdge = safe.left
  const rightEdge = design.w - safe.right
  const topEdge = safe.top
  const bottomEdge = design.h - safe.bottom
  const centerX = box.width >= rightEdge - leftEdge
    ? (leftEdge + rightEdge) / 2
    : leftEdge + box.width / 2 + cell.col * ((rightEdge - leftEdge - box.width) / 2)
  const y = box.height >= bottomEdge - topEdge
    ? design.h / 2
    : topEdge + box.height / 2 + cell.row * ((bottomEdge - topEdge - box.height) / 2)
  const x = centerX + box.width * (textAnchorRatio(item) - 0.5)
  return { x: Math.round(x), y: Math.round(y) }
}
