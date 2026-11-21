precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uNu;
uniform float uRadius;
uniform float uAxis;
uniform float uPixelScale;

void main() {
  vec2 stepUv = (uAxis < 0.5 ? vec2(uInputSize.z, 0.0) : vec2(0.0, uInputSize.w)) * uPixelScale;
  vec4 sum = texture(uTexture, vTextureCoord);
  float total = 1.0;
  float weight = 1.0;
  // The symmetric exponential is the impulse response of one FFmpeg gblur
  // forward/backward IIR pass. Repeating it preserves the meaning of steps.
  for (int offset = 1; offset <= 256; offset++) {
    if (float(offset) > uRadius) break;
    weight *= uNu;
    vec2 delta = stepUv * float(offset);
    sum += weight * (
      texture(uTexture, clamp(vTextureCoord - delta, uInputClamp.xy, uInputClamp.zw)) +
      texture(uTexture, clamp(vTextureCoord + delta, uInputClamp.xy, uInputClamp.zw))
    );
    total += 2.0 * weight;
  }
  finalColor = sum / total * vColor;
}
