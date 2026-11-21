precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uScaleX;
uniform float uScaleY;
uniform float uLumaQ;
uniform float uChromaQ;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

vec3 sampleYuv(vec2 offset) {
  vec2 uv=vTextureCoord+offset*vec2(uScaleX,uScaleY)*uInputSize.zw;
  vec3 c=texture(uTexture,clamp(uv,uInputClamp.xy,uInputClamp.zw)).rgb;
  return floor(vec3(dot(c,vec3(.299,.587,.114))*219.0+16.0,dot(c,vec3(-.168736,-.331264,.5))*224.0+128.0,dot(c,vec3(.5,-.418688,-.081312))*224.0+128.0)+.5);
}

float weight5(int x) { return x==0 ? 6.0 : ((x==-1 || x==1) ? 4.0 : 1.0); }
float weight3(int x) { return x==0 ? 2.0 : ((x==-1 || x==1) ? 1.0 : 0.0); }

void main() {
  vec4 original=texture(uTexture,vTextureCoord);
  vec3 source=sampleYuv(vec2(0.0));
  vec3 sum=vec3(0.0);
  for(int y=-2;y<=2;y++) {
    for(int x=-2;x<=2;x++) {
      vec3 value=sampleYuv(vec2(float(x),float(y)));
      sum.x+=value.x*weight5(x)*weight5(y);
      sum.yz+=value.yz*weight3(x)*weight3(y);
    }
  }
  vec3 blurred=floor((sum+vec3(128.0,8.0,8.0))/vec3(256.0,16.0,16.0));
  vec3 value=clamp(source+floor((source-blurred)*vec3(uLumaQ,uChromaQ,uChromaQ)/65536.0),0.0,255.0);
  float y=(value.x-16.0)/219.0, u=(value.y-128.0)/224.0, v=(value.z-128.0)/224.0;
  vec3 result=clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
  finalColor=vec4(blendTrunc(original.rgb,result,uIntensity),original.a)*vColor;
}
