
in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uMode;
uniform float uIntensity;
uniform float uP0;
uniform float uP1;
uniform float uP2;
uniform float uP3;
uniform float uP4;

// BT.601 luma: matches FFmpeg format=gray / hue=s=0 / eq Y plane.
float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// FFmpeg vf_blend.c assigns the double expression to uint8 (truncation);
// the framebuffer would round instead: truncate explicitly on ramps.
vec3 blendTrunc(vec3 a, vec3 b, float t) {
  if (t >= 0.999) return b;
  if (t <= 0.001) return a;
  return floor(mix(a, b, t) * 255.0) / 255.0;
}
// Simple RGB average gray: matches FFmpeg colorhold (vf_colorkey.c
// do_colorhold_slice uses (r+g+b)/3, not luma).
float avgGray(vec3 c) { return (c.r + c.g + c.b) / 3.0; }

void main() {
  vec4 color = texture(uTexture, vTextureCoord);
  vec3 c = color.rgb;
  if (uMode < 0.5) {
    // Exact FFmpeg vf_vignette.c forward factor: cos(angle*d)^4,
    // d = hypot(xx,yy)/dmax, dmax = hypot(w/2,h/2), angle = uP0
    // (default PI/4), xx=(x-x0)*xscale, yy=(y-y0)*yscale.
    // uP3/uP4 carry frame W/H so non-square frames match FFmpeg:
    // d = length((vPos-0.5)*res)/length(res*0.5). Backward mode is
    // 1/factor (unused here).
    float angle = uP0 > 0.0001 ? uP0 : 0.7853982;
    angle = clamp(angle, 0.0, 1.5707963);
    vec2 res = vec2(max(1.0, uP3), max(1.0, uP4));
    vec2 pc = floor(vPos * res) - res * .5;
    pc = sign(pc) * floor(abs(pc));
    float dnorm = length(pc) / max(1.0, length(res * 0.5));
    float cf = cos(angle * clamp(dnorm, 0.0, 1.0));
    float factor = cf * cf * cf * cf;
    if (dnorm > 1.0) factor = 0.0;
    vec3 result=floor(c*255.0*factor+.5)/255.0;
    if(uP1>.5) {
      vec3 yuv=floor(vec3(dot(c,vec3(.299,.587,.114))*219.0+16.0,dot(c,vec3(-.168736,-.331264,.5))*224.0+128.0,dot(c,vec3(.5,-.418688,-.081312))*224.0+128.0)+.5);
      yuv=floor(vec3(yuv.x*factor,(yuv.yz-127.0)*factor+127.0)+.5);
      float y=(yuv.x-16.0)/219.0,u=(yuv.y-128.0)/224.0,v=(yuv.z-128.0)/224.0;
      result=clamp(vec3(y+1.402*v,y-.344136*u-.714136*v,y+1.772*u),0.0,1.0);
    }
    c = blendTrunc(c, result, clamp(uIntensity, 0.0, 1.0));
  } else if (uMode < 1.5) {
    float row = mod(gl_FragCoord.y, max(1.0, uP0));
    float line = step(row, uP1) * clamp(uP2, 0.0, 1.0);
    c *= (1.0 - line);
  } else if (uMode < 2.5) {
    float col = mod(gl_FragCoord.x, max(1.0, uP0));
    float line = step(col, uP1) * uP2;
    c = mix(c, vec3(1.0), line * uIntensity);
  } else if (uMode < 3.5) {
    float levels = max(2.0, uP0);
    vec3 q = floor(c * 255.0 * levels / 256.0) / (levels - 1.0);
    c = blendTrunc(c, clamp(q, 0.0, 1.0), uIntensity);
  } else if (uMode < 4.5) {
    vec3 s = mix(c, vec3(1.0) - c, step(uP0, c));
    c = blendTrunc(c, s, uIntensity);
  } else if (uMode < 5.5) {
    float l = luminance(c);
    vec3 duo = vec3(11.0 + 236.0 * l, 16.0 + 162.0 * l, 38.0 + 65.0 * l) / 255.0;
    c = blendTrunc(c, duo, uIntensity);
  } else if (uMode < 6.5) {
    float l = luminance(c) * 255.0;
    vec3 tri;
    if (l < 128.0) tri = vec3(18.0 + 0.55 * l, 24.0 + 0.75 * l, 54.0 + 1.05 * l) / 255.0;
    else tri = vec3(88.0 + 1.25 * (l - 128.0), 120.0 + 0.72 * (l - 128.0), 188.0 + 0.45 * (l - 128.0)) / 255.0;
    c = blendTrunc(c, tri, uIntensity);
  } else if (uMode < 7.5) {
    // FFmpeg's default index is plane zero, G in the canonical GBRP input.
    float x = floor(c.g * 255.0 + 0.5) * (256.0 / 255.0);
    vec3 turbo = vec3(-4.3683890e-15, -4.0011069e-16, -2.8242609e-15);
    turbo = turbo * x + vec3(3.7020347e-12, 2.7861423e-13, 2.9234108e-12);
    turbo = turbo * x + vec3(-1.1712592e-09, -6.3388921e-11, -1.1726546e-09);
    turbo = turbo * x + vec3(1.6401790e-07, 5.8872238e-09, 2.2552115e-07);
    turbo = turbo * x + vec3(-8.6842919e-06, -5.4466522e-07, -2.0059387e-05);
    turbo = turbo * x + vec3(-1.8542465e-06, 1.8037114e-05, 5.0595552e-04);
    turbo = turbo * x + vec3(8.4485325e-03, 1.0599869e-02, 1.7714932e-02);
    turbo = clamp(turbo * x + vec3(1.6267077e-01, 7.6914696e-02, 2.7271836e-01), 0.0, 1.0);
    c = blendTrunc(c, floor(turbo * 255.0) / 255.0, uIntensity);
  } else if (uMode < 8.5) {
    // FFmpeg 5.1 vf_pseudocolor Inferno polynomial, evaluated at LUT index/255*256.
    float x = floor(clamp(luminance(c), 0.0, 1.0) * 255.0 + 0.5) * (256.0 / 255.0);
    vec3 inferno = vec3(-3.9848859e-18, 6.8408539e-16, -2.9921470e-15);
    inferno = inferno * x + vec3(9.4821649e-14, -6.5499979e-13, 2.5864165e-12);
    inferno = inferno * x + vec3(-6.7371977e-11, 2.4562526e-10, -8.7403799e-10);
    inferno = inferno * x + vec3(1.8469937e-08, -4.5989298e-08, 1.4713388e-07);
    inferno = inferno * x + vec3(-2.5359307e-06, 4.5723324e-06, -1.2701505e-05);
    inferno = inferno * x + vec3(1.7959053e-04, -2.2111913e-04, 4.5159935e-04);
    inferno = inferno * x + vec3(3.9782564e-04, 5.2023164e-03, 3.1087989e-03);
    inferno = clamp(inferno * x + vec3(2.8845935e-04, -1.1226064e-02, 1.9122831e-02), 0.0, 1.0);
    // The export explicitly keeps GRAY8: pseudocolor writes only its Y LUT,
    // not three RGB planes. Its BT.709 Y coefficients omit the 16-code offset.
    float gray = floor(dot(inferno, vec3(0.2126, 0.7152, 0.0722)) * 219.0) / 255.0;
    c = blendTrunc(c, vec3(gray), uIntensity);
  } else if (uMode < 9.5) {
    // Exact FFmpeg vf_colorkey.c colorhold: normalized euclidean distance
    // diff = |c-target|/(255*sqrt(3)), t = clamp((diff-sim)/blend),
    // gray = (r+g+b)/3, out = mix(c, gray, t). uP4 carries blend.
    vec3 target = vec3(uP0, uP1, uP2) / 255.0;
    float diff = distance(c, target) / 1.7320508;
    float blend = max(uP4, 0.0001);
    float t = clamp((diff - uP3) / blend, 0.0, 1.0);
    vec3 held = mix(c, vec3(avgGray(c)), t);
    c = blendTrunc(texture(uTexture, vTextureCoord).rgb, held, uIntensity);
  } else if (uMode < 10.5) {
    // Exact FFmpeg lens-flare geq: r+70*exp(-((X-W*0.72)^2+(Y-H*0.28)^2)/
    // (W*H*0.006)) etc. uP0/uP1 carry frame W/H so the elliptical falloff
    // matches non-square frames; amplitudes 70/52/30 -> 0.27/0.20/0.12.
    vec2 fc = vec2(0.72, 0.28);
    float W = max(1.0, uP0);
    float H = max(1.0, uP1);
    vec2 dn = vPos - fc;
    float d2px = dn.x * dn.x * W * W + dn.y * dn.y * H * H;
    float glow = exp(-d2px / max(1.0, W * H * 0.006)) * uIntensity;
    c += vec3(0.2745098, 0.2039216, 0.1176471) * glow;
  } else if (uMode < 11.5) {
    float col = mod(gl_FragCoord.x, max(1.0, uP0));
    float maskV = step(col, uP1) * uP2;
    float row = mod(gl_FragCoord.y, max(1.0, uP3));
    float maskH = step(row, 1.0) * uP2 * 0.8;
    c *= (1.0 - (maskV + maskH) * uIntensity);
  } else if (uMode < 12.5) {
    // Exact FFmpeg curves=all=0/0 0.35/0.2 0.72/0.88 1/1 natural cubic spline
    // (vf_curves.c interpolate): M=[0,7.4957,-8.637,0].
    vec3 cc = clamp(c, 0.0, 1.0);
    float y0; float x0 = cc.r;
    if (x0 < 0.35) { y0 = 0.1341 * x0 + 3.5694 * x0 * x0 * x0; }
    else if (x0 < 0.72) { float xx = x0 - 0.35; y0 = 0.2 + 1.4460 * xx + 3.7479 * xx * xx - 7.2660 * xx * xx * xx; }
    else { float xx = x0 - 0.72; y0 = 0.88 + 1.2347 * xx - 4.3185 * xx * xx + 5.1410 * xx * xx * xx; }
    float y1; float x1 = cc.g;
    if (x1 < 0.35) { y1 = 0.1341 * x1 + 3.5694 * x1 * x1 * x1; }
    else if (x1 < 0.72) { float xx = x1 - 0.35; y1 = 0.2 + 1.4460 * xx + 3.7479 * xx * xx - 7.2660 * xx * xx * xx; }
    else { float xx = x1 - 0.72; y1 = 0.88 + 1.2347 * xx - 4.3185 * xx * xx + 5.1410 * xx * xx * xx; }
    float y2; float x2 = cc.b;
    if (x2 < 0.35) { y2 = 0.1341 * x2 + 3.5694 * x2 * x2 * x2; }
    else if (x2 < 0.72) { float xx = x2 - 0.35; y2 = 0.2 + 1.4460 * xx + 3.7479 * xx * xx - 7.2660 * xx * xx * xx; }
    else { float xx = x2 - 0.72; y2 = 0.88 + 1.2347 * xx - 4.3185 * xx * xx + 5.1410 * xx * xx * xx; }
    vec3 outc = clamp(vec3(y0, y1, y2), 0.0, 1.0);
    c = blendTrunc(c, outc, clamp(uIntensity, 0.0, 1.0));
  }
  finalColor = vec4(c, color.a) * vColor;
}
