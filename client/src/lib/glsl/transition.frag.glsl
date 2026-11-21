// transition between images

precision highp float;

in vec2 vTextureCoord;
in vec2 vPos;
in vec4 vColor;
out vec4 finalColor;

uniform sampler2D uTexture; // A image
uniform sampler2D uBackTexture; // B image
uniform sampler2D uNativeRandom;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float uTMode; // transition
uniform float uProgress; // progress of transition
uniform float uTexW;
uniform float uTexH;

const float PI = 3.14159265358979323846;

// smoothstep
float ffSmooth(float edge0, float edge1, float value) {
  float amount = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return amount * amount * (3.0 - 2.0 * amount);
}

float ffRandom(vec2 pixel) {
  vec3 bytes = texture(uNativeRandom, (pixel + 0.5) / vec2(uTexW, uTexH)).rgb * 255.0;
  return dot(bytes, vec3(1.0 / 256.0, 1.0 / 65536.0, 1.0 / 16777216.0));
}

vec4 ffMix(vec4 a, vec4 b, float amount) {
  return a * amount + b * (1.0 - amount);
}

vec4 opaque(vec4 color) {
  if (color.a > 0.0) color.rgb /= color.a;
  vec3 rgb = color.rgb;
  vec3 yuv = floor(vec3(
    dot(rgb, vec3(0.299, 0.587, 0.114)) * 219.0 + 16.0,
    dot(rgb, vec3(-0.168736, -0.331264, 0.5)) * 224.0 + 128.0,
    dot(rgb, vec3(0.5, -0.418688, -0.081312)) * 224.0 + 128.0
  ) + 0.5) / 255.0;
  return vec4(yuv, 1.0);
}

vec2 sampleUv(vec2 pixel, vec2 size) {
  return (clamp(pixel, vec2(0.0), size - 1.0) + 0.5) / size * uOutputFrame.zw * uInputSize.zw;
}

vec4 sampleA(vec2 pixel, vec2 size) {
  return opaque(texture(uBackTexture, sampleUv(pixel, size)));
}

vec4 sampleB(vec2 pixel, vec2 size) {
  return opaque(texture(uTexture, sampleUv(pixel, size)));
}

vec4 selectLess(vec4 values, float threshold, vec4 yesValue, vec4 noValue) {
  return vec4(
    values.r < threshold ? yesValue.r : noValue.r,
    values.g < threshold ? yesValue.g : noValue.g,
    values.b < threshold ? yesValue.b : noValue.b,
    1.0
  );
}

vec3 quantizeByte(vec3 value) {
  return floor(clamp(value, 0.0, 1.0) * 255.0 + 0.00001) / 255.0;
}

// Pixi compiles preview filters as GLSL ES 1.00 on many setups, where
// trunc()/round() and integer min()/max() do not exist (they are ES 3.00
// only). These helpers emulate them with floor/sign so every transition
// mode links on both GLSL versions. ffTrunc matches C trunc() semantics
// (toward zero), unlike floor(), for negative slide offsets.
float ffTrunc(float x) { return sign(x) * floor(abs(x)); }
vec2 ffTrunc2(vec2 x) { return sign(x) * floor(abs(x)); }
vec3 ffTrunc3(vec3 x) { return sign(x) * floor(abs(x)); }
float ffRound(float x) { return floor(x + 0.5); }
int ffMini(int a, int b) { return a < b ? a : b; }
int ffMaxi(int a, int b) { return a > b ? a : b; }

vec3 wrapCustomByte(vec3 value) {
  vec3 integerValue = ffTrunc3(value * 255.0);
  return mod(mod(integerValue, 256.0) + 256.0, 256.0) / 255.0;
}

void main() {
  // Pixi renders filters into power-of-two pooled textures: uInputSize is
  // the pooled backing size while uOutputFrame.zw is the real filter bounds.
  // Work in bounds space and convert to UVs with uInputSize.zw so both A/B
  // samples land inside the content subrect (same K idiom as warp/pixelate).
  // Using uInputSize.xy here squeezes the transition into a small interior
  // rect whenever the pool rounds the backing texture up.
  vec2 size = max(vec2(1.0), vec2(uTexW, uTexH));
  vec2 pixel = clamp(floor(vPos * size), vec2(0.0), size - 1.0);
  float x = pixel.x;
  float y = pixel.y;
  float W = size.x;
  float H = size.y;
  float progress = clamp(uProgress, 0.0, 1.0);
  float P = 1.0 - progress;
  float Q = 1.0 - P;
  float mode = floor(uTMode + 0.5);
  vec4 A = sampleA(pixel, size);
  vec4 B = sampleB(pixel, size);
  vec4 result = A;
  bool custom = mode >= 46.0;

  if (mode == 0.0) {
    result = ffMix(A, B, P);
  } else if (mode == 1.0) {
    result = x > ffTrunc(W * P) ? B : A;
  } else if (mode == 2.0) {
    result = x > ffTrunc(W * (1.0 - P)) ? A : B;
  } else if (mode == 3.0) {
    result = y > ffTrunc(H * P) ? B : A;
  } else if (mode == 4.0) {
    result = y > ffTrunc(H * (1.0 - P)) ? A : B;
  } else if (mode >= 5.0 && mode <= 8.0) {
    bool horizontal = mode <= 6.0;
    float extent = horizontal ? W : H;
    float coordinate = horizontal ? x : y;
    float direction = mode == 5.0 || mode == 7.0 ? -1.0 : 1.0;
    float shifted = coordinate + ffTrunc(direction * P * extent);
    float wrapped = mod(shifted, extent);
    vec2 sourcePixel = horizontal ? vec2(wrapped, y) : vec2(x, wrapped);
    result = shifted >= 0.0 && shifted < extent
      ? sampleB(sourcePixel, size)
      : sampleA(sourcePixel, size);
  } else if (mode == 9.0) {
    vec2 center = floor(size / 2.0);
    float radius = pow(2.0 * abs(P - 0.5), 3.0) * length(center);
    result = length(pixel - center) > radius ? vec4(0.0, 127.0/255.0, 127.0/255.0, 1.0) : (P < 0.5 ? B : A);
  } else if (mode == 10.0) {
    vec2 center = floor(size / 2.0);
    float halfWidth = ffTrunc(abs(P - 0.5) * W);
    float halfHeight = ffTrunc(abs(P - 0.5) * H);
    bool inside = abs(x - center.x) < halfWidth && abs(y - center.y) < halfHeight;
    result = inside ? (P < 0.5 ? B : A) : vec4(0.0, 127.0/255.0, 127.0/255.0, 1.0);
  } else if (mode == 11.0) {
    float nearEnough = length(A.rgb - B.rgb) <= P ? 1.0 : 0.0;
    result = ffMix(ffMix(A, B, nearEnough), B, P);
  } else if (mode == 12.0 || mode == 13.0) {
    vec4 solid = vec4(mode == 12.0 ? 0.0 : 1.0, 127.0/255.0, 127.0/255.0, 1.0);
    result = ffMix(
      ffMix(A, solid, ffSmooth(0.8, 1.0, P)),
      ffMix(solid, B, ffSmooth(0.2, 1.0, P)),
      P
    );
  } else if (mode == 14.0) {
    vec2 center = floor(size / 2.0);
    float angle = atan(x - center.x, y - center.y) - (P - 0.5) * 2.5 * PI;
    result = ffMix(B, A, ffSmooth(0.0, 1.0, angle));
  } else if (mode >= 15.0 && mode <= 18.0) {
    float field = 0.0;
    if (mode == 15.0) field = 1.0 + x / W - 2.0 * P;
    if (mode == 16.0) field = 1.0 + (W - 1.0 - x) / W - 2.0 * P;
    if (mode == 17.0) field = 1.0 + y / H - 2.0 * P;
    if (mode == 18.0) field = 1.0 + (H - 1.0 - y) / H - 2.0 * P;
    result = ffMix(B, A, ffSmooth(0.0, 1.0, field));
  } else if (mode == 19.0 || mode == 20.0) {
    vec2 center = floor(size / 2.0);
    float radius = length(pixel - center) / max(length(center), 0.00001);
    float field = mode == 19.0
      ? radius + (P - 0.5) * 3.0
      : radius + (1.0 - P - 0.5) * 3.0;
    result = mode == 19.0
      ? ffMix(A, B, ffSmooth(0.0, 1.0, field))
      : ffMix(B, A, ffSmooth(0.0, 1.0, field));
  } else if (mode >= 21.0 && mode <= 24.0) {
    bool vertical = mode <= 22.0;
    float center = floor((vertical ? W : H) / 2.0);
    float coordinate = vertical ? x : y;
    float normalized = abs((coordinate - center) / max(center, 0.00001));
    float field = mode == 21.0 || mode == 23.0
      ? 2.0 - normalized - 2.0 * P
      : 1.0 + normalized - 2.0 * P;
    result = ffMix(B, A, ffSmooth(0.0, 1.0, field));
  } else if (mode == 25.0) {
    result = ffRandom(pixel) + P >= 1.0 ? A : B;
  } else if (mode == 26.0) {
    float distance = ceil(50.0 * min(P, 1.0 - P)) / 50.0;
    float block = 2.0 * distance * min(W, H) / 20.0;
    vec2 sourcePixel = pixel;
    if (block > 0.0) {
      sourcePixel = min((floor(pixel / block) + 0.5) * block, size - 1.0);
      sourcePixel = ffTrunc2(sourcePixel);
    }
    result = ffMix(sampleA(sourcePixel, size), sampleB(sourcePixel, size), P);
  } else if (mode >= 27.0 && mode <= 30.0) {
    float dx = mode == 28.0 || mode == 30.0 ? (W - 1.0 - x) / W : x / W;
    float dy = mode == 29.0 || mode == 30.0 ? (H - 1.0 - y) / H : y / H;
    float field = 1.0 + dx * dy - 2.0 * P;
    result = ffMix(B, A, ffSmooth(0.0, 1.0, field));
  } else if (mode >= 31.0 && mode <= 34.0) {
    float coordinate = 0.0;
    if (mode == 31.0) coordinate = x / W;
    if (mode == 32.0) coordinate = (W - 1.0 - x) / W;
    if (mode == 33.0) coordinate = y / H;
    if (mode == 34.0) coordinate = (H - 1.0 - y) / H;
    float gradient = ffSmooth(-0.5, 0.0, coordinate - 1.5 * P);
    float selector = gradient <= fract(10.0 * coordinate) ? 0.0 : 1.0;
    result = ffMix(B, A, selector);
  } else if (mode == 35.0) {
    float gradient = P <= 0.5 ? 2.0 * P : 2.0 * (1.0 - P);
    int count = 1 + int(floor(W / 2.0) * gradient);
    count = ffMini(count, int(W - x));
    vec4 sumA = vec4(0.0);
    vec4 sumB = vec4(0.0);
    for (int offset = 0; offset < 2048; offset++) {
      if (offset >= count) break;
      vec2 sourcePixel = vec2(x + float(offset), y);
      sumA += sampleA(sourcePixel, size);
      sumB += sampleB(sourcePixel, size);
    }
    float divisor = float(ffMaxi(1, ffMini(count, 2048)));
    result = ffMix(sumA / divisor, sumB / divisor, P);
  } else if (mode == 36.0) {
    // FFmpeg fadegrays desaturates by keeping luma and setting chroma to mid
    // (YUV path, the common case since xfade inputs are yuv420p-derived).
    // In RGB that is BT.601 luma, not a plain channel average.
    vec4 grayA = vec4(A.r, 128.0/255.0, 128.0/255.0, 1.0);
    vec4 grayB = vec4(B.r, 128.0/255.0, 128.0/255.0, 1.0);
    result = ffMix(
      ffMix(A, grayA, ffSmooth(0.8, 1.0, P)),
      ffMix(grayB, B, ffSmooth(0.2, 1.0, P)),
      P
    );
  } else if (mode >= 37.0 && mode <= 40.0) {
    float widthEdge = mode == 37.0 || mode == 39.0 ? ffTrunc(W * P) : ffTrunc(W * (1.0 - P));
    float heightEdge = mode == 37.0 || mode == 38.0 ? ffTrunc(H * P) : ffTrunc(H * (1.0 - P));
    bool horizontal = mode == 37.0 || mode == 39.0 ? x <= widthEdge : x > widthEdge;
    bool vertical = mode == 37.0 || mode == 38.0 ? y <= heightEdge : y > heightEdge;
    result = horizontal && vertical ? A : B;
  } else if (mode == 41.0 || mode == 42.0) {
    bool horizontalSqueeze = mode == 41.0;
    float coordinate = horizontalSqueeze ? y / H : x / W;
    float mapped = P > 0.0 ? 0.5 + (coordinate - 0.5) / P : 2.0;
    if (mapped < 0.0 || mapped > 1.0) {
      result = B;
    } else {
      vec2 sourcePixel = horizontalSqueeze
        ? vec2(x, ffRound(mapped * (H - 1.0)))
        : vec2(ffRound(mapped * (W - 1.0)), y);
      result = sampleA(sourcePixel, size);
    }
  } else if (mode == 43.0) {
    float zoom = ffSmooth(0.5, 1.0, P);
    vec2 sourcePosition = vec2(0.5) + (pixel / size - 0.5) * zoom;
    vec2 sourcePixel = ceil(sourcePosition * (size - 1.0));
    result = ffMix(sampleA(sourcePixel, size), B, ffSmooth(0.0, 0.5, P));
  } else if (mode == 44.0 || mode == 45.0) {
    vec4 difference = abs(A - B);
    vec4 exponent = mode == 44.0
      ? vec4(1.0) + log(vec4(1.0) + difference)
      : vec4(1.0) + log(vec4(2.0) - difference);
    vec4 amount = pow(vec4(P), exponent);
    result = A * amount + B * (vec4(1.0) - amount);
  } else if (mode == 46.0) {
    // White sweep highlight, clamped: unclamped overflow wraps bright
    // pixels to black via wrapCustomByte (same uint8 wrap as FFmpeg).
    float whipHighlight = 42.0 / 255.0 * exp(-pow(x / W - Q, 2.0) / 0.0025) * sin(PI * Q);
    vec4 whipBase = x / W < Q ? B : A;
    result = vec4(min(vec3(1.0), whipBase.rgb + vec3(whipHighlight, 0.0, 0.0)), 1.0);
  } else if (mode == 47.0) {
    float whipHighlight = 42.0 / 255.0 * exp(-pow(x / W - (1.0 - Q), 2.0) / 0.0025) * sin(PI * Q);
    vec4 whipBase = x / W > 1.0 - Q ? B : A;
    result = vec4(min(vec3(1.0), whipBase.rgb + vec3(whipHighlight, 0.0, 0.0)), 1.0);
  } else if (mode == 48.0) {
    float whipHighlight = 42.0 / 255.0 * exp(-pow(y / H - Q, 2.0) / 0.0025) * sin(PI * Q);
    vec4 whipBase = y / H < Q ? B : A;
    result = vec4(min(vec3(1.0), whipBase.rgb + vec3(whipHighlight, 0.0, 0.0)), 1.0);
  } else if (mode == 49.0) {
    float whipHighlight = 42.0 / 255.0 * exp(-pow(y / H - (1.0 - Q), 2.0) / 0.0025) * sin(PI * Q);
    vec4 whipBase = y / H > 1.0 - Q ? B : A;
    result = vec4(min(vec3(1.0), whipBase.rgb + vec3(whipHighlight, 0.0, 0.0)), 1.0);
  } else if (mode == 50.0 || mode == 51.0) {
    vec2 center = vec2(W / 2.0, H / 2.0);
    float radius = length(pixel - center) / max(length(center), 0.00001);
    bool useB = mode == 50.0 ? radius < Q : radius > 1.0 - Q;
    float lift = (mode == 50.0 ? 24.0 : 20.0) / 255.0 * sin(PI * Q);
    vec4 zoomBase = useB ? B : mix(A, B, Q);
    result = vec4(min(vec3(1.0), zoomBase.rgb + vec3(lift, 0.0, 0.0)), 1.0);
  } else if (mode == 52.0 || mode == 53.0) {
    float angle = atan(y - H / 2.0, x - W / 2.0) / (2.0 * PI);
    float angular = mode == 52.0 ? mod(angle + Q + 1.0, 1.0) : mod(angle + 0.5, 1.0);
    result = angular < Q ? B : (mode == 52.0 ? mix(A, B, Q) : A);
  } else if (mode == 54.0) {
    vec2 center = vec2(W / 2.0, H / 2.0);
    float radius = length(pixel - center) / max(length(center), 0.00001);
    if (abs(radius - Q) < 0.12) {
      vec4 warpBase = mix(A, B, Q);
      result = vec4(min(vec3(1.0), warpBase.rgb + vec3(36.0 / 255.0 * sin(PI * Q), 0.0, 0.0)), 1.0);
    } else {
      result = radius < Q ? B : A;
    }
  } else if (mode == 55.0 || mode == 56.0) {
    float coordinate = mode == 55.0 ? x / W : y / H;
    result = abs(coordinate - 0.5) < Q / 2.0 ? B : mix(A, B, Q);
  } else if (mode == 57.0) {
    result = x / W + 0.045 * sin(y / H * 10.0 * PI + Q * 8.0 * PI) < Q ? B : A;
  } else if (mode == 58.0) {
    float wave = y / H + 0.035 * sin(x / W * 7.0 * PI + Q * 5.0 * PI)
      + 0.02 * sin(x / W * 17.0 * PI - Q * 9.0 * PI);
    result = wave < Q ? B : A;
  } else if (mode == 59.0) {
    float band = max(1.0, min(W, H) / 6.0);
    float field = mod(abs(x - W / 2.0) + abs(y - H / 2.0), band) / band;
    result = field < Q ? B : A;
  } else if (mode == 60.0) {
    vec3 amount = vec3(
      min(1.0, Q * 1.25),
      clamp(Q * 1.25 - 0.12, 0.0, 1.0),
      clamp(Q * 1.25 - 0.24, 0.0, 1.0)
    );
    result = vec4(mix(A.rgb, B.rgb, amount), 1.0);
  } else if (mode == 61.0) {
    bool band = mod(y + floor(Q * 18.0) * 37.0, 96.0) < 18.0 + 34.0 * sin(Q * PI);
    if (band) result = sin(x * 0.19 + y * 0.37 + Q * 91.0) > 0.0 ? B : A;
    else result = mix(A, B, Q);
  } else if (mode == 62.0) {
    // Bipolar scan modulation: clamp both sides, FFmpeg uses max(0,min(255,...)).
    vec4 trackBase = x / W + 0.04 * sin(y / 9.0 + Q * 32.0) < Q ? B : A;
    vec3 trackMod = vec3(10.0 / 255.0 * sin(y * PI / 2.0) * sin(PI * Q), 0.0, 0.0);
    result = vec4(clamp(trackBase.rgb + trackMod, vec3(0.0), vec3(1.0)), 1.0);
  } else if (mode == 63.0) {
    float field = mod(floor(x / 24.0) + floor(y / 18.0) * 3.0 + floor(Q * 20.0), 10.0) / 10.0;
    result = field < Q ? B : A * (0.82 - Q * 0.25) + B * (0.18 + Q * 0.25);
  } else if (mode == 64.0) {
    if (abs(Q - 0.5) < 0.18) {
      float staticValue = sin(x * 12.9898 + y * 78.233 + Q * 43758.5) > 0.0 ? 1.0 : 0.0;
      result = vec4((16.0 + 219.0 * staticValue)/255.0, 128.0/255.0, 128.0/255.0, 1.0);
    } else {
      result = Q < 0.5 ? A : B;
    }
  } else if (mode == 65.0) {
    float field = mod(y, 8.0) / 8.0 + floor(y / 8.0) / (H / 8.0);
    result = field < Q * 2.0 ? B : A;
  } else if (mode == 66.0) {
    vec4 field = vec4((x / W) * 0.35 + (y / H) * 0.35) + A * 0.3;
    result = selectLess(field, Q, B, A);
  } else if (mode == 67.0) {
    vec3 leak = vec3(52.37, -21.31, 21.31) / 255.0 * exp(-pow(Q - 0.5, 2.0) / 0.035);
    result = vec4(clamp(mix(A.rgb, B.rgb, Q) + leak, 0.0, 1.0), 1.0);
  } else if (mode == 68.0) {
    vec4 burnBase = x / W + 0.08 * sin(y / H * 13.0 + Q * 17.0) < Q ? B : A;
    vec3 burn = vec3(53.23, -26.76, 30.09) / 255.0 * exp(-pow(x / W - Q, 2.0) / 0.018);
    result = vec4(clamp(burnBase.rgb + burn, 0.0, 1.0), 1.0);
  } else if (mode == 69.0) {
    result = vec4(min(vec3(1.0), mix(A.rgb, B.rgb, Q) + vec3(210.0 / 255.0 * exp(-pow(Q - 0.5, 2.0) / 0.012), 0.0, 0.0)), 1.0);
  } else if (mode == 70.0) {
    result = selectLess(A, Q, B, A);
  } else if (mode == 71.0) {
    vec3 firstBranch = vec3(
      Q + 0.16 * sin(0.0 * 2.1),
      Q + 0.16 * sin(1.0 * 2.1),
      Q + 0.16 * sin(2.0 * 2.1)
    );
    vec3 mixed = mix(A.rgb, B.rgb, Q);
    vec3 matte = vec3(
      A.r < Q ? B.r : A.r,
      A.g < Q ? B.g : A.g,
      A.b < Q ? B.b : A.b
    );
    result = vec4(
      firstBranch.r < 0.5 ? mixed.r : matte.r,
      firstBranch.g < 0.5 ? mixed.g : matte.g,
      firstBranch.b < 0.5 ? mixed.b : matte.b,
      1.0
    );
  } else if (mode == 72.0) {
    float field = (sin(x * 0.041) + sin(y * 0.053) + sin((x + y) * 0.021) + 3.0) / 6.0;
    result = field < Q ? B : A;
  } else if (mode == 73.0) {
    // FFmpeg parity: diagonal wipe + luma-only white highlight, clamped to
    // 1.0. Adding without min() overflows bright pixels and wrapCustomByte
    // wraps them to black (jagged dark edge on white areas, Image 1).
    float field = x / W + y / H;
    result = field < Q * 2.0 ? B : A;
    float pageHighlight = 34.0 / 255.0 * exp(-pow(field - Q * 2.0, 2.0) / 0.012) * sin(PI * Q);
    result.rgb = min(vec3(1.0), result.rgb + vec3(pageHighlight, 0.0, 0.0));
  } else if (mode == 74.0) {
    float field = abs(mod(x / (W / 4.0), 2.0) - 1.0);
    result = field < Q ? B : A;
  } else if (mode == 75.0) {
    if (Q < 0.5) result = abs(y / H - 0.5) < (0.5 - Q) * 2.0 ? A : vec4(16.0/255.0, 128.0/255.0, 128.0/255.0, 1.0);
    else result = abs(y / H - 0.5) < (Q - 0.5) * 2.0 ? B : vec4(16.0/255.0, 128.0/255.0, 128.0/255.0, 1.0);
  }

  result.rgb = custom ? wrapCustomByte(result.rgb) : quantizeByte(result.rgb);
  float outY = (result.r * 255.0 - 16.0) / 219.0;
  float outU = (result.g * 255.0 - 128.0) / 224.0;
  float outV = (result.b * 255.0 - 128.0) / 224.0;
  vec3 rgb = vec3(outY + 1.402 * outV, outY - 0.344136 * outU - 0.714136 * outV, outY + 1.772 * outU);
  finalColor = vec4(clamp(rgb, 0.0, 1.0), 1.0) * vColor;
}
