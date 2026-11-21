import data from './catalog.v1.json'
import type { ClipTransform } from './clip-transform'
import type { EffectDef, EffectParams, EffectRamp } from './effects'

export interface CatalogFrame {
  at: number
  transform: ClipTransform
}

export interface CatalogLook {
  id: string
  label: string
  category: string
  description: string
  popular: boolean
  motion?: string
  frames: CatalogFrame[]
  effects: Array<{
    id: string
    start: number
    length: { fraction: number; cap: number }
    params: EffectParams
    ramp: EffectRamp | null
    fpsParameter?: string
  }>
}

export interface CatalogMotion {
  id: string
  label: string
  hint: string
  cap: number
  frames: CatalogFrame[]
}

export const EDIT_CATALOG_VERSION = data.version
export const CATALOG_LOOKS = data.looks as unknown as readonly CatalogLook[]
export const CATALOG_MOTIONS = data.motions as unknown as readonly CatalogMotion[]
export const CATALOG_EFFECTS = data.effects as unknown as readonly EffectDef[]
export const CATALOG_TRANSITIONS = data.transitions as unknown as readonly EffectDef[]
export const CATALOG_TEXT_PRESETS = data.textPresets
