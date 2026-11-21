precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uTexW;
uniform float uTexH;
uniform float uCellW;
uniform float uCellH;
uniform float uThickness;
uniform float uWhite;
uniform float uYuv;
uniform float uOpacity;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

void main() {
  vec4 original=texture(uTexture,vTextureCoord);
  vec2 pixel=floor(vPos*vec2(uTexW,uTexH));
  vec3 result=original.rgb;
  bool hitX = uCellW > 0.5 && mod(pixel.x,uCellW)<uThickness;
  bool hitY = uCellH > 0.5 && mod(pixel.y,uCellH)<uThickness;
  if(hitX || hitY) {
    float alpha=floor(uOpacity*255.0)/255.0;
    if(uYuv>.5) {
      vec3 c=original.rgb;
      vec3 yuv=floor(vec3(dot(c,vec3(.299,.587,.114))*219.0+16.0,dot(c,vec3(-.168736,-.331264,.5))*224.0+128.0,dot(c,vec3(.5,-.418688,-.081312))*224.0+128.0)+.5);
      vec3 target=vec3(uWhite>.5 ? 235.0 : 16.0,128.0,128.0);
      yuv=floor(mix(yuv,target,alpha));
      float y=(yuv.x-16.0)/219.0,u=(yuv.y-128.0)/224.0,v=(yuv.z-128.0)/224.0;
      result=clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
    } else result=floor(mix(floor(original.rgb*255.0+.5),vec3(uWhite*255.0),alpha))/255.0;
  }
  finalColor=vec4(blendTrunc(original.rgb,result,uIntensity),original.a)*vColor;
}
