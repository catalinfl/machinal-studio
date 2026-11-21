import { AI_IMAGE_MODELS } from './api'
import { DEFAULT_CLIP_TRANSFORM, type ClipTransform } from './clip-transform'
import { DEFAULT_SPEECH_MODEL, SPEECH_MODELS } from './speech'
import type { TextItem } from '../stores/editor.svelte'

type ActionBase = { id: string }

export type ImageAction = ActionBase & {
  kind: 'image'; prompt: string; model: string; aspect: string; background: string; imageStyle: string
  destination: 'timeline' | 'media-bin'; start: number; duration: number; transform: ClipTransform
}

export type VoiceAction = ActionBase & {
  kind: 'voice'; text: string; model: string; voiceMode: 'preset' | 'clone'; voice: string
  referenceName: string; referenceTranscript: string; destination: 'timeline' | 'media-bin'; start: number
}

export type SceneAction = ActionBase & {
  kind: 'scene'; operation: 'generate' | 'edit'; prompt: string; assetId: string; model: string; aspect: string
  destination: 'timeline' | 'media-bin'; start: number; duration: number
}

export type CaptionsAction = ActionBase & {
  kind: 'captions'; language: string; maxWords: number; preset: string; assetId: string; style: Partial<TextItem>
}

export type TextAction = ActionBase & {
  kind: 'text'; text: string; start: number; duration: number; preset: string
  x: number; y: number; fontSize: number; color: string
  presetValues?: Partial<TextItem>
}

export type RecipeAction = ImageAction | SceneAction | VoiceAction | CaptionsAction | TextAction
export type RecipeActionKind = RecipeAction['kind']

export const RECIPE_ACTION_TYPES = [
  { kind: 'image', label: 'Generate image', description: 'Describe a frame, choose its AI model and place it in your edit.' },
  { kind: 'scene', label: 'Generate / edit scene', description: 'Animate a prompt or edit an existing scene component, with its own duration.' },
  { kind: 'voice', label: 'Generate voice', description: 'Turn a script into narration with a built-in or sampled voice.' },
  { kind: 'captions', label: 'Generate captions', description: 'Caption the resulting edit, including generated narration.' },
  { kind: 'text', label: 'Add text', description: 'Place your own words with a style, position and timing.' },
] as const

export function createRecipeAction(kind: RecipeActionKind, id: string, start: number): RecipeAction {
  switch (kind) {
    case 'image':
      return { kind, id, prompt: '', model: AI_IMAGE_MODELS[0].id, aspect: '16:9', background: 'opaque', imageStyle: '',
        destination: 'timeline', start, duration: 5, transform: { ...DEFAULT_CLIP_TRANSFORM, zoomX: 0.62, zoomY: 0.62 } }
    case 'voice': {
      const model = SPEECH_MODELS.find((item) => item.id === DEFAULT_SPEECH_MODEL)!
      return { kind, id, text: '', model: model.id, voiceMode: 'preset', voice: model.defaultVoice ?? model.voices[0],
        referenceName: '', referenceTranscript: '', destination: 'timeline', start }
    }
    case 'scene':
      return { kind, id, operation: 'generate', prompt: '', assetId: '', model: '', aspect: '', destination: 'timeline', start, duration: 8 }
    case 'captions':
      return { kind, id, language: 'auto', maxWords: 4, preset: '', assetId: '', style: {} }
    case 'text':
      return { kind, id, text: '', start, duration: 5, preset: 'title', x: 960, y: 540, fontSize: 112, color: '#ffffff' }
  }
}

export function recipeActionError(action: RecipeAction): string | null {
  if (action.kind === 'captions') {
    if (!Number.isInteger(action.maxWords) || action.maxWords < 1 || action.maxWords > 50) return 'Use 1–50 words per caption.'
    return null
  }
  if (!Number.isFinite(action.start) || action.start < 0 || action.start > 86400) return 'Start must be between 0 and 86,400 seconds.'
  if ((action.kind === 'image' || action.kind === 'scene' || action.kind === 'text') && (!Number.isFinite(action.duration) || action.duration < 0.1 || action.start + action.duration > 86400)) {
    return 'Use a duration of at least 0.1 seconds, ending within 24 hours.'
  }
  if (action.kind === 'image') {
    if (!action.prompt.trim()) return 'Describe the image you want to generate.'
    if (Array.from(action.prompt).length > 4000) return 'Keep the image description within 4,000 characters.'
    const model = AI_IMAGE_MODELS.find((item) => item.id === action.model)
    if (!model) return 'Choose an available image model.'
    if (!(model.aspects as readonly string[]).includes(action.aspect)) return 'Choose an aspect ratio supported by this model.'
    if (action.background === 'transparent' && !model.transparent) return 'Choose a model that supports transparent backgrounds.'
    const transform = action.transform
    if (![transform.positionX, transform.positionY, transform.zoomX, transform.zoomY].every(Number.isFinite)
      || Math.abs(transform.positionX) > 100 || Math.abs(transform.positionY) > 100
      || transform.zoomX < 0.01 || transform.zoomX > 40 || transform.zoomY < 0.01 || transform.zoomY > 40) return 'Use a valid image position and scale.'
  } else if (action.kind === 'scene') {
    if (!action.prompt.trim()) return 'Describe the scene or the changes you want to make.'
    if (Array.from(action.prompt).length > 4000) return 'Keep the scene prompt within 4,000 characters.'
    if (action.duration < 1 || action.duration > 60) return 'Choose a scene length between 1 and 60 seconds.'
    if (action.operation === 'edit' && !action.assetId) return 'Choose an existing live scene to edit.'
  } else if (action.kind === 'voice') {
    if (!action.text.trim()) return 'Write the script you want to turn into speech.'
    if (Array.from(action.text).length > 4000) return 'Keep the script within 4,000 characters.'
    const model = SPEECH_MODELS.find((item) => item.id === action.model)
    if (!model) return 'Choose an available speech model.'
    if (action.voiceMode === 'clone' && (!model.cloning || !action.referenceName)) return 'Choose a server voice sample for a model that supports cloning.'
    if (action.voiceMode === 'preset' && !(model.voices as readonly string[]).includes(action.voice)) return 'Choose a built-in voice for this model.'
  } else {
    if (!action.text.trim()) return 'Write the text you want to place in the edit.'
    if (new TextEncoder().encode(action.text).length > 10000) return 'Keep the text within 10,000 bytes.'
    if (![action.x, action.y, action.fontSize].every(Number.isFinite) || action.fontSize < 8 || action.fontSize > 600
      || action.x < -3840 || action.x > 7680 || action.y < -3840 || action.y > 7680) return 'Use a valid text position and font size (8–600).'
  }
  return null
}

export function recipeActionDetail(action: RecipeAction): string {
  if (action.kind === 'captions') return `${action.language === 'auto' ? 'Auto language' : 'Romanian'} · ${action.maxWords} words per caption`
  if (action.kind === 'image') return action.destination === 'media-bin' ? 'Generate to Media Bin' : `${action.start}s–${Number((action.start + action.duration).toFixed(3))}s · image overlay`
  if (action.kind === 'scene') return `${action.operation === 'edit' ? 'Edit' : 'Generate'} · ${action.duration}s scene${action.destination === 'timeline' ? ` · from ${action.start}s` : ' · Media Bin'}`
  if (action.kind === 'voice') return action.destination === 'media-bin' ? 'Generate to Media Bin' : `From ${action.start}s · narration track`
  return `${action.start}s–${Number((action.start + action.duration).toFixed(3))}s · text overlay`
}
