import type { DocumentClip, DocumentEffect, EditDocument } from './composition-types'
import type { CaptionDraft } from './subtitles'
import { stringify } from 'yaml'

type Rule = NonNullable<EditDocument['rules']>[number]

export type RecipeStarter = 'look' | 'captions' | 'image' | 'scene' | 'voice'

const captionStyleKeys = [
  'x', 'y', 'anchor', 'fontFamily', 'fontSize', 'fontWeight', 'italic', 'align', 'color',
  'strokeColor', 'strokeWidth', 'backgroundColor', 'backgroundOpacity',
  'backgroundPadding', 'backgroundRadius', 'bannerStyle', 'accentColor',
  'animation', 'animationDuration', 'opacity', 'rotation', 'highlightMode',
  'highlightColor', 'highlightBackgroundColor', 'highlightBackgroundOpacity',
  'highlightAnimation',
] as const

export function captionJobSnippet(wordsPerCaption: number, draft?: CaptionDraft, language = 'auto'): string {
  const style = draft ? Object.fromEntries(captionStyleKeys.map((key) => [key, draft[key]])) : undefined
  return stringify({ after: [{ id: 'captions', type: 'captions.generate', language, maxWords: wordsPerCaption, ...(style ? { style } : {}) }] }, { lineWidth: 0 })
}

export function speechJobSnippet(settings: { text: string; language?: string; model: string; voice?: string; referenceName?: string; referenceTranscript?: string; start: number }): string {
  return stringify({
    before: [{ id: 'voice', type: 'speech.generate', text: settings.text || 'Replace with narration text', language: settings.language ?? 'auto', model: settings.model, ...(settings.voice ? { voice: settings.voice } : {}), ...(settings.referenceName ? { referenceName: settings.referenceName, ...(settings.referenceTranscript ? { referenceTranscript: settings.referenceTranscript } : {}) } : {}) }],
    placements: [{ job: 'voice', track: { type: 'audio', role: 'narration' }, start: settings.start }],
  }, { lineWidth: 0 })
}

export function imageJobSnippet(settings: { prompt: string; model: string; aspect: string; background: string; imageStyle?: string; start: number; duration: number }): string {
  return stringify({
    before: [{ id: 'image', type: 'image.generate', prompt: settings.prompt || 'Replace with an image description', duration: settings.duration, model: settings.model, aspect: settings.aspect, background: settings.background, ...(settings.imageStyle ? { imageStyle: settings.imageStyle } : {}) }],
    placements: [{ job: 'image', track: { type: 'video', role: 'overlay' }, start: settings.start, duration: settings.duration }],
  }, { lineWidth: 0 })
}

export function starterRecipe(kind: RecipeStarter, output?: EditDocument['output']): EditDocument {
  const document: EditDocument = { version: 2, mode: 'modify', output }
  switch (kind) {
    case 'look':
      document.rules = [{ id: 'each-video', target: { kind: 'video', position: 'all' }, apply: { look: 'warm-memory', effect: { preset: 'vignette' } } }]
      break
    case 'captions':
      document.after = [{ id: 'captions', type: 'captions.generate', language: 'ro', maxWords: 4 }]
      break
    case 'image':
      document.before = [{ id: 'image', type: 'image.generate', prompt: 'A cinematic city at night', aspect: '16:9' }]
      document.placements = [{ job: 'image', track: { type: 'video', role: 'overlay' }, start: 5, duration: 5 }]
      break
    case 'voice':
      document.before = [{ id: 'voice', type: 'speech.generate', text: 'Salut! Bine ai venit.', language: 'ro' }]
      document.placements = [{ job: 'voice', track: { type: 'audio', role: 'narration' }, start: 0 }]
      document.after = [{ id: 'captions', type: 'captions.generate', language: 'ro', maxWords: 4 }]
      break
    case 'scene':
      document.before = [{ id: 'scene', type: 'scene.generate', prompt: 'A seed grows into a tree', duration: 8 }]
      document.placements = [{ job: 'scene', track: { type: 'video', role: 'scene' }, start: 0 }]
      break
  }
  return document
}

function clipStyle(clip: DocumentClip, effects: DocumentEffect[]) {
  const effect = effects.find((item) => item.ownerClipId === clip.id && !item.provenance?.rule.startsWith('look:'))
  return {
    ...(clip.look ? { look: clip.look } : {}),
    ...(clip.motion ? { motion: clip.motion } : {}),
    ...(effect ? { effect: { preset: effect.preset, params: effect.params, ...(effect.ramp ? { ramp: effect.ramp } : {}) } } : {}),
  }
}

export function generalizeDocument(document: EditDocument): EditDocument {
  const rules: Rule[] = []
  for (const track of document.tracks ?? []) {
    if (track.type !== 'video') continue
    const clips = [...track.clips].sort((left, right) => left.start - right.start)
    const styles = clips.map((clip) => clipStyle(clip, document.effects ?? []))
    if (!styles.length) continue
    const shared = Object.fromEntries(Object.entries(styles[0]).filter(([key, value]) =>
      styles.every((style) => JSON.stringify(style[key as keyof typeof style]) === JSON.stringify(value)))) as Rule['apply']
    if (Object.keys(shared).length) rules.push({ id: `${track.id}-each`, target: { kind: 'video', trackId: track.id, position: 'all' }, apply: shared })
    styles.forEach((style, index) => {
      const specific = Object.fromEntries(Object.entries(style).filter(([key, value]) =>
        JSON.stringify(shared[key as keyof typeof shared]) !== JSON.stringify(value))) as Rule['apply']
      if (!Object.keys(specific).length) return
      rules.push({ id: `${track.id}-${index + 1}`, target: { kind: 'video', trackId: track.id, position: 'nth', index: index + 1 }, apply: specific })
    })
  }
  return { version: 2, mode: 'modify', output: document.output, rules }
}
