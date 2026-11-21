type Point = readonly [number, number]

function polynomial(value: number): string {
  return value.toExponential(12)
}

function curveFunction(name: string, points: readonly Point[]): string {
  const count = points.length
  const diagonal = new Array<number>(count).fill(1)
  const upper = new Array<number>(count).fill(0)
  const result = new Array<number>(count).fill(0)
  for (let index = 1; index < count - 1; index++) {
    const previous = points[index][0] - points[index - 1][0]
    const next = points[index + 1][0] - points[index][0]
    const factor = previous / diagonal[index - 1]
    diagonal[index] = 2 * (previous + next) - factor * upper[index - 1]
    upper[index] = next
    result[index] = 6 * ((points[index + 1][1] - points[index][1]) / next - (points[index][1] - points[index - 1][1]) / previous) - factor * result[index - 1]
  }
  for (let index = count - 2; index > 0; index--) result[index] = (result[index] - upper[index] * result[index + 1]) / diagonal[index]
  const segments: string[] = []
  for (let index = 0; index < count - 1; index++) {
    const [x, y] = points[index]
    const h = points[index + 1][0] - x
    const b = (points[index + 1][1] - y) / h - h * (2 * result[index] + result[index + 1]) / 6
    const c = result[index] / 2
    const d = (result[index + 1] - result[index]) / (6 * h)
    segments.push(`if (x <= ${polynomial(points[index + 1][0])}) { float t = x - ${polynomial(x)}; return ((${polynomial(d)} * t + ${polynomial(c)}) * t + ${polynomial(b)}) * t + ${polynomial(y)}; }`)
  }
  return `float ${name}(float x) { ${segments.join('\n')} return ${polynomial(points[count - 1][1])}; }`
}

function fragment(channels: readonly (readonly Point[])[]): string {
  return `precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uIntensity;
${channels.map((points, index) => curveFunction(`curve${index}`, points)).join('\n')}
vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
void main() {
  vec4 original = texture(uTexture, vTextureCoord);
  vec3 inputValue = floor(original.rgb * 255.0 + 0.5) / 255.0;
  vec3 result = vec3(curve0(inputValue.r), curve1(inputValue.g), curve2(inputValue.b));
  result = floor(clamp(result, 0.0, 1.0) * 255.0) / 255.0;
  finalColor = vec4(blendTrunc(original.rgb, result, uIntensity), original.a) * vColor;
}`
}

export const VINTAGE_CURVE = fragment([
  [[0, 0.11], [0.42, 0.51], [1, 0.95]],
  [[0, 0], [0.5, 0.48], [1, 1]],
  [[0, 0.22], [0.49, 0.44], [1, 0.8]],
])

export const CROSS_PROCESS_CURVE = fragment([
  [[0, 0.04], [0.35, 0.24], [0.68, 0.82], [1, 0.97]],
  [[0, 0.01], [0.42, 0.52], [1, 0.94]],
  [[0, 0.12], [0.38, 0.46], [0.72, 0.78], [1, 0.9]],
])

const infrared: readonly Point[] = [[0, 0], [0.35, 0.2], [0.72, 0.88], [1, 1]]
export const INFRARED_CURVE = fragment([infrared, infrared, infrared])
