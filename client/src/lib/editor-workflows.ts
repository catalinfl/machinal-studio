export type EditorWorkflow = 'reel' | 'montage' | 'narrated'

export const EDITOR_WORKFLOWS = [
  { id: 'reel', name: 'Captioned reel', detail: 'Portrait framing, your clips, then captions.', aspect: 'portrait' },
  { id: 'montage', name: 'My media montage', detail: 'Arrange your own videos and photos.', aspect: 'landscape' },
  { id: 'narrated', name: 'Narrated video', detail: 'Write a voiceover, then build around it.', aspect: 'landscape' },
] as const
