precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uContrast;
uniform float uBrightness;
uniform float uSaturation;
uniform float uGamma;
uniform float uIntensity;
uniform float uContrastQ;
uniform float uBrightnessQ;
uniform float uSaturationQ;
uniform float uChromaBias;
uniform float uOutputYuv;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

vec3 rgbToYuv(vec3 rgb) {
  return floor(vec3(
    dot(rgb, vec3(0.299, 0.587, 0.114)) * 219.0 + 16.0,
    dot(rgb, vec3(-0.168736, -0.331264, 0.5)) * 224.0 + 128.0,
    dot(rgb, vec3(0.5, -0.418688, -0.081312)) * 224.0 + 128.0
  ) + 0.5);
}

vec3 yuvToRgb(vec3 sample) {
  float y = (sample.x - 16.0) / 219.0;
  float u = (sample.y - 128.0) / 224.0;
  float v = (sample.z - 128.0) / 224.0;
  return clamp(vec3(y + 1.402 * v, y - 0.344136 * u - 0.714136 * v, y + 1.772 * u), 0.0, 1.0);
}

void main() {
  vec4 original = texture(uTexture, vTextureCoord);
  vec3 sample = rgbToYuv(original.rgb);
  if (uGamma != 1.0) {
    float value = max(0.0, uContrast * (sample.x / 255.0 - 0.5) + 0.5 + uBrightness);
    sample.x = clamp(floor(256.0 * pow(value, 1.0 / uGamma)), 0.0, 255.0);
  } else if (uContrast != 1.0 || uBrightness != 0.0) {
    sample.x = clamp(floor(sample.x * uContrastQ / 4096.0) + uBrightnessQ, 0.0, 255.0);
  }
  if (uSaturation != 1.0) sample.yz = clamp(floor(sample.yz * uSaturationQ / 4096.0) + uChromaBias, 0.0, 255.0);
  vec3 graded = uOutputYuv > 0.5 ? sample / 255.0 : yuvToRgb(sample);
  finalColor = vec4(blendTrunc(original.rgb, graded, uIntensity), original.a) * vColor;
}
