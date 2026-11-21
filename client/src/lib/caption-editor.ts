import type { TextItem } from '../stores/editor.svelte'
import { TEXT_FONTS } from './text-render'
import type { CaptionDraft } from './subtitles'
import type { ShortFormTextPreset } from './text-presets'

export type CaptionStyleKey = Exclude<keyof TextItem, 'id'>

export function commonCaptionValue(
  drafts: CaptionDraft[],
  key: CaptionStyleKey,
): string | number | boolean {
  if (drafts.length === 0) return ''
  const first = drafts[0][key]
  return drafts.every((draft) => draft[key] === first)
    ? first as string | number | boolean
    : ''
}

export function captionPreviewPosition(preset: ShortFormTextPreset): string {
  return liveCaptionPreviewPosition(preset.values)
}

/** Live position from the actual draft values (first caption), not the preset. */
export function liveCaptionPreviewPosition(values: Partial<TextItem> | null | undefined): string {
  const y = values?.y ?? 820
  return y < 450 ? 'top' : y < 700 ? 'middle' : 'bottom'
}

export function captionPreviewTextStyle(preset: ShortFormTextPreset): string {
  return captionTextStyleFromValues(preset.values)
}

/**
 * Live text style built from the first caption draft, so every tweak
 * (size, font, color, background, outline, treatment) shows in the preview.
 */
export function liveCaptionPreviewTextStyle(values: Partial<TextItem> | null | undefined): string {
  return captionTextStyleFromValues(values ?? {})
}

function captionTextStyleFromValues(values: Partial<TextItem>): string {
  const font = TEXT_FONTS.find((candidate) => candidate.id === values.fontFamily) ?? TEXT_FONTS[0]
  const backgroundOpacity = values.backgroundOpacity ?? 0
  const styles = [
    `font-family:${font.css}`,
    `font-weight:${values.fontWeight ?? 400}`,
    `font-size:${Math.max(8, Math.min(18, (values.fontSize ?? 58) / 7))}px`,
    values.italic ? 'font-style:italic' : '',
    `color:${values.color ?? '#ffffff'}`,
    `text-align:${values.align ?? 'center'}`,
    `align-items:${values.align === 'left' ? 'flex-start' : values.align === 'right' ? 'flex-end' : 'center'}`,
    backgroundOpacity > 0
      ? `background-color:color-mix(in srgb, ${values.backgroundColor ?? '#000000'} ${Math.round(backgroundOpacity * 100)}%, transparent)`
      : '',
    `border-radius:${Math.min(values.backgroundRadius ?? 4, 12)}px`,
    `padding:${Math.max(3, Math.round((values.backgroundPadding ?? 12) / 4))}px ${Math.max(5, Math.round((values.backgroundPadding ?? 12) / 3))}px`,
    values.rotation ? `transform:rotate(${values.rotation}deg)` : '',
    values.strokeWidth
      ? `text-shadow:0 1px 0 ${values.strokeColor ?? '#000000'}, 1px 0 0 ${values.strokeColor ?? '#000000'}, -1px 0 0 ${values.strokeColor ?? '#000000'}`
      : '',
  ]
  return styles.filter(Boolean).join(';')
}

export function captionPreviewSubtitleStyle(preset: ShortFormTextPreset, draft?: CaptionDraft | null): string {
  return liveCaptionPreviewSubtitleStyle({
    highlightMode: draft?.highlightMode ?? preset.values.highlightMode,
    highlightColor: draft?.highlightColor ?? preset.values.highlightColor,
    highlightBackgroundColor: draft?.highlightBackgroundColor ?? preset.values.highlightBackgroundColor,
    highlightBackgroundOpacity: draft?.highlightBackgroundOpacity ?? preset.values.highlightBackgroundOpacity,
    highlightAnimation: draft?.highlightAnimation ?? preset.values.highlightAnimation,
  })
}

/** Live active-word style built from the actual draft values. */
export function liveCaptionPreviewSubtitleStyle(values: Partial<TextItem> | null | undefined): string {
  if ((values?.highlightMode ?? 'none') !== 'word') return ''
  const wordBackgroundOpacity = Math.max(0, Math.min(1, values?.highlightBackgroundOpacity ?? 0))
  const styles = [
    `color:${values?.highlightColor ?? '#fff36d'}`,
    wordBackgroundOpacity > 0
      ? `background-color:color-mix(in srgb, ${values?.highlightBackgroundColor ?? '#000000'} ${Math.round(wordBackgroundOpacity * 100)}%, transparent)`
      : '',
    wordBackgroundOpacity > 0
      ? `box-shadow:0 0 0 3px color-mix(in srgb, ${values?.highlightBackgroundColor ?? '#000000'} ${Math.round(wordBackgroundOpacity * 100)}%, transparent)`
      : '',
    wordBackgroundOpacity > 0 ? 'border-radius:4px' : '',
    values?.highlightAnimation === 'glow' ? `text-shadow:0 0 8px ${values?.highlightColor ?? '#fff36d'}` : '',
  ]
  return styles.filter(Boolean).join(';')
}
