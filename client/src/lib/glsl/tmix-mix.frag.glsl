precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform sampler2D uAccum;
uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uF2;
uniform sampler2D uF3;
uniform sampler2D uF4;
uniform sampler2D uF5;
uniform sampler2D uF6;
uniform sampler2D uF7;
uniform float uHasAccum;
uniform float uCount;
uniform float uW0;
uniform float uW1;
uniform float uW2;
uniform float uW3;
uniform float uW4;
uniform float uW5;
uniform float uW6;
uniform float uW7;
uniform float uScale;
uniform float uFinal;
uniform float uIntensity;

vec4 frameAt(float index, vec2 uv) {
  if (index < 0.5) return texture(uF0, uv);
  if (index < 1.5) return texture(uF1, uv);
  if (index < 2.5) return texture(uF2, uv);
  if (index < 3.5) return texture(uF3, uv);
  if (index < 4.5) return texture(uF4, uv);
  if (index < 5.5) return texture(uF5, uv);
  if (index < 6.5) return texture(uF6, uv);
  return texture(uF7, uv);
}

float weightAt(float index) {
  if (index < 0.5) return uW0;
  if (index < 1.5) return uW1;
  if (index < 2.5) return uW2;
  if (index < 3.5) return uW3;
  if (index < 4.5) return uW4;
  if (index < 5.5) return uW5;
  if (index < 6.5) return uW6;
  return uW7;
}

// lrintf uses round-half-to-even; floor(x+0.5) would differ on exact .5
// (possible with scales like 1/4). Match the native rounding bit-exactly.
float roundEven(float value) {
  float q = floor(value);
  float f = value - q;
  if (f < 0.5) return q;
  if (f > 0.5) return q + 1.0;
  return mod(q, 2.0) == 0.0 ? q : q + 1.0;
}

void main() {
  // Raw weighted byte sum (exact in float32: < 20*255*1 << 2^24).
  vec4 sum = uHasAccum > 0.5 ? texture(uAccum, vTextureCoord) : vec4(0.0);
  for (float i = 0.0; i < 8.0; i += 1.0) {
    if (i >= uCount) break;
    sum += frameAt(i, vTextureCoord) * 255.0 * weightAt(i);
  }
  if (uFinal < 0.5) {
    finalColor = sum;
    return;
  }
  vec4 rounded = vec4(roundEven(sum.r * uScale), roundEven(sum.g * uScale), roundEven(sum.b * uScale), roundEven(sum.a * uScale));
  vec4 mixed = clamp(rounded, vec4(0.0), vec4(255.0)) / 255.0;
  vec4 original = texture(uOriginal, vTextureCoord);
  vec3 outRgb = uIntensity >= 0.999 ? mixed.rgb : (uIntensity <= 0.001 ? original.rgb : floor(mix(original.rgb, mixed.rgb, uIntensity) * 255.0) / 255.0);
  finalColor = vec4(outRgb, mix(original.a, mixed.a, uIntensity)) * vColor;
}
