precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform sampler2D uOther;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uPhase;
uniform float uAxis;
uniform float uDirection;
uniform float uStride;
uniform float uAlpha;
uniform float uInvRange;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

void main() {
  vec4 value=texture(uTexture,vTextureCoord);
  vec2 delta=uAxis<.5 ? vec2(uInputSize.z,0.0) : vec2(0.0,uInputSize.w);
  float coordinate=floor((uAxis<.5 ? vPos.x : vPos.y)*(uAxis<.5 ? uOutputFrame.z : uOutputFrame.w));
  float extent=uAxis<.5 ? uOutputFrame.z : uOutputFrame.w;
  if(uPhase<.5) {
    vec2 pair=uAxis<.5 ? vec2(floor(texture(uOriginal,vTextureCoord).g*255.0+.5)/255.0,1.0) : value.rg;
    float previous=coordinate-uDirection;
    if(previous<0.0 || previous>=extent) value=vec4(pair,0.0,1.0);
    else {
      float current=floor(texture(uOriginal,vTextureCoord).g*255.0+.5);
      float neighbor=floor(texture(uOriginal,clamp(vTextureCoord-delta*uDirection,uInputClamp.xy,uInputClamp.zw)).g*255.0+.5);
      float alpha=uAlpha*exp(-abs(current-neighbor)*uInvRange);
      value=vec4((1.0-uAlpha)*pair,alpha,1.0);
    }
  } else if(uPhase<1.5) {
    float previous=coordinate-uDirection*uStride;
    if(previous>=0.0 && previous<extent) {
      vec4 before=texture(uTexture,vTextureCoord-delta*uDirection*uStride);
      value.rg+=value.b*before.rg;
      value.b*=before.b;
    }
  } else if(uPhase<2.5) {
    value=vec4(value.rg+texture(uOther,vTextureCoord).rg,0.0,1.0);
  } else {
    vec2 sum=value.rg+texture(uOther,vTextureCoord).rg;
    vec4 original=texture(uOriginal,vTextureCoord);
    vec4 result=original;
    result.g=floor(sum.x/max(sum.y,.000001)*255.0+.5)/255.0;
    value=vec4(blendTrunc(original.rgb,result.rgb,uIntensity),original.a);
  }
  finalColor=value;
}
