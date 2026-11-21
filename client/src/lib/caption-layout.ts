import type { ProjectAspect, TextItem } from '../stores/editor.svelte'
import { textDesignSize, textSafeInsets } from './text-geometry'

type MeasureText = (text: string, fontSize: number) => number
const MAX_CAPTION_FIT_ATTEMPTS = 64

function wrapCaption(words: string[], available: number, fontSize: number, measure: MeasureText): string[] {
  const lines = ['']
  for (const word of words) {
    const last = lines.length - 1
    const candidate = lines[last] ? `${lines[last]} ${word}` : word
    if (lines[last] && measure(candidate, fontSize) > available) lines.push(word)
    else lines[last] = candidate
  }
  return lines
}

export function fitCaptionLayout(item: TextItem, aspect: ProjectAspect, measure: MeasureText): TextItem {
  if (!item.isCaption) return item
  if (![item.fontSize, item.strokeWidth, item.x, item.y].every(Number.isFinite) || item.fontSize <= 0 || item.strokeWidth < 0
    || (item.backgroundOpacity > 0 && !Number.isFinite(item.backgroundPadding))) {
    throw new Error('Caption style is incomplete or invalid. Review its font size and position in Text; saved text and timing have not been changed.')
  }

  const design = textDesignSize(aspect)
  const safe = textSafeInsets(aspect)
  const width = design.w - safe.left - safe.right
  const padding = 2 * (item.strokeWidth + (item.backgroundOpacity > 0 ? item.backgroundPadding : 0) + 4)
  const words = item.text.trim().split(/\s+/)
  let fontSize = item.fontSize
  const minimumReadableSize = Math.min(fontSize, 24)
  const anchor = item.anchor === 'left' ? 0 : item.anchor === 'right' ? 1 : 0.5

  for (let attempt = 0; attempt < MAX_CAPTION_FIT_ATTEMPTS; attempt++) {
    const widestWord = Math.max(0, ...words.map(word => measure(word, fontSize)))
    const lineHeight = fontSize * 1.2
    const glow = item.highlightAnimation === 'glow' ? fontSize * 0.55 : 0
    const pill = (item.highlightBackgroundOpacity ?? 0) > 0 ? fontSize * 0.3 : 0
    const overflow = item.highlightMode === 'word'
      ? Math.ceil(Math.max(widestWord, lineHeight) * 0.03 + item.strokeWidth + glow + pill + lineHeight * 0.22)
      : 0
    const effects = overflow * 2
    const available = Math.max(1, width - padding - effects)
    const lines = wrapCaption(words, available, fontSize, measure)
    const baseWidth = Math.ceil(Math.max(...lines.map(line => measure(line, fontSize))) + padding) + effects
    const baseHeight = Math.ceil(lines.length * lineHeight + padding) + effects
    const radians = (item.rotation ?? 0) * Math.PI / 180
    const measuredWidth = Math.ceil(baseWidth * Math.abs(Math.cos(radians)) + baseHeight * Math.abs(Math.sin(radians)))
    const measuredHeight = Math.ceil(baseHeight * Math.abs(Math.cos(radians)) + baseWidth * Math.abs(Math.sin(radians)))
    if (lines.length <= 2 && measuredWidth <= width && measuredHeight <= design.h - safe.top - safe.bottom) {
      return {
        ...item,
        text: lines.join('\n'),
        fontSize,
        x: Math.max(safe.left + measuredWidth * anchor, Math.min(design.w - safe.right - measuredWidth * (1 - anchor), item.x)),
        y: Math.max(safe.top + measuredHeight / 2, Math.min(design.h - safe.bottom - measuredHeight / 2, item.y)),
      }
    }
    if (fontSize <= minimumReadableSize) throw new Error('Caption cannot fit legibly in two lines; split it into shorter timed captions')
    fontSize = Math.max(minimumReadableSize, fontSize * 0.9)
  }
  throw new Error('Caption fitting exceeded its safe limit. Review the caption style in Text; saved text and timing have not been changed.')
}
