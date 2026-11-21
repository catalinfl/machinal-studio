precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uInputClamp;
uniform float uTexW;
uniform float uTexH;
uniform float uBlockW;
uniform float uBlockH;
uniform float uAxis;
uniform float uIntensity;

vec4 blendTrunc4(vec4 a, vec4 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return vec4(floor(mix(a.rgb, b.rgb, t) * 255.0) / 255.0, mix(a.a, b.a, t));
}

void main() {
  vec2 size = vec2(uTexW,uTexH);
  vec2 pixel = floor(vPos * size);
  float block = uAxis < .5 ? uBlockW : uBlockH;
  float pos = uAxis < .5 ? pixel.x : pixel.y;
  float extent = uAxis < .5 ? size.x : size.y;
  float start = floor(pos/block)*block;
  float count = min(block,extent-start);
  vec4 sum = vec4(0.0);
  for (int index = 0; index < 128; index++) {
    if (float(index) >= count) break;
    vec2 p = uAxis < .5 ? vec2(start+float(index),pixel.y) : vec2(pixel.x,start+float(index));
    vec2 uv = (p+.5)/size * uOutputFrame.zw*uInputSize.zw;
    sum += texture(uTexture,clamp(uv,uInputClamp.xy,uInputClamp.zw));
  }
  vec4 averaged = sum/max(1.0,count);
  if (uAxis > .5) {
    averaged.rgb = floor(averaged.rgb*255.0+.00001)/255.0;
    averaged = blendTrunc4(texture(uOriginal,vTextureCoord),averaged,uIntensity);
  }
  finalColor = averaged*vColor;
}
