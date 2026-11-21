export type ContextMenuIcon =
  | 'audio'
  | 'copy'
  | 'delete'
  | 'eye'
  | 'inspect'
  | 'link'
  | 'lock'
  | 'mute'
  | 'speed'
  | 'split'
  | 'track'
  | 'unlink'
  | 'unlock'
  | 'video'

export interface ContextMenuAction {
  type: 'action'
  label: string
  icon: ContextMenuIcon
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  destructive?: boolean
  onSelect: () => void
}

export interface ContextMenuSeparator {
  type: 'separator'
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator
