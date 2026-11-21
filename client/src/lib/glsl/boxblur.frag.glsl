precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uRadius;
uniform float uAxis;
uniform float uPixelScale;
uniform float uPixelScaleY;
uniform float uIntensity;
void main() {
  // Exact FFmpeg vf_boxblur.c separable box: average of (2*radius+1) taps
  // along one axis, mirrored edges, H then V as two stacked filters.
  // uAxis 2 selects a single-pass 2D average: separable H-then-V equals one
  // (2r+1)^2 average, so a single uIntensity mix here is exactly one
  // crossfade and matches ffmpeg wrapIntensity. Two chained mixed passes
  // (H mix, V mix) would apply the envelope twice and diverge mid-ramp, so
  // ramped blocks use this 2D branch while constant blocks (I=1) keep the
  // separable H+V pair, which is exact at any radius.
  vec4 orig = texture(uTexture, vTextureCoord);
  int r = int(max(0.0, floor(uRadius + 0.5)));
  if (r <= 0) { finalColor = orig * vColor; return; }
  // GLSL ES 1.00 has no int min()/max() (ES 3.00 only) — Pixi compiles
  // preview filters as ES 1.00 on many setups, so use a ternary.
  r = r < 64 ? r : 64;
  vec2 texel = uInputSize.zw * uPixelScale;
  vec2 dir = uAxis > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  vec3 acc = vec3(0.0);
  float n = 0.0;
  if (uAxis > 1.5) {
    // 2D branch, capped at 24 (49x49 taps) for preview speed.
    int r2 = r < 24 ? r : 24;
    vec2 step2d = uInputSize.zw * vec2(uPixelScale, uPixelScaleY);
    for (int y = -24; y <= 24; y++) {
      for (int x = -24; x <= 24; x++) {
        if (x < -r2 || x > r2 || y < -r2 || y > r2) continue;
        vec2 uv = vTextureCoord + step2d * vec2(float(x), float(y));
        vec2 extent = max(uInputClamp.zw - uInputClamp.xy, uInputSize.zw);
        vec2 reflected = mod(uv - uInputClamp.xy, 2.0 * extent);
        uv = uInputClamp.xy + min(reflected, 2.0 * extent - reflected);
        acc += texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
        n += 1.0;
      }
    }
  } else {
  for (int i = -64; i <= 64; i++) {
    if (i < -r || i > r) continue;
    vec2 uv = vTextureCoord + texel * dir * float(i);
    // The pooled texture can be larger than the image; reflect at its valid bounds.
    vec2 extent = max(uInputClamp.zw - uInputClamp.xy, uInputSize.zw);
    vec2 reflected = mod(uv - uInputClamp.xy, 2.0 * extent);
    uv = uInputClamp.xy + min(reflected, 2.0 * extent - reflected);
    acc += texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
    n += 1.0;
  }
  }
  vec3 blurred = acc / max(1.0, n);
  finalColor = vec4(mix(orig.rgb, blurred, clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
