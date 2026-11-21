# Effect parity — measured report

2026-09-20T10:42:37.948Z

Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36

ffmpeg version 5.1.4 Copyright (c) 2000-2023 the FFmpeg developers

160x90, RGBA, 12 fps, 1s; moving square, gradients, checkerboard; transitions use static A/B; samples 0/.25/.5/.75s; WebGL resolution=1

RGB MAE 0–255; worst sampled frame. Partial = missing temporal/editor behavior, never parity certified. WASM filter-kernel comparison, not native export validation. PNGs and report.json are alongside this file.

| Effect | Variant | Status | Worst MAE | Notes |
|---|---|---|---:|---|
| baseline | baseline | measured | 0.00 |  |
| cross-dissolve | default | measured | 0.00 |  |
| film-dissolve-fast | default | measured | 0.00 |  |
| film-dissolve-slow | default | measured | 0.05 |  |
| fade-black | default | measured | 0.00 |  |
| fade-white | default | measured | 0.00 |  |
| fade-grayscale | default | measured | 35.33 |  |
| blur-dissolve | default | measured | 0.09 |  |
| noise-dissolve | default | measured | 32.93 |  |
| difference-dissolve | default | measured | 0.00 |  |
| mosaic-dissolve | default | measured | 0.00 |  |
| wipe-left | default | measured | 0.00 |  |
| wipe-right | default | measured | 0.00 |  |
| wipe-up | default | measured | 0.00 |  |
| wipe-down | default | measured | 0.00 |  |
| smooth-left | default | measured | 0.01 |  |
| smooth-right | default | measured | 0.01 |  |
| smooth-up | default | measured | 0.02 |  |
| smooth-down | default | measured | 0.03 |  |
| clock-wipe | default | measured | 0.00 |  |
| diagonal-tl | default | measured | 0.03 |  |
| diagonal-tr | default | measured | 0.02 |  |
| diagonal-bl | default | measured | 0.03 |  |
| diagonal-br | default | measured | 0.03 |  |
| corner-tl | default | measured | 0.00 |  |
| corner-tr | default | measured | 0.00 |  |
| corner-bl | default | measured | 0.00 |  |
| corner-br | default | measured | 0.00 |  |
| blinds-left | default | measured | 0.00 |  |
| blinds-right | default | measured | 0.00 |  |
| blinds-up | default | measured | 0.00 |  |
| blinds-down | default | measured | 0.00 |  |
| circle | default | measured | 0.01 |  |
| circle-close | default | measured | 0.01 |  |
| circle-crop | default | measured | 0.00 |  |
| rectangle-crop | default | measured | 0.00 |  |
| barn-vertical-open | default | measured | 0.02 |  |
| barn-vertical-close | default | measured | 0.02 |  |
| barn-horizontal-open | default | measured | 0.02 |  |
| barn-horizontal-close | default | measured | 0.01 |  |
| slide-left | default | measured | 0.06 |  |
| slide-right | default | measured | 0.00 |  |
| slide-up | default | measured | 0.75 |  |
| slide-down | default | measured | 0.00 |  |
| squeeze-horizontal | default | measured | 0.01 |  |
| squeeze-vertical | default | measured | 0.00 |  |
| zoom-in | default | measured | 0.00 |  |
| whip-pan-left | default | measured | 2.20 |  |
| whip-pan-right | default | measured | 2.20 |  |
| whip-pan-up | default | measured | 2.24 |  |
| whip-pan-down | default | measured | 2.24 |  |
| zoom-blur-in | default | measured | 14.49 |  |
| zoom-blur-out | default | measured | 11.82 |  |
| spin-zoom | default | measured | 0.00 |  |
| camera-roll | default | measured | 0.00 |  |
| lens-warp | default | measured | 7.78 |  |
| stretch-horizontal | default | measured | 0.00 |  |
| stretch-vertical | default | measured | 0.00 |  |
| ripple-warp | default | measured | 0.04 |  |
| liquid-wave | default | measured | 0.00 |  |
| kaleidoscope-reveal | default | measured | 0.00 |  |
| rgb-split-transition | default | measured | 12.70 |  |
| digital-glitch-transition | default | measured | 0.00 |  |
| vhs-tracking-transition | default | measured | 3.10 |  |
| datamosh-transition | default | measured | 0.11 |  |
| tv-static-transition | default | measured | 91.02 |  |
| scanline-reveal | default | measured | 0.00 |  |
| pixel-sort-reveal | default | measured | 0.00 |  |
| light-leak-transition | default | measured | 34.47 |  |
| film-burn-transition | default | measured | 9.09 |  |
| flash-bulb-transition | default | measured | 82.07 |  |
| luma-fade | default | measured | 0.00 |  |
| chroma-fade | default | measured | 33.17 |  |
| ink-bleed-reveal | default | measured | 0.01 |  |
| page-turn-2d | default | measured | 3.55 |  |
| split-panels | default | measured | 0.00 |  |
| shutter-snap | default | measured | 90.67 |  |
| blur | default | measured | 1.75 |  |
| blur | ramp | measured | 1.08 |  |
| gaussian-blur | default | measured | 12.09 |  |
| gaussian-blur | ramp | measured | 112.17 |  |
| directional-blur | default | measured | 4.45 |  |
| directional-blur | ramp | measured | 3.10 |  |
| mosaic-blur | default | measured | 4.71 |  |
| mosaic-blur | ramp | measured | 3.50 |  |
| soft-focus | default | measured | 5.00 |  |
| soft-focus | ramp | measured | 4.04 |  |
| grayscale | default | measured | 0.28 |  |
| grayscale | ramp | measured | 0.41 |  |
| brightness | default | measured | 1.67 |  |
| brightness | ramp | measured | 1.39 |  |
| contrast-pop | default | measured | 1.89 |  |
| contrast-pop | ramp | measured | 1.58 |  |
| color-boost | default | measured | 1.97 |  |
| color-boost | ramp | measured | 1.76 |  |
| hue-shift | default | measured | 0.48 |  |
| hue-shift | ramp | measured | 0.49 |  |
| warm-grade | default | measured | 0.00 |  |
| warm-grade | ramp | measured | 0.12 |  |
| cool-grade | default | measured | 0.00 |  |
| cool-grade | ramp | measured | 0.12 |  |
| day-for-night | default | measured | 7.50 |  |
| day-for-night | ramp | measured | 6.12 |  |
| vintage | default | measured | 1.28 |  |
| vintage | ramp | measured | 1.43 |  |
| bleach-bypass | default | measured | 4.41 |  |
| bleach-bypass | ramp | measured | 3.65 |  |
| sepia | default | measured | 0.30 |  |
| sepia | ramp | measured | 0.84 |  |
| negate | default | measured | 0.00 |  |
| negate | ramp | measured | 1.00 |  |
| sepia-dream | default | measured | 2.02 |  |
| sepia-dream | ramp | measured | 2.89 |  |
| negative-strobe | default | measured | 146.57 |  |
| negative-strobe | ramp | measured | 73.19 |  |
| flash-hit | default | measured | 9.05 |  |
| flash-hit | ramp | measured | 6.60 |  |
| rgb-punch | default | measured | 31.52 |  |
| rgb-punch | ramp | measured | 23.23 |  |
| analog-flicker | default | measured | 1.55 |  |
| analog-flicker | ramp | measured | 1.31 |  |
| film-grain | default | measured | 3.18 |  |
| film-grain | ramp | measured | 2.26 |  |
| analog-damage | default | measured | 14.51 |  |
| analog-damage | ramp | measured | 9.45 |  |
| scanlines | default | measured | 0.20 |  |
| scanlines | ramp | measured | 0.26 |  |
| block-damage | default | measured | 2.63 |  |
| block-damage | ramp | measured | 2.27 |  |
| vignette | default | measured | 0.56 |  |
| vignette | ramp | measured | 0.49 |  |
| global-beauty | default | measured | 4.17 |  |
| global-beauty | ramp | measured | 3.07 |  |
| deband | default | measured | 4.64 |  |
| deband | ramp | measured | 3.44 |  |
| deflicker | default | partial | 1.09 | deflicker needs frame history; preview passthrough |
| deflicker | ramp | partial | 1.09 | deflicker needs frame history; preview passthrough |
| denoise | default | measured | 10.76 |  |
| denoise | ramp | measured | 8.28 |  |
| dust-reduction | default | error | — |  |
| dust-reduction | ramp | error | — |  |
| chromatic-correction | default | measured | 7.18 |  |
| chromatic-correction | ramp | measured | 5.12 |  |
| deinterlace | default | partial | 0.08 | deinterlace bob passthrough for progressive preview |
| deinterlace | ramp | partial | 0.05 | deinterlace bob passthrough for progressive preview |
| sharpen | default | measured | 2.30 |  |
| sharpen | ramp | measured | 1.67 |  |
| sharpen-edges | default | measured | 1.07 |  |
| sharpen-edges | ramp | measured | 0.90 |  |
| soften | default | measured | 6.55 |  |
| soften | ramp | measured | 4.79 |  |
| edge-detect | default | measured | 6.54 |  |
| edge-detect | ramp | measured | 5.14 |  |
| emboss | default | measured | 102.34 |  |
| emboss | ramp | measured | 82.67 |  |
| pencil-sketch | default | measured | 64.23 |  |
| pencil-sketch | ramp | measured | 61.40 |  |
| posterize | default | measured | 0.00 |  |
| posterize | ramp | measured | 0.55 |  |
| prism | default | measured | 10.08 |  |
| prism | ramp | measured | 7.21 |  |
| watercolor | default | measured | 14.14 |  |
| watercolor | ramp | measured | 10.41 |  |
| mirror | default | measured | 0.00 |  |
| mirror | ramp | measured | 52.84 |  |
| flip-v | default | measured | 0.00 |  |
| flip-v | ramp | measured | 56.65 |  |
| motion-trails | default | partial | 3.81 | temporal echo handled as ghost overlay in preview |
| motion-trails | ramp | partial | 2.60 | temporal echo handled as ghost overlay in preview |
| frame-echo | default | partial | 4.03 | temporal echo handled as ghost overlay in preview |
| frame-echo | ramp | partial | 2.53 | temporal echo handled as ghost overlay in preview |
| stop-motion | default | partial | 0.00 | stop-motion via frame-hold seek quantization |
| rotate | default | measured | 2.38 |  |
| rotate | ramp | measured | 14.22 |  |
| lens-distortion | default | measured | 7.46 |  |
| lens-distortion | ramp | measured | 8.81 |  |
| fisheye | default | measured | 26.36 |  |
| fisheye | ramp | measured | 23.37 |  |
| shear | default | measured | 22.20 |  |
| shear | ramp | measured | 20.38 |  |
| waviness | default | measured | 25.51 |  |
| waviness | ramp | measured | 16.82 |  |
| camera-shake | default | measured | 36.29 |  |
| camera-shake | ramp | error | — |  |
| glow-bloom | default | measured | 28.33 |  |
| glow-bloom | ramp | measured | 21.12 |  |
| halation | default | measured | 3.33 |  |
| halation | ramp | measured | 2.55 |  |
| lens-flare | default | measured | 0.11 |  |
| lens-flare | ramp | measured | 0.10 |  |
| light-rays | default | measured | 7.76 |  |
| light-rays | ramp | measured | 6.84 |  |
| radial-aberration | default | measured | 19.75 |  |
| radial-aberration | ramp | measured | 15.93 |  |
| vhs-tracking | default | measured | 32.22 |  |
| vhs-tracking | ramp | measured | 18.88 |  |
| vhs-head-noise | default | measured | 15.64 |  |
| vhs-head-noise | ramp | measured | 10.61 |  |
| datamosh | default | partial | 27.00 | temporal echo handled as ghost overlay in preview |
| datamosh | ramp | partial | 19.24 | temporal echo handled as ghost overlay in preview |
| glitch-bands | default | measured | 33.64 |  |
| glitch-bands | ramp | measured | 18.75 |  |
| bad-tv | default | measured | 27.76 |  |
| bad-tv | ramp | error | — |  |
| crt-curvature | default | measured | 13.51 |  |
| crt-curvature | ramp | measured | 12.60 |  |
| crt-phosphor | default | measured | 13.87 |  |
| crt-phosphor | ramp | measured | 10.85 |  |
| color-isolation | default | measured | 0.54 |  |
| color-isolation | ramp | measured | 0.76 |  |
| duotone | default | measured | 0.52 |  |
| duotone | ramp | measured | 5.45 |  |
| tritone | default | measured | 0.43 |  |
| tritone | ramp | measured | 3.53 |  |
| false-color | default | measured | 49.33 |  |
| false-color | ramp | measured | 37.10 |  |
| solarize | default | measured | 0.00 |  |
| solarize | ramp | measured | 0.40 |  |
| infrared | default | measured | 3.20 |  |
| infrared | ramp | measured | 3.66 |  |
| thermal | default | measured | 43.68 |  |
| thermal | ramp | measured | 22.18 |  |
| cross-process | default | measured | 15.98 |  |
| cross-process | ramp | measured | 11.30 |  |
| gate-weave | default | measured | 25.92 |  |
| gate-weave | ramp | error | — |  |
| dust-scratches | default | measured | 4.97 |  |
| dust-scratches | ramp | measured | 2.55 |  |
| film-flicker | default | measured | 4.10 |  |
| film-flicker | ramp | measured | 3.42 |  |
| old-projector | default | measured | 11.76 |  |
| old-projector | ramp | measured | 6.20 |  |
| comic-book | default | measured | 60.91 |  |
| comic-book | ramp | measured | 45.58 |  |
| oil-painting | default | measured | 14.79 |  |
| oil-painting | ramp | measured | 11.19 |  |
| neon-edges | default | measured | 26.31 |  |
| neon-edges | ramp | measured | 17.33 |  |
| kaleidoscope | default | measured | 3.30 |  |
| kaleidoscope | ramp | measured | 21.69 |  |
| tiny-planet | default | measured | 2.93 |  |
| tiny-planet | ramp | measured | 18.57 |  |
| tilt-shift | default | measured | 5.57 |  |
| tilt-shift | ramp | measured | 3.93 |  |
| glow-bloom + contrast-pop + vignette | stack | measured | 20.44 |  |
| comic-book + color-boost + sharpen-edges | stack | measured | 74.37 |  |
| thermal + glitch-bands + scanlines | stack | measured | 39.95 |  |
