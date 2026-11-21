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
uniform float uX;
uniform float uY;
uniform float uAngle;
uniform float uMargin;
uniform float uTexW;
uniform float uTexH;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

void main() {
  vec2 size = vec2(uTexW, uTexH);
  vec2 pixel = vPos * size - 0.5;
  vec2 source = pixel;
  bool valid = true;
  if (uMode < 0.5) {
    source.x = size.x - 1.0 - pixel.x;
  } else if (uMode < 1.5) {
    source.y = size.y - 1.0 - pixel.y;
  } else if (uMode < 2.5) {
    vec2 center = (size - 1.0) * 0.5;
    vec2 delta = pixel - center;
    source = center + vec2(cos(uAngle) * delta.x + sin(uAngle) * delta.y, -sin(uAngle) * delta.x + cos(uAngle) * delta.y);
    valid = all(greaterThanEqual(source, vec2(-1.0))) && all(lessThan(source, size));
  } else if (uMode < 3.5) {
    source += vec2(uX * (pixel.y - size.y * 0.5), uY * (pixel.x - size.x * 0.5));
    valid = all(greaterThanEqual(source, vec2(0.0))) && all(lessThan(source, size - 1.0));
  } else {
    vec2 cropped = max(vec2(1.0), size - 2.0 * uMargin);
    vec2 origin = floor(vec2(uMargin + uX, uMargin + uY) + 0.5);
    source = (pixel + 0.5) * cropped / size - 0.5 + origin;
    source = clamp(source, origin, origin + cropped - 1.0);
  }
  vec2 uv = (source + 0.5) / size * uOutputFrame.zw * uInputSize.zw;
  vec4 original = texture(uTexture, vTextureCoord);
  vec4 transformed = valid ? texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)) : vec4(0.0, 0.0, 0.0, 1.0);
  finalColor = vec4(blendTrunc(original.rgb, transformed.rgb, uIntensity), mix(original.a, transformed.a, clamp(uIntensity, 0.0, 1.0))) * vColor;
}
