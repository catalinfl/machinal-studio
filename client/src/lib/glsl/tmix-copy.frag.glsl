precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;

// Quantize to byte-exact values like FFmpeg's per-stage uint8 frames, so the
// temporal mix below matches vf_mix.c bit-exactly instead of accumulating
// float precision that the native chain never has.
void main() {
  vec4 value = texture(uTexture, vTextureCoord);
  finalColor = floor(value * 255.0 + 0.5) / 255.0;
}
