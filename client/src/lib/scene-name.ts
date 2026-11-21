const SCENE_NAME_MAX_WORDS = 6
const SCENE_NAME_MAX_LENGTH = 60
const GENERATED_SCENE_FILE = /^ai_scene_[a-f0-9]{32}_(\d{2})\.(?:scene\.json|mp4)$/i

export function conciseSceneName(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const name = candidate.trim().replace(/\.(?:scene\.json|json|mp4)$/i, '').replace(/\s+/g, ' ').trim()
    if (!name || /^ai_scene_/i.test(name) || /^(?:(?:generated|edited) )?scene(?: \d+)?$/i.test(name)) continue
    const words = name.split(' ').slice(0, SCENE_NAME_MAX_WORDS)
    while (words.length > 1 && words.join(' ').length > SCENE_NAME_MAX_LENGTH) words.pop()
    return Array.from(words.join(' ')).slice(0, SCENE_NAME_MAX_LENGTH).join('')
  }
  return undefined
}

export function sceneFileDisplayName(file: string): string | undefined {
  const match = GENERATED_SCENE_FILE.exec(file)
  return match ? `Scene ${Number(match[1])}` : undefined
}
