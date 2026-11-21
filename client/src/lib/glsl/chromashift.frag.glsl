precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uBlueX;
uniform float uBlueY;
uniform float uRedX;
uniform float uRedY;
uniform float uScaleX;
uniform float uScaleY;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

vec3 rgbToYuvBytes(vec3 rgb) {
  return floor(vec3(
    dot(rgb, vec3(0.299, 0.587, 0.114)) * 219.0 + 16.0,
    dot(rgb, vec3(-0.168736, -0.331264, 0.5)) * 224.0 + 128.0,
    dot(rgb, vec3(0.5, -0.418688, -0.081312)) * 224.0 + 128.0
  ) + 0.5);
}

vec3 sampleYuv(vec2 uv) {
  vec3 rgb = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
  return rgbToYuvBytes(rgb);
}

void main() {
  vec2 stepUv = uInputSize.zw * vec2(uScaleX, uScaleY);
  vec4 original = texture(uTexture, vTextureCoord);
  // FFmpeg chromashift works on limited-range YUV planes: Y stays, Cb/Cr
  // shift independently with edge smear (clamp). Quantize every conversion
  // to bytes like the native filter.
  vec3 base = sampleYuv(vTextureCoord);
  vec3 blue = sampleYuv(vTextureCoord - vec2(uBlueX, uBlueY) * stepUv);
  vec3 red = sampleYuv(vTextureCoord - vec2(uRedX, uRedY) * stepUv);
  vec3 shifted = vec3(base.x, blue.y, red.z);
  float y = (shifted.x - 16.0) / 219.0;
  float u = (shifted.y - 128.0) / 224.0;
  float v = (shifted.z - 128.0) / 224.0;
  vec3 result = clamp(vec3(y + 1.402 * v, y - 0.344136 * u - 0.714136 * v, y + 1.772 * u), 0.0, 1.0);
  finalColor = vec4(blendTrunc(original.rgb, result, uIntensity), original.a) * vColor;
}
