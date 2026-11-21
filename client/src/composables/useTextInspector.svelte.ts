import { editor, textDesignSize, type TextAlign, type TextItem } from '../stores/editor.svelte'
import { TEXT_ANIMATION_OPTIONS, WORD_ANIMATION_OPTIONS, textAnimationOption } from '../lib/text-presets'
import { TEXT_FONT_CATEGORIES, TEXT_FONTS } from '../lib/text-render'
import { TEXT_POSITION_CELLS, textPositionCellCenter, type PositionCell } from '../lib/text-layout'

export function useTextInspector() {
  const item = $derived(editor.textItems.find((candidate) => candidate.id === editor.selectedTextItemId) ?? null)

  const selectedItems = $derived(editor.selectedTextItemIds.flatMap((id) => {
    const selected = editor.textItems.find((candidate) => candidate.id === id)
    return selected ? [selected] : []
  }))

  const design = $derived(textDesignSize(editor.effectiveProjectAspect))

  const activeCell = $derived.by(() => {
    if (!item) return null
    let best: string | null = null
    let bestDistance = 90

    for (const cell of TEXT_POSITION_CELLS) {
      const center = textPositionCellCenter(item, cell, editor.effectiveProjectAspect)
      const distance = Math.hypot(center.x - item.x, center.y - item.y)

      if (distance < bestDistance) {
        bestDistance = distance
        best = cell.id
      }
    }

    return best
  })

  const value = (event: Event): string => (event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
  const updateActive = (patch: Partial<Omit<TextItem, 'id'>>): void => { if (item) editor.updateTextItem(item.id, patch) }

  const updateSelected = (patch: Partial<Omit<TextItem, 'id'>>): void => editor.withHistoryTransaction(() => {
    for (const selected of selectedItems) {
      editor.updateTextItem(selected.id, patch)
    }
  })

  const numberValue = (event: Event): number | null => {
    const parsed = Number(value(event))
    return Number.isFinite(parsed) ? parsed : null
  }

  const updateNumber = (key: 'start' | 'duration' | 'x' | 'y' | 'fontSize' | 'strokeWidth' | 'backgroundOpacity' | 'backgroundPadding' | 'backgroundRadius' | 'animationDuration' | 'rotation' | 'opacity' | 'highlightBackgroundOpacity') => (event: Event): void => {
    const parsed = numberValue(event)
    if (parsed !== null) (key === 'start' || key === 'duration' ? updateActive : updateSelected)({ [key]: parsed })
  }

  const updateValue = (key: keyof Omit<TextItem, 'id'>) => (event: Event): void => {
    setValue(key, value(event))
  }

  const setValue = (key: keyof Omit<TextItem, 'id'>, nextValue: string): void => {
    const next = key === 'isCaption' ? nextValue === 'caption' : nextValue
    updateSelected({ [key]: next } as Partial<Omit<TextItem, 'id'>>)
  }

  const updateText = (event: Event): void => updateActive({ text: value(event) })
  const beginHistory = (): void => editor.beginHistory()
  const endHistory = (): void => editor.endHistory()

  const toggleBackground = (): void => { if (item) updateSelected({ backgroundOpacity: item.backgroundOpacity > 0 ? 0 : 0.7 }) }
  const toggleBold = (): void => { if (item) updateSelected({ fontWeight: item.fontWeight === 700 ? 400 : 700 }) }
  const toggleItalic = (): void => { if (item) updateSelected({ italic: !item.italic }) }
  const applyCell = (cell: PositionCell): void => { if (item) updateSelected(textPositionCellCenter(item, cell, editor.effectiveProjectAspect)) }
  const applyCellFor = (cell: PositionCell) => (): void => applyCell(cell)
  const updateAlign = (align: TextAlign) => (): void => updateSelected({ align })

  return {
    editor,
    TEXT_POSITION_CELLS,
    TEXT_FONT_CATEGORIES,
    TEXT_FONTS,
    TEXT_ANIMATION_OPTIONS,
    WORD_ANIMATION_OPTIONS,
    value,
    updateText,
    updateValue,
    setValue,
    updateNumber,
    beginHistory,
    endHistory,
    toggleBackground,
    toggleBold,
    toggleItalic,
    applyCell,
    applyCellFor,
    updateAlign,
    get item() { return item },
    get selectedItems() { return selectedItems },
    get design() { return design },
    get activeCell() { return activeCell },
    get textAnimationOption() { return textAnimationOption },
    close: () => editor.selectTextItem(null),
  }
}
