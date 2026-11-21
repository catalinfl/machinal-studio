precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uTexW;
uniform float uTexH;
uniform float uLumaRadius;
uniform float uChromaRadius;
uniform float uLumaPower;
uniform float uChromaPower;
uniform float uPass;
uniform float uAxis;

void main() {
  vec2 size=vec2(uTexW,uTexH);
  vec2 pixel=floor(vPos*size);
  float rY=uPass<uLumaPower ? uLumaRadius : 0.0;
  float rC=uPass<uChromaPower ? uChromaRadius : 0.0;
  vec3 radius=vec3(rC,rY,rC);
  vec3 sum=vec3(0.0);
  for(int index=-64;index<=64;index++) {
    if(abs(float(index))>max(rY,rC)) continue;
    vec2 p=pixel+(uAxis<.5 ? vec2(float(index),0.0) : vec2(0.0,float(index)));
    p=mod(p,size*2.0);
    p=min(p,size*2.0-1.0-p);
    vec2 uv=(p+.5)/size*uOutputFrame.zw*uInputSize.zw;
    vec3 value=floor(texture(uTexture,clamp(uv,uInputClamp.xy,uInputClamp.zw)).rgb*255.0+.5);
    sum+=value*step(vec3(abs(float(index))),radius);
  }
  vec3 length=2.0*radius+1.0;
  vec3 reciprocal=floor((vec3(65536.0)+floor(length/2.0))/length);
  vec3 result=floor((sum*reciprocal+32768.0)/65536.0)/255.0;
  finalColor=vec4(result,texture(uTexture,vTextureCoord).a)*vColor;
}
