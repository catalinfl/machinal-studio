precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uIntensity;
uniform float uRS; uniform float uGS; uniform float uBS;
uniform float uRM; uniform float uGM; uniform float uBM;
uniform float uRH; uniform float uGH; uniform float uBH;
// Exact FFmpeg vf_colorbalance.c get_component per channel:
// l = max(r,g,b)+min(r,g,b) in 0..2; weights clip((b-l)*4+0.5)*0.7 etc.
float cbWeight(float l, float v) { return clamp((0.3333333 - l) * 4.0 + 0.5, 0.0, 1.0) * 0.7 * v; }
float cbWeightMid(float l, float v) {
  return clamp((l - 0.3333333) * 4.0 + 0.5, 0.0, 1.0)
       * clamp((1.0 - l - 0.3333333) * 4.0 + 0.5, 0.0, 1.0) * 0.7 * v;
}
float cbWeightHi(float l, float v) { return clamp((l + 0.3333333 - 1.0) * 4.0 + 0.5, 0.0, 1.0) * 0.7 * v; }
vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
void main() {
  vec4 orig = texture(uTexture, vTextureCoord);
  vec3 c = orig.rgb;
  float l = max(max(c.r, c.g), c.b) + min(min(c.r, c.g), c.b);
  vec3 outc;
  outc.r = clamp(c.r + cbWeight(l, uRS) + cbWeightMid(l, uRM) + cbWeightHi(l, uRH), 0.0, 1.0);
  outc.g = clamp(c.g + cbWeight(l, uGS) + cbWeightMid(l, uGM) + cbWeightHi(l, uGH), 0.0, 1.0);
  outc.b = clamp(c.b + cbWeight(l, uBS) + cbWeightMid(l, uBM) + cbWeightHi(l, uBH), 0.0, 1.0);
  finalColor = vec4(blendTrunc(c, outc, clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
