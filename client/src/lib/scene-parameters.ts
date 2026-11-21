export interface SceneObjectParameters {
  x?: number
  y?: number
  z?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
  opacity?: number
  delay?: number
  duration?: number
  color?: string
}

export type SceneParameters = Record<string, SceneObjectParameters>

const ranges: Record<string, readonly [number, number]> = {
  x: [-19200, 19200], y: [-19200, 19200], z: [-19200, 19200],
  rotation: [-Math.PI * 100, Math.PI * 100], scaleX: [-100, 100], scaleY: [-100, 100],
  opacity: [0, 1], delay: [0, 60], duration: [0, 60],
}

export function validateSceneParameters(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) throw new Error('Invalid scene parameters')
  for (const [id, object] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || !object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Invalid scene parameter object')
    for (const [key, field] of Object.entries(object)) {
      if (key === 'color') {
        if (typeof field !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(field)) throw new Error('Invalid scene parameter color')
        continue
      }
      const range = Object.hasOwn(ranges, key) ? ranges[key] : undefined
      if (!range || typeof field !== 'number' || !Number.isFinite(field) || field < range[0] || field > range[1]) throw new Error('Invalid scene parameter value')
    }
  }
}
