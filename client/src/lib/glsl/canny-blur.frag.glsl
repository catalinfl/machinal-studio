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
uniform float uGray;

vec3 sampleByte(vec2 offset) {
  vec2 uv = vTextureCoord + offset * uInputSize.zw * vec2(uScaleX, uScaleY);
  vec3 rgb = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
  if (uGray > 0.5) rgb = vec3(dot(rgb, vec3(0.299, 0.587, 0.114)));
  return floor(rgb * 255.0 + 0.5);
}

float weight(float x, float y) {
  if (y == 2.0) return x == 2.0 ? 2.0 : (x == 1.0 ? 4.0 : 5.0);
  if (y == 1.0) return x == 2.0 ? 4.0 : (x == 1.0 ? 9.0 : 12.0);
  return x == 2.0 ? 5.0 : (x == 1.0 ? 12.0 : 15.0);
}

void main() {
  vec2 pixel = floor(vPos * vec2(uTexW, uTexH));
  vec3 result = sampleByte(vec2(0.0));
  if (pixel.x >= 2.0 && pixel.y >= 2.0 && pixel.x < uTexW - 2.0 && pixel.y < uTexH - 2.0) {
    vec3 sum = vec3(0.0);
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) sum += sampleByte(vec2(float(x), float(y))) * weight(abs(float(x)), abs(float(y)));
    }
    result = floor(sum / 159.0 + 0.00001);
  }
  finalColor = vec4(result / 255.0, 1.0);
}
