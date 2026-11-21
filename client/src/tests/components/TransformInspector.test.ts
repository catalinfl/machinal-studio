import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import { tick } from 'svelte'
import TransformInspector from '../../components/TransformInspector.svelte'
import { editor } from '../../stores/editor.svelte'

describe('TransformInspector', () => {
  beforeEach(() => {
    editor.clearSelection()
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.clearHistory()
  })

  function addSelectedVideo() {
    const clip = editor.addClip(editor.channels[0].id, {
      fileName: 'video.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 0,
    })
    editor.selectClip(clip.id)
    return clip
  }

  it('updates the selected clip position on X', async () => {
    const clip = addSelectedVideo()

    const { getByLabelText } = render(TransformInspector)

    await fireEvent.change(getByLabelText('Position X'), { target: { value: '25' } })

    expect(editor.getClipById(clip.id)?.clip.transform?.positionX).toBe(25)
  })

  it('retains an opened advanced section when synchronization replaces the selected clip object', async () => {
    addSelectedVideo()
    const { container, getByLabelText } = render(TransformInspector)
    const details = container.querySelector('details')!
    details.open = true
    await fireEvent(details, new Event('toggle'))
    await fireEvent.input(getByLabelText('Clip layer opacity'), { target: { value: '0.75' } })

    editor.channels[0].clips = editor.channels[0].clips.map(clip => ({ ...clip }))
    await tick()

    expect(details.open).toBe(true)
    expect(getByLabelText('Clip layer opacity')).toHaveValue('0.75')
  })

  it('defaults animated clips to expanded but preserves an explicit collapse through updates', async () => {
    const clip = addSelectedVideo()
    editor.setClipTransform(clip.id, {}, 0)
    const { container } = render(TransformInspector)
    await tick()
    const details = container.querySelector('details')!
    expect(details.open).toBe(true)
    details.open = false
    await fireEvent(details, new Event('toggle'))

    editor.channels[0].clips = editor.channels[0].clips.map(clip => ({ ...clip, transformKeyframes: [...(clip.transformKeyframes ?? [])] }))
    await tick()

    expect(details.open).toBe(false)
  })

  it('controls opacity and edge fades for an image layer', async () => {
    const clip = addSelectedVideo()
    clip.mediaKind = 'image'
    clip.fileName = 'b-roll.jpg'
    const { getByLabelText, getByText } = render(TransformInspector)

    expect(getByText('Image over image')).toBeInTheDocument()
    await fireEvent.input(getByLabelText('Clip layer opacity'), { target: { value: '0.65' } })
    await fireEvent.change(getByLabelText('Clip fade in'), { target: { value: '0.75' } })
    await fireEvent.change(getByLabelText('Clip fade out'), { target: { value: '1.25' } })

    expect(editor.getClipById(clip.id)?.clip).toMatchObject({
      opacity: 0.65,
      fadeIn: 0.75,
      fadeOut: 1.25,
    })
  })

  it('applies modern layer appearance presets with exportable keyframes', async () => {
    const clip = addSelectedVideo()
    const { getByLabelText } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Layer appearance Lift'))

    let updated = editor.getClipById(clip.id)!.clip
    expect(updated.layerEntrance).toBe('lift')
    expect(updated.fadeIn).toBe(0.5)
    expect(updated.transformKeyframes).toHaveLength(5)
    expect(updated.transformKeyframes?.[0].transform).toMatchObject({ positionY: 7, zoomX: 1.025, zoomY: 1.025 })
    expect(updated.transformKeyframes?.at(-1)).toMatchObject({ time: 5, transform: { positionY: 0, zoomX: 1, zoomY: 1 } })

    await fireEvent.change(getByLabelText('Clip fade in'), { target: { value: '0.8' } })
    updated = editor.getClipById(clip.id)!.clip
    expect(updated.transformKeyframes?.[3].time).toBe(0.8)
  })

  it('applies a disappearance preset without clearing the entrance', async () => {
    const clip = addSelectedVideo()
    const { getByLabelText } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Layer appearance Lift'))
    await fireEvent.click(getByLabelText('Layer disappearance Sink'))

    const updated = editor.getClipById(clip.id)!.clip
    expect(updated.layerEntrance).toBe('lift')
    expect(updated.layerExit).toBe('sink')
    expect(updated.fadeOut).toBe(0.5)
    expect(updated.transformKeyframes?.[0].transform).toMatchObject({ positionY: 7 })
    expect(updated.transformKeyframes?.at(-1)).toMatchObject({ time: 5, transform: { positionY: 7 } })
  })

  it('offers the expanded TikTok catalog and applies punch in', async () => {
    const clip = addSelectedVideo()
    const { getByLabelText, getByRole } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Transform motion preset'))
    expect(getByRole('button', { name: 'Punch in - Quick emphasis zoom' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Impact shake - Short hook shake' })).toBeInTheDocument()
    expect(getByRole('button', { name: 'Drift - Edge-safe camera glide' })).toBeInTheDocument()

    await fireEvent.click(getByRole('button', { name: 'Punch in - Quick emphasis zoom' }))

    const keyframes = editor.getClipById(clip.id)?.clip.transformKeyframes ?? []
    expect(keyframes).toHaveLength(5)
    expect(keyframes[3]).toMatchObject({ time: 0.32, transform: { zoomX: 1.14, zoomY: 1.14 } })
    expect(keyframes.at(-1)).toMatchObject({ time: 5, transform: { zoomX: 1.14, zoomY: 1.14 } })
  })

  it('updates the same transform value on every preset keyframe by default', async () => {
    const clip = addSelectedVideo()
    editor.setCurrentTime(0)
    const { getByLabelText, getByRole } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Transform motion preset'))
    await fireEvent.click(getByRole('button', { name: 'Punch in - Quick emphasis zoom' }))
    await tick()

    expect(getByRole('button', { name: 'Edit one keyframe' })).toHaveAttribute('aria-pressed', 'false')
    await fireEvent.change(getByLabelText('Position X'), { target: { value: '10' } })

    const updated = editor.getClipById(clip.id)!.clip
    expect(updated.transformKeyframes).toHaveLength(5)
    expect(updated.transformKeyframes?.every((keyframe) => keyframe.transform.positionX === 10)).toBe(true)
    expect(updated.motionPreset).toBeUndefined()
  })

  it('updates only the keyframe at the playhead when single-keyframe editing is active', async () => {
    const clip = addSelectedVideo()
    editor.setCurrentTime(0)
    const { getByLabelText, getByRole } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Transform motion preset'))
    await fireEvent.click(getByRole('button', { name: 'Punch in - Quick emphasis zoom' }))
    await fireEvent.click(getByRole('button', { name: 'Edit one keyframe' }))
    editor.setCurrentTime(0.32)
    await tick()
    await fireEvent.change(getByLabelText('Position X'), { target: { value: '10' } })

    const keyframes = editor.getClipById(clip.id)!.clip.transformKeyframes ?? []
    expect(keyframes).toHaveLength(5)
    expect(keyframes.find((keyframe) => keyframe.time === 0.32)?.transform.positionX).toBe(10)
    expect(keyframes.filter((keyframe) => keyframe.time !== 0.32).every((keyframe) => keyframe.transform.positionX === 0)).toBe(true)
  })

  it('keeps the applied preset selected after switching to another clip', async () => {
    const clip = addSelectedVideo()
    const otherClip = editor.addClip(editor.channels[0].id, {
      fileName: 'other.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 6,
    })
    const { getByLabelText, getByRole } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Transform motion preset'))
    await fireEvent.click(getByRole('button', { name: 'Punch in - Quick emphasis zoom' }))
    expect(getByLabelText('Transform motion preset')).toHaveAttribute('data-value', 'punch')

    editor.selectClip(otherClip.id)
    editor.selectClip(clip.id)
    await tick()

    expect(getByLabelText('Transform motion preset')).toHaveAttribute('data-value', 'punch')
    expect(editor.getClipById(clip.id)?.clip.motionPreset).toBe('punch')
  })

  it('recognizes an existing animated preset when its label state is missing', async () => {
    const clip = addSelectedVideo()
    const otherClip = editor.addClip(editor.channels[0].id, {
      fileName: 'other.mp4',
      scrubBlobUrl: null,
      sourceDuration: 5,
      inPoint: 0,
      outPoint: 5,
      start: 6,
    })
    const { getByLabelText, getByRole } = render(TransformInspector)

    await fireEvent.click(getByLabelText('Transform motion preset'))
    await fireEvent.click(getByRole('button', { name: 'Punch in - Quick emphasis zoom' }))
    clip.motionPreset = undefined

    editor.selectClip(otherClip.id)
    editor.selectClip(clip.id)
    await tick()

    expect(getByLabelText('Transform motion preset')).toHaveAttribute('data-value', 'punch')
  })
})
