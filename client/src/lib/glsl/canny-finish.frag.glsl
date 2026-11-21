precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uScaleX;
uniform float uScaleY;
uniform float uLow;
uniform float uHigh;
uniform float uMode;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
uniform float uLevels;
uniform float uInk;

void main() {
  vec4 original = texture(uOriginal, vTextureCoord);
  vec3 value = floor(texture(uTexture, vTextureCoord).rgb * 255.0 + 0.5);
  vec3 neighbor = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec2 uv = vTextureCoord + vec2(float(x) * uScaleX, float(y) * uScaleY) * uInputSize.zw;
      neighbor = max(neighbor, floor(texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb * 255.0 + 0.5));
    }
  }
  float low = floor(uLow * 255.0 + 0.5);
  float high = floor(uHigh * 255.0 + 0.5);
  vec3 keep = max(vec3(greaterThan(value, vec3(high))), vec3(greaterThan(value, vec3(low))) * vec3(greaterThan(neighbor, vec3(high))));
  vec3 edge = value * keep / 255.0;
  vec3 result = edge;
  if (uMode < 0.5) result = floor((edge + original.rgb) * 127.5 + 0.00001) / 255.0;
  else if (uMode > 1.5) {
    vec3 poster = floor(floor(original.rgb * 255.0 + 0.5) * uLevels / 256.0) / (uLevels - 1.0);
    poster = floor(poster * 255.0) / 255.0;
    // The GRAY8 ink branch makes FFmpeg negotiate grayscale for this blend.
    float gray = floor(dot(poster, vec3(0.299, 0.587, 0.114)) * 255.0 + 0.5);
    vec3 multiplied = floor(vec3(gray) * (vec3(1.0) - edge));
    result = floor(mix(vec3(gray), multiplied, uInk)) / 255.0;
  }
  finalColor = vec4(blendTrunc(original.rgb, result, uIntensity), original.a);
}
