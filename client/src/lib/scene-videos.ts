export const MAX_SCENE_VIDEOS = 2
export const MAX_SCENE_VIDEO_BYTES = 20 * 1024 * 1024

export const SCENE_VIDEO_LOOKS = [
  ['original', 'Original'], ['cinematic', 'Cinematic'], ['noir', 'Black & white'], ['vintage', 'Vintage'],
  ['warm', 'Warm'], ['cool', 'Cool'], ['vivid', 'Vivid'], ['faded', 'Faded'], ['dreamy', 'Dreamy'],
  ['dramatic', 'Dramatic'], ['sepia', 'Sepia'], ['negative', 'Negative'], ['night', 'Night'], ['retro', 'Retro scanlines'],
] as const

export type SceneVideoLook = typeof SCENE_VIDEO_LOOKS[number][0]

export interface SceneVideoDraft {
  id: string
  file: File
  uploadName: string
  previewUrl: string
  description: string
  look: SceneVideoLook
}

export interface SceneVideoInput {
  id: string
  file: string
  name: string
  description?: string
  look: SceneVideoLook
}

export function validateSceneVideoFiles(files: File[], existingCount = 0): void {
  if (files.length + existingCount > MAX_SCENE_VIDEOS) throw new Error(`Attach up to ${MAX_SCENE_VIDEOS} videos per request.`)
  for (const file of files) {
    if (!/\.(mp4|webm)$/i.test(file.name) || !['video/mp4', 'video/webm'].includes(file.type)) throw new Error('Choose H.264 MP4 or VP8/VP9 WebM videos.')
    if (!file.size || file.size > MAX_SCENE_VIDEO_BYTES) throw new Error('Choose videos smaller than 20 MB each.')
    if (file.name.length > 255) throw new Error('Shorten the video filename to 255 characters or fewer.')
  }
}

export function sceneVideoInputs(videos: SceneVideoDraft[]): SceneVideoInput[] {
  validateSceneVideoFiles(videos.map(video => video.file))
  return videos.map((video, index) => {
    const description = video.description.trim()
    if (Array.from(description).length > 600) throw new Error('Keep video directions within 600 characters.')
    if (!SCENE_VIDEO_LOOKS.some(([id]) => id === video.look)) throw new Error('Choose an available video look.')
    return { id: `video_${index + 1}`, file: video.uploadName, name: video.file.name, look: video.look, ...(description ? { description } : {}) }
  })
}

export function validateEmbeddedSceneVideos(value: unknown): asserts value is Record<string, string> | undefined {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The scene videos are invalid.')
  const entries = Object.entries(value)
  if (entries.length > MAX_SCENE_VIDEOS || entries.some(([id, source]) => !/^video_[1-2]$/.test(id) || typeof source !== 'string'
    || !/^data:video\/(mp4|webm);base64,/.test(source) || source.length > Math.ceil(MAX_SCENE_VIDEO_BYTES / 3) * 4 + 64)) {
    throw new Error('The scene videos are invalid. Generate this scene again.')
  }
}
