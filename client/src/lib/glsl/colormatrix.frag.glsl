precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uM0; uniform float uM1; uniform float uM2; uniform float uM3; uniform float uM4;
uniform float uM5; uniform float uM6; uniform float uM7; uniform float uM8; uniform float uM9;
uniform float uM10; uniform float uM11; uniform float uM12; uniform float uM13; uniform float uM14;
uniform float uM15; uniform float uM16; uniform float uM17; uniform float uM18; uniform float uM19;
uniform float uTrunc;
uniform float uLut;
uniform float uIntensity;

// FFmpeg vf_colorchannelmixer.c builds per-gain LUTs with lrint (banker's
// rounding) and sums them in integer, while negate/hue apply direct math:
// uLut selects the LUT path for colorchannelmixer-based grades.
float rEven(float v) {
  float q = floor(v);
  float f = v - q;
  if (f < 0.5) return q;
  if (f > 0.5) return q + 1.0;
  return mod(q, 2.0) == 0.0 ? q : q + 1.0;
}

// Fused matrix multiply + optional truncation: the native wrapIntensity
// blend is a single quantized op, while chained Pixi filters would round at
// an intermediate byte buffer first. Fusing keeps one quantization point.
// uTrunc mirrors vf_blend.c truncation (C-cast); full-strength output keeps
// native rounding.
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 r;
  if (uLut > 0.5) {
    vec3 bytes = floor(c.rgb * 255.0 + 0.5);
    r.r = rEven(bytes.r * uM0) + rEven(bytes.g * uM1) + rEven(bytes.b * uM2);
    r.g = rEven(bytes.r * uM5) + rEven(bytes.g * uM6) + rEven(bytes.b * uM7);
    r.b = rEven(bytes.r * uM10) + rEven(bytes.g * uM11) + rEven(bytes.b * uM12);
    r = clamp(r, vec3(0.0), vec3(255.0)) / 255.0;
    // Full LUT output mixed once like the native blend (truncating).
    if (uIntensity < 0.999) {
      r = uIntensity <= 0.001 ? c.rgb : floor(mix(c.rgb, r, uIntensity) * 255.0) / 255.0;
    }
  } else {
    r.r = uM0 * c.r + uM1 * c.g + uM2 * c.b + uM3 * c.a + uM4;
    r.g = uM5 * c.r + uM6 * c.g + uM7 * c.b + uM8 * c.a + uM9;
    r.b = uM10 * c.r + uM11 * c.g + uM12 * c.b + uM13 * c.a + uM14;
  }
  float alpha = uM15 * c.r + uM16 * c.g + uM17 * c.b + uM18 * c.a + uM19;
  if (uTrunc > 0.5) r = floor(r * 255.0) / 255.0;
  finalColor = vec4(r, alpha) * vColor;
}
