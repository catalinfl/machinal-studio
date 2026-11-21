precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uScaleX;
uniform float uScaleY;
uniform float uTexW;
uniform float uTexH;

vec3 sampleByte(vec2 offset) {
  vec2 uv = vTextureCoord + offset * uInputSize.zw * vec2(uScaleX, uScaleY);
  return floor(texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb * 255.0 + 0.5);
}

void gradient(vec2 offset, out vec3 gx, out vec3 gy) {
  vec2 p = floor(vPos * vec2(uTexW, uTexH)) + offset;
  if (p.x < 1.0 || p.y < 1.0 || p.x >= uTexW - 1.0 || p.y >= uTexH - 1.0) {
    gx = vec3(0.0); gy = vec3(0.0); return;
  }
  vec3 tl = sampleByte(offset + vec2(-1.0, -1.0));
  vec3 t = sampleByte(offset + vec2(0.0, -1.0));
  vec3 tr = sampleByte(offset + vec2(1.0, -1.0));
  vec3 l = sampleByte(offset + vec2(-1.0, 0.0));
  vec3 r = sampleByte(offset + vec2(1.0, 0.0));
  vec3 bl = sampleByte(offset + vec2(-1.0, 1.0));
  vec3 b = sampleByte(offset + vec2(0.0, 1.0));
  vec3 br = sampleByte(offset + vec2(1.0, 1.0));
  gx = -tl + tr - 2.0 * l + 2.0 * r - bl + br;
  gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
}

vec3 magnitude(vec2 offset) {
  vec3 gx, gy;
  gradient(offset, gx, gy);
  return abs(gx) + abs(gy);
}

void main() {
  vec3 gx, gy;
  gradient(vec2(0.0), gx, gy);
  vec3 center = abs(gx) + abs(gy);
  vec3 horizontal = vec3(lessThan(abs(gy) * 65536.0, abs(gx) * 27146.0));
  vec3 diagonal = (vec3(1.0) - horizontal) * vec3(lessThan(abs(gy) * 65536.0, abs(gx) * 158218.0));
  vec3 down = diagonal * step(vec3(0.0), gx * gy);
  vec3 up = diagonal - down;
  vec3 vertical = vec3(1.0) - horizontal - diagonal;
  vec3 neighborA = magnitude(vec2(-1.0, 0.0)) * horizontal + magnitude(vec2(-1.0, -1.0)) * down + magnitude(vec2(-1.0, 1.0)) * up + magnitude(vec2(0.0, -1.0)) * vertical;
  vec3 neighborB = magnitude(vec2(1.0, 0.0)) * horizontal + magnitude(vec2(1.0, 1.0)) * down + magnitude(vec2(1.0, -1.0)) * up + magnitude(vec2(0.0, 1.0)) * vertical;
  vec3 keep = vec3(greaterThan(center, neighborA)) * vec3(greaterThan(center, neighborB));
  finalColor = vec4(min(center, vec3(255.0)) * keep / 255.0, 1.0);
}
