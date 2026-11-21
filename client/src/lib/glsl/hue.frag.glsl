precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uAngle;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

// Exact FFmpeg vf_hue.c: rotate (U,V) around 128 by angle (radians).
// BT.601 full-range YUV here to match the YUV420P render path.
vec3 rgb2yuv(vec3 c) {
  return vec3(0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
              -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b + 0.5,
              0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b + 0.5);
}

vec3 yuv2rgb(vec3 c) {
  float y = c.x;
  float u = c.y - 0.5;
  float v = c.z - 0.5;
  return vec3(y + 1.402 * v, y - 0.344136 * u - 0.714136 * v, y + 1.772 * u);
}

void main() {
  vec4 orig = texture(uTexture, vTextureCoord);
  vec3 yuv = rgb2yuv(orig.rgb);
  float co = cos(uAngle); float si = sin(uAngle);
  vec2 uv = yuv.yz - vec2(0.5);
  yuv.yz = vec2(co * uv.x - si * uv.y, si * uv.x + co * uv.y) + vec2(0.5);
  vec3 rotated = clamp(yuv2rgb(yuv), 0.0, 1.0);
  finalColor = vec4(blendTrunc(orig.rgb, rotated, clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
