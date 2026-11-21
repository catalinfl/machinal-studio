precision highp float;
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;
uniform float uMode;
uniform float uIntensity;

vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
uniform float uAmp;
uniform float uWaveLen;
uniform float uBandW;
uniform float uStart;
uniform float uTime;
uniform float uSpeed;
uniform float uTexW;
uniform float uTexH;

vec3 yuvAt(vec2 pixel) {
  vec2 uv = (pixel + 0.5) / vec2(uTexW, uTexH) * uOutputFrame.zw * uInputSize.zw;
  vec3 c = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
  return floor(vec3(dot(c, vec3(.299,.587,.114))*219.0+16.0, dot(c, vec3(-.168736,-.331264,.5))*224.0+128.0, dot(c, vec3(.5,-.418688,-.081312))*224.0+128.0)+.5);
}

vec3 samplePlane(vec2 pixel) {
  vec2 p = clamp(pixel, vec2(0.0), vec2(uTexW, uTexH) - 2.0);
  vec2 base = floor(p);
  vec2 amount = fract(p);
  return mix(mix(yuvAt(base), yuvAt(base+vec2(1.0,0.0)), amount.x), mix(yuvAt(base+vec2(0.0,1.0)), yuvAt(base+vec2(1.0,1.0)), amount.x), amount.y);
}

void main() {
  vec2 pixel = floor(vPos * vec2(uTexW, uTexH));
  vec3 offsets = vec3(0.0);
  if (uMode < .5) {
    float amount = sin(pixel.y / uWaveLen);
    offsets = uAmp * amount * vec3(1.0,.5,.5);
  } else if (uMode < 1.5) {
    float amount = sin(pixel.y / uWaveLen + uTime * uSpeed);
    offsets = uAmp * amount * vec3(1.0,.5,-.5);
  } else if (uMode < 2.5) {
    if (pixel.y > uTexH * uStart) offsets = uAmp * vec3(sin(pixel.y / 2.0 + uTime * 25.0), .5, -.5);
  } else {
    if (mod(pixel.y + uTime * uSpeed, uWaveLen) < uBandW) offsets = uAmp * vec3(sin(uTime * 31.0), .5, -.5);
  }
  vec3 yuv = floor(vec3(samplePlane(pixel+vec2(offsets.x,0.0)).x, samplePlane(pixel+vec2(offsets.y,0.0)).y, samplePlane(pixel+vec2(offsets.z,0.0)).z) + .00001);
  float y = (yuv.x - 16.0) / 219.0;
  float u = (yuv.y - 128.0) / 224.0;
  float v = (yuv.z - 128.0) / 224.0;
  vec3 result = clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
  vec4 original = texture(uTexture,vTextureCoord);
  finalColor = vec4(blendTrunc(original.rgb,result,uIntensity),original.a)*vColor;
}
