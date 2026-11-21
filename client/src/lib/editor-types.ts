import type { EffectParams, EffectRamp } from './effects'
import type { ClipLookId } from './clip-looks'
import type { ClipTransform, ClipTransformKeyframe, LayerEntranceEffect, LayerExitEffect, TransformPreset } from './clip-transform'
import type { Provenance } from './composition-types'

export type MediaKind = 'video' | 'audio' | 'image'

export interface Clip {
  id: string
  provenance?: Provenance
  fileName: string
  sourceMode?: 'proxy' | 'wasm'
  sourceId?: string
  mediaKind?: MediaKind
  scrubBlobUrl: string | null
  sourceDuration: number
  // Source-window times are seconds; start is a timeline time.
  inPoint: number
  outPoint: number
  start: number
  playbackRate?: number
  linkedClipId?: string
  volume?: number // Whole percent, 0–200; default 100.
  transform?: ClipTransform
  transformKeyframes?: ClipTransformKeyframe[]
  motionPreset?: TransformPreset
  layerEntrance?: LayerEntranceEffect
  layerExit?: LayerExitEffect
  opacity?: number
  fadeIn?: number
  fadeOut?: number
}

export interface Channel {
  id: string
  type: 'video' | 'audio'
  name: string
  clips: Clip[]
  muted: boolean
  hidden: boolean
  locked: boolean
}

export interface EffectBlock {
  id: string
  provenance?: Provenance
  channelId: string
  effectId: string
  params: EffectParams
  ramp: EffectRamp | null
  start: number
  duration: number
  nodeId: string | null
  ownerClipId?: string
  clipLookId?: ClipLookId
}

export type TextFontFamily =
  | 'sans' | 'system' | 'roboto' | 'open-sans' | 'lato' | 'montserrat' | 'oswald'
  | 'helvetica' | 'verdana' | 'trebuchet' | 'tahoma' | 'arial-black'
  | 'serif' | 'playfair-display' | 'merriweather' | 'times' | 'palatino'
  | 'mono' | 'roboto-mono' | 'lucida-console' | 'display' | 'comic-sans'
export type TextAlign = 'left' | 'center' | 'right' | 'justify'
export type TextHighlightMode = 'none' | 'word'
export type TextHighlightAnimation = 'pop' | 'bounce' | 'slide-up' | 'glow' | 'none'
export type TextBannerStyle = 'none' | 'rail' | 'block' | 'underline'
export type TextAnimation = 'none' | 'slide-left' | 'slide-right' | 'rise' | 'pop' | 'drop' | 'bounce' | 'shake' | 'float'

export interface TimedTextWord {
  text: string
  start: number
  end: number
}

export interface TextItem {
  id: string
  sourceClipId?: string
  start: number
  duration: number
  text: string
  x: number
  y: number
  anchor?: 'left' | 'center' | 'right'
  fontFamily: TextFontFamily
  fontSize: number
  fontWeight: 400 | 700
  italic: boolean
  align: TextAlign
  color: string
  strokeColor: string
  strokeWidth: number
  backgroundColor: string
  backgroundOpacity: number
  backgroundPadding: number
  backgroundRadius: number
  bannerStyle: TextBannerStyle
  accentColor: string
  animation: TextAnimation
  animationDuration: number
  opacity: number
  rotation: number
  isCaption: boolean
  highlightMode: TextHighlightMode
  highlightColor: string
  highlightBackgroundColor: string
  highlightBackgroundOpacity: number
  highlightAnimation: TextHighlightAnimation
  words: TimedTextWord[]
}

export interface Transition {
  id: string
  channelId: string
  leftClipId: string
  rightClipId: string
  effectId: string
}

export type Resolution = '480p' | '720p' | '1080p' | '2k' | '4k'
export type ProjectAspect = 'landscape' | 'portrait' | 'classic'
