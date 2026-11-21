import type { EffectParams, EffectRamp } from './effects'
import { CATALOG_LOOKS } from './edit-catalog'
import { DEFAULT_CLIP_TRANSFORM, transformPreset, type ClipTransform, type ClipTransformKeyframe, type TransformPreset } from './clip-transform'

export const CLIP_LOOK_DRAG_MIME = 'application/x-cineedit-clip-look'
export const CLIP_LOOKS = CATALOG_LOOKS
export type ClipLookId = (typeof CLIP_LOOKS)[number]['id']

export interface ClipLookEffect {
  effectId: string
  offset: number
  duration: number
  params: EffectParams
  ramp: EffectRamp | null
}

export interface ResolvedClipLook {
  transform: ClipTransform
  transformKeyframes: ClipTransformKeyframe[]
  effects: ClipLookEffect[]
}

export function resolveClipLook(preset: ClipLookId, duration: number, fps: number): ResolvedClipLook {
  const look = CATALOG_LOOKS.find((look) => look.id === preset)
  if (!look) throw new Error(`Unknown clip look: ${preset}`)
  const length = Math.max(0.1, Number.isFinite(duration) ? duration : 0.1)
  const safeFps = Math.max(1, Number.isFinite(fps) ? fps : 30)
  const frames = look.motion
    ? transformPreset(look.motion as TransformPreset, length).keyframes
    : look.frames.map((frame) => ({ time: frame.at * length, transform: { ...frame.transform } }))
  return {
    transform: { ...DEFAULT_CLIP_TRANSFORM },
    transformKeyframes: frames,
    effects: look.effects.map((effect) => {
      const offset = Math.max(0, Math.min(length - 0.001, effect.start * length))
      const requested = Math.min(length * effect.length.fraction, effect.length.cap || Infinity)
      return {
        effectId: effect.id,
        offset,
        duration: Math.max(0.001, Math.min(length - offset, requested)),
        params: {
          ...effect.params,
          ...(effect.fpsParameter ? { [effect.fpsParameter]: Math.max(2, Math.round(safeFps * 0.1)) } : {}),
        },
        ramp: effect.ramp ? { ...effect.ramp } : null,
      }
    }),
  }
}
