import {
  clipTransformAt,
  normalizeClipTransform,
  normalizeClipTransformKeyframe,
  type ClipTransform,
  type ClipTransformKeyframe,
} from './clip-transform'

const TRANSFORM_GUARD_PIXELS = 4

interface TransformSource {
  transform?: ClipTransform | null
  transformKeyframes?: ClipTransformKeyframe[] | null
}

function fmt(value: number): string {
  return String(Number(value.toFixed(6)))
}

function transformExpression(
  key: keyof Pick<ClipTransform, 'zoomX' | 'zoomY' | 'positionX' | 'positionY' | 'rotation' | 'anchorX' | 'anchorY' | 'pitch' | 'yaw'>,
  base: ClipTransform,
  keyframes: ClipTransformKeyframe[],
  segmentOffset: number,
  frameRate?: number,
): string {
  const points = keyframes.length > 0
    ? keyframes.map((keyframe) => ({ time: Math.max(0, keyframe.time), value: keyframe.transform[key] }))
    : [{ time: 0, value: base[key] }]
  const time = frameRate === undefined
    ? segmentOffset === 0 ? 't' : `(t+${fmt(segmentOffset)})`
    : `(on/${fmt(frameRate)}${segmentOffset === 0 ? '' : `+${fmt(segmentOffset)}`})`
  let expression = fmt(points[points.length - 1].value)
  for (let index = points.length - 2; index >= 0; index--) {
    const left = points[index]
    const right = points[index + 1]
    const span = Math.max(0.000001, right.time - left.time)
    const value = `${fmt(left.value)}+(${fmt(right.value)}-${fmt(left.value)})*(${time}-${fmt(left.time)})/${fmt(span)}`
    expression = `if(lt(${time},${fmt(right.time)}),${value},${expression})`
  }
  return points.length > 1 ? `if(lt(${time},${fmt(points[0].time)}),${fmt(points[0].value)},${expression})` : expression
}

export function buildClipTransformFilter(
  source: TransformSource,
  width: number,
  height: number,
  segmentOffset: number,
  segmentDuration: number,
  fps: number,
  target = 'transform_shear',
): string {
  const hasTransform = Boolean(source.transform || source.transformKeyframes?.length)
  if (!hasTransform) return ''
  const base = normalizeClipTransform(source.transform)
  const keyframes = (source.transformKeyframes ?? [])
    .map(normalizeClipTransformKeyframe)
    .sort((a, b) => a.time - b.time)
  // perspective evaluates on a fixed-size output and retains fractional source
  // coordinates, avoiding the pixel stepping caused by dynamic scale/crop.
  const zoomX = transformExpression('zoomX', base, keyframes, segmentOffset, fps)
  const zoomY = transformExpression('zoomY', base, keyframes, segmentOffset, fps)
  const positionX = transformExpression('positionX', base, keyframes, segmentOffset, fps)
  const positionY = transformExpression('positionY', base, keyframes, segmentOffset, fps)
  const anchorX = transformExpression('anchorX', base, keyframes, segmentOffset, fps)
  const anchorY = transformExpression('anchorY', base, keyframes, segmentOffset, fps)
  const rotation = transformExpression('rotation', base, keyframes, segmentOffset)
  const first = clipTransformAt({ transform: base, transformKeyframes: keyframes }, 0)
  const last = clipTransformAt({ transform: base, transformKeyframes: keyframes }, Number.POSITIVE_INFINITY)
  const at = (time: number) => clipTransformAt(
    { transform: base, transformKeyframes: keyframes },
    segmentOffset + time,
  )
  const firstShear = at(0)
  // shear shx/shy are scalar options; animate them with commands instead of t expressions.
  const shearFilter = `shear@${target}=shx=${fmt(-firstShear.yaw * Math.PI / 180 * 0.55)}:shy=${fmt(-firstShear.pitch * Math.PI / 180 * 0.55)}:fillcolor=black`
  const shearCommands: string[] = []
  let previousShx = -firstShear.yaw * Math.PI / 180 * 0.55
  let previousShy = -firstShear.pitch * Math.PI / 180 * 0.55
  const frameCount = Math.ceil(Math.max(0, segmentDuration) * fps)
  for (let frame = 1; frame < frameCount; frame++) {
    const transform = at(frame / fps)
    const shx = -transform.yaw * Math.PI / 180 * 0.55
    const shy = -transform.pitch * Math.PI / 180 * 0.55
    if (shx === previousShx && shy === previousShy) continue
    const time = fmt(frame / fps)
    if (shx !== previousShx) shearCommands.push(`${time} shear@${target} shx ${fmt(shx)}`)
    if (shy !== previousShy) shearCommands.push(`${time} shear@${target} shy ${fmt(shy)}`)
    previousShx = shx
    previousShy = shy
  }
  const guard = TRANSFORM_GUARD_PIXELS
  const paddedWidth = width + guard * 2
  const paddedHeight = height + guard * 2
  const stageX = `(${width}/2+(${positionX})*${width}/100)`
  const stageY = `(${height}/2+(${positionY})*${height}/100)`
  const sourceX = (outputX: number) => `(${anchorX})*${width}+(${outputX}-${guard}-(${stageX}))/(${zoomX})+${guard}`
  const sourceY = (outputY: number) => `(${anchorY})*${height}+(${outputY}-${guard}-(${stageY}))/(${zoomY})+${guard}`
  const perspectiveFilter = [
    `perspective=x0='${sourceX(0)}':y0='${sourceY(0)}'`,
    `x1='${sourceX(paddedWidth)}':y1='${sourceY(0)}'`,
    `x2='${sourceX(0)}':y2='${sourceY(paddedHeight)}'`,
    `x3='${sourceX(paddedWidth)}':y3='${sourceY(paddedHeight)}'`,
    'eval=frame:interpolation=cubic:sense=source',
  ].join(':')
  const filters = [
    `pad=${paddedWidth}:${paddedHeight}:${guard}:${guard}:color=black`,
    perspectiveFilter,
    `crop=${width}:${height}:${guard}:${guard}`,
    `rotate=a='(${rotation})*PI/180':ow=${width}:oh=${height}:fillcolor=black`,
    shearCommands.length > 0
      ? `sendcmd=c='${shearCommands.join(';')}',${shearFilter}`
      : shearFilter,
  ]
  if (first.flipH && last.flipH) filters.push('hflip')
  if (first.flipV && last.flipV) filters.push('vflip')
  return filters.join(',')
}
