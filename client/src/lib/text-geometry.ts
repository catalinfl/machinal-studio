import type { ProjectAspect } from '../stores/editor.svelte'

export function textDesignSize(aspect: ProjectAspect): { w: number; h: number } {
  if (aspect === 'portrait') return { w: 1080, h: 1920 }
  if (aspect === 'classic') return { w: 1440, h: 1080 }
  return { w: 1920, h: 1080 }
}

export function textSafeInsets(aspect: ProjectAspect): { left: number; right: number; top: number; bottom: number } {
  const design = textDesignSize(aspect)
  if (aspect === 'portrait') {
    return {
      left: Math.round(design.w * 0.07), right: Math.round(design.w * 0.15),
      top: Math.round(design.h * 0.09), bottom: Math.round(design.h * 0.19),
    }
  }
  const horizontal = Math.round(design.w * (aspect === 'classic' ? 0.06 : 0.05))
  const vertical = Math.round(design.h * (aspect === 'classic' ? 0.07 : 0.06))
  return { left: horizontal, right: horizontal, top: vertical, bottom: vertical }
}
