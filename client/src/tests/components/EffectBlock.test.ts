import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import EffectBlock from '../../components/EffectBlock.svelte'
import { editor } from '../../stores/editor.svelte'

describe('EffectBlock', () => {
  beforeEach(() => {
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    editor.selectClip(null)
    editor.setPixelsPerSecond(40)
  })

  function addBlock(effectId = 'grayscale', start = 2, duration = 3) {
    return editor.addEffectBlock(editor.channels[0].id, effectId, start, duration)!
  }

  it('renders the effect label', () => {
    const block = addBlock()
    const { getByText } = render(EffectBlock, { block, laneIndex: 0 })
    expect(getByText('Grayscale')).toBeTruthy()
  })

  it('renders the lane index', () => {
    const block = addBlock()
    const { getByText } = render(EffectBlock, { block, laneIndex: 1 })
    expect(getByText('L2')).toBeTruthy()
  })

  it('visually joins matching preset effects across adjacent clips', () => {
    const channel = editor.channels[0]
    const first = editor.addClip(channel.id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 2, start: 0,
    })
    const second = editor.addClip(channel.id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 10,
      inPoint: 0, outPoint: 3, start: 2,
    })
    editor.applyClipLook(first.id, 'balanced-enhance')
    editor.applyClipLook(second.id, 'balanced-enhance')
    const blocks = editor.effectBlocks.filter((block) => block.effectId === 'denoise')
    const firstView = render(EffectBlock, { block: blocks[0], laneIndex: 0 })
    const secondView = render(EffectBlock, { block: blocks[1], laneIndex: 0 })

    expect(firstView.container.querySelector('.fxblock')).toHaveClass('preset-group-right')
    expect(secondView.container.querySelector('.fxblock')).toHaveClass('preset-group-left')
  })

  it('duration appears in the title attribute', () => {
    const block = addBlock('blur', 2, 3)
    const { container } = render(EffectBlock, { block, laneIndex: 0 })
    const el = container.querySelector('.fxblock') as HTMLElement
    expect(el.title).toContain('3.00s')
  })

  it('selects on single click but opens the inspector only on double click', async () => {
    const block = addBlock()
    const onOpenInspector = vi.fn()
    const { container } = render(EffectBlock, { block, laneIndex: 0, onOpenInspector })
    const el = container.querySelector('.fxblock') as HTMLElement

    await fireEvent.mouseDown(el, { button: 0 })
    await fireEvent.mouseUp(window)
    expect(editor.selectedEffectBlockIds).toContain(block.id)
    expect(onOpenInspector).not.toHaveBeenCalled()

    await fireEvent.dblClick(el)
    expect(onOpenInspector).toHaveBeenCalledTimes(1)
  })

  it('opens the inspector with Enter', async () => {
    const block = addBlock()
    const onOpenInspector = vi.fn()
    const { container } = render(EffectBlock, { block, laneIndex: 0, onOpenInspector })
    const el = container.querySelector('.fxblock') as HTMLElement

    await fireEvent.keyDown(el, { key: 'Enter' })
    expect(editor.selectedEffectBlockIds).toContain(block.id)
    expect(onOpenInspector).toHaveBeenCalledTimes(1)
  })

  it('draws the selected ramp curve inside the timeline block', () => {
    const block = addBlock('blur', 2, 3)
    editor.setEffectRamp([block.id], { mode: 'in', curve: 'ease-in-out', amount: 0.5 })
    const current = editor.effectBlocks.find((candidate) => candidate.id === block.id)!
    const { container } = render(EffectBlock, { block: current, laneIndex: 0 })
    const envelope = container.querySelector('.fx-envelope') as SVGElement
    const line = container.querySelector('.fx-envelope-line') as SVGPathElement

    expect(envelope.dataset.rampMode).toBe('in')
    expect(envelope.dataset.rampCurve).toBe('ease-in-out')
    expect(line.getAttribute('d')).toContain('M0.000,7.000')
    expect(line.getAttribute('d')).toContain('L100.000,1.000')
    expect((container.querySelector('.fxblock') as HTMLElement).title).toContain('Fade In / Ease In Out')
  })

  it('renders with correct position based on block start and pixelsPerSecond', () => {
    const block = addBlock('blur', 5, 2)
    const { container } = render(EffectBlock, { block, laneIndex: 0 })
    const el = container.querySelector('.fxblock') as HTMLElement
    expect(el).toBeTruthy()
    expect(el.style.left).toBe('200px')
    expect(el.style.width).toBe('80px')
  })

  it('shows a resize handle', () => {
    const block = addBlock()
    const { getByLabelText } = render(EffectBlock, { block, laneIndex: 0 })
    expect(getByLabelText('Resize effect range')).toBeTruthy()
  })

  it('clicking delete removes the effect block', async () => {
    const block = addBlock()
    const { getByTitle } = render(EffectBlock, { block, laneIndex: 0 })
    await fireEvent.click(getByTitle('Remove effect'))
    expect(editor.effectBlocks).toHaveLength(0)
  })

  it('does not move block when channel is locked', async () => {
    editor.toggleLock(editor.channels[0].id)
    const block = addBlock('blur', 3, 2)
    const originalStart = editor.effectBlocks.find((b) => b.id === block.id)!.start

    const { container } = render(EffectBlock, { block, laneIndex: 0 })
    const el = container.querySelector('.fxblock') as HTMLElement
    await fireEvent.mouseDown(el, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((b) => b.id === block.id)!.start).toBe(originalStart)
  })

  it('resize handle changes block duration on drag', async () => {
    const block = addBlock('sepia', 1, 2)
    const originalDur = editor.effectBlocks.find((b) => b.id === block.id)!.duration

    const { getByLabelText } = render(EffectBlock, { block, laneIndex: 0 })
    const resizeHandle = getByLabelText('Resize effect range')

    await fireEvent.mouseDown(resizeHandle, { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const newDur = editor.effectBlocks.find((b) => b.id === block.id)!.duration
    expect(newDur).toBeGreaterThan(originalDur)
    expect(newDur).toBeCloseTo(originalDur + 80 / editor.pixelsPerSecond, 1)
  })

  it('left resize handle changes the effect start and preserves its end', async () => {
    const block = addBlock('sepia', 2, 3)
    const { getByLabelText } = render(EffectBlock, { block, laneIndex: 0 })

    await fireEvent.mouseDown(getByLabelText('Resize effect start'), { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const resized = editor.effectBlocks.find((candidate) => candidate.id === block.id)!
    expect(resized.start).toBeCloseTo(3, 1)
    expect(resized.duration).toBeCloseTo(2, 1)
  })

  it('resizes every selected effect by the same delta', async () => {
    const first = addBlock('blur', 1, 2)
    const second = addBlock('sepia', 4, 3)
    editor.selectItems([], [first.id, second.id])
    const { getByLabelText } = render(EffectBlock, { block: first, laneIndex: 0 })

    await fireEvent.mouseDown(getByLabelText('Resize effect range'), { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === first.id)!.duration).toBeCloseTo(3)
    expect(editor.effectBlocks.find((block) => block.id === second.id)!.duration).toBeCloseTo(4)
  })

  it('dragging the block moves it on mouse move', async () => {
    const block = addBlock('blur', 3, 2)
    const originalStart = editor.effectBlocks.find((b) => b.id === block.id)!.start

    const { container } = render(EffectBlock, { block, laneIndex: 0 })
    const el = container.querySelector('.fxblock') as HTMLElement
    await fireEvent.mouseDown(el, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const newStart = editor.effectBlocks.find((b) => b.id === block.id)!.start
    expect(newStart).toBeGreaterThan(originalStart)
  })

  it('snaps a moved effect edge to another effect within 3px', async () => {
    addBlock('sepia', 2, 2)
    const moving = addBlock('blur', 6, 1)
    const { container } = render(EffectBlock, { block: moving, laneIndex: 0 })

    await fireEvent.mouseDown(container.querySelector('.fxblock')!, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 22 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === moving.id)!.start).toBeCloseTo(4)
  })

  it('snaps a resized effect edge to another effect within 3px', async () => {
    const resizing = addBlock('sepia', 1, 2)
    addBlock('blur', 4, 2)
    const { getByLabelText } = render(EffectBlock, { block: resizing, laneIndex: 0 })

    await fireEvent.mouseDown(getByLabelText('Resize effect range'), { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 38 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === resizing.id)!.duration).toBe(3)
  })

  it('snaps only the dragged left edge when the fixed right edge already matches a clip', async () => {
    editor.addClip(editor.channels[0].id, {
      fileName: 'first.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 0,
    })
    editor.addClip(editor.channels[0].id, {
      fileName: 'second.mp4', scrubBlobUrl: null, sourceDuration: 5,
      inPoint: 0, outPoint: 5, start: 5,
    })
    const resizing = addBlock('sepia', 6, 4)
    const { getByLabelText } = render(EffectBlock, { block: resizing, laneIndex: 0 })

    await fireEvent.mouseDown(getByLabelText('Resize effect start'), { clientX: 0 })
    await fireEvent.mouseMove(window, { clientX: -38 })
    await fireEvent.mouseUp(window)

    expect(editor.effectBlocks.find((block) => block.id === resizing.id)).toMatchObject({ start: 5, duration: 5 })
  })

  it('snaps a moved effect edge to the playhead within 3px', async () => {
    const moving = addBlock('blur', 6, 1)
    editor.setCurrentTime(5)
    const { container } = render(EffectBlock, { block: moving, laneIndex: 0 })

    await fireEvent.mouseDown(container.querySelector('.fxblock')!, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 58 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === moving.id)!.start).toBeCloseTo(5)
  })

  it('snaps a resized effect edge to the playhead within 3px', async () => {
    const resizing = addBlock('sepia', 1, 2)
    editor.setCurrentTime(4)
    const { getByLabelText } = render(EffectBlock, { block: resizing, laneIndex: 0 })

    await fireEvent.mouseDown(getByLabelText('Resize effect range'), { clientX: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 38 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === resizing.id)!.duration).toBe(3)
  })

  it('holding Alt disables playhead snapping so the block detaches', async () => {
    const moving = addBlock('blur', 6, 1)
    editor.setCurrentTime(5)
    const { container } = render(EffectBlock, { block: moving, laneIndex: 0 })

    await fireEvent.mouseDown(container.querySelector('.fxblock')!, { clientX: 100 })
    // Same drag as the snapping test, but with Alt held: must NOT snap to 5.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 58, altKey: true }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === moving.id)!.start).toBeCloseTo(4.95, 1)
    expect(editor.effectBlocks.find((block) => block.id === moving.id)!.start).not.toBeCloseTo(5, 2)
  })

  it('selects an effect and exposes its selected state', async () => {
    const block = addBlock()
    const { container } = render(EffectBlock, { block, laneIndex: 0 })
    const el = container.querySelector('.fxblock') as HTMLElement

    await fireEvent.mouseDown(el, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.selectedEffectBlockIds).toEqual([block.id])
    expect(el).toHaveClass('selected')
  })

  it('Ctrl-selects an effect together with a clip', async () => {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'test.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const block = addBlock()
    editor.selectClip(clip.id)
    const { container } = render(EffectBlock, { block, laneIndex: 0 })

    await fireEvent.mouseDown(container.querySelector('.fxblock')!, { ctrlKey: true, clientX: 100 })
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.selectedEffectBlockIds).toEqual([block.id])
  })

  it('dragging one selected effect moves all selected effects', async () => {
    const first = addBlock('blur', 1, 1)
    const second = addBlock('sepia', 4, 1)
    editor.selectItems([], [first.id, second.id])
    const { container } = render(EffectBlock, { block: first, laneIndex: 0 })

    await fireEvent.mouseDown(container.querySelector('.fxblock')!, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    expect(editor.effectBlocks.find((block) => block.id === first.id)!.start).toBe(3)
    expect(editor.effectBlocks.find((block) => block.id === second.id)!.start).toBe(6)
  })

  it('shows every selected effect in the drag preview', async () => {
    const first = addBlock('blur', 1, 1)
    const second = addBlock('sepia', 4, 1)
    editor.selectItems([], [first.id, second.id])
    const firstView = render(EffectBlock, { block: first, laneIndex: 0 })
    const secondView = render(EffectBlock, { block: second, laneIndex: 0 })
    const firstElement = firstView.container.querySelector('.fxblock') as HTMLElement
    const secondElement = secondView.container.querySelector('.fxblock') as HTMLElement

    await fireEvent.mouseDown(firstElement, { clientX: 100, clientY: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 160 }))
    await tick()

    expect(firstElement).toHaveClass('drag-preview')
    expect(secondElement).toHaveClass('drag-preview')
    expect(firstElement.style.transform).toBe('translateY(60px)')
    expect(secondElement.style.transform).toBe('translateY(60px)')

    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 160 }))
  })

  it('drops selected effects onto another video channel with a clip', async () => {
    const target = editor.addChannel('video')
    editor.addClip(target.id, {
      fileName: 'target.mp4',
      scrubBlobUrl: null,
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    const first = addBlock('blur', 1, 1)
    const second = addBlock('sepia', 3, 1)
    editor.selectItems([], [first.id, second.id])
    const targetElement = document.createElement('div')
    targetElement.dataset.timelineChannelId = target.id
    targetElement.dataset.channelType = 'video'
    targetElement.dataset.channelLocked = 'false'
    Object.defineProperty(targetElement, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 500, top: 150, bottom: 250, width: 500, height: 100 }),
    })
    document.body.appendChild(targetElement)
    const { container } = render(EffectBlock, { block: first, laneIndex: 0 })

    await fireEvent.mouseDown(container.querySelector('.fxblock')!, { clientX: 100, clientY: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 200 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 100, clientY: 200 }))

    expect(editor.effectBlocks.find((candidate) => candidate.id === first.id)!.channelId).toBe(target.id)
    expect(editor.effectBlocks.find((candidate) => candidate.id === second.id)!.channelId).toBe(target.id)
    targetElement.remove()
  })
})
