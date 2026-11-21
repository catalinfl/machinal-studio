# Effect parity — measured report

2026-09-20T11:44:39.647Z

Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36

ffmpeg version 5.1.4 Copyright (c) 2000-2023 the FFmpeg developers

160x90, yuv420p, 12 fps, 1s; moving square, gradients, checkerboard; transitions use static A/B; samples 0/0.25/0.5/0.75s; Pixi uses the same decoded input; WebGL resolution=1

RGB MAE 0–255; worst sampled frame. Partial = missing temporal/editor behavior, never parity certified. WASM filter-kernel comparison, not native export validation. PNGs and report.json are alongside this file.

| Effect | Variant | Status | Worst MAE | Notes |
|---|---|---|---:|---|
| baseline | baseline | measured | 0.00 |  |
| cross-dissolve | default | measured | 6.51 |  |
| film-dissolve-fast | default | measured | 9.33 |  |
| film-dissolve-slow | default | measured | 9.22 |  |
| fade-black | default | measured | 11.93 |  |
| fade-white | default | measured | 13.81 |  |
| fade-grayscale | default | measured | 6.51 |  |
| blur-dissolve | default | measured | 6.51 |  |
| noise-dissolve | default | measured | 38.50 |  |
| difference-dissolve | default | measured | 30.22 |  |
| mosaic-dissolve | default | measured | 6.51 |  |
| wipe-left | default | measured | 6.51 |  |
| wipe-right | default | measured | 6.51 |  |
| wipe-up | default | measured | 6.51 |  |
| wipe-down | default | measured | 6.51 |  |
| smooth-left | default | measured | 6.51 |  |
| smooth-right | default | measured | 6.51 |  |
| smooth-up | default | measured | 6.51 |  |
| smooth-down | default | measured | 6.51 |  |
| clock-wipe | default | measured | 6.51 |  |
| diagonal-tl | default | measured | 6.51 |  |
| diagonal-tr | default | measured | 6.51 |  |
| diagonal-bl | default | measured | 6.51 |  |
| diagonal-br | default | measured | 6.51 |  |
| corner-tl | default | measured | 6.51 |  |
| corner-tr | default | measured | 6.51 |  |
| corner-bl | default | measured | 6.51 |  |
| corner-br | default | measured | 6.51 |  |
| blinds-left | default | measured | 6.51 |  |
| blinds-right | default | measured | 6.51 |  |
| blinds-up | default | measured | 6.51 |  |
| blinds-down | default | measured | 6.51 |  |
| circle | default | measured | 6.51 |  |
| circle-close | default | measured | 6.51 |  |
| circle-crop | default | measured | 6.51 |  |
| rectangle-crop | default | measured | 6.47 |  |
| barn-vertical-open | default | measured | 6.51 |  |
| barn-vertical-close | default | measured | 6.51 |  |
| barn-horizontal-open | default | measured | 6.51 |  |
| barn-horizontal-close | default | measured | 6.51 |  |
| slide-left | default | measured | 6.55 |  |
| slide-right | default | measured | 6.51 |  |
| slide-up | default | measured | 7.66 |  |
| slide-down | default | measured | 6.51 |  |
| squeeze-horizontal | default | measured | 7.80 |  |
| squeeze-vertical | default | measured | 6.78 |  |
| zoom-in | default | measured | 6.51 |  |
| whip-pan-left | default | measured | 6.67 |  |
| whip-pan-right | default | measured | 6.82 |  |
| whip-pan-up | default | measured | 6.82 |  |
| whip-pan-down | default | measured | 6.93 |  |
| zoom-blur-in | default | measured | 8.32 |  |
| zoom-blur-out | default | measured | 7.79 |  |
| spin-zoom | default | measured | 6.51 |  |
| camera-roll | default | measured | 6.51 |  |
| lens-warp | default | measured | 7.34 |  |
| stretch-horizontal | default | measured | 6.51 |  |
| stretch-vertical | default | measured | 6.51 |  |
| ripple-warp | default | measured | 6.55 |  |
| liquid-wave | default | measured | 6.51 |  |
| kaleidoscope-reveal | default | measured | 6.51 |  |
| rgb-split-transition | default | measured | 17.47 |  |
| digital-glitch-transition | default | measured | 6.50 |  |
| vhs-tracking-transition | default | measured | 6.51 |  |
| datamosh-transition | default | measured | 6.33 |  |
| tv-static-transition | default | measured | 6.51 |  |
| scanline-reveal | default | measured | 6.51 |  |
| pixel-sort-reveal | default | measured | 13.15 |  |
| light-leak-transition | default | measured | 6.41 |  |
| film-burn-transition | default | measured | 6.28 |  |
| flash-bulb-transition | default | measured | 8.89 |  |
| luma-fade | default | measured | 35.26 |  |
| chroma-fade | default | measured | 39.91 |  |
| ink-bleed-reveal | default | measured | 6.51 |  |
| page-turn-2d | default | measured | 6.83 |  |
| split-panels | default | measured | 6.51 |  |
| shutter-snap | default | measured | 6.51 |  |
| blur | default | measured | 1.16 |  |
| blur | ramp | measured | 6.49 |  |
| gaussian-blur | default | measured | 12.79 |  |
| gaussian-blur | ramp | measured | 92.27 |  |
| directional-blur | default | measured | 9.86 |  |
| directional-blur | ramp | measured | 6.49 |  |
| mosaic-blur | default | measured | 4.63 |  |
| mosaic-blur | ramp | measured | 6.49 |  |
| soft-focus | default | measured | 5.70 |  |
| soft-focus | ramp | measured | 6.49 |  |
| grayscale | default | measured | 0.48 |  |
| grayscale | ramp | measured | 6.49 |  |
| brightness | default | measured | 1.65 |  |
| brightness | ramp | measured | 6.49 |  |
| contrast-pop | default | measured | 2.00 |  |
| contrast-pop | ramp | measured | 6.49 |  |
| color-boost | default | measured | 1.92 |  |
| color-boost | ramp | measured | 6.49 |  |
| hue-shift | default | measured | 0.58 |  |
| hue-shift | ramp | measured | 6.49 |  |
| warm-grade | default | measured | 0.01 |  |
| warm-grade | ramp | measured | 6.49 |  |
| cool-grade | default | measured | 0.00 |  |
| cool-grade | ramp | measured | 6.49 |  |
| day-for-night | default | measured | 7.49 |  |
| day-for-night | ramp | measured | 7.54 |  |
| vintage | default | measured | 1.37 |  |
| vintage | ramp | measured | 6.49 |  |
| bleach-bypass | default | measured | 4.15 |  |
| bleach-bypass | ramp | measured | 6.49 |  |
| sepia | default | measured | 0.31 |  |
| sepia | ramp | measured | 6.49 |  |
| negate | default | measured | 1.46 |  |
| negate | ramp | measured | 6.49 |  |
| sepia-dream | default | measured | 2.03 |  |
| sepia-dream | ramp | measured | 6.49 |  |
| negative-strobe | default | measured | 144.31 |  |
| negative-strobe | ramp | measured | 72.43 |  |
| flash-hit | default | measured | 8.99 |  |
| flash-hit | ramp | measured | 9.16 |  |
| rgb-punch | default | measured | 31.69 |  |
| rgb-punch | ramp | measured | 22.91 |  |
| analog-flicker | default | measured | 1.64 |  |
| analog-flicker | ramp | measured | 6.49 |  |
| film-grain | default | measured | 5.78 |  |
| film-grain | ramp | measured | 8.00 |  |
| analog-damage | default | measured | 17.02 |  |
| analog-damage | ramp | measured | 8.42 |  |
| scanlines | default | measured | 10.95 |  |
| scanlines | ramp | measured | 11.32 |  |
| block-damage | default | measured | 3.84 |  |
| block-damage | ramp | measured | 6.49 |  |
| vignette | default | measured | 5.97 |  |
| vignette | ramp | measured | 6.87 |  |
| global-beauty | default | measured | 4.82 |  |
| global-beauty | ramp | measured | 6.49 |  |
| deband | default | measured | 3.39 |  |
| deband | ramp | measured | 6.49 |  |
| deflicker | default | partial | 1.17 | deflicker needs frame history; preview passthrough |
| deflicker | ramp | partial | 6.49 | deflicker needs frame history; preview passthrough |
| denoise | default | measured | 10.23 |  |
| denoise | ramp | measured | 6.49 |  |
| dust-reduction | default | error | — |  |
| dust-reduction | ramp | error | — |  |
| chromatic-correction | default | measured | 20.53 |  |
| chromatic-correction | ramp | measured | 15.32 |  |
| deinterlace | default | partial | 0.26 | deinterlace bob passthrough for progressive preview |
| deinterlace | ramp | partial | 6.49 | deinterlace bob passthrough for progressive preview |
| sharpen | default | measured | 2.22 |  |
| sharpen | ramp | measured | 7.31 |  |
| sharpen-edges | default | measured | 2.07 |  |
| sharpen-edges | ramp | measured | 6.60 |  |
| soften | default | measured | 5.44 |  |
| soften | ramp | measured | 6.49 |  |
| edge-detect | default | measured | 10.83 |  |
| edge-detect | ramp | measured | 9.07 |  |
| emboss | default | measured | 101.55 |  |
| emboss | ramp | measured | 81.79 |  |
| pencil-sketch | default | measured | 64.52 |  |
| pencil-sketch | ramp | measured | 61.04 |  |
| posterize | default | measured | 0.00 |  |
| posterize | ramp | measured | 6.49 |  |
| prism | default | measured | 10.18 |  |
| prism | ramp | measured | 7.71 |  |
| watercolor | default | measured | 14.31 |  |
| watercolor | ramp | measured | 7.58 |  |
| mirror | default | measured | 0.00 |  |
| mirror | ramp | measured | 50.40 |  |
| flip-v | default | measured | 0.00 |  |
| flip-v | ramp | measured | 54.97 |  |
| motion-trails | default | partial | 3.87 | temporal echo handled as ghost overlay in preview |
| motion-trails | ramp | partial | 8.60 | temporal echo handled as ghost overlay in preview |
| frame-echo | default | partial | 4.09 | temporal echo handled as ghost overlay in preview |
| frame-echo | ramp | partial | 8.60 | temporal echo handled as ghost overlay in preview |
| stop-motion | default | partial | 0.00 | stop-motion via frame-hold seek quantization |
| rotate | default | measured | 8.34 |  |
| rotate | ramp | measured | 13.97 |  |
| lens-distortion | default | measured | 11.84 |  |
| lens-distortion | ramp | measured | 10.63 |  |
| fisheye | default | measured | 29.95 |  |
| fisheye | ramp | measured | 24.72 |  |
| shear | default | measured | 22.01 |  |
| shear | ramp | measured | 20.28 |  |
| waviness | default | measured | 19.54 |  |
| waviness | ramp | measured | 20.83 |  |
| camera-shake | default | measured | 35.16 |  |
| camera-shake | ramp | error | — |  |
| glow-bloom | default | measured | 29.65 |  |
| glow-bloom | ramp | measured | 24.05 |  |
| halation | default | measured | 20.47 |  |
| halation | ramp | measured | 17.71 |  |
| lens-flare | default | measured | 6.59 |  |
| lens-flare | ramp | measured | 6.49 |  |
| light-rays | default | measured | 7.52 |  |
| light-rays | ramp | measured | 6.50 |  |
| radial-aberration | default | measured | 18.96 |  |
| radial-aberration | ramp | measured | 15.41 |  |
| vhs-tracking | default | measured | 24.81 |  |
| vhs-tracking | ramp | measured | 24.53 |  |
| vhs-head-noise | default | measured | 14.50 |  |
| vhs-head-noise | ramp | measured | 12.64 |  |
| datamosh | default | partial | 25.64 | temporal echo handled as ghost overlay in preview |
| datamosh | ramp | partial | 19.01 | temporal echo handled as ghost overlay in preview |
| glitch-bands | default | measured | 30.92 |  |
| glitch-bands | ramp | measured | 18.98 |  |
| bad-tv | default | measured | 27.21 |  |
| bad-tv | ramp | error | — |  |
| crt-curvature | default | measured | 15.92 |  |
| crt-curvature | ramp | measured | 13.97 |  |
| crt-phosphor | default | measured | 13.14 |  |
| crt-phosphor | ramp | measured | 10.45 |  |
| color-isolation | default | measured | 0.54 |  |
| color-isolation | ramp | measured | 6.49 |  |
| duotone | default | measured | 0.43 |  |
| duotone | ramp | measured | 6.77 |  |
| tritone | default | measured | 0.69 |  |
| tritone | ramp | measured | 6.49 |  |
| false-color | default | measured | 15.22 |  |
| false-color | ramp | measured | 11.70 |  |
| solarize | default | measured | 0.00 |  |
| solarize | ramp | measured | 6.49 |  |
| infrared | default | measured | 3.06 |  |
| infrared | ramp | measured | 6.49 |  |
| thermal | default | measured | 43.29 |  |
| thermal | ramp | measured | 22.85 |  |
| cross-process | default | measured | 16.40 |  |
| cross-process | ramp | measured | 15.15 |  |
| gate-weave | default | measured | 22.25 |  |
| gate-weave | ramp | error | — |  |
| dust-scratches | default | measured | 5.44 |  |
| dust-scratches | ramp | measured | 7.88 |  |
| film-flicker | default | measured | 4.07 |  |
| film-flicker | ramp | measured | 6.64 |  |
| old-projector | default | measured | 11.78 |  |
| old-projector | ramp | measured | 6.49 |  |
| comic-book | default | measured | 60.31 |  |
| comic-book | ramp | measured | 45.97 |  |
| oil-painting | default | measured | 16.30 |  |
| oil-painting | ramp | measured | 8.61 |  |
| neon-edges | default | measured | 25.56 |  |
| neon-edges | ramp | measured | 17.65 |  |
| kaleidoscope | default | measured | 6.79 |  |
| kaleidoscope | ramp | measured | 20.88 |  |
| tiny-planet | default | measured | 4.52 |  |
| tiny-planet | ramp | measured | 17.55 |  |
| tilt-shift | default | measured | 8.74 |  |
| tilt-shift | ramp | measured | 7.05 |  |
| glow-bloom + contrast-pop + vignette | stack | measured | 20.30 |  |
| comic-book + color-boost + sharpen-edges | stack | measured | 73.80 |  |
| thermal + glitch-bands + scanlines | stack | measured | 39.55 |  |
