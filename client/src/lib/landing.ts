import { stringify } from 'yaml'
import { CATALOG_LOOKS } from './edit-catalog'
import { getEffect } from './effects'

export const DEMO_CLIP_DURATION = 4
export const DEMO_OVERLAP = 0.6
export const DEMO_SCENES = [
  { id: 'opening', label: 'The idea', words: ['Good ideas', 'move forward.'], ground: '#c6adff', ink: '#262a30' },
  { id: 'next', label: 'The next move', words: ['Make your', 'next move.'], ground: '#222833', ink: '#c6adff' },
  { id: 'finish', label: 'Your direction', words: ['Your story.', 'Your direction.'], ground: '#f3f2ee', ink: '#7047c7' },
] as const

export type DemoSceneId = typeof DEMO_SCENES[number]['id']
export type DemoTool = 'media' | 'styles' | 'effects' | 'transitions' | 'text'
export type DemoClip = { id: DemoSceneId; look: string | null; effect: string | null }
export type DemoProject = { clips: DemoClip[]; selected: DemoSceneId; time: number; title: string | null; transition: string | null }

export const demoLooks = CATALOG_LOOKS.filter(look => ['warm-memory', 'silver-contrast', 'neon-night'].includes(look.id))
export const demoEffects = ['grayscale', 'prism', 'vignette'].flatMap(id => {
  const effect = getEffect(id)
  return effect ? [effect] : []
})

export const demoTransitions = ['cross-dissolve', 'slide-left', 'fade-black'].flatMap(id => {
  const transition = getEffect(id)
  return transition ? [transition] : []
})

export function demoLayout(project: Pick<DemoProject, 'clips' | 'transition'>) {
  const step = DEMO_CLIP_DURATION - (project.transition ? DEMO_OVERLAP : 0)
  return project.clips.map((clip, index) => ({ ...clip, start: index * step, end: index * step + DEMO_CLIP_DURATION }))
}

export function demoDuration(project: Pick<DemoProject, 'clips' | 'transition'>): number {
  return demoLayout(project).at(-1)?.end ?? DEMO_CLIP_DURATION
}

export function demoRecipe(project: DemoProject): string {
  const rules = project.clips.flatMap((clip, index) => {
    if (!clip.look && !clip.effect) return []
    return [{
      id: `shot-${index + 1}`,
      target: { kind: 'image', position: 'nth', index: index + 1 },
      apply: {
        ...(clip.look ? { look: clip.look } : {}),
        ...(clip.effect ? { effect: { preset: clip.effect } } : {}),
      },
    }]
  })
  return stringify({ version: 2, mode: 'modify', rules }, { lineWidth: 52 })
}

export const generationRecipe = `version: 2
mode: modify
before:
  - id: artwork
    type: image.generate
    prompt: A bold editorial cover
    aspect: '16:9'
  - id: voice
    type: speech.generate
    text: Your next story starts here.
placements:
  - job: artwork
    track: {type: video, role: overlay}
    start: 0
    duration: 4
  - job: voice
    track: {type: audio, role: voice}
    start: 0
after:
  - id: captions
    type: captions.generate
    language: auto
    maxWords: 4`

export function formatDemoTime(seconds: number): string {
  return `00:${String(Math.floor(seconds)).padStart(2, '0')}`
}
