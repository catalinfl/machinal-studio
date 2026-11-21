precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uScaleX;
uniform float uScaleY;
uniform float uMode;
uniform float uIntensity;
uniform float uP0;
uniform float uP1;
uniform float uTexW;
uniform float uTexH;

float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec4 sampleColor(vec2 uv) {
  return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

float grayAt(vec2 uv) {
  return floor(luminance(sampleColor(uv).rgb) * 255.0 + 0.5) / 255.0;
}

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

void main() {
  vec2 texel = uInputSize.zw * vec2(uScaleX, uScaleY);
  vec4 orig = texture(uTexture, vTextureCoord);
  vec3 c = orig.rgb;
  if (uMode < 0.5) {
    // FFmpeg edgedetect=mode=colormix: Canny edges (binary after double
    // threshold) averaged with source: dst = (edge + src) / 2 per plane.
    // Single-pass approx: Sobel magnitude -> smoothstep(low,high) binary.
    float tl = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, -1.0)).rgb);
    float t = luminance(texture(uTexture, vTextureCoord + texel * vec2(0.0, -1.0)).rgb);
    float tr = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, -1.0)).rgb);
    float l = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, 0.0)).rgb);
    float r = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, 0.0)).rgb);
    float bl = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, 1.0)).rgb);
    float b = luminance(texture(uTexture, vTextureCoord + texel * vec2(0.0, 1.0)).rgb);
    float br = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, 1.0)).rgb);
    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float edge = clamp(length(vec2(gx, gy)) * 0.25, 0.0, 1.0);
    float bin = smoothstep(uP0, uP1, edge);
    vec3 mixed = (c + vec3(bin)) * 0.5;
    c = blendTrunc(c, mixed, uIntensity);
  } else if (uMode < 1.5) {
    float tl = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, -1.0)).rgb);
    float t = luminance(texture(uTexture, vTextureCoord + texel * vec2(0.0, -1.0)).rgb);
    float tr = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, -1.0)).rgb);
    float l = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, 0.0)).rgb);
    float r = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, 0.0)).rgb);
    float bl = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, 1.0)).rgb);
    float b = luminance(texture(uTexture, vTextureCoord + texel * vec2(0.0, 1.0)).rgb);
    float br = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, 1.0)).rgb);
    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float edge = clamp(length(vec2(gx, gy)), 0.0, 1.0);
    float wires = 1.0 - smoothstep(uP0, uP1, edge);
    vec3 sketch = vec3(wires);
    c = blendTrunc(c, sketch, uIntensity);
  } else if (uMode < 2.5) {
    float tl = grayAt(vTextureCoord + texel * vec2(-1.0, -1.0));
    float t = grayAt(vTextureCoord + texel * vec2(0.0, -1.0));
    float l = grayAt(vTextureCoord + texel * vec2(-1.0, 0.0));
    float cc = grayAt(vTextureCoord);
    float r = grayAt(vTextureCoord + texel * vec2(1.0, 0.0));
    float b = grayAt(vTextureCoord + texel * vec2(0.0, 1.0));
    float br = grayAt(vTextureCoord + texel * vec2(1.0, 1.0));
    float emboss = -2.0 * tl - t - l + cc + r + b + 2.0 * br;
    // FFmpeg's bias is in 8-bit sample units, not normalized RGB units.
    emboss = floor(emboss * 255.0 + 1.0) / 255.0;
    c = blendTrunc(c, vec3(clamp(emboss, 0.0, 1.0)), uIntensity);
  } else if (uMode < 3.5) {
    // FFmpeg unsharp defaults to a 5x5 box blur (msize 5) subtracted with
    // amount: out = src + (src - blur5x5) * amount.
    vec3 blur = vec3(0.0);
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        blur += texture(uTexture, vTextureCoord + texel * vec2(float(x), float(y))).rgb;
      }
    }
    blur /= 25.0;
    vec3 sharp = c + (c - blur) * uP0;
    c = blendTrunc(c, sharp, uIntensity);
  } else if (uMode < 4.5) {
    float tl = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, -1.0)).rgb);
    float t = luminance(texture(uTexture, vTextureCoord + texel * vec2(0.0, -1.0)).rgb);
    float tr = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, -1.0)).rgb);
    float l = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, 0.0)).rgb);
    float r = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, 0.0)).rgb);
    float bl = luminance(texture(uTexture, vTextureCoord + texel * vec2(-1.0, 1.0)).rgb);
    float b = luminance(texture(uTexture, vTextureCoord + texel * vec2(0.0, 1.0)).rgb);
    float br = luminance(texture(uTexture, vTextureCoord + texel * vec2(1.0, 1.0)).rgb);
    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float edge = clamp(length(vec2(gx, gy)), 0.0, 1.0);
    float ink = 1.0 - smoothstep(uP0, uP1, edge) * uP0;
    c *= mix(1.0, ink, uIntensity);
  }
  finalColor = vec4(c, orig.a) * vColor;
}
