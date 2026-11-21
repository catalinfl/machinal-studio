import { clipEnd, clipPlaybackRate, editor, type Channel, type Clip, MIN_CLIP_LEN } from '../stores/editor.svelte'
import type { ContextMenuIcon, ContextMenuItem } from './context-menu'
import { mediaProcessing } from '../stores/media-processing.svelte'

export interface TimelineContextMenuContent {
  title: string
  detail: string
  icon: ContextMenuIcon
  items: ContextMenuItem[]
}

export function buildClipContextMenu(
  clip: Clip,
  channel: Channel,
  onOpenClipInspector?: () => void,
): TimelineContextMenuContent {
  const selected = editor.selectedClipIds.flatMap((id) => {
    const found = editor.getClipById(id)
    return found ? [found] : []
  })
  const audioSelection = selected.filter(({ channel: selectedChannel }) => selectedChannel.type === 'audio')
  const hasLockedTrack = selected.some(({ channel: selectedChannel, clip: selectedClip }) => {
    if (selectedChannel.locked) return true
    const linked = selectedClip.linkedClipId ? editor.getClipById(selectedClip.linkedClipId) : null
    return linked?.channel.locked ?? false
  })
  const audioLocked = audioSelection.some(({ channel: selectedChannel }) => selectedChannel.locked)
  const audioMuted = audioSelection.length > 0
    && audioSelection.every(({ clip: selectedClip }) => (selectedClip.volume ?? 100) === 0)
  const linkedSelection = selected.length === 1
    ? Boolean(selected[0].clip.linkedClipId)
    : selected.length === 2
      && selected[0].clip.linkedClipId === selected[1].clip.id
      && selected[1].clip.linkedClipId === selected[0].clip.id
  const canToggleLink = linkedSelection || (
    selected.length === 2 && selected[0].channel.type !== selected[1].channel.type
  )
  const customSpeed = selected.some(({ clip: selectedClip }) => Math.abs(clipPlaybackRate(selectedClip) - 1) > 0.001)
  const canSplit = !mediaProcessing.active
    && !channel.locked
    && editor.currentTime >= clip.start + MIN_CLIP_LEN
    && editor.currentTime <= clipEnd(clip) - MIN_CLIP_LEN
  const items: ContextMenuItem[] = [
    {
      type: 'action',
      label: selected.length > 1 ? `Inspect ${selected.length} clips` : 'Open inspector',
      icon: 'inspect',
      shortcut: 'Double-click',
      onSelect: () => onOpenClipInspector?.(),
    },
    {
      type: 'action',
      label: 'Split at playhead',
      icon: 'split',
      shortcut: 'C',
      disabled: !canSplit,
      onSelect: () => {
        if (!mediaProcessing.active) editor.splitClip(clip.id, editor.currentTime)
      },
    },
    { type: 'separator' },
    {
      type: 'action',
      label: selected.length > 1 ? `Copy ${selected.length} clips` : 'Copy clip',
      icon: 'copy',
      shortcut: 'Ctrl+C',
      onSelect: () => { editor.copySelectedClips() },
    },
  ]

  if (canToggleLink) {
    items.push({
      type: 'action',
      label: linkedSelection ? 'Unlink audio and video' : 'Link audio and video',
      icon: linkedSelection ? 'unlink' : 'link',
      shortcut: 'Ctrl+A',
      onSelect: () => { editor.toggleLinkSelectedClips() },
    })
  }

  if (audioSelection.length > 0) {
    items.push({
      type: 'action',
      label: audioSelection.length > 1 ? 'Mute selected audio' : 'Mute clip audio',
      icon: 'mute',
      checked: audioMuted,
      disabled: audioLocked,
      onSelect: () => {
        editor.beginHistory()
        try {
          for (const { clip: selectedClip } of audioSelection) {
            editor.setClipVolume(selectedClip.id, audioMuted ? 100 : 0)
          }
        } finally {
          editor.endHistory()
        }
      },
    })
  }

  if (customSpeed) {
    items.push({
      type: 'action',
      label: 'Reset speed to 1x',
      icon: 'speed',
      disabled: hasLockedTrack,
      onSelect: () => {
        editor.beginHistory()
        try {
          for (const { clip: selectedClip } of selected) editor.setClipPlaybackRate(selectedClip.id, 1)
        } finally {
          editor.endHistory()
        }
      },
    })
  }

  items.push(
    { type: 'separator' },
    {
      type: 'action',
      label: selected.length > 1 ? `Delete ${selected.length} clips` : 'Delete clip',
      icon: 'delete',
      shortcut: 'Del',
      destructive: true,
      onSelect: () => editor.removeSelectedItems(),
    },
  )

  return {
    title: clip.fileName,
    detail: `${channel.name} - ${(clipEnd(clip) - clip.start).toFixed(2)} s`,
    icon: channel.type,
    items,
  }
}

export function buildChannelContextMenu(channel: Channel): TimelineContextMenuContent {
  return {
    title: channel.name,
    detail: `${channel.type === 'video' ? 'Video' : 'Audio'} track - ${channel.clips.length} ${channel.clips.length === 1 ? 'clip' : 'clips'}`,
    icon: channel.type,
    items: [
      {
        type: 'action',
        label: 'Mute track',
        icon: 'mute',
        checked: channel.muted,
        onSelect: () => editor.toggleMute(channel.id),
      },
      {
        type: 'action',
        label: 'Lock track',
        icon: channel.locked ? 'lock' : 'unlock',
        checked: channel.locked,
        onSelect: () => editor.toggleLock(channel.id),
      },
      {
        type: 'action',
        label: 'Select clips on track',
        icon: 'track',
        disabled: channel.clips.length === 0,
        onSelect: () => editor.selectClips(channel.clips.map((candidate) => candidate.id)),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Add video track below',
        icon: 'video',
        onSelect: () => editor.addChannel('video', channel.id),
      },
      {
        type: 'action',
        label: 'Add audio track below',
        icon: 'audio',
        onSelect: () => editor.addChannel('audio', channel.id),
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Remove track',
        icon: 'delete',
        destructive: true,
        onSelect: () => editor.removeChannel(channel.id),
      },
    ],
  }
}
