import { describe, it, expect, beforeEach } from 'vitest'
import { clipEnd, editor, type Clip, maxTransitionOverlap, packEffectLanes } from '../../stores/editor.svelte'

function baseClip(over: Partial<Clip> = {}): Omit<Clip, 'id'> {
  return {
    fileName: 'test.mp4',
    scrubBlobUrl: null,
    sourceDuration: 10,
    inPoint: 0,
    outPoint: 5,
    start: 0,
    ...over,
  }
}

describe('editor store', () => {
  beforeEach(() => {
    while (editor.textItems.length > 0) editor.removeTextItem(editor.textItems[0].id)
    while (editor.channels.length > 0) editor.removeChannel(editor.channels[0].id)
    editor.addChannel('video')
    editor.addChannel('audio')
    while (editor.transitions.length > 0) editor.removeTransition(editor.transitions[0].id)
    editor.selectClip(null)
    editor.resetProjectAspect()
    editor.setResolution('1080p')
    editor.clearHistory()
  })

  it('starts with two empty channels', () => {
    expect(editor.channels).toHaveLength(2)
    expect(editor.totalDuration).toBe(0)
  })

  it('addChannel adds a channel with a correct name', () => {
    editor.addChannel('video')
    const last = editor.channels[editor.channels.length - 1]
    expect(last.type).toBe('video')
    expect(last.name).toContain('Video')
    expect(last.clips).toEqual([])
  })

  it('removeChannel removes the channel', () => {
    const id = editor.channels[0].id
    editor.removeChannel(id)
    expect(editor.channels.find((c) => c.id === id)).toBeUndefined()
  })

  it('toggleMute/toggleHidden/toggleLock toggle state', () => {
    const id = editor.channels[0].id
    expect(editor.channels[0].muted).toBe(false)
    editor.toggleMute(id)
    expect(editor.channels[0].muted).toBe(true)
    editor.toggleHidden(id)
    expect(editor.channels[0].hidden).toBe(true)
    editor.toggleLock(id)
    expect(editor.channels[0].locked).toBe(true)
  })

  it('addClip adds a clip and sorts by start', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ start: 5 }))
    const c2 = editor.addClip(id, baseClip({ start: 2 }))
    expect(editor.channels[0].clips[0].start).toBe(2)
    expect(editor.channels[0].clips[1].start).toBe(5)
    expect(c2.id).toContain('clip')
  })

  it('addClip throws on missing channel', () => {
    expect(() => editor.addClip('nope', baseClip())).toThrow('not found')
  })

  it('stores clamped visual compositing and keeps fades on the outer split edges', () => {
    const clip = editor.addClip(editor.channels[0].id, baseClip({ mediaKind: 'image' }))

    expect(editor.setClipCompositing(clip.id, { opacity: 1.5, fadeIn: 1, fadeOut: 2 })).toBe(true)
    expect(editor.getClipById(clip.id)?.clip).toMatchObject({ opacity: 1, fadeIn: 1, fadeOut: 2 })

    const right = editor.splitClip(clip.id, 2)!
    expect(editor.getClipById(clip.id)?.clip).toMatchObject({ fadeIn: 1, fadeOut: 0 })
    expect(editor.getClipById(right.id)?.clip).toMatchObject({ fadeIn: 0, fadeOut: 2 })
  })

  it('totalDuration reflects the longest clip', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ inPoint: 0, outPoint: 3, start: 0 }))
    expect(editor.totalDuration).toBe(3)
    editor.addClip(id, baseClip({ inPoint: 0, outPoint: 7, start: 5 }))
    expect(editor.totalDuration).toBeCloseTo(12)
  })

  describe('playback speed', () => {
    it('shortens a video and its linked audio together', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip())
      const audio = editor.addClip(editor.channels[1].id, baseClip())
      video.linkedClipId = audio.id
      audio.linkedClipId = video.id

      expect(editor.setClipPlaybackRate(video.id, 2)).toBe(true)

      expect(editor.getClipById(video.id)!.clip.playbackRate).toBe(2)
      expect(editor.getClipById(audio.id)!.clip.playbackRate).toBe(2)
      expect(editor.totalDuration).toBe(2.5)
      expect(editor.getActiveClipsAt(2.49)).toHaveLength(2)
      expect(editor.getActiveClipsAt(2.5)).toHaveLength(0)
    })

    it('does not change a linked pair when either track is locked', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip())
      const audio = editor.addClip(editor.channels[1].id, baseClip())
      video.linkedClipId = audio.id
      audio.linkedClipId = video.id
      editor.toggleLock(editor.channels[1].id)

      expect(editor.setClipPlaybackRate(video.id, 2)).toBe(false)
      expect(editor.getClipById(video.id)!.clip.playbackRate).toBeUndefined()
      expect(editor.getClipById(audio.id)!.clip.playbackRate).toBeUndefined()
    })

    it('converts trim and split positions from timeline time to source time', () => {
      const clip = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 8, playbackRate: 2 }))

      editor.trimClip(clip.id, 'left', 1)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(1)
      expect(editor.getClipById(clip.id)!.clip.inPoint).toBe(2)

      const second = editor.splitClip(clip.id, 2)
      expect(editor.getClipById(clip.id)!.clip.outPoint).toBe(4)
      expect(second?.inPoint).toBe(4)
      expect(second?.playbackRate).toBe(2)
    })

    it('preserves playback speed through copy and paste', () => {
      const clip = editor.addClip(editor.channels[0].id, baseClip({ playbackRate: 2 }))
      editor.selectClip(clip.id)
      editor.copySelectedClips()

      const [pasted] = editor.pasteCopiedClips(4)
      expect(pasted.playbackRate).toBe(2)
      expect(pasted.start).toBe(4)
    })
  })

  it('removeClip removes the clip', () => {
    const id = editor.channels[0].id
    const c = editor.addClip(id, baseClip())
    editor.removeClip(id, c.id)
    expect(editor.channels[0].clips).toHaveLength(0)
  })

  it('playhead lands at the last clip end when deleting clips leaves it ahead', () => {
    const channelId = editor.channels[0].id
    const short = editor.addClip(channelId, baseClip({ outPoint: 4, start: 0 }))
    const longest = editor.addClip(channelId, baseClip({ outPoint: 10, start: 4 }))
    editor.addClip(channelId, baseClip({ outPoint: 2, start: 14 }))
    editor.setCurrentTime(20)

    editor.removeClip(channelId, longest.id)

    expect(editor.getClipById(short.id)!.clip.start).toBe(0)
    expect(editor.currentTime).toBe(6)
  })

  it('playhead lands at the last clip end after a ripple-delete', () => {
    const channelId = editor.channels[0].id
    const first = editor.addClip(channelId, baseClip({ outPoint: 2, start: 0 }))
    const longest = editor.addClip(channelId, baseClip({ outPoint: 6, start: 2 }))
    editor.addClip(channelId, baseClip({ outPoint: 2, start: 8 }))
    editor.setCurrentTime(15)

    editor.removeClip(channelId, first.id)

    expect(editor.getClipById(longest.id)!.clip.start).toBe(0)
    expect(editor.currentTime).toBe(8)
  })

  it('playhead stays put when a left drag does not move the last clip end past it', () => {
    const channelId = editor.channels[0].id
    editor.addClip(channelId, baseClip({ outPoint: 4, start: 0 }))
    const longest = editor.addClip(channelId, baseClip({ outPoint: 6, start: 4 }))
    editor.setCurrentTime(8)

    editor.moveClip(channelId, longest.id, 2)

    const moved = editor.getClipById(longest.id)!.clip.start
    expect(moved).toBeLessThan(4)
    expect(editor.currentTime).toBe(8)
  })

  it('playhead stays put when the deleted clip is not the longest', () => {
    const channelId = editor.channels[0].id
    editor.addClip(channelId, baseClip({ outPoint: 10, start: 0 }))
    const short = editor.addClip(channelId, baseClip({ outPoint: 2, start: 10 }))
    editor.setCurrentTime(3)

    editor.removeClip(channelId, short.id)

    expect(editor.currentTime).toBe(3)
  })

  it('playhead does not move when a non-longest clip is dragged', () => {
    const channelId = editor.channels[0].id
    const short = editor.addClip(channelId, baseClip({ outPoint: 2, start: 0 }))
    editor.addClip(channelId, baseClip({ outPoint: 10, start: 2 }))
    editor.setCurrentTime(4)

    editor.moveClip(channelId, short.id, 0)

    expect(editor.currentTime).toBe(4)
  })

  it('playhead resets to 0 when the longest clip was the only clip', () => {
    const channelId = editor.channels[0].id
    const only = editor.addClip(channelId, baseClip())
    editor.setCurrentTime(8)

    editor.removeClip(channelId, only.id)

    expect(editor.currentTime).toBe(0)
  })

  it('playhead lands on the end of the last remaining clip when it was past it', () => {
    const channelId = editor.channels[0].id
    const only = editor.addClip(channelId, baseClip({ outPoint: 3 }))
    const longest = editor.addClip(channelId, baseClip({ outPoint: 10, start: 3 }))
    editor.setCurrentTime(11)

    editor.removeClip(channelId, longest.id)

    expect(editor.getClipById(only.id)!.clip.start).toBe(0)
    expect(editor.currentTime).toBe(3)
  })

  it('playhead stays put when it is not past the last clip', () => {
    const channelId = editor.channels[0].id
    const only = editor.addClip(channelId, baseClip({ outPoint: 3 }))
    const longest = editor.addClip(channelId, baseClip({ outPoint: 10, start: 3 }))
    editor.setCurrentTime(2)

    editor.removeClip(channelId, longest.id)

    expect(editor.currentTime).toBe(2)
  })

  it('clamps after deleting a non-longest clip when it was the last clip', () => {
    const channelId = editor.channels[0].id
    editor.addClip(channelId, baseClip({ outPoint: 5, start: 0 }))
    const last = editor.addClip(channelId, baseClip({ outPoint: 2, start: 5 }))
    editor.setCurrentTime(8)

    editor.removeClip(channelId, last.id)

    expect(editor.currentTime).toBe(5)
  })

  it('clamps after moving the last clip left when the playhead is ahead', () => {
    const channelId = editor.channels[0].id
    editor.addClip(channelId, baseClip({ outPoint: 5, start: 0 }))
    const last = editor.addClip(channelId, baseClip({ outPoint: 2, start: 6 }))
    editor.setCurrentTime(9)

    editor.moveClip(channelId, last.id, 5)

    expect(editor.currentTime).toBe(7)
  })

  it('ripple-deletes a clip and moves later clips left', () => {
    const channelId = editor.channels[0].id
    editor.addClip(channelId, baseClip({ outPoint: 2, start: 0 }))
    const removed = editor.addClip(channelId, baseClip({ outPoint: 5, start: 2 }))
    const later = editor.addClip(channelId, baseClip({ outPoint: 3, start: 7 }))

    editor.removeClip(channelId, removed.id)

    expect(editor.getClipById(later.id)!.clip.start).toBe(2)
  })

  it('ripple-deletes linked video and audio clips together', () => {
    const video = editor.channels[0]
    const audio = editor.channels[1]
    const removedVideo = editor.addClip(video.id, baseClip({ outPoint: 2, start: 2 }))
    const removedAudio = editor.addClip(audio.id, baseClip({ outPoint: 2, start: 2 }))
    const laterVideo = editor.addClip(video.id, baseClip({ outPoint: 2, start: 4 }))
    const laterAudio = editor.addClip(audio.id, baseClip({ outPoint: 2, start: 4 }))
    removedVideo.linkedClipId = removedAudio.id
    removedAudio.linkedClipId = removedVideo.id

    editor.removeClip(video.id, removedVideo.id)

    expect(editor.getClipById(laterVideo.id)!.clip.start).toBe(2)
    expect(editor.getClipById(laterAudio.id)!.clip.start).toBe(2)
  })

  it('undo restores the original positions after a ripple delete', () => {
    const channelId = editor.channels[0].id
    const removed = editor.addClip(channelId, baseClip({ outPoint: 2, start: 2 }))
    const later = editor.addClip(channelId, baseClip({ outPoint: 2, start: 4 }))
    editor.clearHistory()

    editor.removeClip(channelId, removed.id)
    expect(editor.getClipById(later.id)!.clip.start).toBe(2)

    expect(editor.undo()).toBe(true)
    expect(editor.getClipById(removed.id)).not.toBeNull()
    expect(editor.getClipById(later.id)!.clip.start).toBe(4)
  })

  it('keeps clip order when ripple-deleting the first clip in a transition chain', () => {
    const channel = editor.channels[0]
    const first = editor.addClip(channel.id, baseClip({ start: 0 }))
    const second = editor.addClip(channel.id, baseClip({ start: 4 }))
    const third = editor.addClip(channel.id, baseClip({ start: 8 }))
    editor.addTransition(channel.id, first.id, second.id, 'cross-dissolve', 1)
    const survivingTransition = editor.addTransition(channel.id, second.id, third.id, 'wipe-left', 1)!

    editor.removeClip(channel.id, first.id)

    expect(channel.clips.map((clip) => clip.id)).toEqual([second.id, third.id])
    expect(channel.clips.map((clip) => clip.start)).toEqual([0, 4])
    expect(editor.transitions).toEqual([survivingTransition])
  })

  it('keeps clip order when ripple-deleting the middle clip in a transition chain', () => {
    const channel = editor.channels[0]
    const first = editor.addClip(channel.id, baseClip({ start: 0 }))
    const second = editor.addClip(channel.id, baseClip({ start: 4 }))
    const third = editor.addClip(channel.id, baseClip({ start: 8 }))
    const fourth = editor.addClip(channel.id, baseClip({ start: 12 }))
    editor.addTransition(channel.id, first.id, second.id, 'cross-dissolve', 1)
    editor.addTransition(channel.id, second.id, third.id, 'wipe-left', 1)
    const survivingTransition = editor.addTransition(channel.id, third.id, fourth.id, 'wipe-right', 1)!

    editor.removeClip(channel.id, second.id)

    expect(channel.clips.map((clip) => clip.id)).toEqual([first.id, third.id, fourth.id])
    expect(channel.clips.map((clip) => clip.start)).toEqual([0, 4, 8])
    expect(editor.transitions).toEqual([survivingTransition])
  })

  describe('history', () => {
    it('undoes and redoes an edit', () => {
      const channelId = editor.channels[0].id
      const clip = editor.addClip(channelId, baseClip())
      editor.clearHistory()

      editor.moveClip(channelId, clip.id, 3)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(3)

      expect(editor.undo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(0)
      expect(editor.redo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(3)
    })

    it('groups a drag transaction into one undo step', () => {
      const channelId = editor.channels[0].id
      const clip = editor.addClip(channelId, baseClip())
      editor.clearHistory()

      editor.beginHistory()
      editor.moveClip(channelId, clip.id, 1)
      editor.moveClip(channelId, clip.id, 2)
      editor.moveClip(channelId, clip.id, 3)
      editor.endHistory()

      expect(editor.undo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(0)
      expect(editor.undo()).toBe(false)
    })

    it('undoes and redoes clip volume changes', () => {
      const clip = editor.addClip(editor.channels[1].id, baseClip())
      editor.clearHistory()

      editor.beginHistory()
      editor.setClipVolume(clip.id, 50)
      editor.setClipVolume(clip.id, 0)
      editor.endHistory()

      expect(editor.getClipById(clip.id)!.clip.volume).toBe(0)
      expect(editor.undo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.volume).toBeUndefined()
      expect(editor.redo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.volume).toBe(0)
    })

    it('undoes an edit even if its drag transaction did not receive mouseup', () => {
      const channelId = editor.channels[0].id
      const clip = editor.addClip(channelId, baseClip())
      editor.clearHistory()

      editor.beginHistory()
      editor.moveClip(channelId, clip.id, 3)

      expect(editor.undo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(0)
      expect(editor.redo()).toBe(true)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(3)
    })

    it('clears redo after a new edit', () => {
      const channelId = editor.channels[0].id
      const clip = editor.addClip(channelId, baseClip())
      editor.clearHistory()

      editor.moveClip(channelId, clip.id, 2)
      editor.undo()
      editor.trimClip(clip.id, 'right', -1)

      expect(editor.redo()).toBe(false)
      expect(editor.getClipById(clip.id)!.clip.outPoint).toBe(4)
    })

    it('restores deleted clips and their selection', () => {
      const channelId = editor.channels[0].id
      const clip = editor.addClip(channelId, baseClip())
      editor.selectClip(clip.id)
      editor.clearHistory()

      editor.removeSelectedClips()
      expect(editor.getClipById(clip.id)).toBeNull()

      editor.undo()
      expect(editor.getClipById(clip.id)).not.toBeNull()
      expect(editor.selectedClipIds).toEqual([clip.id])
    })

    it('toggles the link between two selected clips', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip())
      const audio = editor.addClip(editor.channels[1].id, baseClip())
      editor.selectClips([video.id, audio.id])

      expect(editor.toggleLinkSelectedClips()).toBe(true)
      expect(editor.getClipById(video.id)!.clip.linkedClipId).toBe(audio.id)
      expect(editor.toggleLinkSelectedClips()).toBe(true)
      expect(editor.getClipById(video.id)!.clip.linkedClipId).toBeUndefined()
    })

    it('unlinks a linked pair when only one clip is selected', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip())
      const audio = editor.addClip(editor.channels[1].id, baseClip())
      editor.selectClips([video.id, audio.id])
      editor.toggleLinkSelectedClips()
      editor.selectClip(video.id)

      expect(editor.toggleLinkSelectedClips()).toBe(true)
      expect(editor.getClipById(video.id)!.clip.linkedClipId).toBeUndefined()
      expect(editor.getClipById(audio.id)!.clip.linkedClipId).toBeUndefined()
    })
  })

  it('moveClip passes a neighbour after crossing it and still respects lock', () => {
    const id = editor.channels[0].id
    const first = editor.addClip(id, baseClip({ start: 10 })) // [10,15)
    const c2 = editor.addClip(id, baseClip({ start: 5 })) // [5,10)
    const findClip = (cid: string) =>
      editor.channels[0].clips.find((c) => c.id === cid)!
    expect(findClip(c2.id).start).toBe(5)
    expect(editor.channels[0].clips[0].id).toBe(c2.id)
    // Dragging beyond the neighbour's midpoint moves the clip to its right.
    editor.moveClip(id, c2.id, 15)
    expect(findClip(c2.id).start).toBe(15)
    expect(editor.channels[0].clips[0].id).toBe(first.id)
    expect(editor.channels[0].clips[1].id).toBe(c2.id)
    editor.toggleLock(id)
    editor.moveClip(id, c2.id, 999)
    expect(findClip(c2.id).start).toBe(15)
  })

  it('moveClip clamps to non-negative start', () => {
    const id = editor.channels[0].id
    const c = editor.addClip(id, baseClip({ start: 0 }))
    editor.moveClip(id, c.id, -100)
    expect(c.start).toBe(0)
  })

  it('moves a clip to another channel of the same type', () => {
    const source = editor.channels[0]
    editor.addChannel('video')
    const target = editor.channels.find((ch) => ch.type === 'video' && ch.id !== source.id)!
    const clip = editor.addClip(source.id, baseClip())

    expect(editor.moveClipToChannel(source.id, target.id, clip.id)).toBe(true)
    expect(source.clips).toHaveLength(0)
    expect(target.clips[0].id).toBe(clip.id)
  })

  it('uses the requested start after a source-channel collision during transfer', () => {
    const source = editor.channels[0]
    const target = editor.addChannel('video')
    editor.addClip(source.id, baseClip({ start: 0 }))
    const moving = editor.addClip(source.id, baseClip({ start: 8 }))

    editor.moveClip(source.id, moving.id, 0)
    expect(editor.getClipById(moving.id)!.clip.start).toBeGreaterThan(0)

    expect(editor.moveClipToChannel(source.id, target.id, moving.id, 0)).toBe(true)
    expect(editor.getClipById(moving.id)!.channel.id).toBe(target.id)
    expect(editor.getClipById(moving.id)!.clip.start).toBe(0)
  })

  it('moves linked audio below the target video and creates the channel when missing', () => {
    const sourceVideo = editor.channels[0]
    const sourceAudio = editor.channels[1]
    const targetVideo = editor.addChannel('video')
    const video = editor.addClip(sourceVideo.id, baseClip({ start: 4 }))
    const audio = editor.addClip(sourceAudio.id, baseClip({ start: 4 }))
    editor.selectClips([video.id, audio.id])
    editor.toggleLinkSelectedClips()

    expect(editor.moveClipToChannel(sourceVideo.id, targetVideo.id, video.id, 1)).toBe(true)

    const targetIndex = editor.channels.findIndex((channel) => channel.id === targetVideo.id)
    const targetAudio = editor.channels[targetIndex + 1]
    expect(targetAudio.type).toBe('audio')
    expect(editor.getClipById(video.id)!.channel.id).toBe(targetVideo.id)
    expect(editor.getClipById(audio.id)!.channel.id).toBe(targetAudio.id)
    expect(editor.getClipById(video.id)!.clip.start).toBe(1)
    expect(editor.getClipById(audio.id)!.clip.start).toBe(1)
    expect(editor.getClipById(video.id)!.clip.linkedClipId).toBe(audio.id)
    expect(editor.getClipById(audio.id)!.clip.linkedClipId).toBe(video.id)
  })

  it('moves multiple selected clips to another channel as a rigid group', () => {
    const source = editor.channels[0]
    const target = editor.addChannel('video')
    const first = editor.addClip(source.id, baseClip({ outPoint: 2, start: 1 }))
    const second = editor.addClip(source.id, baseClip({ outPoint: 2, start: 4 }))

    expect(editor.moveClipsToChannel(
      source.id,
      target.id,
      [first.id, second.id],
      first.id,
      10,
    )).toBe(true)

    expect(source.clips).toHaveLength(0)
    expect(editor.getClipById(first.id)!.channel.id).toBe(target.id)
    expect(editor.getClipById(second.id)!.channel.id).toBe(target.id)
    expect(editor.getClipById(first.id)!.clip.start).toBe(10)
    expect(editor.getClipById(second.id)!.clip.start).toBe(13)
  })

  it('preserves separate source tracks when moving a multi-track selection', () => {
    const firstSource = editor.channels[0]
    const secondSource = editor.addChannel('video')
    const firstTarget = editor.addChannel('video')
    const secondTarget = editor.addChannel('video')
    const first = editor.addClip(firstSource.id, baseClip({ start: 0 }))
    const second = editor.addClip(secondSource.id, baseClip({ start: 0 }))

    expect(editor.moveClipsToChannel(
      firstSource.id,
      firstTarget.id,
      [first.id, second.id],
      first.id,
    )).toBe(true)

    expect(editor.getClipById(first.id)!.channel.id).toBe(firstTarget.id)
    expect(editor.getClipById(second.id)!.channel.id).toBe(secondTarget.id)
    expect(editor.channels.find((channel) => channel.id === firstTarget.id)!.clips.map((clip) => clip.id))
      .toEqual([first.id])
    expect(editor.channels.find((channel) => channel.id === secondTarget.id)!.clips.map((clip) => clip.id))
      .toEqual([second.id])
  })

  it('creates missing destination tracks for a multi-track selection', () => {
    const firstSource = editor.channels[0]
    const secondSource = editor.addChannel('video')
    const target = editor.addChannel('video')
    const first = editor.addClip(firstSource.id, baseClip({ start: 0 }))
    const second = editor.addClip(secondSource.id, baseClip({ start: 0 }))
    const channelIdsBefore = new Set(editor.channels.map((channel) => channel.id))

    expect(editor.moveClipsToChannel(
      firstSource.id,
      target.id,
      [first.id, second.id],
      first.id,
    )).toBe(true)

    const created = editor.channels.filter((channel) => !channelIdsBefore.has(channel.id))
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe('video')
    expect(editor.getClipById(first.id)!.channel.id).toBe(target.id)
    expect(editor.getClipById(second.id)!.channel.id).toBe(created[0].id)
  })

  it('creates one new destination track per source track in the new-track zone', () => {
    const firstSource = editor.channels[0]
    const secondSource = editor.addChannel('video')
    const first = editor.addClip(firstSource.id, baseClip({ start: 0 }))
    const second = editor.addClip(secondSource.id, baseClip({ start: 0 }))
    const channelIdsBefore = new Set(editor.channels.map((channel) => channel.id))

    expect(editor.moveClipsToChannel(
      firstSource.id,
      null,
      [first.id, second.id],
      first.id,
    )).toBe(true)

    const created = editor.channels.filter((channel) => !channelIdsBefore.has(channel.id))
    expect(created).toHaveLength(2)
    expect(created.every((channel) => channel.type === 'video')).toBe(true)
    expect(editor.getClipById(first.id)!.channel.id).toBe(created[0].id)
    expect(editor.getClipById(second.id)!.channel.id).toBe(created[1].id)
    expect(created.map((channel) => channel.clips.length)).toEqual([1, 1])
  })

  it('moves selected unlinked video and audio tracks together', () => {
    const sourceVideo = editor.channels[0]
    const sourceAudio = editor.channels[1]
    const targetVideo = editor.addChannel('video')
    const targetAudio = editor.addChannel('audio')
    const video = editor.addClip(sourceVideo.id, baseClip())
    const audio = editor.addClip(sourceAudio.id, baseClip())

    expect(editor.moveClipsToChannel(
      sourceVideo.id,
      targetVideo.id,
      [video.id, audio.id],
      video.id,
    )).toBe(true)

    expect(editor.getClipById(video.id)!.channel.id).toBe(targetVideo.id)
    expect(editor.getClipById(audio.id)!.channel.id).toBe(targetAudio.id)
  })

  it('creates matching new tracks for a mixed unlinked selection', () => {
    const sourceVideo = editor.channels[0]
    const sourceAudio = editor.channels[1]
    const video = editor.addClip(sourceVideo.id, baseClip())
    const audio = editor.addClip(sourceAudio.id, baseClip())
    const channelIdsBefore = new Set(editor.channels.map((channel) => channel.id))

    expect(editor.moveClipsToChannel(
      sourceVideo.id,
      null,
      [video.id, audio.id],
      video.id,
    )).toBe(true)

    const created = editor.channels.filter((channel) => !channelIdsBefore.has(channel.id))
    expect(created.map((channel) => channel.type)).toEqual(['video', 'audio'])
    expect(editor.getClipById(video.id)!.channel.id).toBe(created[0].id)
    expect(editor.getClipById(audio.id)!.channel.id).toBe(created[1].id)
  })

  it('moves linked partners for every selected video clip to the target track pair', () => {
    const sourceVideo = editor.channels[0]
    const sourceAudio = editor.channels[1]
    const targetVideo = editor.addChannel('video')
    const firstVideo = editor.addClip(sourceVideo.id, baseClip({ outPoint: 2, start: 0 }))
    const secondVideo = editor.addClip(sourceVideo.id, baseClip({ outPoint: 2, start: 3 }))
    const firstAudio = editor.addClip(sourceAudio.id, baseClip({ outPoint: 2, start: 0 }))
    const secondAudio = editor.addClip(sourceAudio.id, baseClip({ outPoint: 2, start: 3 }))
    firstVideo.linkedClipId = firstAudio.id
    firstAudio.linkedClipId = firstVideo.id
    secondVideo.linkedClipId = secondAudio.id
    secondAudio.linkedClipId = secondVideo.id

    expect(editor.moveClipsToChannel(
      sourceVideo.id,
      targetVideo.id,
      [firstVideo.id, secondVideo.id],
      firstVideo.id,
    )).toBe(true)

    const targetIndex = editor.channels.findIndex((channel) => channel.id === targetVideo.id)
    const liveTargetVideo = editor.channels[targetIndex]
    const targetAudio = editor.channels[targetIndex + 1]
    expect(liveTargetVideo.clips.map((clip) => clip.id)).toEqual([firstVideo.id, secondVideo.id])
    expect(targetAudio.type).toBe('audio')
    expect(targetAudio.clips.map((clip) => clip.id)).toEqual([firstAudio.id, secondAudio.id])
  })

  it('keeps linked pairs from separate source tracks on separate target pairs', () => {
    const firstSourceVideo = editor.channels[0]
    const firstSourceAudio = editor.channels[1]
    const secondSourceVideo = editor.addChannel('video')
    const secondSourceAudio = editor.addChannel('audio')
    const firstTargetVideo = editor.addChannel('video')
    const firstTargetAudio = editor.addChannel('audio')
    const secondTargetVideo = editor.addChannel('video')
    const secondTargetAudio = editor.addChannel('audio')
    const firstVideo = editor.addClip(firstSourceVideo.id, baseClip())
    const firstAudio = editor.addClip(firstSourceAudio.id, baseClip())
    const secondVideo = editor.addClip(secondSourceVideo.id, baseClip())
    const secondAudio = editor.addClip(secondSourceAudio.id, baseClip())
    firstVideo.linkedClipId = firstAudio.id
    firstAudio.linkedClipId = firstVideo.id
    secondVideo.linkedClipId = secondAudio.id
    secondAudio.linkedClipId = secondVideo.id

    expect(editor.moveClipsToChannel(
      firstSourceVideo.id,
      firstTargetVideo.id,
      [firstVideo.id, secondVideo.id],
      firstVideo.id,
    )).toBe(true)

    expect(editor.getClipById(firstVideo.id)!.channel.id).toBe(firstTargetVideo.id)
    expect(editor.getClipById(firstAudio.id)!.channel.id).toBe(firstTargetAudio.id)
    expect(editor.getClipById(secondVideo.id)!.channel.id).toBe(secondTargetVideo.id)
    expect(editor.getClipById(secondAudio.id)!.channel.id).toBe(secondTargetAudio.id)
  })

  it('does not move a clip to a channel of another type', () => {
    const source = editor.channels[0]
    const target = editor.channels.find((ch) => ch.type === 'audio')!
    const clip = editor.addClip(source.id, baseClip())

    expect(editor.moveClipToChannel(source.id, target.id, clip.id)).toBe(false)
    expect(source.clips[0].id).toBe(clip.id)
    expect(target.clips).toHaveLength(0)
  })

  it('moveClip overlaps the next clip edge up to the transition cap', () => {
    const id = editor.channels[0].id
    const a = editor.addClip(id, baseClip({ start: 0 })) // [0,5)
    editor.addClip(id, baseClip({ start: 5 })) // [5,10)
    // cap = (min(5,5) - 0.1)/2 = 2.45 → a.start may reach 5 + 2.45 - 5 = 2.45
    editor.moveClip(id, a.id, 4.9)
    const stored = editor.channels[0].clips.find((c) => c.id === a.id)!
    expect(stored.start).toBeCloseTo(2.45)
    // It remains on the original side until its center crosses the neighbour.
    expect(stored.start).toBeLessThan(5)
  })

  it('moveClip allows a small edge overlap without capping', () => {
    const id = editor.channels[0].id
    const a = editor.addClip(id, baseClip({ start: 0 })) // [0,5)
    editor.addClip(id, baseClip({ start: 5 })) // [5,10)
    editor.moveClip(id, a.id, 1) // [1,6) → 1s overlap, below the 2.45 cap
    const stored = editor.channels[0].clips.find((c) => c.id === a.id)!
    expect(stored.start).toBe(1)
  })

  it('moveClip overlaps the previous clip edge up to the transition cap when dragging left', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ start: 0 })) // [0,5)
    const b = editor.addClip(id, baseClip({ start: 8 })) // [8,13)
    // cap = 2.45 → b.start may reach 5 - 2.45 = 2.55
    editor.moveClip(id, b.id, 2)
    const stored = editor.channels[0].clips.find((c) => c.id === b.id)!
    expect(stored.start).toBeCloseTo(2.55)
    expect(stored.start + 5).toBeGreaterThan(5) // still on the right side
  })

  it('moveClip caps the overlap at half the SHORTER clip', () => {
    const id = editor.channels[0].id
    const a = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 2, start: 0 })) // [0,2)
    editor.addClip(id, baseClip({ inPoint: 0, outPoint: 10, start: 2 })) // [2,12)
    // shorter clip is a (2s) → cap = (2 - 0.1)/2 = 0.95 → b.start min = 2 - 0.95 = 1.05
    const b = editor.channels[0].clips[1]
    editor.moveClip(id, b.id, 0)
    const stored = editor.channels[0].clips.find((c) => c.id === b.id)!
    expect(stored.start).toBeCloseTo(1.05)
    expect(editor.getClipOverlap(id, stored).left).toBeCloseTo(0.95)
  })

  it('moveClip allows still-image transitions to meet at the midpoint', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ mediaKind: 'image', inPoint: 0, outPoint: 2, start: 0 }))
    const right = editor.addClip(id, baseClip({ mediaKind: 'image', inPoint: 0, outPoint: 2, start: 2 }))

    editor.moveClip(id, right.id, 0)

    const stored = editor.channels[0].clips.find((clip) => clip.id === right.id)!
    expect(stored.start).toBeCloseTo(1)
    expect(editor.getClipOverlap(id, stored).left).toBeCloseTo(1)
  })

  it('moveClip crosses a neighbour only after the midpoint threshold', () => {
    const id = editor.channels[0].id
    const a = editor.addClip(id, baseClip({ start: 0 })) // [0,5)
    const b = editor.addClip(id, baseClip({ start: 5 })) // [5,10)
    editor.moveClip(id, a.id, 5)
    expect(editor.channels[0].clips.find((c) => c.id === a.id)!.start).toBeCloseTo(2.45)

    editor.moveClip(id, a.id, 5.01)
    const stored = editor.channels[0].clips.find((c) => c.id === a.id)!
    expect(stored.start).toBeCloseTo(7.55)
    expect(editor.channels[0].clips[0].id).toBe(b.id)
  })

  it('getClipOverlap reports both edges', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ start: 0 })) // [0,5)
    const b = editor.addClip(id, baseClip({ start: 4 })) // [4,9) — 1s overlap with a
    const c = editor.addClip(id, baseClip({ start: 8 })) // [8,13) — 1s overlap with b
    expect(editor.getClipOverlap(id, b)).toEqual({ left: 1, right: 1 })
    expect(editor.getClipOverlap(id, c).left).toBeCloseTo(1)
  })

  it('calculates all channel overlaps in one batch with identical results', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ start: 0 }))
    editor.addClip(id, baseClip({ start: 4 }))
    editor.addClip(id, baseClip({ start: 4 }))
    editor.addClip(id, baseClip({ start: 8 }))

    const overlaps = editor.getClipOverlaps(id)
    for (const clip of editor.channels[0].clips) {
      expect(overlaps.get(clip.id)).toEqual(editor.getClipOverlap(id, clip))
    }
  })

  it('getActiveClipsAt finds active clips at given time', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ inPoint: 0, outPoint: 4, start: 0 }))
    const active = editor.getActiveClipsAt(2)
    expect(active).toHaveLength(1)
    const none = editor.getActiveClipsAt(4)
    expect(none).toHaveLength(0)
  })

  it('getActiveClipsAt ignores hidden channels', () => {
    const id = editor.channels[0].id
    editor.addClip(id, baseClip({ inPoint: 0, outPoint: 10, start: 0 }))
    editor.toggleHidden(id)
    expect(editor.getActiveClipsAt(5)).toHaveLength(0)
  })

  it('setResolution/setFps/setPixelsPerSecond update values', () => {
    editor.setFps(60)
    expect(editor.fps).toBe(60)
    editor.setPixelsPerSecond(80)
    expect(editor.pixelsPerSecond).toBe(80)
    editor.setResolution('720p')
    expect(editor.resolution).toBe('720p')
  })

  it('locks project orientation to the first valid video and transposes output dimensions', () => {
    expect(editor.initializeProjectAspect(720, 1280)).toBe('portrait')
    expect(editor.projectAspect).toBe('portrait')
    expect(editor.projectResolution).toEqual({ w: 1080, h: 1920 })

    editor.initializeProjectAspect(1920, 1080)
    expect(editor.projectAspect).toBe('portrait')

    editor.setResolution('720p')
    expect(editor.projectResolution).toEqual({ w: 720, h: 1280 })
  })

  it('detects a 4:3 source as classic and transposes output dimensions', () => {
    expect(editor.initializeProjectAspect(1440, 1080)).toBe('classic')
    expect(editor.projectAspect).toBe('classic')
    expect(editor.projectResolution).toEqual({ w: 1440, h: 1080 })

    editor.initializeProjectAspect(1920, 1080)
    expect(editor.projectAspect).toBe('classic')

    editor.setResolution('4k')
    expect(editor.projectResolution).toEqual({ w: 3840, h: 2880 })
  })

  it('detects a 16:9 source as landscape', () => {
    expect(editor.initializeProjectAspect(1920, 1080)).toBe('landscape')
    expect(editor.projectResolution).toEqual({ w: 1920, h: 1080 })
  })

  it('switches the project aspect to 4:3 and back without forcing a resolution', () => {
    editor.setProjectAspect('classic')
    expect(editor.effectiveProjectAspect).toBe('classic')
    expect(editor.projectResolution).toEqual({ w: 1440, h: 1080 })

    editor.setResolution('4k')
    expect(editor.resolution).toBe('4k')
    expect(editor.projectResolution).toEqual({ w: 3840, h: 2880 })

    editor.setProjectAspect('landscape')
    expect(editor.projectResolution).toEqual({ w: 3840, h: 2160 })
  })

  it('manually switches the project aspect between 16:9 and 9:16', () => {
    editor.setProjectAspect('portrait')
    expect(editor.projectAspect).toBe('portrait')
    expect(editor.effectiveProjectAspect).toBe('portrait')
    expect(editor.projectResolution).toEqual({ w: 1080, h: 1920 })

    editor.setProjectAspect('landscape')
    expect(editor.effectiveProjectAspect).toBe('landscape')
    expect(editor.projectResolution).toEqual({ w: 1920, h: 1080 })
  })

  it('forces a portrait-capable resolution when switching to 9:16', () => {
    editor.setResolution('4k')
    editor.setProjectAspect('portrait')
    expect(editor.resolution).toBe('1080p')
    expect(editor.projectResolution).toEqual({ w: 1080, h: 1920 })
  })

  it('uses a portrait design space for new text', () => {
    editor.initializeProjectAspect(1080, 1920)
    const item = editor.addTextItem(0)

    expect(item).toMatchObject({ x: 540, y: 960 })
    editor.updateTextItem(item.id, { x: 5000, y: 5000 })
    expect(editor.textItems.find((candidate) => candidate.id === item.id)).toMatchObject({ x: 1080, y: 1920 })
  })

  it('preserves relative text alignment when the project aspect changes', () => {
    const item = editor.addTextItem(0, { x: 960, y: 540 })

    editor.setProjectAspect('portrait')
    expect(editor.textItems.find((candidate) => candidate.id === item.id)).toMatchObject({ x: 540, y: 960 })

    editor.setProjectAspect('classic')
    expect(editor.textItems.find((candidate) => candidate.id === item.id)).toMatchObject({ x: 720, y: 540 })
  })

  it('moves edge text into the safe area when switching aspect', () => {
    const item = editor.addTextItem(0, { x: 1900, y: 1060 })

    editor.setProjectAspect('portrait')

    expect(editor.textItems.find((candidate) => candidate.id === item.id)).toMatchObject({ x: 918, y: 1555 })
  })

  it('selectClip sets the selected id', () => {
    editor.selectClip('xyz')
    expect(editor.selectedClipId).toBe('xyz')
    editor.selectClip(null)
    expect(editor.selectedClipId).toBe(null)
  })

  it('selectClip toggles clips in an additive selection', () => {
    editor.selectClip('one')
    editor.selectClip('two', true)
    expect(editor.selectedClipIds).toEqual(['one', 'two'])
    expect(editor.selectedClipId).toBe('two')

    editor.selectClip('one', true)
    expect(editor.selectedClipIds).toEqual(['two'])
  })

  it('selectClips replaces the selection and ignores duplicate or missing ids', () => {
    const first = editor.addClip(editor.channels[0].id, baseClip())
    const second = editor.addClip(editor.channels[1].id, baseClip())

    editor.selectClips([first.id, second.id, first.id, 'missing'])

    expect(editor.selectedClipIds).toEqual([first.id, second.id])
  })

  it('selectAllClips selects clips across every channel', () => {
    const video = editor.addClip(editor.channels[0].id, baseClip())
    const audio = editor.addClip(editor.channels[1].id, baseClip())

    editor.selectAllClips()

    expect(editor.selectedClipIds).toEqual([video.id, audio.id])
  })

  it('selects effects additively together with clips', () => {
    const clip = editor.addClip(editor.channels[0].id, baseClip())
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!

    editor.selectClip(clip.id)
    editor.selectEffectBlock(block.id, true)

    expect(editor.selectedClipIds).toEqual([clip.id])
    expect(editor.selectedEffectBlockIds).toEqual([block.id])

    editor.selectEffectBlock(block.id)
    expect(editor.selectedClipIds).toEqual([])
    expect(editor.selectedEffectBlockIds).toEqual([block.id])
  })

  it('moveClips moves all selected clips by the same delta', () => {
    const video = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 1 }))
    const audio = editor.addClip(editor.channels[1].id, baseClip({ outPoint: 2, start: 3 }))

    expect(editor.moveClips([video.id, audio.id], 4)).toBe(4)
    expect(editor.getClipById(video.id)!.clip.start).toBe(5)
    expect(editor.getClipById(audio.id)!.clip.start).toBe(7)
  })

  it('moveClips moves the whole selection past an external clip', () => {
    const video = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 0 }))
    editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 4 }))
    const audio = editor.addClip(editor.channels[1].id, baseClip({ outPoint: 2, start: 1 }))

    expect(editor.moveClips([video.id, audio.id], 10)).toBe(10)
    expect(editor.getClipById(video.id)!.clip.start).toBe(10)
    expect(editor.getClipById(audio.id)!.clip.start).toBe(11)
  })

  it('moveClips stops on the reachable side when a left-side crossing would leave the timeline', () => {
    editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 1 }))
    const video = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 5 }))
    const audio = editor.addClip(editor.channels[1].id, baseClip({ outPoint: 2, start: 6 }))

    expect(editor.moveClips([video.id, audio.id], -10)).toBeCloseTo(-2.95)
    expect(editor.getClipById(video.id)!.clip.start).toBeCloseTo(2.05)
    expect(editor.getClipById(audio.id)!.clip.start).toBeCloseTo(3.05)
  })

  it('moveClips moves contiguous video and audio selections past trailing clips as one group', () => {
    const videoId = editor.channels[0].id
    const audioId = editor.channels[1].id
    const selected = [
      editor.addClip(videoId, baseClip({ outPoint: 2, start: 0 })),
      editor.addClip(videoId, baseClip({ outPoint: 2, start: 2 })),
      editor.addClip(audioId, baseClip({ outPoint: 2, start: 0 })),
      editor.addClip(audioId, baseClip({ outPoint: 2, start: 2 })),
    ]
    const videoBlocker = editor.addClip(videoId, baseClip({ outPoint: 2, start: 4 }))
    const audioBlocker = editor.addClip(audioId, baseClip({ outPoint: 2, start: 4 }))

    const delta = editor.moveClips(selected.map((clip) => clip.id), 4)

    expect(delta).toBeCloseTo(5.05)
    expect(editor.getClipById(selected[0].id)!.clip.start).toBeCloseTo(5.05)
    expect(editor.getClipById(selected[1].id)!.clip.start).toBeCloseTo(7.05)
    expect(editor.getClipById(selected[2].id)!.clip.start).toBeCloseTo(5.05)
    expect(editor.getClipById(selected[3].id)!.clip.start).toBeCloseTo(7.05)
    expect(videoBlocker.start).toBe(4)
    expect(audioBlocker.start).toBe(4)
  })

  it('moveClips stops every clip when one selected channel is locked', () => {
    const video = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 1 }))
    const audio = editor.addClip(editor.channels[1].id, baseClip({ outPoint: 2, start: 1 }))
    editor.toggleLock(editor.channels[1].id)

    expect(editor.moveClips([video.id, audio.id], 2)).toBe(0)
    expect(editor.getClipById(video.id)!.clip.start).toBe(1)
    expect(editor.getClipById(audio.id)!.clip.start).toBe(1)
  })

  it('copies and pastes the selected clip at the first free position', () => {
    const clip = editor.addClip(editor.channels[0].id, baseClip({ start: 0 }))
    editor.selectClip(clip.id)

    expect(editor.copySelectedClips()).toBe(true)
    const pasted = editor.pasteCopiedClips(0)

    expect(pasted).toHaveLength(1)
    expect(editor.getClipById(pasted[0].id)!.clip.start).toBe(5)
    expect(editor.selectedClipIds).toEqual([pasted[0].id])
  })

  it('copy/paste preserves offsets for multiple selected clips', () => {
    const video = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 2 }))
    const audio = editor.addClip(editor.channels[1].id, baseClip({ outPoint: 2, start: 4 }))
    editor.selectClip(video.id)
    editor.selectClip(audio.id, true)

    editor.copySelectedClips()
    const pasted = editor.pasteCopiedClips(10)

    expect(pasted).toHaveLength(2)
    expect(editor.getClipById(pasted[0].id)!.clip.start).toBe(10)
    expect(editor.getClipById(pasted[1].id)!.clip.start).toBe(12)
  })

  it('copy/paste includes and relinks an attached audio clip', () => {
    const video = editor.addClip(editor.channels[0].id, baseClip())
    const audio = editor.addClip(editor.channels[1].id, baseClip())
    editor.getClipById(video.id)!.clip.linkedClipId = audio.id
    editor.getClipById(audio.id)!.clip.linkedClipId = video.id
    editor.selectClip(video.id)

    editor.copySelectedClips()
    const pasted = editor.pasteCopiedClips(6)

    expect(pasted).toHaveLength(2)
    const pastedVideo = pasted.find((clip) => editor.getClipById(clip.id)!.channel.type === 'video')!
    const pastedAudio = pasted.find((clip) => editor.getClipById(clip.id)!.channel.type === 'audio')!
    expect(editor.getClipById(pastedVideo.id)!.clip.linkedClipId).toBe(pastedAudio.id)
    expect(editor.getClipById(pastedAudio.id)!.clip.linkedClipId).toBe(pastedVideo.id)
  })

  it('copies and pastes transitions between selected clips', () => {
    const channel = editor.channels[0]
    const left = editor.addClip(channel.id, baseClip({ start: 0 }))
    const right = editor.addClip(channel.id, baseClip({ start: 4 }))
    editor.addTransition(channel.id, left.id, right.id, 'wipe-left', 1)
    editor.selectClips([left.id, right.id])

    editor.copySelectedClips()
    const pasted = editor.pasteCopiedClips(10)
    const pastedLeft = pasted.find((clip) => clip.start === 10)!
    const pastedRight = pasted.find((clip) => clip.start === 14)!
    const pastedTransition = editor.getTransitionBetween(pastedLeft.id, pastedRight.id)

    expect(pastedTransition?.effectId).toBe('wipe-left')
    expect(pastedTransition?.channelId).toBe(channel.id)
  })

  it('keeps a transition when moving both clips to another video channel', () => {
    const source = editor.channels[0]
    const target = editor.addChannel('video')
    const left = editor.addClip(source.id, baseClip({ start: 0 }))
    const right = editor.addClip(source.id, baseClip({ start: 4 }))
    const transition = editor.addTransition(source.id, left.id, right.id, 'wipe-right', 1)!

    expect(editor.moveClipsToChannel(source.id, target.id, [left.id, right.id], left.id)).toBe(true)

    expect(editor.getTransitionBetween(left.id, right.id)).toMatchObject({
      id: transition.id,
      channelId: target.id,
      effectId: 'wipe-right',
    })
  })

  it('copies and pastes an effect-only selection at the paste position', () => {
    editor.addClip(editor.channels[0].id, baseClip({ sourceDuration: 20, outPoint: 20 }))
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
    editor.selectEffectBlock(block.id)

    expect(editor.copySelectedClips()).toBe(true)
    editor.pasteCopiedClips(8)

    const pasted = editor.effectBlocks.find((candidate) => candidate.id !== block.id)!
    expect(pasted.start).toBe(8)
    expect(pasted.duration).toBe(2)
    expect(pasted.params).toEqual(block.params)
    expect(pasted.params).not.toBe(block.params)
    expect(pasted.nodeId).toBeNull()
    expect(editor.selectedClipIds).toEqual([])
    expect(editor.selectedEffectBlockIds).toEqual([pasted.id])
  })

  it('pastes clips and effects at the target preserving their offsets', () => {
    const clip = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2 }))
    const block = editor.addEffectBlock(editor.channels[0].id, 'sepia', 1, 1)!
    editor.selectClip(clip.id)
    editor.selectEffectBlock(block.id, true)

    editor.copySelectedClips()
    const pastedClips = editor.pasteCopiedClips(5)

    expect(pastedClips).toHaveLength(1)
    expect(pastedClips[0].start).toBe(5)
    const pastedBlock = editor.effectBlocks.find((candidate) => candidate.id !== block.id)!
    expect(pastedBlock.start).toBe(6)
    expect(editor.selectedClipIds).toEqual([pastedClips[0].id])
    expect(editor.selectedEffectBlockIds).toEqual([pastedBlock.id])
  })

  it('pastes an effect-only selection at the paste position even without clips', () => {
    const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 1)!
    editor.selectEffectBlock(block.id)
    editor.copySelectedClips()

    editor.pasteCopiedClips(5)

    expect(editor.effectBlocks).toHaveLength(2)
    const pasted = editor.effectBlocks.find((candidate) => candidate.id !== block.id)!
    expect(pasted.start).toBe(5)
    expect(editor.selectedEffectBlockIds).toEqual([pasted.id])
  })

  it('setCurrentTime/setPlaying update values', () => {
    editor.setCurrentTime(3.5)
    expect(editor.currentTime).toBe(3.5)
    editor.setPlaying(true)
    expect(editor.playing).toBe(true)
  })

  it('addClip on audio channel adds clip', () => {
    const audioId = editor.channels.find((c) => c.type === 'audio')!.id
    const c = editor.addClip(audioId, baseClip({ start: 1 }))
    const audio = editor.channels.find((ch) => ch.id === audioId)!
    expect(audio.clips.find((x) => x.id === c.id)).toBeTruthy()
  })

  describe('linked clips', () => {
    function findClip(chIndex: number, clipId: string) {
      return editor.channels[chIndex].clips.find((c) => c.id === clipId)!
    }

    it('links exactly one selected video clip and one selected audio clip', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip())
      const audio = editor.addClip(editor.channels[1].id, baseClip())
      editor.selectClip(video.id)
      editor.selectClip(audio.id, true)

      expect(editor.linkSelectedClips()).toBe(true)
      expect(editor.getClipById(video.id)!.clip.linkedClipId).toBe(audio.id)
      expect(editor.getClipById(audio.id)!.clip.linkedClipId).toBe(video.id)
    })

    it('does not link a selection unless it contains exactly one video and one audio clip', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip())
      const secondVideoChannel = editor.addChannel('video')
      const secondVideo = editor.addClip(secondVideoChannel.id, baseClip())
      const audio = editor.addClip(editor.channels[1].id, baseClip())
      editor.selectClip(video.id)
      editor.selectClip(secondVideo.id, true)

      expect(editor.linkSelectedClips()).toBe(false)
      expect(editor.getClipById(video.id)!.clip.linkedClipId).toBeUndefined()
      expect(editor.getClipById(secondVideo.id)!.clip.linkedClipId).toBeUndefined()

      editor.selectClip(audio.id, true)
      expect(editor.linkSelectedClips()).toBe(false)
      expect(editor.getClipById(audio.id)!.clip.linkedClipId).toBeUndefined()
    })

    it('moveClip moves a linked clip together', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const vClip = editor.addClip(videoId, baseClip({ start: 5 }))
      const aClip = editor.addClip(audioId, baseClip({ start: 5 }))
      findClip(0, vClip.id).linkedClipId = aClip.id
      findClip(1, aClip.id).linkedClipId = vClip.id

      editor.moveClip(videoId, vClip.id, 10)
      expect(findClip(0, vClip.id).start).toBe(10)
      expect(findClip(1, aClip.id).start).toBe(10)
    })

    it('moveClip creates the same transition overlap on the linked audio channel', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      // Two linked pairs, mirrored on both channels.
      editor.addClip(videoId, baseClip({ start: 0 }))
      editor.addClip(audioId, baseClip({ start: 0 }))
      const v2 = editor.addClip(videoId, baseClip({ start: 5 }))
      const a2 = editor.addClip(audioId, baseClip({ start: 5 }))
      findClip(0, v2.id).linkedClipId = a2.id
      findClip(1, a2.id).linkedClipId = v2.id

      // Drag the second video clip 1s into the first → 1s transition.
      editor.moveClip(videoId, v2.id, 4)
      expect(findClip(0, v2.id).start).toBe(4)
      expect(findClip(1, a2.id).start).toBe(4)
      expect(editor.getClipOverlap(videoId, findClip(0, v2.id)).left).toBeCloseTo(1)
      expect(editor.getClipOverlap(audioId, findClip(1, a2.id)).left).toBeCloseTo(1)
    })

    it('keeps clips linked when the partner reaches the exact overlap limit', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const blocker = editor.addClip(audioId, baseClip({ start: 0 }))
      const video = editor.addClip(videoId, baseClip({ start: 5 }))
      const audio = editor.addClip(audioId, baseClip({ start: 5 }))
      findClip(0, video.id).linkedClipId = audio.id
      findClip(1, audio.id).linkedClipId = video.id

      const limit = blocker.start + 5 - maxTransitionOverlap(5, 5)
      editor.moveClip(videoId, video.id, limit)

      expect(findClip(0, video.id).start).toBeCloseTo(limit)
      expect(findClip(1, audio.id).start).toBeCloseTo(limit)
      expect(findClip(0, video.id).linkedClipId).toBe(audio.id)
      expect(findClip(1, audio.id).linkedClipId).toBe(video.id)
    })

    it('unlinks when the partner cannot move beyond its overlap limit', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      editor.addClip(audioId, baseClip({ start: 0 }))
      const video = editor.addClip(videoId, baseClip({ start: 10 }))
      const audio = editor.addClip(audioId, baseClip({ start: 10 }))
      findClip(0, video.id).linkedClipId = audio.id
      findClip(1, audio.id).linkedClipId = video.id

      editor.moveClip(videoId, video.id, 0)

      expect(findClip(0, video.id).start).toBe(0)
      expect(findClip(1, audio.id).start).toBeCloseTo(5 - maxTransitionOverlap(5, 5))
      expect(findClip(0, video.id).linkedClipId).toBeUndefined()
      expect(findClip(1, audio.id).linkedClipId).toBeUndefined()
    })

    it('does not move a linked pair when the partner channel is locked', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const video = editor.addClip(videoId, baseClip({ start: 1 }))
      const audio = editor.addClip(audioId, baseClip({ start: 1 }))
      findClip(0, video.id).linkedClipId = audio.id
      findClip(1, audio.id).linkedClipId = video.id
      editor.toggleLock(audioId)

      editor.moveClip(videoId, video.id, 4)

      expect(findClip(0, video.id).start).toBe(1)
      expect(findClip(1, audio.id).start).toBe(1)
    })

    it('removeClip unlinks the partner instead of removing it', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const vClip = editor.addClip(videoId, baseClip({ start: 0 }))
      const aClip = editor.addClip(audioId, baseClip({ start: 0 }))
      findClip(0, vClip.id).linkedClipId = aClip.id
      findClip(1, aClip.id).linkedClipId = vClip.id

      editor.removeClip(videoId, vClip.id)
      expect(editor.channels[0].clips.find((c) => c.id === vClip.id)).toBeUndefined()
      expect(editor.channels[1].clips.find((c) => c.id === aClip.id)).toBeUndefined()
    })

    it('unlinkClip removes the link from both clips', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const vClip = editor.addClip(videoId, baseClip({ start: 0 }))
      const aClip = editor.addClip(audioId, baseClip({ start: 0 }))
      findClip(0, vClip.id).linkedClipId = aClip.id
      findClip(1, aClip.id).linkedClipId = vClip.id

      editor.unlinkClip(vClip.id)
      expect(findClip(0, vClip.id).linkedClipId).toBeUndefined()
      expect(findClip(1, aClip.id).linkedClipId).toBeUndefined()
    })

    it('unlinkClip does nothing for a clip without link', () => {
      const id = editor.channels[0].id
      const clip = editor.addClip(id, baseClip())
      editor.unlinkClip(clip.id)
      expect(editor.channels[0].clips.find((c) => c.id === clip.id)!.linkedClipId).toBeUndefined()
    })
  })

  describe('getClipById', () => {
    it('finds a clip by its id', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ start: 2 }))
      const result = editor.getClipById(c.id)
      expect(result).not.toBeNull()
      expect(result!.clip.id).toBe(c.id)
      expect(result!.channel.id).toBe(id)
    })

    it('returns null when clip not found', () => {
      expect(editor.getClipById('nonexistent')).toBeNull()
    })
  })

  describe('removeClipById', () => {
    it('removes a clip by id', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip())
      expect(editor.channels[0].clips).toHaveLength(1)
      editor.removeClipById(c.id)
      expect(editor.channels[0].clips).toHaveLength(0)
    })

    it('removes a linked clip and unlinks partner', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const vClip = editor.addClip(videoId, baseClip({ start: 0 }))
      const aClip = editor.addClip(audioId, baseClip({ start: 0 }))
      editor.channels[0].clips.find((c) => c.id === vClip.id)!.linkedClipId = aClip.id
      editor.channels[1].clips.find((c) => c.id === aClip.id)!.linkedClipId = vClip.id

      editor.removeClipById(vClip.id)
      expect(editor.channels[0].clips.find((c) => c.id === vClip.id)).toBeUndefined()
      expect(editor.channels[1].clips.find((c) => c.id === aClip.id)).toBeUndefined()
    })

    it('does nothing for unknown clip id', () => {
      editor.removeClipById('nonexistent')
      expect(editor.channels[0].clips).toHaveLength(0)
    })
  })

  describe('effect blocks', () => {
    beforeEach(() => {
      while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    })

    function findBlock(blockId: string) {
      return editor.effectBlocks.find((b) => b.id === blockId)!
    }

    it('applies a compound look as one undoable clip-owned recipe', () => {
      const clip = editor.addClip(editor.channels[0].id, baseClip({ start: 2, outPoint: 10 }))
      editor.clearHistory()

      expect(editor.applyClipLook(clip.id, 'sepia-strobe')).toBe(true)
      expect(editor.getClipById(clip.id)?.clip.transformKeyframes?.at(-1)?.transform.zoomX).toBeCloseTo(1.12)
      expect(editor.effectBlocks).toHaveLength(8)
      expect(editor.effectBlocks.every((block) => (
        block.ownerClipId === clip.id && block.clipLookId === 'sepia-strobe'
      ))).toBe(true)

      expect(editor.undo()).toBe(true)
      expect(editor.effectBlocks).toHaveLength(0)
      expect(editor.getClipById(clip.id)?.clip.transformKeyframes).toBeUndefined()
      expect(editor.redo()).toBe(true)
      expect(editor.effectBlocks).toHaveLength(8)
    })

    it('keeps each clip look active through incoming and outgoing transitions', () => {
      const channel = editor.channels[0]
      const first = editor.addClip(channel.id, baseClip({ fileName: 'first.jpg', mediaKind: 'image', start: 0 }))
      const middle = editor.addClip(channel.id, baseClip({ fileName: 'middle.jpg', mediaKind: 'image', start: 4 }))
      const last = editor.addClip(channel.id, baseClip({ fileName: 'last.jpg', mediaKind: 'image', start: 8 }))
      editor.addTransition(channel.id, first.id, middle.id, 'cross-dissolve', 1)
      editor.addTransition(channel.id, middle.id, last.id, 'wipe-left', 1)

      editor.applyClipLook(first.id, 'balanced-enhance')
      editor.applyClipLook(middle.id, 'balanced-enhance')
      editor.applyClipLook(last.id, 'balanced-enhance')

      const firstBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === first.id)
      const middleBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === middle.id)
      const lastBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === last.id)
      expect(firstBlocks).toHaveLength(3)
      expect(middleBlocks).toHaveLength(3)
      expect(lastBlocks).toHaveLength(3)
      expect(firstBlocks.every((block) => Math.abs(block.start - first.start) < 0.001 && Math.abs(block.start + block.duration - clipEnd(first)) < 0.001)).toBe(true)
      expect(middleBlocks.every((block) => Math.abs(block.start - middle.start) < 0.001 && Math.abs(block.start + block.duration - clipEnd(middle)) < 0.001)).toBe(true)
      expect(lastBlocks.every((block) => Math.abs(block.start - last.start) < 0.001 && Math.abs(block.start + block.duration - clipEnd(last)) < 0.001)).toBe(true)
    })

    it('moves, replaces, and removes clip-owned look effects with their clip', () => {
      const channel = editor.channels[0]
      const clip = editor.addClip(channel.id, baseClip({ start: 2, outPoint: 10 }))
      editor.applyClipLook(clip.id, 'sepia-strobe')
      const originalStarts = editor.effectBlocks.map((block) => block.start)

      editor.moveClip(channel.id, clip.id, 5)
      expect(editor.effectBlocks.map((block) => block.start)).toEqual(originalStarts.map((start) => start + 3))

      editor.applyClipLook(clip.id, 'sepia-strobe')
      expect(editor.effectBlocks).toHaveLength(8)

      editor.removeClip(channel.id, clip.id)
      expect(editor.effectBlocks).toHaveLength(0)
    })

    it('copies a compound look when its owner clip is pasted', () => {
      const channel = editor.channels[0]
      const clip = editor.addClip(channel.id, baseClip({ outPoint: 10 }))
      editor.applyClipLook(clip.id, 'sepia-strobe')
      editor.selectClip(clip.id)

      expect(editor.copySelectedClips()).toBe(true)
      const [pasted] = editor.pasteCopiedClips(15)

      const pastedBlocks = editor.effectBlocks.filter((block) => block.ownerClipId === pasted.id)
      expect(pastedBlocks).toHaveLength(8)
      expect(pastedBlocks.every((block) => block.clipLookId === 'sepia-strobe')).toBe(true)

      const starts = pastedBlocks.map((block) => block.start)
      editor.moveSelection([pasted.id], pastedBlocks.map((block) => block.id), [], 2, true)
      expect(pastedBlocks.map((block) => block.start)).toEqual(starts.map((start) => start + 2))
    })

    it('addEffectBlock creates a block on a video channel', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'grayscale', 2, 3)
      expect(block).not.toBeNull()
      expect(block!.effectId).toBe('grayscale')
      expect(block!.channelId).toBe(editor.channels[0].id)
      expect(findBlock(block!.id).start).toBe(2)
      expect(findBlock(block!.id).duration).toBe(3)
      expect(findBlock(block!.id).nodeId).toBeNull()
    })

    it('addEffectBlock returns null for non-video channel', () => {
      const audioId = editor.channels.find((c) => c.type === 'audio')!.id
      const block = editor.addEffectBlock(audioId, 'blur', 0, 2)
      expect(block).toBeNull()
    })

    it('addEffectBlock clamps start to non-negative', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', -5, 2)!
      expect(findBlock(block!.id).start).toBe(0)
    })

    it('addEffectBlock clamps duration to minimum 0.2', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 0.1)!
      expect(findBlock(block!.id).duration).toBe(0.2)
    })

    it('removeEffectBlock removes the block', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'grayscale', 0, 2)
      expect(editor.effectBlocks).toHaveLength(1)
      editor.removeEffectBlock(block!.id)
      expect(editor.effectBlocks).toHaveLength(0)
    })

    it('moveEffectBlock moves the block start', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 3, 2)!
      editor.moveEffectBlock(block.id, 7)
      expect(findBlock(block.id).start).toBe(7)
    })

    it('moveEffectBlock clamps to non-negative', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 3, 2)!
      editor.moveEffectBlock(block.id, -1)
      expect(findBlock(block.id).start).toBe(0)
    })

    it('moveEffectBlock marks nodeId as null after move', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 3, 2)!
      findBlock(block.id).nodeId = 'some_node'
      editor.moveEffectBlock(block.id, 5)
      expect(findBlock(block.id).nodeId).toBeNull()
    })

    it('resizeEffectBlock resizes the block', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 3)!
      editor.resizeEffectBlock(block.id, 5)
      expect(findBlock(block.id).duration).toBe(5)
    })

    it('resizeEffectBlock clamps to minimum 0.2', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 3)!
      editor.resizeEffectBlock(block.id, 0)
      expect(findBlock(block.id).duration).toBe(0.2)
    })

    it('resizeEffectBlock marks nodeId as null after resize', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 3)!
      findBlock(block.id).nodeId = 'some_node'
      editor.resizeEffectBlock(block.id, 4)
      expect(findBlock(block.id).nodeId).toBeNull()
    })

    it('resizes multiple effects in one undoable edit', () => {
      const first = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
      const second = editor.addEffectBlock(editor.channels[0].id, 'sepia', 4, 3)!
      editor.clearHistory()

      expect(editor.resizeEffectBlocks([first.id, second.id], 5)).toBe(true)
      expect(findBlock(first.id).duration).toBe(5)
      expect(findBlock(second.id).duration).toBe(5)

      expect(editor.undo()).toBe(true)
      expect(findBlock(first.id).duration).toBe(2)
      expect(findBlock(second.id).duration).toBe(3)
    })

    it('does not resize an effect selection containing a locked track', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
      editor.toggleLock(editor.channels[0].id)

      expect(editor.resizeEffectBlocks([block.id], 5)).toBe(false)
      expect(findBlock(block.id).duration).toBe(2)
    })

    it('setEffectBlockNode sets the node id', () => {
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 2)!
      editor.setEffectBlockNode(block.id, 'node_123')
      expect(findBlock(block.id).nodeId).toBe('node_123')
      editor.setEffectBlockNode(block.id, null)
      expect(findBlock(block.id).nodeId).toBeNull()
    })

    it('getEffectBlocksForChannel returns blocks for a channel', () => {
      editor.addEffectBlock(editor.channels[0].id, 'grayscale', 0, 2)
      editor.addEffectBlock(editor.channels[0].id, 'blur', 3, 2)
      const videoBlocks = editor.getEffectBlocksForChannel(editor.channels[0].id)
      expect(videoBlocks).toHaveLength(2)
      const audioBlocks = editor.getEffectBlocksForChannel(editor.channels[1].id)
      expect(audioBlocks).toHaveLength(0)
    })

    it('moves multiple selected effects as one rigid group', () => {
      const first = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
      const second = editor.addEffectBlock(editor.channels[0].id, 'sepia', 4, 1)!

      expect(editor.moveEffectBlocks([first.id, second.id], -3)).toBe(-1)
      expect(findBlock(first.id).start).toBe(0)
      expect(findBlock(second.id).start).toBe(3)
    })

    it('moves a mixed clip and effect selection by the same delta', () => {
      const clip = editor.addClip(editor.channels[0].id, baseClip({ outPoint: 2, start: 1 }))
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 2, 1)!

      expect(editor.moveSelection([clip.id], [block.id], [], 3)).toBe(3)
      expect(editor.getClipById(clip.id)!.clip.start).toBe(4)
      expect(findBlock(block.id).start).toBe(5)
    })

    it('moves effects to another video channel even over empty timeline', () => {
      const target = editor.addChannel('video')
      editor.addClip(target.id, baseClip({ start: 2, outPoint: 6 }))
      const valid = editor.addEffectBlock(editor.channels[0].id, 'blur', 3, 1)!
      const overEmpty = editor.addEffectBlock(editor.channels[0].id, 'sepia', 8, 1)!

      expect(editor.moveEffectBlocksToChannel([valid.id], target.id)).toBe(true)
      expect(findBlock(valid.id).channelId).toBe(target.id)
      // Timeline-anchored effects may sit in the continuation of the next
      // clip, so empty target space no longer rejects the move.
      expect(editor.moveEffectBlocksToChannel([overEmpty.id], target.id)).toBe(true)
      expect(findBlock(overEmpty.id).channelId).toBe(target.id)
    })

    it('detaches a regular effect moved over empty timeline', () => {
      const channel = editor.channels[0]
      const clip = editor.addClip(channel.id, baseClip({ start: 0, outPoint: 5 }))
      const block = editor.addEffectBlock(channel.id, 'blur', 1, 2)!
      expect(editor.anchorEffectBlock(block.id, 2)).toBe(true)
      expect(findBlock(block.id).ownerClipId).toBe(clip.id)

      findBlock(block.id).start = 10
      expect(editor.anchorEffectBlock(block.id, 11)).toBe(true)
      expect(findBlock(block.id).ownerClipId).toBeUndefined()
    })

    it('detaches a regular effect stretched across two clips', () => {
      const channel = editor.channels[0]
      const first = editor.addClip(channel.id, baseClip({ start: 0, outPoint: 2 }))
      const second = editor.addClip(channel.id, baseClip({ start: 2, outPoint: 4 }))
      const block = editor.addEffectBlock(channel.id, 'blur', 0.5, 1)!
      expect(editor.anchorEffectBlock(block.id, 1)).toBe(true)
      expect(findBlock(block.id).ownerClipId).toBe(first.id)

      findBlock(block.id).start = 1.5
      findBlock(block.id).duration = 2
      expect(editor.anchorEffectBlock(block.id, 2.5)).toBe(true)
      expect(findBlock(block.id).ownerClipId).toBeUndefined()
      expect(second.id).toBeTruthy()
    })

    it('detaches a regular effect resized across two clips so it renders on both', () => {
      const channel = editor.channels[0]
      const first = editor.addClip(channel.id, baseClip({ start: 0, outPoint: 2 }))
      editor.addClip(channel.id, baseClip({ start: 2, outPoint: 4 }))
      const block = editor.addEffectBlock(channel.id, 'blur', 0.5, 1)!
      expect(editor.anchorEffectBlock(block.id, 1)).toBe(true)
      expect(findBlock(block.id).ownerClipId).toBe(first.id)

      editor.resizeEffectBlock(block.id, 3)
      expect(findBlock(block.id).ownerClipId).toBeUndefined()

      editor.resizeEffectBlockRange(block.id, 0.5, 1)
      expect(findBlock(block.id).ownerClipId).toBe(first.id)
    })

    it('keeps preset looks glued to their clip over empty timeline', () => {
      const channel = editor.channels[0]
      const clip = editor.addClip(channel.id, baseClip({ start: 0, outPoint: 5 }))
      editor.applyClipLook(clip.id, 'sepia-strobe')
      const preset = editor.effectBlocks.find((candidate) => candidate.ownerClipId === clip.id)!
      preset.start = 10
      expect(editor.anchorEffectBlock(preset.id, 11)).toBe(false)
      expect(editor.effectBlocks.find((candidate) => candidate.id === preset.id)!.ownerClipId).toBe(clip.id)
    })

    it('removing a channel removes its effects and their selection', () => {
      const channelId = editor.channels[0].id
      const block = editor.addEffectBlock(channelId, 'blur', 0, 2)!
      editor.selectEffectBlock(block.id)

      editor.removeChannel(channelId)

      expect(editor.effectBlocks.find((candidate) => candidate.id === block.id)).toBeUndefined()
      expect(editor.selectedEffectBlockIds).toEqual([])
    })

    it('undo restores a deleted mixed selection', () => {
      const clip = editor.addClip(editor.channels[0].id, baseClip())
      const block = editor.addEffectBlock(editor.channels[0].id, 'blur', 1, 2)!
      editor.selectClip(clip.id)
      editor.selectEffectBlock(block.id, true)
      editor.clearHistory()

      editor.removeSelectedItems()
      expect(editor.getClipById(clip.id)).toBeNull()
      expect(editor.effectBlocks).toHaveLength(0)

      editor.undo()
      expect(editor.getClipById(clip.id)).not.toBeNull()
      expect(editor.effectBlocks.map((candidate) => candidate.id)).toEqual([block.id])
      expect(editor.selectedClipIds).toEqual([clip.id])
      expect(editor.selectedEffectBlockIds).toEqual([block.id])
    })
  })

  describe('text items', () => {
    it('keeps text separate from effects and includes it in project duration', () => {
      const item = editor.addTextItem(2, { text: 'Opening title', duration: 4, x: 420, y: 180 })

      expect(editor.textItems).toHaveLength(1)
      expect(editor.effectBlocks).toHaveLength(0)
      expect(item.text).toBe('Opening title')
      expect(editor.totalDuration).toBe(6)
      expect(editor.getActiveTextItemsAt(5.999).map((candidate) => candidate.id)).toEqual([item.id])
      expect(editor.getActiveTextItemsAt(6)).toEqual([])
    })

    it('updates text styling and restores it through undo', () => {
      const item = editor.addTextItem(0)
      editor.clearHistory()

      editor.updateTextItem(item.id, {
        fontFamily: 'serif', fontSize: 140, color: '#ff0000', x: 4000,
        backgroundColor: '#123456', backgroundOpacity: 2, backgroundPadding: 24, backgroundRadius: 12,
      })
      const current = editor.textItems[0]
      expect(current.fontFamily).toBe('serif')
      expect(current.fontSize).toBe(140)
      expect(current.color).toBe('#ff0000')
      expect(current.x).toBe(1920)
      expect(current.backgroundColor).toBe('#123456')
      expect(current.backgroundOpacity).toBe(1)
      expect(current.backgroundPadding).toBe(24)
      expect(current.backgroundRadius).toBe(12)

      expect(editor.undo()).toBe(true)
      expect(editor.textItems[0].fontFamily).toBe('sans')
      expect(editor.textItems[0].fontSize).toBe(40)
      expect(editor.textItems[0].x).toBe(960)
      expect(editor.textItems[0].backgroundOpacity).toBe(0)
    })

    it('copies, moves, resizes, and deletes text independently', () => {
      const item = editor.addTextItem(1, {
        text: 'Caption',
        duration: 2,
        isCaption: true,
        highlightMode: 'word',
        words: [{ text: 'Caption', start: 0, end: 1 }],
      })
      editor.selectTextItem(item.id)
      expect(editor.copySelectedClips()).toBe(true)
      item.words[0].text = 'Changed after copy'

      editor.pasteCopiedClips(5)
      expect(editor.textItems.map((candidate) => candidate.start)).toEqual([1, 5])
      const pasted = editor.textItems[1]
      expect(pasted.words).toEqual([{ text: 'Caption', start: 0, end: 1 }])
      editor.moveTextItems([pasted.id], -10)
      editor.resizeTextItem(pasted.id, 0)
      expect(pasted.start).toBe(0)
      expect(pasted.duration).toBe(0.2)

      editor.removeSelectedItems()
      expect(editor.textItems.map((candidate) => candidate.id)).toEqual([item.id])
    })

    it('pastes copied voice-to-text captions as one undo step', () => {
      editor.withHistoryTransaction(() => {
        editor.addTextItem(1, { text: 'Hello world', isCaption: true })
        editor.addTextItem(3, { text: 'Second line', isCaption: true })
      })
      editor.clearHistory()
      editor.selectItems([], [], editor.textItems.map((candidate) => candidate.id))
      expect(editor.copySelectedClips()).toBe(true)

      editor.pasteCopiedClips(10)
      expect(editor.textItems).toHaveLength(4)

      expect(editor.undo()).toBe(true)
      expect(editor.textItems).toHaveLength(2)
      expect(editor.undo()).toBe(false)

      expect(editor.redo()).toBe(true)
      expect(editor.textItems).toHaveLength(4)
    })

    it('moves captions anchored to a media clip with that clip', () => {
      const clip = editor.addClip(editor.channels[1].id, baseClip({ start: 2, mediaKind: 'audio' }))
      const caption = editor.addTextItem(3, {
        text: 'Anchored caption',
        isCaption: true,
        sourceClipId: clip.id,
      })

      editor.moveClip(editor.channels[1].id, clip.id, 6)

      expect(editor.textItems.find((item) => item.id === caption.id)!.start).toBe(7)
    })

    it('moves a caption once when its linked media and caption are selected together', () => {
      const video = editor.addClip(editor.channels[0].id, baseClip({ start: 2, mediaKind: 'video' }))
      const audio = editor.addClip(editor.channels[1].id, baseClip({ start: 2, mediaKind: 'audio' }))
      video.linkedClipId = audio.id
      audio.linkedClipId = video.id
      const caption = editor.addTextItem(3, {
        text: 'Linked caption',
        isCaption: true,
        sourceClipId: video.id,
      })

      editor.moveSelection([audio.id], [], [caption.id], 4)

      expect(editor.getClipById(video.id)!.clip.start).toBe(6)
      expect(editor.getClipById(audio.id)!.clip.start).toBe(6)
      expect(editor.textItems.find((item) => item.id === caption.id)!.start).toBe(7)
    })
  })

  describe('trimClip', () => {
    function findClip(chIndex: number, clipId: string) {
      return editor.channels[chIndex].clips.find((c) => c.id === clipId)!
    }

    it('trims the in point and shifts start together', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 2 }))
      editor.trimClip(c.id, 'left', 1.5)
      expect(findClip(0, c.id).inPoint).toBeCloseTo(1.5)
      expect(findClip(0, c.id).start).toBeCloseTo(3.5)
      expect(findClip(0, c.id).outPoint).toBe(5)
    })

    it('trims the out point without moving start', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 2 }))
      editor.trimClip(c.id, 'right', -2)
      expect(findClip(0, c.id).outPoint).toBeCloseTo(3)
      expect(findClip(0, c.id).start).toBe(2)
      expect(findClip(0, c.id).inPoint).toBe(0)
    })

    it('clamps in-trim to the source start and timeline 0', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 1, outPoint: 5, start: 0.5 }))
      editor.trimClip(c.id, 'left', -10)
      // limited by -start (0.5), not by -inPoint (1)
      expect(findClip(0, c.id).inPoint).toBeCloseTo(0.5)
      expect(findClip(0, c.id).start).toBeCloseTo(0)
    })

    it('clamps out-trim to sourceDuration', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ sourceDuration: 10, inPoint: 0, outPoint: 5 }))
      editor.trimClip(c.id, 'right', 100)
      expect(findClip(0, c.id).outPoint).toBe(10)
    })

    it('allows a still image to extend beyond its nominal source duration', () => {
      const id = editor.channels[0].id
      const image = editor.addClip(id, baseClip({
        fileName: 'photo.jpg',
        mediaKind: 'image',
        sourceDuration: 10,
        outPoint: 10,
      }))

      editor.trimClip(image.id, 'right', 15)

      expect(findClip(0, image.id).outPoint).toBe(25)
    })

    it('keeps at least MIN_CLIP_LEN on both edges', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5 }))
      editor.trimClip(c.id, 'left', 100)
      expect(findClip(0, c.id).inPoint).toBeCloseTo(4.9)
      editor.trimClip(c.id, 'right', -100)
      expect(findClip(0, c.id).outPoint).toBeCloseTo(5)
    })

    it('trims the linked partner by the same delta', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const v = editor.addClip(videoId, baseClip({ start: 0 }))
      const a = editor.addClip(audioId, baseClip({ start: 0 }))
      findClip(0, v.id).linkedClipId = a.id
      findClip(1, a.id).linkedClipId = v.id

      editor.trimClip(v.id, 'left', 1)
      expect(findClip(0, v.id).inPoint).toBeCloseTo(1)
      expect(findClip(1, a.id).inPoint).toBeCloseTo(1)
      expect(findClip(1, a.id).start).toBeCloseTo(1)

      editor.trimClip(v.id, 'right', -1)
      expect(findClip(0, v.id).outPoint).toBeCloseTo(4)
      expect(findClip(1, a.id).outPoint).toBeCloseTo(4)
    })

    it('trims only the selected clip when its linked partner has a different duration', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const video = editor.addClip(videoId, baseClip({ inPoint: 0, outPoint: 5, start: 0 }))
      const audio = editor.addClip(audioId, baseClip({ inPoint: 0, outPoint: 3, start: 0 }))
      findClip(0, video.id).linkedClipId = audio.id
      findClip(1, audio.id).linkedClipId = video.id

      editor.trimClip(video.id, 'right', 1)

      expect(findClip(0, video.id).outPoint).toBe(6)
      expect(findClip(1, audio.id).outPoint).toBe(3)
      expect(findClip(1, audio.id).start).toBe(0)
    })

    it('uses the common trim limit for linked clips with equal durations', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const video = editor.addClip(videoId, baseClip({ sourceDuration: 10, outPoint: 5 }))
      const audio = editor.addClip(audioId, baseClip({ sourceDuration: 5, outPoint: 5 }))
      findClip(0, video.id).linkedClipId = audio.id
      findClip(1, audio.id).linkedClipId = video.id

      editor.trimClip(video.id, 'right', 1)

      expect(findClip(0, video.id).outPoint).toBe(5)
      expect(findClip(1, audio.id).outPoint).toBe(5)
    })

    it('does nothing on a locked channel', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip())
      editor.toggleLock(id)
      editor.trimClip(c.id, 'left', 1)
      expect(findClip(0, c.id).inPoint).toBe(0)
    })

    it('right edge trim may extend into the next clip up to the transition cap', () => {
      const id = editor.channels[0].id
      const a = editor.addClip(id, baseClip({ start: 0 })) // [0,5)
      editor.addClip(id, baseClip({ start: 6 })) // [6,11)
      // cap = 2.45 → a.end may reach 6 + 2.45 = 8.45
      editor.trimClip(a.id, 'right', 5)
      expect(findClip(0, a.id).outPoint).toBeCloseTo(8.45)
    })

    it('left edge trim may extend into the previous clip up to handles and the cap', () => {
      const id = editor.channels[0].id
      editor.addClip(id, baseClip({ start: 0 })) // [0,5)
      const b = editor.addClip(id, baseClip({ inPoint: 2, outPoint: 7, start: 6 })) // [6,11)
      // 2s of source handles limit the extension before the cap (2.55) is reached
      editor.trimClip(b.id, 'left', -3)
      expect(findClip(0, b.id).start).toBeCloseTo(4)
      expect(findClip(0, b.id).inPoint).toBeCloseTo(0)
      expect(editor.getClipOverlap(id, findClip(0, b.id)).left).toBeCloseTo(1)
    })

    it('right edge shrink may not invalidate an existing left overlap', () => {
      const id = editor.channels[0].id
      editor.addClip(id, baseClip({ inPoint: 0, outPoint: 10, start: 0 })) // [0,10)
      const b = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 10, start: 8 })) // [8,18) — 2s overlap
      // Shrinking b's right edge: newLen must stay >= 2*overlap + MIN = 4.1
      editor.trimClip(b.id, 'right', -100)
      expect(findClip(0, b.id).outPoint - findClip(0, b.id).inPoint).toBeCloseTo(4.1)
    })

    it('splitClip refuses to cut inside a transition overlap', () => {
      const id = editor.channels[0].id
      editor.addClip(id, baseClip({ start: 0 })) // [0,5)
      const b = editor.addClip(id, baseClip({ start: 4 })) // [4,9) — overlap [4,5)
      expect(editor.splitClip(b.id, 4.5)).toBeNull()
      expect(editor.splitClip(b.id, 6)).not.toBeNull()
    })

    it('marks effect blocks anchored to the clip as dirty', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ start: 0, outPoint: 5 }))
      const block = editor.addEffectBlock(id, 'grayscale', 1, 2)!
      editor.setEffectBlockNode(block.id, 'node_1')
      editor.trimClip(c.id, 'left', 0.5)
      expect(editor.effectBlocks.find((b) => b.id === block.id)!.nodeId).toBeNull()
    })

    it('rebases animated transforms when trimming either edge', () => {
      const clip = editor.addClip(editor.channels[0].id, baseClip({ inPoint: 1, outPoint: 9 }))
      const base = editor.getClipTransformAt(clip.id)!
      editor.setClipTransformKeyframes(clip.id, base, [
        { time: 0, transform: { ...base, zoomX: 1, zoomY: 1 } },
        { time: 4, transform: { ...base, zoomX: 2, zoomY: 2 } },
        { time: 8, transform: { ...base, zoomX: 3, zoomY: 3 } },
      ])
      editor.trimClip(clip.id, 'left', 2)
      const framesAfterLeft = editor.getClipById(clip.id)!.clip.transformKeyframes!
      expect(framesAfterLeft.map((frame) => frame.time)).toEqual([0, 2, 6])
      expect(framesAfterLeft[0].transform.zoomX).toBeCloseTo(1.5)

      editor.trimClip(clip.id, 'right', -3)
      const framesAfterRight = editor.getClipById(clip.id)!.clip.transformKeyframes!
      expect(framesAfterRight.map((frame) => frame.time)).toEqual([0, 2, 3])
      expect(framesAfterRight.at(-1)?.transform.zoomX).toBeCloseTo(2.25)
    })
  })

  it('keeps framing independent of aspect and supports undo, redo and project restore', () => {
    editor.setProjectAspect('portrait')
    editor.clearHistory()
    expect(editor.videoFit).toBe('contain')
    editor.setVideoFit('cover')
    const saved = editor.captureProjectState()
    expect(editor.videoFit).toBe('cover')
    expect(editor.undo()).toBe(true)
    expect(editor.videoFit).toBe('contain')
    expect(editor.redo()).toBe(true)
    expect(editor.videoFit).toBe('cover')
    editor.setProjectAspect('classic')
    expect(editor.videoFit).toBe('cover')
    editor.restoreProjectState(saved)
    expect(editor.videoFit).toBe('cover')
    expect(editor.effectiveProjectAspect).toBe('portrait')
    const { videoFit: _fit, ...legacy } = saved
    editor.restoreProjectState(legacy)
    expect(editor.videoFit).toBe('contain')
  })

  describe('splitClip', () => {
    function findClip(chIndex: number, clipId: string) {
      return editor.channels[chIndex].clips.find((c) => c.id === clipId)!
    }

    it('keeps look animation inside each half after repeated cuts', () => {
      const channel = editor.channels[0]
      const first = editor.addClip(channel.id, baseClip({ start: 0, outPoint: 10.033522, sourceDuration: 11 }))
      editor.applyClipLook(first.id, 'sepia-strobe')
      const originalAtCut = editor.getClipTransformAt(first.id, 1.3834)!

      const middle = editor.splitClip(first.id, 1.3834)!
      const last = editor.splitClip(middle.id, 3.3084)!
      editor.applyClipLook(middle.id, 'sepia-strobe')

      for (const original of [first, middle, last]) {
        const clip = editor.getClipById(original.id)!.clip
        const duration = (clip.outPoint - clip.inPoint) / (clip.playbackRate ?? 1)
        const times = clip.transformKeyframes?.map((frame) => frame.time) ?? []
        expect(times.every((time, index) => time >= 0 && time <= duration && (index === 0 || time > times[index - 1]))).toBe(true)
      }
      expect(editor.getClipById(first.id)!.clip.transformKeyframes?.at(-1)?.time).toBeCloseTo(1.3834)
      expect(editor.getClipById(first.id)!.clip.transformKeyframes?.at(-1)?.transform.zoomX).toBeCloseTo(originalAtCut.zoomX)
      expect(editor.getClipById(last.id)!.clip.transformKeyframes?.[0].time).toBe(0)
    })

    it('splits one clip into two windows of the same source', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 0 }))
      const second = editor.splitClip(c.id, 2)!
      expect(second).not.toBeNull()
      expect(findClip(0, c.id).outPoint).toBeCloseTo(2)
      expect(findClip(0, c.id).inPoint).toBe(0)
      expect(second.inPoint).toBeCloseTo(2)
      expect(second.outPoint).toBe(5)
      expect(second.start).toBe(2)
      expect(editor.channels[0].clips).toHaveLength(2)
    })

    it('accounts for an existing inPoint when cutting', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 3, outPoint: 8, start: 1 }))
      const second = editor.splitClip(c.id, 3)!
      expect(findClip(0, c.id).outPoint).toBeCloseTo(5)
      expect(second.inPoint).toBeCloseTo(5)
      expect(second.outPoint).toBe(8)
    })

    it('rejects cuts too close to the edges', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 0 }))
      expect(editor.splitClip(c.id, 0.05)).toBeNull()
      expect(editor.splitClip(c.id, 4.95)).toBeNull()
      expect(editor.splitClip(c.id, 6)).toBeNull()
      expect(editor.channels[0].clips).toHaveLength(1)
    })

    it('splits the linked partner and keeps the halves linked', () => {
      const videoId = editor.channels[0].id
      const audioId = editor.channels[1].id
      const v = editor.addClip(videoId, baseClip({ start: 0 }))
      const a = editor.addClip(audioId, baseClip({ start: 0 }))
      findClip(0, v.id).linkedClipId = a.id
      findClip(1, a.id).linkedClipId = v.id

      const v2 = editor.splitClip(v.id, 2)!
      expect(editor.channels[0].clips).toHaveLength(2)
      expect(editor.channels[1].clips).toHaveLength(2)

      const a1 = editor.channels[1].clips.find((c) => c.id !== v2.linkedClipId && c.id === a.id)!
      const a2 = editor.channels[1].clips.find((c) => c.id === v2.linkedClipId)!
      expect(findClip(0, v.id).linkedClipId).toBe(a1.id)
      expect(v2.linkedClipId).toBe(a2.id)
      expect(a1.outPoint).toBeCloseTo(2)
      expect(a2.inPoint).toBeCloseTo(2)
      expect(a2.start).toBe(2)
    })

    it('keeps captions anchored to the clip half that contains them', () => {
      const channel = editor.channels[0]
      const clip = editor.addClip(channel.id, baseClip({ start: 0, outPoint: 8, mediaKind: 'video' }))
      const leftCaption = editor.addTextItem(1, {
        text: 'Before', duration: 1, isCaption: true, sourceClipId: clip.id,
      })
      const rightCaption = editor.addTextItem(6, {
        text: 'After', duration: 1, isCaption: true, sourceClipId: clip.id,
      })
      const crossingCaption = editor.addTextItem(3, {
        text: 'One Two',
        duration: 2,
        isCaption: true,
        sourceClipId: clip.id,
        words: [
          { text: 'One', start: 0, end: 0.8 },
          { text: 'Two', start: 0.8, end: 2 },
        ],
      })

      const rightClip = editor.splitClip(clip.id, 4)!
      const leftItems = editor.textItems.filter((item) => item.sourceClipId === clip.id)
      const rightItems = editor.textItems.filter((item) => item.sourceClipId === rightClip.id)

      expect(leftItems.map((item) => item.id)).toEqual([leftCaption.id, crossingCaption.id])
      expect(rightItems.map((item) => item.text)).toEqual(['After', 'Two'])
      expect(editor.textItems.find((item) => item.id === crossingCaption.id)!.duration).toBe(1)
      expect(rightItems.find((item) => item.text === 'Two')).toMatchObject({ start: 4, duration: 1 })

      editor.moveClip(channel.id, rightClip.id, 7)

      expect(editor.textItems.find((item) => item.id === leftCaption.id)!.start).toBe(1)
      expect(editor.textItems.filter((item) => item.sourceClipId === rightClip.id).map((item) => item.start)).toEqual([9, 7])
    })

    it('does nothing on a locked channel', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip())
      editor.toggleLock(id)
      expect(editor.splitClip(c.id, 2)).toBeNull()
      expect(editor.channels[0].clips).toHaveLength(1)
    })

    it('marks effect blocks anchored to both halves as dirty', () => {
      const id = editor.channels[0].id
      const c = editor.addClip(id, baseClip({ start: 0, outPoint: 6 }))
      const left = editor.addEffectBlock(id, 'grayscale', 1, 1)!
      const right = editor.addEffectBlock(id, 'blur', 4, 1)!
      editor.setEffectBlockNode(left.id, 'n1')
      editor.setEffectBlockNode(right.id, 'n2')
      editor.splitClip(c.id, 3)
      expect(editor.effectBlocks.find((b) => b.id === left.id)!.nodeId).toBeNull()
      expect(editor.effectBlocks.find((b) => b.id === right.id)!.nodeId).toBeNull()
    })
  })

  describe('transitions', () => {
    function findClip(chIndex: number, clipId: string) {
      return editor.channels[chIndex].clips.find((c) => c.id === clipId)!
    }

    it('addTransition between touching clips consumes handles on both sides', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 0, sourceDuration: 10 }))
      const right = editor.addClip(id, baseClip({ inPoint: 3, outPoint: 8, start: 5, sourceDuration: 10 }))
      const t = editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)
      expect(t).not.toBeNull()
      // 0.5s from the left tail + 0.5s from the right head → 1s overlap
      expect(findClip(0, left.id).outPoint).toBeCloseTo(5.5)
      expect(findClip(0, right.id).inPoint).toBeCloseTo(2.5)
      expect(findClip(0, right.id).start).toBeCloseTo(4.5)
      expect(editor.getClipOverlap(id, findClip(0, right.id)).left).toBeCloseTo(1)
      expect(editor.transitions).toHaveLength(1)
    })

    it('addTransition without handles slides the right clip into the left one', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 0, sourceDuration: 5 }))
      const right = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 5, sourceDuration: 5 }))
      const t = editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)
      expect(t).not.toBeNull()
      expect(findClip(0, left.id).outPoint).toBe(5) // untouched (no handles)
      expect(findClip(0, right.id).start).toBeCloseTo(4)
      expect(editor.getClipOverlap(id, findClip(0, right.id)).left).toBeCloseTo(1)
    })

    it('addTransition on an existing overlap only registers the type', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 4 })) // 1s overlap
      const t = editor.addTransition(id, left.id, right.id, 'wipe-left', 1)
      expect(t).not.toBeNull()
      expect(findClip(0, right.id).start).toBe(4) // geometry untouched
      expect(editor.transitions[0].effectId).toBe('wipe-left')
    })

    it('addTransition grows a small existing overlap up to the wanted duration', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 4 })) // 1s overlap
      editor.addTransition(id, left.id, right.id, 'cross-dissolve', 2)
      expect(editor.getClipOverlap(id, findClip(0, right.id)).left).toBeCloseTo(2)
    })

    it('addTransition caps the duration at the transition cap', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ inPoint: 0, outPoint: 5, start: 0, sourceDuration: 10 }))
      const right = editor.addClip(id, baseClip({ inPoint: 5, outPoint: 10, start: 5, sourceDuration: 10 }))
      editor.addTransition(id, left.id, right.id, 'cross-dissolve', 100)
      // cap = (5 - 0.1)/2 = 2.45
      expect(editor.getClipOverlap(id, findClip(0, right.id)).left).toBeCloseTo(2.45)
    })

    it('addTransition re-types an existing transition instead of duplicating it', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 4 }))
      editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)
      editor.addTransition(id, left.id, right.id, 'wipe-right', 1)
      expect(editor.transitions).toHaveLength(1)
      expect(editor.transitions[0].effectId).toBe('wipe-right')
    })

    it('addTransition rejects clips separated by a gap', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 7 }))
      expect(editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)).toBeNull()
      expect(findClip(0, right.id).start).toBe(7)
      expect(editor.transitions).toHaveLength(0)
    })

    it('removeTransition keeps the overlap (falls back to default crossfade)', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 4 }))
      const t = editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)!
      editor.removeTransition(t.id)
      expect(editor.transitions).toHaveLength(0)
      expect(editor.getClipOverlap(id, findClip(0, right.id)).left).toBeCloseTo(1)
    })

    it('pulling the clips apart removes the transition (DaVinci-style)', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 4 }))
      editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)
      expect(editor.transitions).toHaveLength(1)
      editor.moveClip(id, right.id, 5) // back to a plain butt cut
      expect(editor.transitions).toHaveLength(0)
    })

    it('removing a clip removes its transitions', () => {
      const id = editor.channels[0].id
      const left = editor.addClip(id, baseClip({ start: 0 }))
      const right = editor.addClip(id, baseClip({ start: 4 }))
      editor.addTransition(id, left.id, right.id, 'cross-dissolve', 1)
      editor.removeClip(id, left.id)
      expect(editor.transitions).toHaveLength(0)
    })
  })

  describe('getEffectLanes', () => {
    beforeEach(() => {
      while (editor.effectBlocks.length > 0) editor.removeEffectBlock(editor.effectBlocks[0].id)
    })

    it('returns empty array when no blocks', () => {
      const lanes = editor.getEffectLanes(editor.channels[0].id)
      expect(lanes).toHaveLength(0)
    })

    it('packs non-overlapping blocks in one lane', () => {
      editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 2)
      editor.addEffectBlock(editor.channels[0].id, 'grayscale', 3, 2)
      const lanes = editor.getEffectLanes(editor.channels[0].id)
      expect(lanes).toHaveLength(1)
      expect(lanes[0]).toHaveLength(2)
    })

    it('creates new lanes for overlapping blocks', () => {
      editor.addEffectBlock(editor.channels[0].id, 'blur', 0, 3)
      editor.addEffectBlock(editor.channels[0].id, 'grayscale', 1, 3)
      const lanes = editor.getEffectLanes(editor.channels[0].id)
      expect(lanes).toHaveLength(2)
    })
  })

  describe('packEffectLanes', () => {
    it('returns empty array for empty input', () => {
      expect(packEffectLanes([])).toHaveLength(0)
    })

    it('packs sorted blocks into lanes', () => {
      const blocks = [
        { id: 'b1', channelId: 'v1', effectId: 'blur', params: {}, start: 0, duration: 2, nodeId: null },
        { id: 'b2', channelId: 'v1', effectId: 'grayscale', params: {}, start: 2, duration: 2, nodeId: null },
      ] as any
      const lanes = packEffectLanes(blocks)
      expect(lanes).toHaveLength(1)
      expect(lanes[0]).toHaveLength(2)
    })

    it('sorts blocks by start before packing', () => {
      const blocks = [
        { id: 'b2', channelId: 'v1', effectId: 'blur', params: {}, start: 5, duration: 2, nodeId: null },
        { id: 'b1', channelId: 'v1', effectId: 'grayscale', params: {}, start: 0, duration: 2, nodeId: null },
      ] as any
      const lanes = packEffectLanes(blocks)
      expect(lanes[0][0].id).toBe('b1')
      expect(lanes[0][1].id).toBe('b2')
    })
  })
})
