precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform sampler2D uPrevious;
uniform sampler2D uCoefficients;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uPhase;
uniform float uPreviousValid;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

vec2 pixelUv(vec2 pixel) {
  return clamp((pixel+.5)*uInputSize.zw,uInputClamp.xy,uInputClamp.zw);
}

vec3 load(vec2 pixel) {
  vec3 c=texture(uOriginal,pixelUv(pixel)).rgb;
  return floor(vec3(dot(c,vec3(.299,.587,.114))*219.0+16.0,dot(c,vec3(-.168736,-.331264,.5))*224.0+128.0,dot(c,vec3(.5,-.418688,-.081312))*224.0+128.0)+.5)*256.0+127.0;
}

float coefficient(float previous,float current,float kind) {
  float index=clamp(floor((previous-current)/16.0)+4096.0,0.0,8191.0);
  vec2 uv=vec2((mod(index,256.0)*4.0+kind+.5)/1024.0,(floor(index/256.0)+.5)/32.0);
  vec2 value=floor(texture(uCoefficients,uv).rg*255.0+.5);
  return value.x+256.0*value.y-32768.0;
}

vec3 lowpass(vec3 previous,vec3 current,float temporal) {
  return current+vec3(coefficient(previous.r,current.r,temporal),coefficient(previous.g,current.g,temporal+1.0),coefficient(previous.b,current.b,temporal+1.0));
}

void main() {
  vec2 pixel=floor(vPos*uOutputFrame.zw);
  vec3 value;
  if(uPhase<.5) {
    value=load(vec2(0.0,pixel.y));
    if(pixel.y<.5) value=lowpass(value,value,0.0);
    for(int x=1;x<8192;x++) {
      if(float(x)>pixel.x) break;
      value=lowpass(value,load(vec2(float(x),pixel.y)),0.0);
    }
  } else if(uPhase<1.5) {
    value=texture(uTexture,pixelUv(vec2(pixel.x,0.0))).rgb;
    for(int y=1;y<8192;y++) {
      if(float(y)>pixel.y) break;
      value=lowpass(value,texture(uTexture,pixelUv(vec2(pixel.x,float(y)))).rgb,0.0);
    }
  } else if(uPhase<2.5) {
    value=texture(uTexture,vTextureCoord).rgb;
    vec3 previous=uPreviousValid>.5 ? texture(uPrevious,vTextureCoord).rgb : load(pixel);
    value=lowpass(previous,value,2.0);
  } else {
    vec4 original=texture(uOriginal,vTextureCoord);
    vec3 sample=floor(texture(uTexture,vTextureCoord).rgb/256.0);
    float y=(sample.x-16.0)/219.0,u=(sample.y-128.0)/224.0,v=(sample.z-128.0)/224.0;
    value=clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
    value=blendTrunc(original.rgb,value,uIntensity);
  }
  finalColor=vec4(value,1.0);
}
