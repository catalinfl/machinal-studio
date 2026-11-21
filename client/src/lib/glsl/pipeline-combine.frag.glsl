precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uOriginal;
uniform float uMode;
uniform float uOpacity;
uniform float uIntensity;
uniform float uFocus;
uniform float uYuv;
uniform float uTexH;

vec3 toYuv(vec3 c) {
  return floor(vec3(dot(c,vec3(.299,.587,.114))*219.0+16.0,dot(c,vec3(-.168736,-.331264,.5))*224.0+128.0,dot(c,vec3(.5,-.418688,-.081312))*224.0+128.0)+.5)/255.0;
}

vec3 toRgb(vec3 c) {
  float y=(c.x*255.0-16.0)/219.0;
  float u=(c.y*255.0-128.0)/224.0;
  float v=(c.z*255.0-128.0)/224.0;
  return clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
}

// FFmpeg vf_blend.c assigns the double expression result to uint8 (C-cast
// truncation). The framebuffer would round instead, diverging 1 LSB on
// ramps: truncate explicitly, keeping endpoints exact.
vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}

void main() {
  vec4 original=texture(uOriginal,vTextureCoord);
  vec3 effect=texture(uTexture,vTextureCoord).rgb;
  if (uMode > .5 && uMode < 1.5) {
    vec3 base=uYuv>.5 ? toYuv(original.rgb) : original.rgb;
    vec3 screen=vec3(1.0)-(vec3(1.0)-base)*(vec3(1.0)-effect);
    effect=floor(mix(base,screen,uOpacity)*255.0+.00001)/255.0;
    if(uYuv>.5) effect=toRgb(effect);
  } else if (uMode > 1.5) {
    float y=floor(vPos.y*uTexH)/uTexH;
    if(y>=.5-uFocus*.5 && y<=.5+uFocus*.5) effect=original.rgb;
  }
  finalColor=vec4(blendTrunc(original.rgb,effect,uIntensity),original.a)*vColor;
}
