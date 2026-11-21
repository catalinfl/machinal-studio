precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform sampler2D uKernel;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uTaps;
uniform float uDirX;
uniform float uDirY;
uniform float uScaleX;
uniform float uScaleY;
// uPositive selects the sweep edge rule: +1 forward sweep (replicate head
// at -s, cut tail past +s), -1 backward sweep (replicate head at +s, cut
// tail past -s), 0 symmetric full kernel (replicate both ends along the
// sampling line; closest to native behavior on real content).
uniform float uPositive;
uniform float uMixOriginal;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

void main() {
  vec2 texel = uInputSize.zw;
  vec2 validSize = max((uInputClamp.zw - uInputClamp.xy) / texel, vec2(1.0));
  vec2 centerPx = (vTextureCoord - uInputClamp.xy) / texel;
  vec2 dirUnit = vec2(uDirX, uDirY);
  // Pooled pixels per source pixel along the line; s below is source pixels.
  vec2 dirPx = vec2(uDirX * uScaleX, uDirY * uScaleY);
  vec2 stepUv = dirPx * texel;
  vec2 inv = vec2(
    abs(dirPx.x) > 1e-6 ? 1.0 / dirPx.x : 1e6,
    abs(dirPx.y) > 1e-6 ? 1.0 / dirPx.y : 1e6);
  vec2 t0 = (vec2(0.0) - centerPx) * inv;
  vec2 t1 = (validSize - 1.0 - centerPx) * inv;
  float tmin = max(min(t0.x, t1.x), min(t0.y, t1.y));
  float tmax = min(max(t0.x, t1.x), max(t0.y, t1.y));
  vec3 acc = vec3(0.0);
  float total = 0.0;
  for (float i = 0.0; i < 255.0; i += 1.0) {
    if (i >= uTaps) break;
    vec4 tap = texture(uKernel, vec2((i + 0.5) / uTaps, 0.5));
    float s = dot(tap.gb, dirUnit);
    bool cut = uPositive > 0.5 ? (s > tmax) : (uPositive < -0.5 ? (s < tmin) : false);
    if (!cut) {
      float sUse = uPositive > 0.5 ? max(s, tmin) : (uPositive < -0.5 ? min(s, tmax) : min(max(s, tmin), tmax));
      acc += texture(uTexture, vTextureCoord + stepUv * sUse).rgb * tap.r;
    }
    total += tap.r;
  }
  vec3 blurred = acc / max(total, 1e-6);
  if (uMixOriginal > 0.5) {
    vec4 original = texture(uOriginal, vTextureCoord);
    finalColor = vec4(blendTrunc(original.rgb, blurred, clamp(uIntensity, 0.0, 1.0)), original.a) * vColor;
  } else {
    finalColor = vec4(blurred, texture(uTexture, vTextureCoord).a);
  }
}
