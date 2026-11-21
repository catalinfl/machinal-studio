export type VideoFit = 'contain' | 'cover'

export function videoFitScale(sourceWidth: number, sourceHeight: number, width: number, height: number, fit: VideoFit): number {
  const scaleX = width / sourceWidth
  const scaleY = height / sourceHeight
  return fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
}

export function videoFitFilter(
  width: number,
  height: number,
  fit: VideoFit = 'contain',
  options: { padColor?: string; forceDivisibleBy?: number } = {},
): string {
  if (fit === 'cover') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${width}:${height}:(iw-ow)/2:(ih-oh)/2,setsar=1`
  }
  const divisible = options.forceDivisibleBy ? `:force_divisible_by=${options.forceDivisibleBy}` : ''
  const color = options.padColor ? `:color=${options.padColor}` : ''
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease${divisible},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${color},setsar=1`
}
