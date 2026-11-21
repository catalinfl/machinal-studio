precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uRadius;
uniform float uOpacity;
uniform float uBrightness;
uniform float uSaturation;
uniform float uRed;
uniform float uIntensity;
// FFmpeg glow-bloom/halation: split -> gblur+grade the copy ->
// blend=all_mode=screen:all_opacity. screen(A,B)=1-(1-A)(1-B),
// output = A*(1-o) + screen(A,B)*o, computed here in one pass with a
// 5x5 gaussian (sigma ~ radius/2.5) standing in for gblur=sigma.
void main() {
  vec4 orig = texture(uTexture, vTextureCoord);
  vec3 src = orig.rgb;
  vec2 texel = uInputSize.zw;
  float sigma = max(0.5, uRadius / 2.5);
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float d2 = float(x * x + y * y);
      float w = exp(-d2 / (2.0 * sigma * sigma));
      acc += texture(uTexture, vTextureCoord + texel * vec2(float(x), float(y)) * max(1.0, sigma * 0.8)).rgb * w;
      wsum += w;
    }
  }
  vec3 glow = acc / max(1e-4, wsum);
  glow += vec3(uBrightness);
  float l = dot(glow, vec3(0.299, 0.587, 0.114));
  glow = vec3(l) + (glow - vec3(l)) * uSaturation;
  glow += vec3(uRed, -uRed * 0.25, -uRed * 0.55);
  glow = clamp(glow, 0.0, 1.0);
  vec3 screenv = vec3(1.0) - (vec3(1.0) - src) * (vec3(1.0) - glow);
  vec3 outc = src * (1.0 - uOpacity) + screenv * uOpacity;
  finalColor = vec4(mix(src, clamp(outc, 0.0, 1.0), clamp(uIntensity, 0.0, 1.0)), orig.a) * vColor;
}
