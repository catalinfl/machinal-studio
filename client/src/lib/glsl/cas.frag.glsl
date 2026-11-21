precision highp float;
in vec2 vTextureCoord;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uScaleX;
uniform float uScaleY;
uniform float uStrength;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

vec3 sampleByte(float x,float y) {
  vec2 uv=vTextureCoord+vec2(x*uScaleX,y*uScaleY)*uInputSize.zw;
  return floor(texture(uTexture,clamp(uv,uInputClamp.xy,uInputClamp.zw)).rgb*255.0+.5);
}

void main() {
  vec4 original=texture(uTexture,vTextureCoord);
  vec3 a=sampleByte(-1.0,-1.0),b=sampleByte(0.0,-1.0),c=sampleByte(1.0,-1.0);
  vec3 d=sampleByte(-1.0,0.0),e=sampleByte(0.0,0.0),f=sampleByte(1.0,0.0);
  vec3 g=sampleByte(-1.0,1.0),h=sampleByte(0.0,1.0),i=sampleByte(1.0,1.0);
  vec3 minimum=min(min(min(d,e),f),min(b,h));
  minimum+=min(min(min(minimum,a),c),min(g,i));
  vec3 maximum=max(max(max(d,e),f),max(b,h));
  maximum+=max(max(max(maximum,a),c),max(g,i));
  vec3 amplitude=sqrt(clamp(min(minimum,511.0-maximum)/max(maximum,vec3(1.0)),0.0,1.0));
  vec3 weight=amplitude/(-16.0+11.99*uStrength);
  vec3 result=clamp(floor(((b+d+f+h)*weight+e)/(1.0+4.0*weight)),0.0,255.0)/255.0;
  finalColor=vec4(blendTrunc(original.rgb,result,uIntensity),original.a)*vColor;
}
