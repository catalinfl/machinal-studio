import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import TextBlock from '../../components/TextBlock.svelte'
import { editor } from '../../stores/editor.svelte'

describe('TextBlock', () => {
  beforeEach(() => {
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    editor.clearSelection()
    editor.setPixelsPerSecond(40)
  })

  it('renders left/right resize handles with snap', () => {
    const first = editor.addTextItem(1, { duration: 2 })
    const { container } = render(TextBlock, { item: first, laneIndex: 0 })

    expect(container.querySelector('[aria-label="Resize text start"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Resize text end"]')).not.toBeNull()
  })

  it('resizes every selected text item by the same delta', async () => {
    const first = editor.addTextItem(1, { duration: 2 })
    const second = editor.addTextItem(4, { duration: 3 })
    editor.selectItems([], [], [first.id, second.id])
    const { getByLabelText } = render(TextBlock, { item: first, laneIndex: 0 })

    await fireEvent.mouseDown(getByLabelText('Resize text end'), { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.textItems.find((item) => item.id === first.id)!.duration).toBeCloseTo(3)
    expect(editor.textItems.find((item) => item.id === second.id)!.duration).toBeCloseTo(4)
  })

  it('snaps the resized right edge to the playhead', async () => {
    editor.setCurrentTime(3)
    const first = editor.addTextItem(1, { duration: 2 })
    const { getByLabelText } = render(TextBlock, { item: first, laneIndex: 0 })

    // end = 3s is the playhead. Drag to 2px before it -> must snap to 3s.
    await fireEvent.mouseDown(getByLabelText('Resize text end'), { clientX: 120 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 118 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.textItems.find((item) => item.id === first.id)!.duration).toBeCloseTo(2)
  })

  it('selects on single click but opens the inspector only on double click', async () => {
    const first = editor.addTextItem(1, { duration: 2, text: 'Hello' })
    const onOpenInspector = vi.fn()
    const { container } = render(TextBlock, { item: first, laneIndex: 0, onOpenInspector })
    const el = container.querySelector('.text-block') as HTMLElement

    await fireEvent.mouseDown(el, { button: 0 })
    await fireEvent.mouseUp(window)
    expect(editor.selectedTextItemIds).toContain(first.id)
    expect(onOpenInspector).not.toHaveBeenCalled()

    await fireEvent.dblClick(el)
    expect(onOpenInspector).toHaveBeenCalledTimes(1)
  })

  it('opens the inspector with Enter', async () => {
    const first = editor.addTextItem(1, { duration: 2, text: 'Hello' })
    const onOpenInspector = vi.fn()
    const { container } = render(TextBlock, { item: first, laneIndex: 0, onOpenInspector })

    await fireEvent.keyDown(container.querySelector('.text-block') as HTMLElement, { key: 'Enter' })
    expect(editor.selectedTextItemIds).toContain(first.id)
    expect(onOpenInspector).toHaveBeenCalledTimes(1)
  })

  it('renders only the text label without badge or delete button', () => {
    const first = editor.addTextItem(1, { duration: 2, text: 'Hello' })
    const { container } = render(TextBlock, { item: first, laneIndex: 0 })

    expect(container.querySelector('.text-block .name')?.textContent).toBe('Hello')
    expect(container.querySelector('.text-block .kind')).toBeNull()
    expect(container.querySelector('.text-block button')).toBeNull()
    expect(container.querySelector('[aria-label="Remove text"]')).toBeNull()
  })
})
