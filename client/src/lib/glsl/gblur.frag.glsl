precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uSigma;
uniform float uScaleX;
uniform float uScaleY;
uniform float uIntensity;
void main() {
  // True 2D gaussian in a single pass so the uIntensity mix below is exactly
  // one crossfade, matching ffmpeg wrapIntensity (split -> gblur -> blend).
  // A BlurFilter with lerped sigma would animate the parameter instead of
  // crossfading and diverge mid-ramp (same envelope, different curve).
  // uSigma stays in source pixels; uScaleX/uScaleY carry the source-to-screen
  // pixel scale exactly like boxblur's uPixelScale. Radius covers 3 sigma,
  // capped at 16 (33x33 taps) for preview speed; component blurs stay below.
  vec4 orig = texture(uTexture, vTextureCoord);
  float sigma = max(0.0, uSigma);
  if (sigma < 0.05) { finalColor = orig * vColor; return; }
  int r = int(floor(sigma * 3.0 + 0.5));
  if (r < 1) { finalColor = orig * vColor; return; }
  // GLSL ES 1.00 has no int min()/max() (ES 3.00 only) — Pixi compiles
  // preview filters as ES 1.00 on many setups, so use a ternary.
  r = r < 16 ? r : 16;
  vec2 step2d = uInputSize.zw * vec2(uScaleX, uScaleY);
  float denom = 2.0 * sigma * sigma;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int y = -16; y <= 16; y++) {
    for (int x = -16; x <= 16; x++) {
      if (x < -r || x > r || y < -r || y > r) continue;
      float w = exp(-(float(x * x + y * y)) / denom);
      vec2 uv = vTextureCoord + step2d * vec2(float(x), float(y));
      // The pooled texture can be larger than the image; reflect at its valid bounds.
      vec2 extent = max(uInputClamp.zw - uInputClamp.xy, uInputSize.zw);
      vec2 reflected = mod(uv - uInputClamp.xy, 2.0 * extent);
      uv = uInputClamp.xy + min(reflected, 2.0 * extent - reflected);
      acc += texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb * w;
      wsum += w;
    }
  }
  vec3 blurred = acc / max(1e-4, wsum);
  finalColor = vec4(mix(orig.rgb, blurred, clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
