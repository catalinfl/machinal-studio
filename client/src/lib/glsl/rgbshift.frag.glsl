precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uScaleX;
uniform float uScaleY;
uniform float uShiftX;
uniform float uShiftY;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
uniform float uTexW;
uniform float uTexH;
uniform float uRadial;

void main() {
  vec2 texel = uInputSize.zw;
  // Full shift here; the single uIntensity mix at the end is the only ramp
  // application (matching ffmpeg wrapIntensity). Scaling the shift by
  // intensity as well would apply the envelope twice and undershoot mid-ramp.
  vec2 shift = vec2(uShiftX * uScaleX, uShiftY * uScaleY) * texel;
  vec2 uv = vTextureCoord;
  if (uRadial > 0.5) {
    vec2 d = uv - vec2(0.5);
    float r = length(d);
    shift *= (0.3 + r * 1.7);
  }
  float r = texture(uTexture, clamp(uv - shift, uInputClamp.xy, uInputClamp.zw)).r;
  float g = texture(uTexture, uv).g;
  float b = texture(uTexture, clamp(uv + shift, uInputClamp.xy, uInputClamp.zw)).b;
  vec4 orig = texture(uTexture, uv);
  vec3 shifted = vec3(r, g, b);
  vec3 c = blendTrunc(orig.rgb, shifted, clamp(uIntensity, 0.0, 1.0));
  finalColor = vec4(c, orig.a) * vColor;
}
