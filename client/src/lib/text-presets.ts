import type { TextAnimation, TextHighlightAnimation, TextItem } from '../stores/editor.svelte'
import { TEXT_FONTS } from './text-render'
import { CATALOG_TEXT_PRESETS } from './edit-catalog'

export interface TextAnimationOption {
  id: TextAnimation
  label: string
  description: string
  usesDuration: boolean
}

export interface WordAnimationOption {
  id: TextHighlightAnimation
  label: string
  description: string
}

export const TEXT_ANIMATION_OPTIONS: readonly TextAnimationOption[] = [
  { id: 'none', label: 'None', description: 'Keep the text still', usesDuration: false },
  { id: 'pop', label: 'Hook pop', description: 'Fast punch from below', usesDuration: true },
  { id: 'rise', label: 'Rise from below', description: 'Smooth creator-style entrance', usesDuration: true },
  { id: 'drop', label: 'Drop from above', description: 'Confident top-down arrival', usesDuration: true },
  { id: 'bounce', label: 'Caption bounce', description: 'Damped landing for emphasis', usesDuration: true },
  { id: 'slide-left', label: 'Slide from left', description: 'Enter from the left edge', usesDuration: true },
  { id: 'slide-right', label: 'Slide from right', description: 'Enter from the right edge', usesDuration: true },
  { id: 'shake', label: 'Beat shake', description: 'Brief horizontal impact', usesDuration: true },
  { id: 'float', label: 'Gentle float', description: 'Drift upward through the cue', usesDuration: false },
]

export const WORD_ANIMATION_OPTIONS: readonly WordAnimationOption[] = [
  { id: 'pop', label: 'TikTok pop', description: 'Brief emphasis, then back to normal size' },
  { id: 'bounce', label: 'Bounce', description: 'Soft rebound that settles at normal size' },
  { id: 'slide-up', label: 'Slide up', description: 'Word rises from below' },
  { id: 'glow', label: 'Glow', description: 'Soft neon glow on the active word' },
  { id: 'none', label: 'Off', description: 'Color only, no word motion' },
]

export type CaptionStylePatch = Partial<Omit<TextItem, 'id' | 'sourceClipId' | 'start' | 'duration' | 'text' | 'x' | 'y' | 'words'>>

export interface TextPanelPreset {
  id?: string
  label: string
  description: string
  variant: string
  values: Partial<TextItem>
  previewTitle?: string
  previewSubtitle?: string
}

export interface ShortFormTextPreset extends TextPanelPreset {
  id: string
  previewTitle: string
  captionValues?: CaptionStylePatch
}

const panelIDs = new Set(['title', 'subtitle', 'lower-third', 'caption', 'social-hook', 'quote', 'breaking-news', 'callout', 'credits', 'watermark'])
const bannerIDs = new Set(['cobalt-rail', 'signal-block', 'electric-line', 'lime-label'])
const presets = CATALOG_TEXT_PRESETS as unknown as readonly ShortFormTextPreset[]
export const SHORT_FORM_TEXT_PRESETS: readonly ShortFormTextPreset[] = presets.filter((preset) => !panelIDs.has(preset.id) && !bannerIDs.has(preset.id))
export const TEXT_PANEL_PRESETS: readonly TextPanelPreset[] = presets.filter((preset) => panelIDs.has(preset.id))
export const BANNER_TEXT_PRESETS: readonly TextPanelPreset[] = presets.filter((preset) => bannerIDs.has(preset.id))

// Best text-first order for the Edit captions Style preset dropdown.
// Strictly the most readable caption-special presets first, then the rest.
export const BEST_TEXT_PRESET_IDS: readonly string[] = [
  'tiktok-pop',
  'tiktok-box',
  'tiktok-glow',
  'active-word',
  'hook-pop',
  'clean-phrase',
  'clean-outline',
  'caption-bounce',
  'color-block',
  'payoff-line',
  'keyword-punch',
]

const bestTextOrder = new Map(BEST_TEXT_PRESET_IDS.map((id, index) => [id, index]))

export const BEST_TEXT_PRESETS: readonly ShortFormTextPreset[] = BEST_TEXT_PRESET_IDS.flatMap((id) => {
  const preset = SHORT_FORM_TEXT_PRESETS.find((candidate) => candidate.id === id)
  return preset ? [preset] : []
})

export const MORE_TEXT_PRESETS: readonly ShortFormTextPreset[] = SHORT_FORM_TEXT_PRESETS.filter(
  (preset) => !bestTextOrder.has(preset.id),
)

const DEFAULT_CAPTION_STYLE: CaptionStylePatch = {
  fontFamily: 'montserrat', fontSize: 58, fontWeight: 700, italic: false, align: 'center',
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 4, backgroundColor: '#000000',
  backgroundOpacity: 0, backgroundPadding: 18, backgroundRadius: 8, bannerStyle: 'none',
  accentColor: '#7047c7', animation: 'none', animationDuration: 0.45, opacity: 1, rotation: 0,
  isCaption: true, highlightMode: 'none', highlightColor: '#fff36d', highlightBackgroundColor: '#000000',
  highlightBackgroundOpacity: 0, highlightAnimation: 'pop',
}

export function captionStyleForPreset(preset: ShortFormTextPreset): CaptionStylePatch {
  const style: CaptionStylePatch = { ...DEFAULT_CAPTION_STYLE }
  for (const key of Object.keys(DEFAULT_CAPTION_STYLE) as Array<keyof CaptionStylePatch>) {
    const value = preset.values[key]
    if (value !== undefined) Object.assign(style, { [key]: value })
  }
  return Object.assign(style, preset.captionValues)
}

export function textPresetSampleStyle(values: Partial<TextItem>): string {
  const font = TEXT_FONTS.find((candidate) => candidate.id === values.fontFamily) ?? TEXT_FONTS[0]
  return [
    `font-family:${font.css}`,
    `font-weight:${values.fontWeight ?? 400}`,
    values.italic ? 'font-style:italic' : '',
    values.color ? `color:${values.color}` : '',
    values.backgroundColor ? `--banner-bg:${values.backgroundColor}` : '',
    values.accentColor ? `--banner-accent:${values.accentColor}` : '',
  ].filter(Boolean).join(';')
}

export function textAnimationOption(animation: TextAnimation | undefined): TextAnimationOption {
  return TEXT_ANIMATION_OPTIONS.find((option) => option.id === animation) ?? TEXT_ANIMATION_OPTIONS[0]
}

export function wordAnimationOption(animation: TextHighlightAnimation | undefined): WordAnimationOption {
  return WORD_ANIMATION_OPTIONS.find((option) => option.id === animation) ?? WORD_ANIMATION_OPTIONS[0]
}
