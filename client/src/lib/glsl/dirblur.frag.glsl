precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uRadius;
uniform float uDirX;
uniform float uDirY;
uniform float uIntensity;
void main() {
  // FFmpeg vf_dblur.c is a 2D IIR blur oriented along (cos(angle),
  // sin(angle)). The preview approximates it with a (2*radius+1)-tap box
  // average along the same direction and mirrored edges, then mixes with
  // the original via intensity (matching the ffmpeg wrapIntensity ramp).
  vec4 orig = texture(uTexture, vTextureCoord);
  int r = int(max(0.0, floor(uRadius + 0.5)));
  if (r <= 0) { finalColor = orig * vColor; return; }
  // GLSL ES 1.00 has no int min()/max() (ES 3.00 only) — Pixi compiles
  // preview filters as ES 1.00 on many setups, so use a ternary.
  r = r < 64 ? r : 64;
  // Direction includes the source-to-screen pixel scale; do not normalize it.
  vec2 dir = vec2(uDirX, uDirY);
  vec2 texel = uInputSize.zw;
  vec3 acc = vec3(0.0);
  float n = 0.0;
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
  vec3 blurred = acc / max(1.0, n);
  finalColor = vec4(mix(orig.rgb, blurred, clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
