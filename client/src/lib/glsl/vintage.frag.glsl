precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uIntensity;
// Exact FFmpeg curves=preset=vintage natural cubic spline LUTs evaluated
// per channel (R: 0/0.11 0.42/0.51 1/0.95, G: 0/0 0.5/0.48 1/1,
// B: 0/0.22 0.49/0.44 1/0.8), followed by eq=saturation=0.85 on chroma.
float vintageR(float x) {
  if (x < 0.42) { float d = x; return 0.11 + 0.9931 * d - 0.2307 * d * d * d; }
  float d = x - 0.42; return 0.51 + 0.8710 * d - 0.2907 * d * d + 0.1671 * d * d * d;
}
float vintageG(float x) {
  if (x < 0.5) { float d = x; return 0.94 * d + 0.08 * d * d * d; }
  float d = x - 0.5; return 0.48 + 1.0 * d + 0.12 * d * d - 0.08 * d * d * d;
}
float vintageB(float x) {
  if (x < 0.49) { float d = x; return 0.22 + 0.386 * d + 0.262 * d * d * d; }
  float d = x - 0.49; return 0.44 + 0.575 * d + 0.3855 * d * d - 0.252 * d * d * d;
}
void main() {
  vec4 orig = texture(uTexture, vTextureCoord);
  vec3 c = vec3(vintageR(orig.r), vintageG(orig.g), vintageB(orig.b));
  // eq saturation=0.85 around BT.601 luma
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = vec3(l) + (c - vec3(l)) * 0.85;
  finalColor = vec4(mix(orig.rgb, clamp(c, 0.0, 1.0), clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
