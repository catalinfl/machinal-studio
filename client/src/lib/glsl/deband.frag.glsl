precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uNativeRandom;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uTexW;
uniform float uTexH;
uniform float uRange;
uniform float uThreshold;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

vec3 sampleByte(vec2 pixel) {
  vec2 uv=(clamp(pixel,vec2(0.0),vec2(uTexW,uTexH)-1.0)+.5)/vec2(uTexW,uTexH)*uOutputFrame.zw*uInputSize.zw;
  return floor(texture(uTexture,clamp(uv,uInputClamp.xy,uInputClamp.zw)).rgb*255.0+.5);
}

void main() {
  vec4 original=texture(uTexture,vTextureCoord);
  vec2 pixel=floor(vPos*vec2(uTexW,uTexH));
  vec3 bytes=texture(uNativeRandom,(pixel+.5)/vec2(uTexW,uTexH)).rgb*255.0;
  float random=dot(bytes,vec3(1.0/256.0,1.0/65536.0,1.0/16777216.0));
  float angle=random*6.28318530718;
  float distance=floor(random*uRange);
  vec2 offset=vec2(cos(angle),sin(angle))*distance;
  offset=sign(offset)*floor(abs(offset));
  vec3 average=floor((sampleByte(pixel+offset)+sampleByte(pixel-offset)+sampleByte(pixel+vec2(offset.x,-offset.y))+sampleByte(pixel+vec2(-offset.x,offset.y)))/4.0);
  vec3 source=floor(original.rgb*255.0+.5);
  bool replace=all(lessThan(abs(source-average),vec3(uThreshold)));
  vec3 result=replace ? average/255.0 : original.rgb;
  finalColor=vec4(blendTrunc(original.rgb,result,uIntensity),original.a)*vColor;
}
