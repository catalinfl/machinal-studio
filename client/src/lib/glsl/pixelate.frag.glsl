precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uBlockW;
uniform float uBlockH;
uniform float uIntensity;
uniform float uTexW;
uniform float uTexH;

void main() {
  vec2 K = max(uOutputFrame.zw * uInputSize.zw, vec2(1e-4));
  vec2 res = vec2(max(1.0, uTexW), max(1.0, uTexH));
  vec2 blocks = vec2(max(1.0, uBlockW), max(1.0, uBlockH));
  vec2 nBlocks = max(vec2(1.0), res / blocks);
  // FFmpeg pixelize=mode=avg replaces each block with its average color.
  // Average a 4x4 grid spread across the block (exact for blocks <=4px,
  // close visual match for larger blocks in a single pass).
  vec2 base = floor(vPos * nBlocks) / nBlocks;
  vec2 step_ = 1.0 / nBlocks;
  vec3 pix = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 sUv = base + step_ * (vec2(float(i), float(j)) + 0.5) / 4.0;
      pix += texture(uTexture, clamp(sUv, vec2(0.001), vec2(0.999)) * K).rgb;
    }
  }
  pix /= 16.0;
  vec3 orig = texture(uTexture, vTextureCoord).rgb;
  vec4 o = texture(uTexture, vTextureCoord);
  finalColor = vec4(mix(orig, pix, clamp(uIntensity, 0.0, 1.0)), o.a) * vColor;
}
