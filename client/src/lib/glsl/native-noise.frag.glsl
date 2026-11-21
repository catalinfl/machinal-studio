precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uNoiseTable;
uniform sampler2D uRowShifts;
uniform float uTexW;
uniform float uTexH;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
uniform float uYuv;

vec3 toYuv(vec3 c) {
  return floor(vec3(dot(c,vec3(.299,.587,.114))*219.0+16.0,dot(c,vec3(-.168736,-.331264,.5))*224.0+128.0,dot(c,vec3(.5,-.418688,-.081312))*224.0+128.0)+.5);
}

float componentNoise(float component, vec2 pixel) {
  vec2 encoded=texture(uRowShifts,vec2((component+.5)/3.0,(mod(pixel.y,4096.0)+.5)/4096.0)).rg*255.0;
  float shift=floor(encoded.x+.5)+256.0*floor(encoded.y+.5);
  float index=mod(pixel.x,4096.0)+shift;
  vec3 values=texture(uNoiseTable,vec2((mod(index,1024.0)+.5)/1024.0,(floor(index/1024.0)+.5)/5.0)).rgb*255.0-128.0;
  return component<.5 ? values.r : (component<1.5 ? values.g : values.b);
}

void main() {
  vec4 original=texture(uTexture,vTextureCoord);
  vec2 pixel=floor(vPos*vec2(uTexW,uTexH));
  vec3 noise=vec3(componentNoise(0.0,pixel),componentNoise(1.0,pixel),componentNoise(2.0,pixel));
  vec3 value=uYuv>.5 ? toYuv(original.rgb) : floor(original.gbr*255.0+.5);
  value=clamp(value+noise,0.0,255.0);
  vec3 result=value.brg/255.0;
  if(uYuv>.5) {
    float y=(value.x-16.0)/219.0, u=(value.y-128.0)/224.0, v=(value.z-128.0)/224.0;
    result=clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
  }
  finalColor=vec4(blendTrunc(original.rgb,result,uIntensity),original.a)*vColor;
}
