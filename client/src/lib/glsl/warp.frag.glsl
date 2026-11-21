precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uMode;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
uniform float uK1;
uniform float uK2;
uniform float uCx;
uniform float uCy;
uniform float uAmp;
uniform float uWaveLen;
uniform float uSpeed;
uniform float uTime;
uniform float uTexW;
uniform float uTexH;

vec2 lensWarp(vec2 uv) {
  // Exact FFmpeg vf_lenscorrection.c calc_correction: pixel offsets from
  // center, r2 = (dx^2+dy^2)*4/(W^2+H^2) in 0..1 at corners,
  // mult = r2*k1 + r2^2*k2 + 1, src = center + mult*off.
  vec2 size = vec2(uTexW, uTexH);
  vec2 center = floor(vec2(uCx, uCy) * size);
  float W = max(1.0, uTexW);
  float H = max(1.0, uTexH);
  vec2 off = uv * size - center;
  float r2 = (dot(off, off) * 4.0) / (W * W + H * H);
  float mult = r2 * uK1 + r2 * r2 * uK2 + 1.0;
  // FFmpeg 5.1's bilinear path rounds the base index before interpolating.
  vec2 src = center + mult * off + 0.5;
  return vec2(src.x / W, src.y / H);
}

void main() {
  vec2 K = max(uOutputFrame.zw * uInputSize.zw, vec2(1e-4));
  vec2 size = vec2(uTexW, uTexH);
  vec2 uv = vPos - 0.5 / size;
  if (uMode < 0.5) {
    vec2 warped = lensWarp(uv);
    uv = warped;
  } else if (uMode < 1.5) {
    float dx = uAmp * sin(uv.y * uTexH / max(1.0, uWaveLen)) / max(1.0, uTexW);
    uv.x += dx;
  } else if (uMode < 2.5) {
    float yy = uv.y * uTexH;
    float dx = uAmp * sin(yy / max(1.0, uWaveLen) + uTime * uSpeed) / max(1.0, uTexW);
    uv.x += dx;
  } else if (uMode < 3.5) {
    float yy = uv.y;
    float band = step(uCx, yy);
    float dx = uAmp * sin(yy * uTexH / 2.0 + uTime * 25.0) / max(1.0, uTexW) * band;
    uv.x += dx;
  } else if (uMode < 4.5) {
    float yy = uv.y * uTexH + uTime * uSpeed;
    float band = step(mod(yy, max(1.0, uWaveLen)), uK1);
    float dx = uAmp * sin(uTime * 31.0) * band / max(1.0, uTexW);
    uv.x += dx;
  } else if (uMode < 5.5) {
    vec2 p = vec2(abs(mod(uv.x * uTexW, uTexW / 2.0) - uTexW / 4.0) * 2.0 / max(1.0, uTexW),
                  abs(mod(uv.y * uTexH, uTexH / 2.0) - uTexH / 4.0) * 2.0 / max(1.0, uTexH));
    uv = p;
  } else if (uMode < 6.5) {
    // Exact FFmpeg tiny-planet geq: X'=(atan2(dy,dx)/2pi+0.5)*W,
    // Y'=H-2*hypot(dx,dy) clamped to [0,H-1], in pixel units.
    float W = max(1.0, uTexW);
    float H = max(1.0, uTexH);
    float dx = (uv.x - 0.5) * W;
    float dy = (uv.y - 0.5) * H;
    float theta = atan(dy, dx) / 6.2831853 + 0.5;
    float rr = H - 2.0 * length(vec2(dx, dy));
    vec2 polar = vec2(theta, clamp(rr / H, 0.0, 1.0));
    uv = polar;
  }
  bool valid = uMode >= 0.5 || (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))));
  vec2 sampleUv = (uv + 0.5 / size) * K;
  vec4 color = valid ? texture(uTexture, clamp(sampleUv, uInputClamp.xy, uInputClamp.zw)) : vec4(0.0, 0.0, 0.0, 1.0);
  vec3 mixed = blendTrunc(texture(uTexture, vTextureCoord).rgb, color.rgb, uIntensity);
  finalColor = vec4(mixed, color.a) * vColor;
}
