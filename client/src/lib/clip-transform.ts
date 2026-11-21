// Per-clip spatial transform used by the Pixi.js preview. These are
// Resolve-style "Transform" clip settings:
//   Zoom X / Y     – scale the media (link flag scales both axes together)
//   Position X / Y – offset the media in screen space (percent of the screen)
//   Rotation Angle – in-plane rotation in degrees
//   Anchor X / Y   – the point within the media that zoom/rotation pivot on
//   Pitch / Yaw    – 3D tilt with a perspective projection (simulated in Pixi)
//   Flip H / V     – mirror the media horizontally / vertically
//
// The same values are sent to both preview and the FFmpeg export pipelines.

import { CATALOG_MOTIONS } from './edit-catalog'

export interface ClipTransform {
  zoomX: number
  zoomY: number
  linkZoom: boolean
  positionX: number // percent of screen width, -100..100
  positionY: number // percent of screen height, -100..100
  rotation: number // degrees, -180..180
  anchorX: number // framed-relative 0..1
  anchorY: number // framed-relative 0..1
  pitch: number // degrees around the horizontal screen axis, -90..90
  yaw: number // degrees around the vertical screen axis, -90..90
  flipH: boolean
  flipV: boolean
}

export interface ClipTransformKeyframe {
  // Timeline time relative to the start of the clip, in seconds.
  time: number
  transform: ClipTransform
}

export type LayerEntranceEffect = 'none' | 'fade' | 'focus' | 'lift' | 'drift-left' | 'drift-right'

export type LayerExitEffect = 'none' | 'fade' | 'zoom-out' | 'sink' | 'drift-left' | 'drift-right'

export const TRANSFORM_PRESETS = [
  { value: 'none', label: 'Static', hint: 'No animation' },
  { value: 'zoom-in', label: 'Slow push in', hint: 'Smooth focus zoom' },
  { value: 'zoom-out', label: 'Slow pull out', hint: 'Smooth scene reveal' },
  { value: 'punch', label: 'Punch in', hint: 'Quick emphasis zoom' },
  { value: 'zoom-pulse', label: 'Zoom pulse', hint: 'Beat-ready zoom hit' },
  { value: 'ken-burns', label: 'Photo pan & zoom', hint: 'Natural Ken Burns move' },
  { value: 'pan-left', label: 'Pan left', hint: 'Smooth horizontal move' },
  { value: 'pan-right', label: 'Pan right', hint: 'Smooth horizontal move' },
  { value: 'pan-up', label: 'Pan up', hint: 'Smooth vertical move' },
  { value: 'pan-down', label: 'Pan down', hint: 'Smooth vertical move' },
  { value: 'reframe-left', label: 'Reframe left', hint: 'Quick subject shift' },
  { value: 'reframe-right', label: 'Reframe right', hint: 'Quick subject shift' },
  { value: 'settle', label: 'Settle in', hint: 'Soft landing motion' },
  { value: 'whip-left', label: 'Whip left', hint: 'Fast directional settle' },
  { value: 'whip-right', label: 'Whip right', hint: 'Fast directional settle' },
  { value: 'impact-shake', label: 'Impact shake', hint: 'Short hook shake' },
  { value: 'drift', label: 'Drift', hint: 'Edge-safe camera glide' },
] as const

export type TransformPreset = (typeof TRANSFORM_PRESETS)[number]['value']

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  zoomX: 1,
  zoomY: 1,
  linkZoom: true,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  anchorX: 0.5,
  anchorY: 0.5,
  pitch: 0,
  yaw: 0,
  flipH: false,
  flipV: false,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Compose a ClipTransform from a partial patch, filling defaults and clamping
// every value to its supported range so stored state can never go out of range.
export function normalizeClipTransform(patch: Partial<ClipTransform> | undefined | null): ClipTransform {
  const pick = (key: keyof ClipTransform, fallback: number): number => {
    const candidate = Number(patch?.[key])
    return Number.isFinite(candidate) ? candidate : fallback
  }
  const defaultTransform = DEFAULT_CLIP_TRANSFORM
  let zoomY = clamp(pick('zoomY', defaultTransform.zoomY), 0.01, 40)
  if (patch?.linkZoom === true) zoomY = clamp(pick('zoomX', defaultTransform.zoomX), 0.01, 40)
  return {
    zoomX: clamp(pick('zoomX', defaultTransform.zoomX), 0.01, 40),
    zoomY,
    linkZoom: patch?.linkZoom ?? defaultTransform.linkZoom,
    positionX: clamp(pick('positionX', defaultTransform.positionX), -100, 100),
    positionY: clamp(pick('positionY', defaultTransform.positionY), -100, 100),
    rotation: clamp(pick('rotation', defaultTransform.rotation), -180, 180),
    anchorX: clamp(pick('anchorX', defaultTransform.anchorX), 0, 1),
    anchorY: clamp(pick('anchorY', defaultTransform.anchorY), 0, 1),
    pitch: clamp(pick('pitch', defaultTransform.pitch), -90, 90),
    yaw: clamp(pick('yaw', defaultTransform.yaw), -90, 90),
    flipH: patch?.flipH ?? defaultTransform.flipH,
    flipV: patch?.flipV ?? defaultTransform.flipV,
  }
}

// Effective transform of a clip: stored value if present, defaults otherwise.
export function clipTransform(clip: { transform?: ClipTransform | null }): ClipTransform {
  return normalizeClipTransform(clip.transform)
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function interpolateTransform(left: ClipTransform, right: ClipTransform, amount: number): ClipTransform {
  return normalizeClipTransform({
    zoomX: lerp(left.zoomX, right.zoomX, amount),
    zoomY: lerp(left.zoomY, right.zoomY, amount),
    linkZoom: amount < 0.5 ? left.linkZoom : right.linkZoom,
    positionX: lerp(left.positionX, right.positionX, amount),
    positionY: lerp(left.positionY, right.positionY, amount),
    rotation: lerp(left.rotation, right.rotation, amount),
    anchorX: lerp(left.anchorX, right.anchorX, amount),
    anchorY: lerp(left.anchorY, right.anchorY, amount),
    pitch: lerp(left.pitch, right.pitch, amount),
    yaw: lerp(left.yaw, right.yaw, amount),
    flipH: amount < 0.5 ? left.flipH : right.flipH,
    flipV: amount < 0.5 ? left.flipV : right.flipV,
  })
}

export function normalizeClipTransformKeyframe(keyframe: ClipTransformKeyframe): ClipTransformKeyframe {
  return {
    time: Number.isFinite(keyframe.time) ? Math.max(0, keyframe.time) : 0,
    transform: normalizeClipTransform(keyframe.transform),
  }
}

// Resolve the animated transform at a time relative to the clip start.
export function clipTransformAt(
  clip: { transform?: ClipTransform | null; transformKeyframes?: ClipTransformKeyframe[] | null },
  time = 0,
): ClipTransform {
  const base = clipTransform(clip)
  const keyframes = (clip.transformKeyframes ?? [])
    .map(normalizeClipTransformKeyframe)
    .sort((a, b) => a.time - b.time)
  if (keyframes.length === 0) return base
  if (time <= keyframes[0].time) return keyframes[0].transform
  const last = keyframes[keyframes.length - 1]
  if (time >= last.time) return last.transform
  for (let index = 1; index < keyframes.length; index++) {
    const right = keyframes[index]
    const left = keyframes[index - 1]
    if (time > right.time) continue
    const span = right.time - left.time
    return interpolateTransform(left.transform, right.transform, span > 0 ? (time - left.time) / span : 1)
  }
  return base
}

export function transformPreset(
  preset: TransformPreset,
  duration: number,
): { transform: ClipTransform; keyframes: ClipTransformKeyframe[] } {
  const length = Math.max(0.1, duration)
  const motion = CATALOG_MOTIONS.find((motion) => motion.id === preset)
  if (!motion) throw new Error(`Unknown motion preset: ${preset}`)
  const span = motion.cap ? Math.min(length, motion.cap) : length
  const keyframes = motion.frames.map((frame) => ({ time: frame.at * span, transform: { ...frame.transform } }))
  const last = keyframes.at(-1)
  if (last && last.time < length) keyframes.push({ time: length, transform: { ...last.transform } })
  return { transform: { ...DEFAULT_CLIP_TRANSFORM }, keyframes }
}

function entranceStartTransform(effect: LayerEntranceEffect, base: ClipTransform): ClipTransform {
  const startPatch: Partial<ClipTransform> = effect === 'focus'
    ? { zoomX: base.zoomX * 1.08, zoomY: base.zoomY * 1.08 }
    : effect === 'lift'
      ? { zoomX: base.zoomX * 1.025, zoomY: base.zoomY * 1.025, positionY: base.positionY + 7 }
      : { zoomX: base.zoomX * 1.05, zoomY: base.zoomY * 1.05, positionX: base.positionX + (effect === 'drift-left' ? -8 : 8) }
  return normalizeClipTransform({ ...base, ...startPatch })
}

function exitEndTransform(effect: LayerExitEffect, base: ClipTransform): ClipTransform {
  const endPatch: Partial<ClipTransform> = effect === 'zoom-out'
    ? { zoomX: base.zoomX * 1.08, zoomY: base.zoomY * 1.08 }
    : effect === 'sink'
      ? { zoomX: base.zoomX * 1.025, zoomY: base.zoomY * 1.025, positionY: base.positionY + 7 }
      : { zoomX: base.zoomX * 1.05, zoomY: base.zoomY * 1.05, positionX: base.positionX + (effect === 'drift-left' ? -8 : 8) }
  return normalizeClipTransform({ ...base, ...endPatch })
}

export function layerEntranceKeyframes(
  effect: LayerEntranceEffect,
  base: ClipTransform,
  duration: number,
  entranceDuration: number,
): ClipTransformKeyframe[] {
  if (effect === 'none' || effect === 'fade') return []

  const clipLength = Math.max(0.1, duration)
  const attack = Math.max(0.1, Math.min(clipLength, entranceDuration))
  const start = entranceStartTransform(effect, base)
  const baseNorm = normalizeClipTransform(base)
  const at = (time: number, amount: number): ClipTransformKeyframe => ({
    time,
    transform: interpolateTransform(start, baseNorm, amount),
  })
  const keyframes = [
    at(0, 0),
    at(attack * 0.18, 0.68),
    at(attack * 0.52, 0.94),
    at(attack, 1),
  ]
  if (attack < clipLength) keyframes.push({ time: clipLength, transform: baseNorm })
  return keyframes
}

export function layerExitKeyframes(
  effect: LayerExitEffect,
  base: ClipTransform,
  duration: number,
  exitDuration: number,
): ClipTransformKeyframe[] {
  if (effect === 'none' || effect === 'fade') return []

  const clipLength = Math.max(0.1, duration)
  const release = Math.max(0.1, Math.min(clipLength, exitDuration))
  const startTime = clipLength - release
  const baseNorm = normalizeClipTransform(base)
  const end = exitEndTransform(effect, base)
  const at = (time: number, amount: number): ClipTransformKeyframe => ({
    time,
    transform: interpolateTransform(baseNorm, end, amount),
  })
  return [
    at(startTime, 0),
    at(startTime + release * 0.48, 0.06),
    at(startTime + release * 0.82, 0.32),
    at(clipLength, 1),
  ]
}

export interface LayerMotion {
  entrance: LayerEntranceEffect
  exit: LayerExitEffect
  base: ClipTransform
  duration: number
  entranceDuration: number
  exitDuration: number
}

function entranceNeedsMotion(effect: LayerEntranceEffect): boolean {
  return effect !== 'none' && effect !== 'fade'
}

function exitNeedsMotion(effect: LayerExitEffect): boolean {
  return effect !== 'none' && effect !== 'fade'
}

export function layerMotionKeyframes(motion: LayerMotion): ClipTransformKeyframe[] {
  const entranceMotion = entranceNeedsMotion(motion.entrance)
  const exitMotion = exitNeedsMotion(motion.exit)
  if (!entranceMotion && !exitMotion) return []
  if (entranceMotion && !exitMotion) {
    return layerEntranceKeyframes(motion.entrance, motion.base, motion.duration, motion.entranceDuration)
  }
  if (!entranceMotion && exitMotion) {
    return layerExitKeyframes(motion.exit, motion.base, motion.duration, motion.exitDuration)
  }

  const clipLength = Math.max(0.1, motion.duration)
  let attack = Math.max(0.1, Math.min(clipLength, motion.entranceDuration))
  let release = Math.max(0.1, Math.min(clipLength, motion.exitDuration))
  if (attack + release > clipLength) {
    attack = clipLength * attack / (attack + release)
    release = clipLength - attack
  }
  const startTime = clipLength - release
  const baseNorm = normalizeClipTransform(motion.base)
  const entranceStart = entranceStartTransform(motion.entrance, motion.base)
  const exitEnd = exitEndTransform(motion.exit, motion.base)
  const entranceAt = (time: number, amount: number): ClipTransformKeyframe => ({
    time,
    transform: interpolateTransform(entranceStart, baseNorm, amount),
  })
  const exitAt = (time: number, amount: number): ClipTransformKeyframe => ({
    time,
    transform: interpolateTransform(baseNorm, exitEnd, amount),
  })
  const keyframes = [
    entranceAt(0, 0),
    entranceAt(attack * 0.18, 0.68),
    entranceAt(attack * 0.52, 0.94),
    entranceAt(attack, 1),
  ]
  if (attack < startTime - 1e-9) keyframes.push({ time: startTime, transform: baseNorm })
  keyframes.push(
    exitAt(startTime + release * 0.48, 0.06),
    exitAt(startTime + release * 0.82, 0.32),
    exitAt(clipLength, 1),
  )
  return keyframes.sort((a, b) => a.time - b.time)
}

export function clipTransformsEqual(a: ClipTransform, b: ClipTransform): boolean {
  return Object.keys(DEFAULT_CLIP_TRANSFORM).every(
    (key) => a[key as keyof ClipTransform] === b[key as keyof ClipTransform],
  )
}


