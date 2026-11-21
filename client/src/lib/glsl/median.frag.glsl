precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
uniform float uRadius;
uniform float uScaleX;
uniform float uScaleY;

vec3 sampleOffset(float x, float y) {
  vec2 uv = vTextureCoord + vec2(x * uScaleX, y * uScaleY) * uInputSize.zw;
  return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
}

vec3 median3x3() {
  vec3 samples[9];
  samples[0] = sampleOffset(-1.0, -1.0);
  samples[1] = sampleOffset(0.0, -1.0);
  samples[2] = sampleOffset(1.0, -1.0);
  samples[3] = sampleOffset(-1.0, 0.0);
  samples[4] = sampleOffset(0.0, 0.0);
  samples[5] = sampleOffset(1.0, 0.0);
  samples[6] = sampleOffset(-1.0, 1.0);
  samples[7] = sampleOffset(0.0, 1.0);
  samples[8] = sampleOffset(1.0, 1.0);
  // Constant loop bounds and loop-derived indices also compile on GLSL ES 1.00.
  for (int pass = 0; pass < 8; pass++) {
    for (int index = 0; index < 8; index++) {
      vec3 low = min(samples[index], samples[index + 1]);
      samples[index + 1] = max(samples[index], samples[index + 1]);
      samples[index] = low;
    }
  }
  return samples[4];
}

vec3 medianWindow() {
  vec3 low = vec3(0.0);
  vec3 high = vec3(255.0);
  float rank = floor(pow(2.0 * uRadius + 1.0, 2.0) / 2.0);
  // Binary rank selection bounds work to eight scans for every 8-bit radius.
  for (int bit = 0; bit < 8; bit++) {
    vec3 midpoint = floor((low + high) * 0.5);
    vec3 count = vec3(0.0);
    for (int y = -10; y <= 10; y++) {
      if (abs(float(y)) > uRadius) continue;
      for (int x = -10; x <= 10; x++) {
        if (abs(float(x)) > uRadius) continue;
        vec3 value = floor(sampleOffset(float(x), float(y)) * 255.0 + 0.5);
        count += step(value, midpoint);
      }
    }
    vec3 below = step(vec3(rank + 1.0), count);
    high = mix(high, midpoint, below);
    low = mix(midpoint + 1.0, low, below);
  }
  return low / 255.0;
}

void main() {
  vec4 original = texture(uTexture, vTextureCoord);
  vec3 median = uRadius < 1.5 ? median3x3() : medianWindow();
  finalColor = vec4(blendTrunc(original.rgb, median, uIntensity), original.a) * vColor;
}
