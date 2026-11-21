precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uFocus;
uniform float uBlur;
uniform float uIntensity;
uniform float uTexW;
uniform float uTexH;

void main() {
  vec4 orig = texture(uTexture, vTextureCoord);
  float top = 0.5 - uFocus * 0.5;
  float bottom = 0.5 + uFocus * 0.5;
  float inFocus = step(top, vPos.y) * step(vPos.y, bottom);
  vec2 texel = uInputSize.zw;
  vec3 blur = vec3(0.0);
  float n = 0.0;
  float radius = clamp(uBlur * 0.5, 0.0, 12.0);
  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      blur += texture(uTexture, vTextureCoord + texel * vec2(x, y) * radius * 0.5).rgb;
      n += 1.0;
    }
  }
  blur /= max(1.0, n);
  vec3 c = mix(blur, orig.rgb, inFocus);
  c = mix(orig.rgb, c, clamp(uIntensity, 0.0, 1.0));
  finalColor = vec4(c, orig.a) * vColor;
}
