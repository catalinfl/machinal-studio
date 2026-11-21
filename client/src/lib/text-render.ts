import type { RenderTextPayload } from './api'
import type { ProjectAspect, TextFontFamily, TextHighlightAnimation, TextItem } from '../stores/editor.svelte'
import { textDesignSize, textSafeInsets } from './text-geometry'
import { fitCaptionLayout } from './caption-layout'

export const TEXT_DRAG_MIME = 'application/x-cineedit-text'
const WORD_PUNCH_DURATION = 0.22
const WORD_MOTION_FRAME_DURATION = 1 / 30
const WORD_POP_PEAK = 1.06
const MICROSECONDS_PER_SECOND = 1_000_000

export const TEXT_FONTS: ReadonlyArray<{ id: TextFontFamily; label: string; category: string; css: string }> = [
  { id: 'sans', label: 'Arial', category: 'Sans serif', css: 'Arial, Helvetica, sans-serif' },
  { id: 'system', label: 'System UI', category: 'Sans serif', css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'montserrat', label: 'Montserrat', category: 'TikTok-style captions', css: '"Montserrat Variable", Montserrat, Arial, sans-serif' },
  { id: 'open-sans', label: 'Open Sans', category: 'TikTok-style captions', css: '"Open Sans Variable", "Open Sans", Arial, sans-serif' },
  { id: 'roboto', label: 'Roboto', category: 'TikTok-style captions', css: '"Roboto Variable", Roboto, Arial, sans-serif' },
  { id: 'oswald', label: 'Oswald', category: 'TikTok-style captions', css: '"Oswald Variable", Oswald, Impact, sans-serif' },
  { id: 'lato', label: 'Lato', category: 'Google Sans serif', css: 'Lato, Arial, sans-serif' },
  { id: 'helvetica', label: 'Helvetica', category: 'Sans serif', css: 'Helvetica, Arial, sans-serif' },
  { id: 'verdana', label: 'Verdana', category: 'Sans serif', css: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', category: 'Sans serif', css: '"Trebuchet MS", Arial, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', category: 'Sans serif', css: 'Tahoma, Verdana, sans-serif' },
  { id: 'arial-black', label: 'Arial Black', category: 'Display', css: '"Arial Black", Arial, sans-serif' },
  { id: 'display', label: 'Impact', category: 'Display', css: 'Impact, Haettenschweiler, sans-serif' },
  { id: 'comic-sans', label: 'Comic Sans MS', category: 'Display', css: '"Comic Sans MS", cursive' },
  { id: 'serif', label: 'Georgia', category: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'playfair-display', label: 'Playfair Display', category: 'Google Serif', css: '"Playfair Display Variable", "Playfair Display", Georgia, serif' },
  { id: 'merriweather', label: 'Merriweather', category: 'Google Serif', css: '"Merriweather Variable", Merriweather, Georgia, serif' },
  { id: 'times', label: 'Times New Roman', category: 'Serif', css: '"Times New Roman", Times, serif' },
  { id: 'palatino', label: 'Palatino', category: 'Serif', css: 'Palatino, "Palatino Linotype", Georgia, serif' },
  { id: 'mono', label: 'Courier New', category: 'Monospace', css: '"Courier New", Courier, monospace' },
  { id: 'roboto-mono', label: 'Roboto Mono', category: 'Google Monospace', css: '"Roboto Mono Variable", "Roboto Mono", "Courier New", monospace' },
  { id: 'lucida-console', label: 'Lucida Console', category: 'Monospace', css: '"Lucida Console", Monaco, monospace' },
]

export const TEXT_FONT_CATEGORIES = [...new Set(TEXT_FONTS.map((font) => font.category))]

export interface TextSafeArea {
  left: number
  right: number
  top: number
  bottom: number
}

export function textSafeArea(aspect: ProjectAspect): TextSafeArea {
  return textSafeInsets(aspect)
}

export function textAnchorRatio(item: Pick<TextItem, 'anchor'>): number {
  return item.anchor === 'left' ? 0 : item.anchor === 'right' ? 1 : 0.5
}

export function fitTextItemPosition(item: TextItem, aspect: ProjectAspect): { x: number; y: number } {
  const design = textDesignSize(aspect)
  const safe = textSafeArea(aspect)
  const box = textRasterSize(item)
  const availableWidth = design.w - safe.left - safe.right
  const availableHeight = design.h - safe.top - safe.bottom
  const boxWidth = Math.min(box.width, availableWidth)
  const anchor = textAnchorRatio(item)
  const halfHeight = Math.min(box.height, availableHeight) / 2
  const minX = safe.left + boxWidth * anchor
  const maxX = design.w - safe.right - boxWidth * (1 - anchor)
  const minY = safe.top + halfHeight
  const maxY = design.h - safe.bottom - halfHeight
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, item.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, item.y))),
  }
}

export function textFontCSS(item: TextItem, scale = 1): string {
  const font = TEXT_FONTS.find((font) => font.id === item.fontFamily) ?? TEXT_FONTS[0]
  const embedded = ['montserrat', 'open-sans', 'roboto', 'oswald', 'lato', 'playfair-display', 'merriweather', 'roboto-mono'].includes(font.id)
  const fallback = ['serif', 'times', 'palatino'].includes(font.id)
    ? '"Merriweather Variable"'
    : ['mono', 'lucida-console'].includes(font.id) ? '"Roboto Mono Variable"'
      : ['display', 'arial-black'].includes(font.id) ? '"Oswald Variable"' : '"Roboto Variable"'
  const family = embedded ? font.css : `${fallback}, ${font.css}`
  return `${item.italic ? 'italic ' : ''}${item.fontWeight} ${item.fontSize * scale}px ${family}`
}

const pendingTextFonts = new Map<string, Promise<FontFace[]>>()

export function textFontsReady(item: TextItem): boolean {
  if (!document.fonts?.check) return true
  const font = textFontCSS(item)
  if (document.fonts.check(font, item.text)) return true
  const key = `${font}|${item.text}`
  if (!pendingTextFonts.has(key)) {
    const loading = document.fonts.load(font, item.text)
    pendingTextFonts.set(key, loading)
    void loading.catch(() => {}).finally(() => pendingTextFonts.delete(key))
  }
  return false
}

export function textItemSignature(item: TextItem, scale: number, activeWordIndex = -1, activeWordProgress = 1): string {
  const progressBucket = activeWordIndex < 0 ? 0 : Math.max(0, Math.min(16, Math.round(activeWordProgress * 16)))
  return [
    scale, item.text, item.fontFamily, item.fontSize, item.fontWeight, item.italic, item.anchor ?? 'center',
    item.align, item.color, item.strokeColor, item.strokeWidth,
    item.backgroundColor, item.backgroundOpacity, item.backgroundPadding, item.backgroundRadius,
    item.bannerStyle, item.accentColor,
    item.opacity, item.rotation, item.isCaption, item.highlightMode, item.highlightColor,
    item.highlightBackgroundColor ?? '#000000', item.highlightBackgroundOpacity ?? 0,
    item.highlightAnimation ?? 'pop',
    activeWordIndex, progressBucket,
  ].join('|')
}

export function activeCaptionWordIndex(item: TextItem, timelineTime: number): number {
  return activeCaptionWordState(item, timelineTime).index
}

export function activeCaptionWordState(item: TextItem, timelineTime: number): { index: number; progress: number } {
  if (!item.isCaption || item.highlightMode !== 'word') return { index: -1, progress: 0 }
  if (timelineTime < item.start || timelineTime >= item.start + item.duration) return { index: -1, progress: 0 }
  // Hold the accent until the next onset; measured speech gaps must not flash the base style.
  const index = item.words.findLastIndex((word) => timelineTime >= item.start + word.start)
  if (index < 0) return { index: -1, progress: 0 }
  const word = item.words[index]
  const progress = Math.max(0, Math.min(1, (timelineTime - (item.start + word.start)) / WORD_PUNCH_DURATION))
  return { index, progress }
}

function highlightAnimationOf(item: TextItem): TextHighlightAnimation {
  return (item as Partial<TextItem>).highlightAnimation ?? 'pop'
}

export function highlightWordScale(animation: TextHighlightAnimation, progress: number): number {
  const punch = Math.max(0, Math.min(1, progress))
  if (animation === 'pop') {
    if (punch < 0.4) return 1 + (WORD_POP_PEAK - 1) * (1 - Math.pow(1 - punch / 0.4, 2))
    const settle = (punch - 0.4) / 0.6
    return 1 + (WORD_POP_PEAK - 1) * (1 - settle * settle * (3 - 2 * settle))
  }
  if (animation === 'bounce') {
    return 1 + 0.04 * Math.cos(punch * Math.PI * 3) * Math.pow(1 - punch, 2)
  }
  return 1
}

export function layoutTextItem(item: TextItem, aspect: ProjectAspect): TextItem {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return item
  if (item.isCaption) return fitCaptionLayout(item, aspect, (text, fontSize) => {
    context.font = textFontCSS({ ...item, fontSize })
    return context.measureText(text).width
  })
  const design = textDesignSize(aspect)
  const safe = textSafeArea(aspect)
  const availableWidth = design.w - safe.left - safe.right
  const availableHeight = design.h - safe.top - safe.bottom
  let fitted = item
  for (let attempt = 0; attempt < 40; attempt++) {
    const size = textRasterSize(fitted)
    if (size.width <= availableWidth && size.height <= availableHeight) {
      return { ...fitted, ...fitTextItemPosition(fitted, aspect) }
    }
    const ratio = Math.min(0.95, availableWidth / size.width, availableHeight / size.height)
    const fontSize = Math.max(8, fitted.fontSize * ratio)
    if (fontSize === fitted.fontSize) break
    fitted = { ...fitted, fontSize }
  }
  throw new Error('Text cannot fit inside the frame; shorten it or reduce its padding')
}

export function highlightWordYOffsetRatio(animation: TextHighlightAnimation, progress: number): number {
  if (animation !== 'slide-up') return 0
  const punch = Math.max(0, Math.min(1, progress))
  return 0.38 * Math.pow(1 - punch, 3)
}

// Bounding box of the rasterized text in 1920x1080 design units (scale 1).
// Used by the renderer and by the inspector to keep the text on screen when
// the user repositions it via the layout grid.
export function measureTextItem(item: TextItem): { width: number; height: number } {
  const lines = item.text.split('\n')
  const measureContext = document.createElement('canvas').getContext('2d')
  if (!measureContext) return { width: 1, height: 1 }
  measureContext.font = textFontCSS(item)
  const lineHeight = item.fontSize * 1.2
  const edgePadding = Math.ceil(4)
  const boxPadding = item.backgroundOpacity > 0 ? item.backgroundPadding : 0
  const padding = Math.ceil(item.strokeWidth + boxPadding) + edgePadding
  const bannerInset = item.bannerStyle === 'block'
    ? Math.ceil(item.fontSize * 0.72)
    : item.bannerStyle === 'rail'
      ? Math.ceil(item.fontSize * 0.22)
      : 0
  const textWidth = Math.max(1, ...lines.map((line) => measureContext.measureText(line || ' ').width))
  return {
    width: Math.max(1, Math.ceil(textWidth + padding * 2 + bannerInset)),
    height: Math.max(1, Math.ceil(lines.length * lineHeight + padding * 2)),
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

interface TextRasterOptions {
  activeWordIndex?: number
  activeWordProgress?: number
}

export function textRasterSize(item: TextItem): { width: number; height: number } {
  const box = measureTextItem(item)
  const overflow = textEffectOverflow(item)
  const width = box.width + overflow * 2
  const height = box.height + overflow * 2
  const radians = (item.rotation ?? 0) * Math.PI / 180
  return {
    width: Math.ceil(width * Math.abs(Math.cos(radians)) + height * Math.abs(Math.sin(radians))),
    height: Math.ceil(height * Math.abs(Math.cos(radians)) + width * Math.abs(Math.sin(radians))),
  }
}

function textEffectOverflow(item: TextItem, scale = 1): number {
  if (!item.isCaption || item.highlightMode !== 'word') return 0
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return 0
  context.font = textFontCSS(item, scale)
  const widest = Math.max(0, ...item.text.split(/\s+/).filter(Boolean).map(word => context.measureText(word).width))
  const lineHeight = item.fontSize * 1.2 * scale
  const glow = highlightAnimationOf(item) === 'glow' ? item.fontSize * 0.55 * scale : 0
  const pill = (item.highlightBackgroundOpacity ?? 0) > 0 ? item.fontSize * 0.3 * scale : 0
  return Math.ceil(Math.max(widest, lineHeight) * (WORD_POP_PEAK - 1) / 2 + item.strokeWidth * scale + glow + pill + lineHeight * 0.22)
}

export function textAnimationOffset(
  item: Pick<TextItem, 'start' | 'duration' | 'animation' | 'animationDuration'>,
  timelineTime: number,
  frameWidth: number,
  itemWidth: number,
  topLeftX: number,
): number {
  if (item.animation === 'shake') {
    const motionDuration = Math.min(item.animationDuration, item.duration / 2)
    if (motionDuration <= 0) return 0
    const elapsed = Math.max(0, Math.min(item.duration, timelineTime - item.start))
    if (elapsed >= motionDuration) return 0
    const progress = elapsed / motionDuration
    return -itemWidth * 0.08 * Math.cos(progress * Math.PI * 6) * Math.pow(1 - progress, 2)
  }
  if (item.animation !== 'slide-left' && item.animation !== 'slide-right') return 0
  const motionDuration = Math.min(item.animationDuration, item.duration / 2)
  if (motionDuration <= 0) return 0
  const elapsed = Math.max(0, Math.min(item.duration, timelineTime - item.start))
  let amount = 0
  if (elapsed < motionDuration) {
    amount = Math.pow(1 - elapsed / motionDuration, 3)
  } else if (elapsed > item.duration - motionDuration) {
    amount = Math.pow((elapsed - (item.duration - motionDuration)) / motionDuration, 3)
  }
  if (amount === 0) return 0
  return item.animation === 'slide-left'
    ? -(topLeftX + itemWidth) * amount
    : (frameWidth - topLeftX) * amount
}

export function textAnimationYOffset(
  item: Pick<TextItem, 'start' | 'duration' | 'animation' | 'animationDuration'>,
  timelineTime: number,
  frameHeight: number,
): number {
  const elapsed = Math.max(0, Math.min(item.duration, timelineTime - item.start))
  if (item.animation === 'float') {
    if (item.duration <= 0) return 0
    return frameHeight * 0.025 * (1 - 2 * elapsed / item.duration)
  }
  if (item.animation !== 'rise' && item.animation !== 'pop' && item.animation !== 'drop' && item.animation !== 'bounce') return 0
  const motionDuration = Math.min(item.animationDuration, item.duration / 2)
  if (motionDuration <= 0) return 0
  const exitStart = item.duration - motionDuration
  if (elapsed < motionDuration) {
    const progress = elapsed / motionDuration
    if (item.animation === 'pop') return frameHeight * 0.07 * Math.pow(1 - progress, 5)
    if (item.animation === 'drop') return -frameHeight * 0.12 * Math.pow(1 - progress, 3)
    if (item.animation === 'bounce') return frameHeight * 0.08 * Math.cos(progress * Math.PI * 3) * Math.pow(1 - progress, 2)
    return frameHeight * 0.12 * Math.pow(1 - progress, 3)
  }
  if (elapsed > exitStart) {
    const progress = (elapsed - exitStart) / motionDuration
    const direction = item.animation === 'drop' ? -1 : 1
    const distance = item.animation === 'pop' ? 0.07 : item.animation === 'bounce' ? 0.08 : 0.12
    return direction * frameHeight * distance * Math.pow(progress, 3)
  }
  return 0
}

export function rasterizeTextCanvas(
  item: TextItem,
  scale = 1,
  options: TextRasterOptions = {},
): HTMLCanvasElement {
  const lines = item.text.split('\n')
  const activeWordIndex = options.activeWordIndex ?? -1
  const activeWordProgress = Math.max(0, Math.min(1, options.activeWordProgress ?? 1))
  const wordAnimation = highlightAnimationOf(item)
  const wordScale = activeWordIndex >= 0 ? highlightWordScale(wordAnimation, activeWordProgress) : 1
  const wordLiftRatio = activeWordIndex >= 0 ? highlightWordYOffsetRatio(wordAnimation, activeWordProgress) : 0
  const wordBackgroundOpacity = Math.max(0, Math.min(1, (item as Partial<TextItem>).highlightBackgroundOpacity ?? 0))
  const wordBackgroundColor = (item as Partial<TextItem>).highlightBackgroundColor ?? '#000000'
  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  if (!measureContext) return measureCanvas

  measureContext.font = textFontCSS(item, scale)
  const lineHeight = item.fontSize * 1.2 * scale
  const edgePadding = Math.ceil(4 * scale)
  const boxPadding = item.backgroundOpacity > 0 ? item.backgroundPadding : 0
  const padding = Math.ceil((item.strokeWidth + boxPadding) * scale) + edgePadding
  const measured = measureTextItem(item)
  const baseWidth = Math.max(1, Math.ceil(measured.width * scale))
  const baseHeight = Math.max(1, Math.ceil(measured.height * scale))
  // Keep the canvas centered and the same size for every word and every animation frame.
  const effectOverflow = textEffectOverflow(item, scale)
  const width = baseWidth + effectOverflow * 2
  const height = baseHeight + effectOverflow * 2

  const textCanvas = document.createElement('canvas')
  textCanvas.width = width
  textCanvas.height = height
  const context = textCanvas.getContext('2d')
  if (!context) return textCanvas

  if (item.backgroundOpacity > 0) {
    context.globalAlpha = item.opacity * item.backgroundOpacity
    context.fillStyle = item.backgroundColor
    roundedRect(
      context,
      effectOverflow + edgePadding,
      effectOverflow + edgePadding,
      baseWidth - edgePadding * 2,
      baseHeight - edgePadding * 2,
      item.backgroundRadius * scale,
    )
    context.fill()

    const accentWidth = item.bannerStyle === 'block'
      ? Math.max(12, Math.round(item.fontSize * 0.58 * scale))
      : Math.max(4, Math.round(item.fontSize * 0.12 * scale))
    context.globalAlpha = item.opacity
    context.fillStyle = item.accentColor
    if (item.bannerStyle === 'rail' || item.bannerStyle === 'block') {
      roundedRect(
        context,
        effectOverflow + edgePadding,
        effectOverflow + edgePadding,
        accentWidth,
        baseHeight - edgePadding * 2,
        item.bannerStyle === 'block' ? item.backgroundRadius * scale : Math.min(item.backgroundRadius * scale, accentWidth / 2),
      )
      context.fill()
    } else if (item.bannerStyle === 'underline') {
      const accentHeight = Math.max(4, Math.round(item.fontSize * 0.1 * scale))
      context.fillRect(
        effectOverflow + edgePadding,
        effectOverflow + baseHeight - edgePadding - accentHeight,
        baseWidth - edgePadding * 2,
        accentHeight,
      )
    }
  }

  context.font = textFontCSS(item, scale)
  context.textAlign = item.align === 'justify' ? 'left' : item.align
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.globalAlpha = item.opacity
  context.strokeStyle = item.strokeColor
  context.lineWidth = item.strokeWidth * 2 * scale
  const paintText = (line: string, x: number, y: number, color = item.color) => {
    context.fillStyle = color
    if (item.strokeWidth > 0) context.strokeText(line, x, y)
    context.fillText(line, x, y)
  }
  const bannerInset = item.bannerStyle === 'block'
    ? Math.ceil(item.fontSize * 0.72 * scale)
    : item.bannerStyle === 'rail'
      ? Math.ceil(item.fontSize * 0.22 * scale)
      : 0
  let wordOffset = 0
  lines.forEach((line, index) => {
    const y = effectOverflow + padding + lineHeight * (index + 0.5)
    const words = line.trim().split(/\s+/).filter(Boolean)
    const rendersWords = item.isCaption && item.highlightMode === 'word'
    if (!rendersWords) {
      context.textAlign = item.align === 'justify' ? 'left' : item.align
      if (item.align !== 'justify') {
        const x = item.align === 'left'
          ? effectOverflow + padding + bannerInset
          : item.align === 'right'
            ? effectOverflow + baseWidth - padding
            : effectOverflow + (baseWidth + bannerInset) / 2
        paintText(line, x, y)
        wordOffset += words.length
        return
      }
      if (words.length < 2 || index === lines.length - 1) {
        paintText(words.join(' '), effectOverflow + padding + bannerInset, y)
        wordOffset += words.length
        return
      }
    }
    if (words.length === 0) return
    context.textAlign = 'left'
    const wordWidths = words.map((word) => measureContext.measureText(word).width)
    const normalizedLine = words.join(' ')
    const isJustified = item.align === 'justify' && words.length > 1 && index !== lines.length - 1
    const gap = isJustified
      ? (baseWidth - padding * 2 - bannerInset - wordWidths.reduce((sum, wordWidth) => sum + wordWidth, 0)) / (words.length - 1)
      : measureContext.measureText(' ').width
    const displayLineWidth = isJustified
      ? baseWidth - padding * 2 - bannerInset
      : measureContext.measureText(normalizedLine).width
    let cursor = item.align === 'right'
      ? effectOverflow + baseWidth - padding - displayLineWidth
      : item.align === 'center'
        ? effectOverflow + (baseWidth + bannerInset - displayLineWidth) / 2
        : effectOverflow + padding + bannerInset
    words.forEach((word, wordIndex) => {
      const absoluteWordIndex = wordOffset + wordIndex
      if (absoluteWordIndex === activeWordIndex) {
        context.save()
        const lift = wordLiftRatio * item.fontSize * scale
        context.translate(cursor + wordWidths[wordIndex] / 2, y - lift)
        context.scale(wordScale, wordScale)
        context.textAlign = 'center'
        // The scale above would also thicken the outline until the stroke
        // color floods the glyph interior, so compensate it back to the
        // designed thickness while the word is enlarged.
        context.lineWidth = wordScale > 0
          ? (item.strokeWidth * 2 * scale) / wordScale
          : item.strokeWidth * 2 * scale
        if (wordBackgroundOpacity > 0) {
          const pillWidth = wordWidths[wordIndex] + item.fontSize * 0.42 * scale
          const pillHeight = lineHeight * 0.98
          const pillRadius = Math.min(pillHeight / 2, item.fontSize * 0.3 * scale)
          context.save()
          context.globalAlpha = item.opacity * wordBackgroundOpacity
          context.fillStyle = wordBackgroundColor
          context.shadowColor = 'transparent'
          context.shadowBlur = 0
          roundedRect(context, -pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight, pillRadius)
          context.fill()
          context.restore()
        }
        if (wordAnimation === 'glow') {
          context.shadowColor = item.highlightColor
          context.shadowBlur = item.fontSize * 0.45 * scale
        }
        paintText(word, 0, 0, item.highlightColor)
        context.restore()
      } else {
        paintText(word, cursor, y)
      }
      cursor += wordWidths[wordIndex] + gap
    })
    wordOffset += words.length
  })

  if (Math.abs(item.rotation) <= 0.001) return textCanvas
  const radians = item.rotation * Math.PI / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const rotated = document.createElement('canvas')
  rotated.width = Math.max(1, Math.ceil(width * cos + height * sin))
  rotated.height = Math.max(1, Math.ceil(width * sin + height * cos))
  const rotatedContext = rotated.getContext('2d')
  if (!rotatedContext) return textCanvas
  rotatedContext.translate(rotated.width / 2, rotated.height / 2)
  rotatedContext.rotate(radians)
  rotatedContext.drawImage(textCanvas, -width / 2, -height / 2)
  return rotated
}

async function canvasBase64(canvas: HTMLCanvasElement, synchronous = false): Promise<string> {
  if (synchronous) return canvas.toDataURL('image/png').split(',', 2)[1] ?? ''
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return canvas.toDataURL('image/png').split(',', 2)[1] ?? ''
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function buildRenderTextOverlays(items: TextItem[], width: number, height: number, aspect: ProjectAspect, options: { synchronousPNG?: boolean } = {}): Promise<RenderTextPayload[]> {
  if (items.length === 0) return []
  for (const item of items) {
    await document.fonts.load(textFontCSS(item), item.text)
  }
  await document.fonts.ready
  const overlays: RenderTextPayload[] = []
  for (const item of items) {
    overlays.push(...await buildRenderTextPayloads(item, width, height, aspect, options.synchronousPNG))
  }
  return overlays
}

export async function buildRenderTextPayload(
  item: TextItem,
  width: number,
  height: number,
  aspect?: ProjectAspect,
): Promise<RenderTextPayload> {
  const design = textDesignSize(aspect ?? (height > width ? 'portrait' : 'landscape'))
  item = layoutTextItem(item, aspect ?? (height > width ? 'portrait' : 'landscape'))
  const canvas = rasterizeTextCanvas(item, height / design.h)
  return {
    ...textOverlayTiming(item.start, item.start + item.duration),
    x: Math.round(item.x * width / design.w - canvas.width * textAnchorRatio(item)),
    y: Math.round(item.y * height / design.h - canvas.height / 2),
    ...(item.animation !== 'none' ? { animation: item.animation, animationDuration: item.animationDuration } : {}),
    image: await canvasBase64(canvas),
  }
}

function textOverlayTiming(start: number, end: number): Pick<RenderTextPayload, 'start' | 'duration'> {
  // The API stores microseconds. Round shared endpoints, not each raster's duration independently.
  const startMicros = Math.round(start * MICROSECONDS_PER_SECOND)
  const endMicros = Math.round(end * MICROSECONDS_PER_SECOND)
  return {
    start: startMicros / MICROSECONDS_PER_SECOND,
    duration: (endMicros - startMicros) / MICROSECONDS_PER_SECOND,
  }
}

export async function buildRenderTextPayloads(
  item: TextItem,
  width: number,
  height: number,
  aspect?: ProjectAspect,
  synchronousPNG = false,
): Promise<RenderTextPayload[]> {
  const design = textDesignSize(aspect ?? (height > width ? 'portrait' : 'landscape'))
  item = layoutTextItem(item, aspect ?? (height > width ? 'portrait' : 'landscape'))
  const scale = height / design.h
  const animated = item.animation !== 'none'
    ? {
        animation: item.animation,
        animationDuration: item.animationDuration,
        motionStart: item.start,
        motionDuration: item.duration,
      }
    : {}
  const payload = async (timing: Pick<RenderTextPayload, 'start' | 'duration'>, activeWordIndex = -1, activeWordProgress = 1): Promise<RenderTextPayload> => {
    const canvas = rasterizeTextCanvas(item, scale, { activeWordIndex, activeWordProgress })
    return {
      ...timing,
      x: Math.round(item.x * width / design.w - canvas.width * textAnchorRatio(item)),
      y: Math.round(item.y * height / design.h - canvas.height / 2),
      ...animated,
      image: await canvasBase64(canvas, synchronousPNG),
    }
  }
  if (!item.isCaption || item.highlightMode !== 'word') {
    return [await payload(textOverlayTiming(item.start, item.start + item.duration))]
  }

  const boundaries = new Set([0, item.duration])
  for (const word of item.words) {
    if (Number.isFinite(word.start)) boundaries.add(Math.max(0, Math.min(item.duration, word.start)))
  }
  const times = [...boundaries].sort((left, right) => left - right)
  const intervals: Array<{ start: number; end: number; activeWordIndex: number }> = []
  for (let index = 0; index < times.length - 1; index++) {
    const start = times[index]
    const end = times[index + 1]
    if (end <= start) continue
    const activeWordIndex = activeCaptionWordIndex(item, item.start + (start + end) / 2)
    const previous = intervals.at(-1)
    if (previous?.activeWordIndex === activeWordIndex) {
      previous.end = end
    } else {
      intervals.push({ start, end, activeWordIndex })
    }
  }
  const wordAnimation = highlightAnimationOf(item)
  const animatedWord = wordAnimation === 'pop' || wordAnimation === 'bounce' || wordAnimation === 'slide-up'
  const frames: Array<{ start: number; end: number; activeWordIndex: number; progress: number }> = []
  for (const interval of intervals) {
    if (interval.activeWordIndex < 0 || !animatedWord) {
      frames.push({ ...interval, progress: 1 })
      continue
    }
    const punchEnd = Math.min(interval.end, interval.start + WORD_PUNCH_DURATION)
    for (let frame = 0; interval.start + frame * WORD_MOTION_FRAME_DURATION < punchEnd; frame++) {
      const start = interval.start + frame * WORD_MOTION_FRAME_DURATION
      const end = Math.min(punchEnd, interval.start + (frame + 1) * WORD_MOTION_FRAME_DURATION)
      const progress = Math.min(1, ((start + end) / 2 - interval.start) / WORD_PUNCH_DURATION)
      frames.push({ start, end, activeWordIndex: interval.activeWordIndex, progress })
    }
    if (punchEnd < interval.end) {
      frames.push({ start: punchEnd, end: interval.end, activeWordIndex: interval.activeWordIndex, progress: 1 })
    }
  }
  const timedFrames = frames.map(frame => ({
    ...frame,
    timing: textOverlayTiming(item.start + frame.start, item.start + frame.end),
  })).filter(frame => frame.timing.duration > 0)
  return Promise.all(timedFrames.map((frame) => (
    payload(frame.timing, frame.activeWordIndex, frame.progress)
  )))
}
