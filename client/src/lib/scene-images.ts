export const MAX_SCENE_IMAGES = 4
export const MAX_SCENE_IMAGE_BYTES = 5 * 1024 * 1024

export interface SceneImageDraft {
  id: string
  file: File
  uploadName: string
  previewUrl: string
  description: string
}

export interface SceneImageInput {
  id: string
  file: string
  name: string
  description?: string
}

export function validateSceneImageFiles(files: File[], existingCount = 0): void {
  if (files.length + existingCount > MAX_SCENE_IMAGES) throw new Error(`Attach up to ${MAX_SCENE_IMAGES} images per request.`)
  for (const file of files) {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose JPEG, PNG or WebP images. PNG and WebP can preserve transparency.')
    if (!file.size || file.size > MAX_SCENE_IMAGE_BYTES) throw new Error('Choose images smaller than 5 MB each.')
    if (file.name.length > 255) throw new Error('Shorten the image filename to 255 characters or fewer.')
  }
}

export function sceneImageInputs(images: SceneImageDraft[]): SceneImageInput[] {
  validateSceneImageFiles(images.map(image => image.file))
  return images.map((image, index) => {
    const description = image.description.trim()
    if (Array.from(description).length > 600) throw new Error('Keep image directions within 600 characters.')
    return { id: `image_${index + 1}`, file: image.uploadName, name: image.file.name, ...(description ? { description } : {}) }
  })
}

export function validateEmbeddedSceneImages(value: unknown): asserts value is Record<string, string> | undefined {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The scene images are invalid.')
  const entries = Object.entries(value)
  if (entries.length > MAX_SCENE_IMAGES || entries.some(([id, source]) => !/^image_[1-4]$/.test(id) || typeof source !== 'string'
    || !/^data:image\/(png|jpeg|webp);base64,/.test(source) || source.length > Math.ceil(MAX_SCENE_IMAGE_BYTES / 3) * 4 + 64)) {
    throw new Error('The scene images are invalid. Generate this scene again.')
  }
}
