# FFmpeg Effects and Transitions

The editor exposes 84 video effects, 60 compound clip looks, all 46 named
`xfade` primitives available in FFmpeg 5.1.4, and 30 additional transitions
built with whitelisted `xfade=custom` expressions. FFmpeg 5.1.4 is the version
used by `@ffmpeg/core` 0.12.x. The catalog contains Resolve- and creator-style
approximations, not Blackmagic implementations.

## Runtime parity

- Preview effect blocks run live through PixiJS filters in
  `src/lib/effects-pixi.ts`.
- Preview transitions run through one two-input PixiJS shader. The shader reads
  input B and Pixi's `uBackTexture` for input A, then ports the formulas from
  FFmpeg 5.1.4 `libavfilter/vf_xfade.c`; it does not approximate transitions by
  stacking alpha masks.
- FFmpeg exposes xfade `P` in reverse (`1` at A, `0` at B). The editor keeps a
  forward timeline progress (`0` at A, `1` at B), and compiles standalone `P`
  tokens in catalog-owned custom expressions to `(1-P)` before generating the
  CLI filter. `PI` and `PLANE` are not rewritten. Project payloads cannot supply
  filter expressions.
- Local export resolves effect IDs through `src/lib/effects.ts` and runs the
  resulting chains in a fresh ffmpeg-wasm instance.
- `POST /render` receives ordered effect IDs and numeric parameter maps. The Go
  registry validates every ID, parameter name, type, and range before invoking
  native FFmpeg. Arbitrary client-provided filtergraphs are not accepted.
- Effects are composed in timeline insertion order. Transitions normalize both
  inputs to equal geometry, frame rate, pixel format, time base, and timestamps
  before `xfade`.
- Video and image clips share the same layer opacity, fade-in, and fade-out
  envelope. The envelope is applied after clip effects, then the completed
  layer is blended over lower video tracks in preview and both export paths.

## `xfade` CLI contract

The implementation follows the four FFmpeg 5.1.4 `xfade` options:

| Option | FFmpeg 5.1.4 behavior | Editor behavior |
| --- | --- | --- |
| `transition` | Named primitive, default `fade`; 46 built-ins in 5.1.4 | Whitelisted by ID in TypeScript and Go; unknown values fall back to `fade` |
| `duration` | Transition duration, default 1 second, valid range 0..60 seconds | Derived from the positive timeline overlap and emitted in seconds |
| `offset` | Start time relative to input A, default 0; may be negative | Derived as accumulated A duration minus overlap; isolated WASM transition jobs start at 0 |
| `expr` | Required for `transition=custom`; variables include `A`, `B`, `P`, `X`, `Y`, `W`, `H`, and `PLANE` | Selected only from the 30 catalog expressions and compiled to FFmpeg's reversed progress |

All named modes use the FFmpeg 5.1.4 enum order in the Pixi shader, including
the transitions that were previously approximated or omitted: `distance`,
`hblur`, `fadegrays`, `squeezeh`, `squeezev`, `zoomin`, `fadefast`, and
`fadeslow`. Spatial boundaries retain FFmpeg's integer truncation, strict
comparisons, one-sided horizontal blur, deterministic dissolve hash, and
forward/backward sample selection.

The WebGL preview executes the same transition formulas at preview resolution.
It is display-equivalent rather than guaranteed byte-identical: FFmpeg computes
on quantized planar YUV/GBR samples while browsers expose decoded RGBA textures,
and GPU floating-point/trigonometric rounding may differ by a least-significant
sample. Final export remains authoritative.

## Algorithms

Every entry in `src/lib/effects.ts` records its category, FFmpeg primitive, and
a short algorithm description. The catalog covers dissolves, wipes, blinds,
iris, custom motion, light, matte, digital, and panel transitions, plus blur,
color mapping, light and lens, analog damage, film simulation, restoration,
graphic stylization, temporal processing, transforms, and warps.

The inspector exposes validated parameters for more than 50 effects, including
separate luma/chroma controls for Blur and dedicated color, restoration,
temporal, and transform settings. Values are retained by timeline history and
copy/paste and are shared by preview, local export, and server export. Presets
whose FFmpeg primitive is intrinsically binary, such as Mirror or Invert, remain
parameterless. Keyframed parameters are not currently supported. Temporal
filters such as Deflicker, Noise Reduction, Motion Trails, and Stop Motion may
buffer frames and are more expensive in the single-threaded WASM renderer.

## Deliberate limitations

The following Resolve features cannot be represented honestly by a stock,
single-input FFmpeg 5.1 filter chain and are not labeled as equivalent:

- Smooth Cut and Speed Warp, which require optical flow or neural inference.
- Face Refinement, Depth Map, Relight, Sky Replacement, and object removal.
- Surface tracking, planar tracking, rotoscoping, masks, and interactive meshes.
- True film-stock grain, halation, physically based lens flare, and 3D Fusion FX.
- Resolve color-management parity for DCTL, ACES/OCIO, HDR, and proprietary
  OpenFX processing.

## References

- DaVinci Resolve 20 Reference Manual: https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_20_Reference_Manual.pdf
- Blackmagic Design Edit overview: https://www.blackmagicdesign.com/products/davinciresolve/edit
- FFmpeg 5.1 xfade documentation: https://ayosec.github.io/ffmpeg-filters-docs/5.1/Filters/Video/xfade.html
- FFmpeg 5.1.4 xfade source (pinned commit): https://github.com/FFmpeg/FFmpeg/blob/4729204c17f756e186d622060088371d10b34f7e/libavfilter/vf_xfade.c
- FFmpeg filter documentation: https://ffmpeg.org/ffmpeg-filters.html
- ffmpeg.wasm overview: https://ffmpegwasm.netlify.app/docs/overview

## Catalog integration check

`CATALOG_FFMPEG_INTEGRATION=1 npx playwright test e2e/ffmpeg-catalog.spec.ts`
runs every added effect and custom transition against the vendored WASM core.
