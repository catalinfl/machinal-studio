// Resolve-inspired presets implemented only with filters available in
// FFmpeg 5.1.4, the version bundled by @ffmpeg/core 0.12.x. The same effect
// IDs are resolved independently by the native /render route.

import { CATALOG_EFFECTS, CATALOG_TRANSITIONS } from './edit-catalog'

export type EffectKind = 'effect' | 'transition'

export type EffectParams = Record<string, number>

export type RampCurve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
export type RampMode = 'in' | 'out' | 'in-out'

// User-facing intensity-ramp settings stored on an effect block: the effect
// fades from 0 to full strength (in), back to 0 (out), or up then down with a
// peak in the middle (in-out), following the chosen curve.
export interface EffectRamp {
  mode: RampMode
  curve: RampCurve
  // Fraction of the block duration covered by each ramp side (0.05..1, capped
  // at 0.5 for in-out so the two sides never overlap).
  amount: number
}

// Render-time ramp: the block's settings plus where this rendered segment
// sits inside the block, so overlapping segments keep a continuous envelope.
export interface RampTiming extends EffectRamp {
  blockDuration: number // timeline seconds spanned by the whole block
  offset: number // block-relative time at this segment's t=0 (can be negative)
}

export interface EffectInstance {
  id: string
  params: EffectParams
  ramp?: RampTiming | null
}

export interface EffectParameterDef {
  key: string
  label: string
  description: string
  defaultValue: number
  min: number
  max: number
  step: number
  unit?: string
  integer?: boolean
}

export interface EffectDef {
  id: string
  label: string
  kind: EffectKind
  category: string
  summary: string
  algorithm: string
  parameters?: EffectParameterDef[]
  // Effects only: an ffmpeg -vf fragment for a segment of `dur` seconds.
  build?: (dur: number, params: Readonly<EffectParams>, tag: string) => string
  // Transitions only: an FFmpeg 5.1 xfade preset.
  xfade?: string
  // Custom xfade expression selected by a whitelisted transition token.
  xfadeExpr?: string
  // Effects that change the frame cadence cannot be intensity-ramped: the
  // blend against the original stream would desync.
  noRamp?: boolean
  // Short accent effects should land on the timeline at their useful length.
  defaultDuration?: number
}

export function groupEffectsByCategory(
  effects: readonly EffectDef[],
): Array<{ category: string; items: EffectDef[] }> {
  return [...new Set(effects.map((effect) => effect.category))].map((category) => ({
    category,
    items: effects.filter((effect) => effect.category === category),
  }))
}

const transition = (
  id: string,
  label: string,
  category: string,
  xfade: string,
  algorithm: string,
): EffectDef => ({ id, label, kind: 'transition', category, summary: algorithm, xfade, algorithm })

const customTransition = (
  id: string,
  label: string,
  category: string,
  xfade: string,
  xfadeExpr: string,
  algorithm: string,
): EffectDef => ({ id, label, kind: 'transition', category, summary: algorithm, xfade, xfadeExpr, algorithm })

const EFFECT_SUMMARIES: Record<string, string> = {
  'blur': 'Softens detail with an even, adjustable blur.',
  'gaussian-blur': 'Softens edges with a smooth, natural-looking blur.',
  'directional-blur': 'Streaks detail along a chosen angle.',
  'mosaic-blur': 'Turns the image into adjustable square color blocks.',
  'soft-focus': 'Softens fine detail while gently lifting light and color.',
  'grayscale': 'Removes all color and keeps the original brightness range.',
  'brightness': 'Makes the whole image brighter and slightly more colorful.',
  'contrast-pop': 'Adds punch to darks, highlights, color, and midtones.',
  'color-boost': 'Makes colors stronger with a small contrast increase.',
  'hue-shift': 'Rotates every color around the color wheel.',
  'warm-grade': 'Adds red warmth and reduces blue in darker tones.',
  'cool-grade': 'Adds blue to shadows and midtones for a cooler image.',
  'day-for-night': 'Darkens and cools daytime footage to suggest moonlight.',
  'vintage': 'Fades color and contrast with a warm vintage curve.',
  'bleach-bypass': 'Creates harsh contrast with strongly muted color.',
  'sepia': 'Recolors the image in warm brown sepia tones.',
  'negate': 'Inverts every color to create a photographic negative.',
  'sepia-dream': 'Combines warm sepia, soft detail, and darkened corners.',
  'negative-strobe': 'Flashes between normal and inverted colors over time.',
  'flash-hit': 'Adds a short bright, low-color exposure flash.',
  'rgb-punch': 'Splits red and blue edges during a short contrast hit.',
  'analog-flicker': 'Adds gentle brightness flicker and fine moving grain.',
  'film-grain': 'Adds an animated layer of fine image noise.',
  'analog-damage': 'Adds faded color, grain, color drift, and dark corners.',
  'scanlines': 'Overlays evenly spaced horizontal dark lines.',
  'block-damage': 'Breaks the image into noisy digital-looking blocks.',
  'vignette': 'Darkens the image gradually toward all four edges.',
  'global-beauty': 'Smooths the whole frame, then restores a little detail.',
  'deband': 'Smooths visible steps in skies, gradients, and flat color.',
  'deflicker': 'Reduces rapid brightness changes between nearby frames.',
  'denoise': 'Reduces image noise across each frame and over time.',
  'dust-reduction': 'Softens isolated bright or dark specks across the frame.',
  'chromatic-correction': 'Moves red and blue color fringes in opposite directions.',
  'deinterlace': 'Rebuilds full frames from interlaced video fields.',
  'sharpen': 'Strengthens fine light and color detail across the image.',
  'sharpen-edges': 'Adds crispness mainly around visible edges.',
  'soften': 'Gently reduces fine detail across the whole image.',
  'edge-detect': 'Highlights strong outlines while retaining source color.',
  'emboss': 'Turns light and dark edges into raised grayscale relief.',
  'pencil-sketch': 'Converts the image into dark lines on a white field.',
  'posterize': 'Reduces smooth color into a chosen number of flat steps.',
  'prism': 'Pulls red and blue edges apart horizontally.',
  'watercolor': 'Flattens nearby colors while keeping major edges visible.',
  'mirror': 'Flips the image from left to right.',
  'flip-v': 'Turns the image upside down.',
  'motion-trails': 'Blends nearby frames into soft trails behind movement.',
  'frame-echo': 'Adds one delayed, semi-transparent copy of the frame.',
  'stop-motion': 'Drops frames to create a choppy stop-motion cadence.',
  'rotate': 'Rotates the full frame and fills exposed corners with black.',
  'lens-distortion': 'Bends straight lines inward or outward from a chosen center.',
  'fisheye': 'Bulges the frame outward around a chosen center.',
  'shear': 'Slants the frame horizontally or vertically.',
  'waviness': 'Bends horizontal image positions into a repeating wave.',
  'camera-shake': 'Moves the frame with a fast, repeating handheld shake.',
  'glow-bloom': 'Spreads bright detail into a soft luminous glow.',
  'halation': 'Adds a soft red glow around bright details.',
  'lens-flare': 'Adds a fixed warm glow near the upper-right of the frame.',
  'light-rays': 'Stretches bright edges into directional light streaks.',
  'radial-aberration': 'Splits red and blue edges more strongly near the frame border.',
  'vhs-tracking': 'Adds moving horizontal tape distortion and noise.',
  'vhs-head-noise': 'Damages the lower frame with unstable tape-like noise.',
  'datamosh': 'Smears movement and adds chunky digital blocks.',
  'glitch-bands': 'Shifts narrow horizontal bands and splits their colors.',
  'bad-tv': 'Adds frame wobble, noise, scanlines, and drifting color.',
  'crt-curvature': 'Bends the image like a rounded tube screen and darkens edges.',
  'crt-phosphor': 'Overlays a dense RGB mask and horizontal scanlines.',
  'color-isolation': 'Keeps one chosen color while muting colors farther from it.',
  'duotone': 'Maps all brightness into deep navy and warm amber.',
  'tritone': 'Maps shadows, midtones, and highlights into three color ranges.',
  'false-color': 'Replaces brightness with a vivid diagnostic color scale.',
  'solarize': 'Inverts only color values above a chosen brightness.',
  'infrared': 'Maps foliage bright and pushes skies toward deep cool tones.',
  'thermal': 'Maps brightness from dark purple through red to yellow.',
  'cross-process': 'Adds opposing color curves and stronger contrast.',
  'gate-weave': 'Drifts the frame slightly left, right, up, and down.',
  'dust-scratches': 'Adds moving dust noise and fine vertical scratches.',
  'film-flicker': 'Varies exposure irregularly like an unstable projector.',
  'old-projector': 'Combines faded color, flicker, dust, scratches, and dark edges.',
  'comic-book': 'Builds flat color steps with strong dark outlines.',
  'oil-painting': 'Flattens color regions and removes small surface detail.',
  'neon-edges': 'Turns colored outlines into a soft neon-like glow.',
  'kaleidoscope': 'Repeats a mirrored center section across the whole frame.',
  'tiny-planet': 'Wraps equirectangular footage into a circular planet view.',
  'tilt-shift': 'Keeps a horizontal strip sharp and blurs above and below it.',
}

const effect = (
  id: string,
  label: string,
  category: string,
  filter: string | ((params: Readonly<EffectParams>, dur: number, tag: string) => string),
  algorithm: string,
  parameters: EffectParameterDef[] = [],
  noRamp = false,
  defaultDuration = 2,
): EffectDef => ({
  id,
  label,
  kind: 'effect',
  category,
  summary: EFFECT_SUMMARIES[id] ?? algorithm,
  build: (dur, params, tag) => typeof filter === 'string' ? filter : filter(params, dur, tag),
  algorithm,
  parameters,
  noRamp,
  defaultDuration,
})

const parameter = (
  key: string,
  label: string,
  description: string,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
  unit?: string,
  integer = false,
): EffectParameterDef => ({ key, label, description, defaultValue, min, max, step, unit, integer })

function fmt(value: number): string {
  return String(Number(value.toFixed(6)))
}

const effectImplementations: EffectDef[] = [
  // Dissolves
  transition('cross-dissolve', 'Cross Dissolve', 'Dissolves', 'fade', 'Linear interpolation between corresponding pixels.'),
  transition('film-dissolve-fast', 'Film Dissolve Fast', 'Dissolves', 'fadefast', 'Difference-weighted nonlinear crossfade with a fast response.'),
  transition('film-dissolve-slow', 'Film Dissolve Slow', 'Dissolves', 'fadeslow', 'Difference-weighted nonlinear crossfade with a slow response.'),
  transition('fade-black', 'Fade Through Black', 'Dissolves', 'fadeblack', 'Blends the outgoing frame to black, then black to the incoming frame.'),
  transition('fade-white', 'Fade Through White', 'Dissolves', 'fadewhite', 'Blends the outgoing frame to white, then white to the incoming frame.'),
  transition('fade-grayscale', 'Monochrome Dissolve', 'Dissolves', 'fadegrays', 'Desaturates around the midpoint while crossfading the two frames.'),
  transition('blur-dissolve', 'Blur Dissolve', 'Dissolves', 'hblur', 'Increases horizontal blur toward the midpoint, then decreases it.'),
  transition('noise-dissolve', 'Noise Dissolve', 'Dissolves', 'dissolve', 'A deterministic spatial noise threshold replaces pixels progressively.'),
  transition('difference-dissolve', 'Difference Dissolve', 'Dissolves', 'distance', 'Reveals pixels using component distance between the two frames.'),
  transition('mosaic-dissolve', 'Mosaic Dissolve', 'Dissolves', 'pixelize', 'Pixel blocks grow toward the midpoint and shrink into the next frame.'),

  // Edge and clock wipes
  transition('wipe-left', 'Wipe Left', 'Edge Wipes', 'wipeleft', 'A hard vertical reveal boundary travels left.'),
  transition('wipe-right', 'Wipe Right', 'Edge Wipes', 'wiperight', 'A hard vertical reveal boundary travels right.'),
  transition('wipe-up', 'Wipe Up', 'Edge Wipes', 'wipeup', 'A hard horizontal reveal boundary travels upward.'),
  transition('wipe-down', 'Wipe Down', 'Edge Wipes', 'wipedown', 'A hard horizontal reveal boundary travels downward.'),
  transition('smooth-left', 'Feathered Wipe Left', 'Edge Wipes', 'smoothleft', 'A leftward reveal uses a smoothstep feather band.'),
  transition('smooth-right', 'Feathered Wipe Right', 'Edge Wipes', 'smoothright', 'A rightward reveal uses a smoothstep feather band.'),
  transition('smooth-up', 'Feathered Wipe Up', 'Edge Wipes', 'smoothup', 'An upward reveal uses a smoothstep feather band.'),
  transition('smooth-down', 'Feathered Wipe Down', 'Edge Wipes', 'smoothdown', 'A downward reveal uses a smoothstep feather band.'),
  transition('clock-wipe', 'Clock Wipe', 'Edge Wipes', 'radial', 'The angle around frame center drives a rotating reveal threshold.'),

  // Diagonal and corner wipes
  transition('diagonal-tl', 'Diagonal Wipe Top Left', 'Corner Wipes', 'diagtl', 'A smooth product field reveals from the top-left corner.'),
  transition('diagonal-tr', 'Diagonal Wipe Top Right', 'Corner Wipes', 'diagtr', 'A smooth product field reveals from the top-right corner.'),
  transition('diagonal-bl', 'Diagonal Wipe Bottom Left', 'Corner Wipes', 'diagbl', 'A smooth product field reveals from the bottom-left corner.'),
  transition('diagonal-br', 'Diagonal Wipe Bottom Right', 'Corner Wipes', 'diagbr', 'A smooth product field reveals from the bottom-right corner.'),
  transition('corner-tl', 'Box Wipe Top Left', 'Corner Wipes', 'wipetl', 'An axis-aligned rectangular reveal is anchored at top-left.'),
  transition('corner-tr', 'Box Wipe Top Right', 'Corner Wipes', 'wipetr', 'An axis-aligned rectangular reveal is anchored at top-right.'),
  transition('corner-bl', 'Box Wipe Bottom Left', 'Corner Wipes', 'wipebl', 'An axis-aligned rectangular reveal is anchored at bottom-left.'),
  transition('corner-br', 'Box Wipe Bottom Right', 'Corner Wipes', 'wipebr', 'An axis-aligned rectangular reveal is anchored at bottom-right.'),

  // Blinds and slices
  transition('blinds-left', 'Venetian Blinds Left', 'Blinds', 'hlslice', 'Ten vertical slices reveal progressively toward the left.'),
  transition('blinds-right', 'Venetian Blinds Right', 'Blinds', 'hrslice', 'Ten vertical slices reveal progressively toward the right.'),
  transition('blinds-up', 'Venetian Blinds Up', 'Blinds', 'vuslice', 'Ten horizontal slices reveal progressively upward.'),
  transition('blinds-down', 'Venetian Blinds Down', 'Blinds', 'vdslice', 'Ten horizontal slices reveal progressively downward.'),

  // Iris and barn door
  transition('circle', 'Circle Iris Open', 'Iris', 'circleopen', 'A feathered radial mask expands from frame center.'),
  transition('circle-close', 'Circle Iris Close', 'Iris', 'circleclose', 'A feathered radial mask contracts toward frame center.'),
  transition('circle-crop', 'Circle Through Black', 'Iris', 'circlecrop', 'A circular crop closes into black and opens onto the next frame.'),
  transition('rectangle-crop', 'Rectangle Through Black', 'Iris', 'rectcrop', 'A rectangular crop closes into black and opens onto the next frame.'),
  transition('barn-vertical-open', 'Barn Door Vertical Open', 'Iris', 'vertopen', 'A symmetric reveal opens from the vertical center seam.'),
  transition('barn-vertical-close', 'Barn Door Vertical Close', 'Iris', 'vertclose', 'A symmetric reveal closes toward the vertical center seam.'),
  transition('barn-horizontal-open', 'Barn Door Horizontal Open', 'Iris', 'horzopen', 'A symmetric reveal opens from the horizontal center seam.'),
  transition('barn-horizontal-close', 'Barn Door Horizontal Close', 'Iris', 'horzclose', 'A symmetric reveal closes toward the horizontal center seam.'),

  // Motion
  transition('slide-left', 'Push Left', 'Motion', 'slideleft', 'Both frames translate horizontally toward the left.'),
  transition('slide-right', 'Push Right', 'Motion', 'slideright', 'Both frames translate horizontally toward the right.'),
  transition('slide-up', 'Push Up', 'Motion', 'slideup', 'Both frames translate vertically upward.'),
  transition('slide-down', 'Push Down', 'Motion', 'slidedown', 'Both frames translate vertically downward.'),
  transition('squeeze-horizontal', 'Squeeze Horizontal', 'Motion', 'squeezeh', 'The outgoing image compresses toward a horizontal center line.'),
  transition('squeeze-vertical', 'Squeeze Vertical', 'Motion', 'squeezev', 'The outgoing image compresses toward a vertical center line.'),
  transition('zoom-in', 'Zoom In', 'Motion', 'zoomin', 'The outgoing frame center-scales with smooth easing into the next frame.'),

  // Custom expressions use only xfade's documented A/B/P/X/Y/W/H/PLANE
  // variables, so they remain portable to the bundled FFmpeg 5.1 WASM core.
  customTransition('whip-pan-left', 'Whip Pan Left', 'Custom Motion', 'custom-whip-left', "min(255,if(lt(X/W,P),B,A)+if(eq(PLANE,0),42*exp(-pow(X/W-P,2)/0.0025)*sin(PI*P),0))", 'Sweeps a bright, narrow directional band from left to right.'),
  customTransition('whip-pan-right', 'Whip Pan Right', 'Custom Motion', 'custom-whip-right', "min(255,if(gt(X/W,1-P),B,A)+if(eq(PLANE,0),42*exp(-pow(X/W-(1-P),2)/0.0025)*sin(PI*P),0))", 'Sweeps a bright, narrow directional band from right to left.'),
  customTransition('whip-pan-up', 'Whip Pan Up', 'Custom Motion', 'custom-whip-up', "min(255,if(lt(Y/H,P),B,A)+if(eq(PLANE,0),42*exp(-pow(Y/H-P,2)/0.0025)*sin(PI*P),0))", 'Sweeps a bright, narrow directional band upward through the cut.'),
  customTransition('whip-pan-down', 'Whip Pan Down', 'Custom Motion', 'custom-whip-down', "min(255,if(gt(Y/H,1-P),B,A)+if(eq(PLANE,0),42*exp(-pow(Y/H-(1-P),2)/0.0025)*sin(PI*P),0))", 'Sweeps a bright, narrow directional band downward through the cut.'),
  customTransition('zoom-blur-in', 'Zoom Blur In', 'Custom Motion', 'custom-zoom-blur-in', "min(255,if(lt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),P),B,(1-P)*A+P*B)+if(eq(PLANE,0),24*sin(PI*P),0))", 'Expands the incoming frame radially with a luminous blended perimeter.'),
  customTransition('zoom-blur-out', 'Zoom Blur Out', 'Custom Motion', 'custom-zoom-blur-out', "min(255,if(gt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),1-P),B,(1-P)*A+P*B)+if(eq(PLANE,0),20*sin(PI*P),0))", 'Introduces the incoming frame from the outer image radius toward center.'),
  customTransition('spin-zoom', 'Spin Zoom', 'Custom Motion', 'custom-spin-zoom', "if(lt(mod(atan2(Y-H/2,X-W/2)/(2*PI)+P+1,1),P),B,(1-P)*A+P*B)", 'Combines an angular reveal with a radial-feeling center blend.'),
  customTransition('camera-roll', 'Camera Roll', 'Custom Motion', 'custom-camera-roll', "if(lt(mod(atan2(Y-H/2,X-W/2)/(2*PI)+0.5,1),P),B,A)", 'Rotates an angular reveal around the optical center.'),
  customTransition('lens-warp', 'Lens Distortion Warp', 'Custom Warp', 'custom-lens-warp', "if(lt(abs(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2)-P),0.12),min(255,((1-P)*A+P*B)+if(eq(PLANE,0),36*sin(PI*P),0)),if(lt(hypot(X-W/2,Y-H/2)/hypot(W/2,H/2),P),B,A))", 'Uses an expanding bright distortion ring to exchange the frames.'),
  customTransition('stretch-horizontal', 'Stretch Warp Horizontal', 'Custom Warp', 'custom-stretch-h', "if(lt(abs(X/W-0.5),P/2),B,(1-P)*A+P*B)", 'Stretches the incoming image outward from a vertical center seam.'),
  customTransition('stretch-vertical', 'Stretch Warp Vertical', 'Custom Warp', 'custom-stretch-v', "if(lt(abs(Y/H-0.5),P/2),B,(1-P)*A+P*B)", 'Stretches the incoming image outward from a horizontal center seam.'),
  customTransition('ripple-warp', 'Ripple Warp', 'Custom Warp', 'custom-ripple', "if(lt(X/W+0.045*sin(Y/H*10*PI+P*8*PI),P),B,A)", 'Moves a sinusoidal reveal wave across the image.'),
  customTransition('liquid-wave', 'Liquid Wave', 'Custom Warp', 'custom-liquid', "if(lt(Y/H+0.035*sin(X/W*7*PI+P*5*PI)+0.02*sin(X/W*17*PI-P*9*PI),P),B,A)", 'Combines two moving wave bands into an organic liquid edge.'),
  customTransition('kaleidoscope-reveal', 'Kaleidoscope Reveal', 'Custom Warp', 'custom-kaleidoscope', "if(lt(mod(abs(X-W/2)+abs(Y-H/2),max(1,min(W,H)/6))/(max(1,min(W,H)/6)),P),B,A)", 'Reveals mirrored diamond bands from the frame center.'),
  customTransition('rgb-split-transition', 'RGB Split Transition', 'Digital', 'custom-rgb-split', "if(eq(PLANE,0),(1-min(1,P*1.25))*A+min(1,P*1.25)*B,if(eq(PLANE,1),(1-max(0,min(1,P*1.25-0.12)))*A+max(0,min(1,P*1.25-0.12))*B,(1-max(0,min(1,P*1.25-0.24)))*A+max(0,min(1,P*1.25-0.24))*B))", 'Offsets the red, green, and blue plane crossfades in time.'),
  customTransition('digital-glitch-transition', 'Digital Glitch Transition', 'Digital', 'custom-digital-glitch', "if(lt(mod(Y+floor(P*18)*37,96),18+34*sin(P*PI)),if(gt(sin(X*0.19+Y*0.37+P*91),0),B,A),(1-P)*A+P*B)", 'Switches unstable horizontal digital bands around a base crossfade.'),
  customTransition('vhs-tracking-transition', 'VHS Tracking Transition', 'Digital', 'custom-vhs-tracking', "max(0,min(255,if(lt(X/W+0.04*sin(Y/9+P*32),P),B,A)+if(eq(PLANE,0),10*sin(Y*PI/2)*sin(PI*P),0)))", 'Adds a wavy tracking boundary and scan-row luminance modulation.'),
  customTransition('datamosh-transition', 'Datamosh Transition', 'Digital', 'custom-datamosh', "if(lt(mod(floor(X/24)+floor(Y/18)*3+floor(P*20),10)/10,P),B,(0.82-P*0.25)*A+(0.18+P*0.25)*B)", 'Replaces macroblock-like cells while retaining a smeared frame blend.'),
  customTransition('tv-static-transition', 'TV Static Transition', 'Digital', 'custom-tv-static', "if(lt(abs(P-0.5),0.18),if(gt(sin(X*12.9898+Y*78.233+P*43758.5),0),if(eq(PLANE,0),235,128),if(eq(PLANE,0),16,128)),if(lt(P,0.5),A,B))", 'Passes through a short procedural black-and-white static burst.'),
  customTransition('scanline-reveal', 'Scanline Reveal', 'Digital', 'custom-scanline', "if(lt(mod(Y,8)/8+floor(Y/8)/(H/8),P*2),B,A)", 'Reveals the incoming frame progressively through ordered scan rows.'),
  customTransition('pixel-sort-reveal', 'Pixel Sort Reveal', 'Digital', 'custom-pixel-sort', "if(lt((X/W)*0.35+(Y/H)*0.35+A/255*0.3,P),B,A)", 'Uses position and source luminance to create an elongated sorted reveal.'),
  // xfade custom runs on yuv420p inputs (PLANE 0=Y,1=U,2=V), while the Pixi
  // preview adds leaks in RGB. The warm RGB leaks (95,52,18) and (110,48,8)
  // are therefore expressed here as BT.601 limited-range YUV offsets so the
  // export renders the same orange instead of a blue-shifted purple.
  customTransition('light-leak-transition', 'Light Leak Transition', 'Light', 'custom-light-leak', "max(0,min(255,(1-P)*A+P*B+if(eq(PLANE,0),52.37,if(eq(PLANE,1),-21.31,21.31))*exp(-pow(P-0.5,2)/0.035)))", 'Crossfades beneath a warm plane-biased exposure leak.'),
  customTransition('film-burn-transition', 'Film Burn Transition', 'Light', 'custom-film-burn', "max(0,min(255,if(lt(X/W+0.08*sin(Y/H*13+P*17),P),B,A)+if(eq(PLANE,0),53.23,if(eq(PLANE,1),-26.76,30.09))*exp(-pow(X/W-P,2)/0.018)))", 'Burns an irregular warm edge across the frame.'),
  customTransition('flash-bulb-transition', 'Flash Bulb Transition', 'Light', 'custom-flash-bulb', "min(255,(1-P)*A+P*B+if(eq(PLANE,0),210*exp(-pow(P-0.5,2)/0.012),0))", 'Hides the cut inside a compact white exposure flash.'),
  customTransition('luma-fade', 'Luma Fade', 'Matte', 'custom-luma-fade', "if(lt(A/255,P),B,A)", 'Uses outgoing pixel luminance as the progressive transition matte.'),
  customTransition('chroma-fade', 'Chroma Fade', 'Matte', 'custom-chroma-fade', "if(lt(P+0.16*sin(PLANE*2.1),0.5),(1-P)*A+P*B,if(lt(A/255,P),B,A))", 'Staggers component planes while using image values as a matte.'),
  customTransition('ink-bleed-reveal', 'Ink Bleed Reveal', 'Matte', 'custom-ink-bleed', "if(lt((sin(X*0.041)+sin(Y*0.053)+sin((X+Y)*0.021)+3)/6,P),B,A)", 'Builds an organic matte from overlapping low-frequency wave fields.'),
  customTransition('page-turn-2d', 'Page Turn 2D', 'Panels', 'custom-page-turn', "min(255,if(lt(X/W+Y/H,P*2),B,A)+if(eq(PLANE,0),34*exp(-pow(X/W+Y/H-P*2,2)/0.012)*sin(PI*P),0))", 'Folds a diagonal reveal edge with a moving highlight.'),
  customTransition('split-panels', 'Split Panels', 'Panels', 'custom-split-panels', "if(lt(abs(mod(X/(W/4),2)-1),P),B,A)", 'Alternating vertical panels open symmetrically onto the incoming frame.'),
  customTransition('shutter-snap', 'Shutter Snap', 'Panels', 'custom-shutter-snap', "if(lt(P,0.5),if(lt(abs(Y/H-0.5),(0.5-P)*2),A,if(eq(PLANE,0),16,128)),if(lt(abs(Y/H-0.5),(P-0.5)*2),B,if(eq(PLANE,0),16,128)))", 'Closes the image to black at center, then snaps open on the next frame.'),

  // Blur and focus
  effect('blur', 'Blur', 'Blur', (p) => `boxblur=luma_radius='min(${fmt(p.lumaRadius)},min(w,h)/2)':luma_power=${fmt(p.lumaPower)}:chroma_radius='min(${fmt(p.chromaRadius)},min(cw,ch)/2)':chroma_power=${fmt(p.chromaPower)}`, 'Separable box averaging of luma and chroma.', [
    parameter('lumaRadius', 'Luma radius', 'Blur radius applied to image detail.', 8, 0, 64, 1, 'px', true),
    parameter('lumaPower', 'Luma passes', 'Number of luma blur passes.', 1, 1, 6, 1, undefined, true),
    parameter('chromaRadius', 'Chroma radius', 'Blur radius applied to color channels.', 4, 0, 64, 1, 'px', true),
    parameter('chromaPower', 'Chroma passes', 'Number of chroma blur passes.', 1, 1, 6, 1, undefined, true),
  ]),
  effect('gaussian-blur', 'Gaussian Blur', 'Blur', (p) => `gblur=sigma=${fmt(p.sigma)}:steps=${fmt(p.steps)}`, 'Recursive Gaussian approximation passes.', [
    parameter('sigma', 'Sigma', 'Strength and radius of the Gaussian blur.', 6, 0.1, 50, 0.1, 'px'),
    parameter('steps', 'Quality steps', 'Approximation passes; higher values are slower.', 2, 1, 6, 1, undefined, true),
  ]),
  effect('directional-blur', 'Directional Blur', 'Blur', (p) => `dblur=angle=${fmt(p.angle)}:radius=${fmt(p.radius)}`, 'Samples and blends pixels along a configurable direction.', [
    parameter('angle', 'Angle', 'Direction of the blur.', 45, 0, 360, 1, 'deg'),
    parameter('radius', 'Radius', 'Distance sampled along the blur direction.', 8, 1, 64, 1, 'px', true),
  ]),
  effect('mosaic-blur', 'Mosaic Blur', 'Blur', (p) => `pixelize=width=${fmt(p.width)}:height=${fmt(p.height)}:mode=avg`, 'Replaces each block with its average color.', [
    parameter('width', 'Block width', 'Horizontal size of each mosaic block.', 16, 2, 128, 1, 'px', true),
    parameter('height', 'Block height', 'Vertical size of each mosaic block.', 16, 2, 128, 1, 'px', true),
  ]),
  effect('soft-focus', 'Soft Focus', 'Blur', (p) => `gblur=sigma=${fmt(p.sigma)},eq=brightness=${fmt(p.brightness)}:saturation=${fmt(p.saturation)}`, 'Gaussian diffusion followed by a luminance and color lift.', [
    parameter('sigma', 'Softness', 'Diffusion radius.', 1.2, 0.1, 10, 0.1, 'px'),
    parameter('brightness', 'Brightness', 'Luminance lift after diffusion.', 0.03, -1, 1, 0.01),
    parameter('saturation', 'Saturation', 'Color intensity after diffusion.', 1.05, 0, 3, 0.05, 'x'),
  ]),

  // Color
  effect('grayscale', 'Grayscale', 'Color', 'hue=s=0', 'Sets chroma saturation to zero while preserving luma.'),
  effect('brightness', 'Brighten', 'Color', (p) => `eq=brightness=${fmt(p.brightness)}:saturation=${fmt(p.saturation)}`, 'Raises the RGB-equivalent offset and saturation.', [
    parameter('brightness', 'Brightness', 'Global luminance offset.', 0.12, -1, 1, 0.01),
    parameter('saturation', 'Saturation', 'Global color intensity.', 1.25, 0, 3, 0.05, 'x'),
  ]),
  effect('contrast-pop', 'Contrast Pop', 'Color', (p) => `eq=contrast=${fmt(p.contrast)}:brightness=${fmt(p.brightness)}:saturation=${fmt(p.saturation)}:gamma=${fmt(p.gamma)}`, 'Applies a global contrast, offset, saturation, and gamma grade.', [
    parameter('contrast', 'Contrast', 'Difference between dark and bright values.', 1.18, 0.1, 3, 0.01, 'x'),
    parameter('brightness', 'Brightness', 'Global luminance offset.', -0.02, -1, 1, 0.01),
    parameter('saturation', 'Saturation', 'Global color intensity.', 1.08, 0, 3, 0.05, 'x'),
    parameter('gamma', 'Gamma', 'Midtone response.', 1.03, 0.1, 10, 0.01),
  ]),
  effect('color-boost', 'Color Boost', 'Color', (p) => `eq=saturation=${fmt(p.saturation)}:contrast=${fmt(p.contrast)}`, 'Expands chroma globally with a small contrast increase.', [
    parameter('saturation', 'Saturation', 'Global color intensity.', 1.45, 0, 3, 0.05, 'x'),
    parameter('contrast', 'Contrast', 'Difference between dark and bright values.', 1.05, 0.1, 3, 0.01, 'x'),
  ]),
  effect('hue-shift', 'Hue Shift', 'Color', (p) => `hue=h=${fmt(p.angle)}`, 'Rotates chroma hue by a configurable angle.', [
    parameter('angle', 'Hue angle', 'Rotation around the color wheel.', 30, -180, 180, 1, 'deg'),
  ]),
  effect('warm-grade', 'Warm Grade', 'Color', 'colorbalance=rs=0.10:gs=0.02:bs=-0.08:rm=0.08:gm=0.02:bm=-0.06', 'Adds red and removes blue mainly in shadows and midtones.'),
  effect('cool-grade', 'Cool Grade', 'Color', 'colorbalance=rs=-0.07:gs=0.01:bs=0.10:rm=-0.05:gm=0.01:bm=0.08', 'Adds blue and removes red mainly in shadows and midtones.'),
  effect('day-for-night', 'Day for Night', 'Color', 'colorbalance=bs=0.15:bm=0.12:bh=0.08:rs=-0.10,eq=brightness=-0.12:saturation=0.75', 'Darkens and cools the image to approximate moonlit exposure.'),
  effect('vintage', 'Vintage Film Curve', 'Color', 'curves=preset=vintage,eq=saturation=0.85', 'Uses FFmpeg\'s vintage RGB tone curve and mild desaturation.'),
  effect('bleach-bypass', 'Bleach Bypass', 'Color', 'eq=contrast=1.3:brightness=-0.03:saturation=0.35', 'Combines high contrast with strong global desaturation.'),
  effect('sepia', 'Sepia', 'Color', 'format=rgb24,colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131', 'Transforms RGB through the conventional sepia matrix.'),
  effect('negate', 'Invert Color', 'Color', 'negate', 'Complements every enabled color component.'),
  effect('sepia-dream', 'Sepia Dream', 'Clip Looks', 'gblur=sigma=0.65:steps=2,colorbalance=rs=0.08:gs=0.01:bs=-0.08:rm=0.06:gm=0.01:bm=-0.05,eq=contrast=0.96:brightness=-0.015:saturation=0.82,format=rgb24,colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131,vignette=angle=PI/4:x0=w/2:y0=h/2:mode=forward:eval=init:dither=1', 'Combines soft diffusion, warm sepia grading, and a centered vignette.'),
  effect('negative-strobe', 'Negative Strobe', 'Clip Looks', (p) => {
    return `negate=enable='lt(mod(t*${fmt(p.rate)}+0.0000001,1),${fmt(p.duty)})'`
  }, 'Alternates inverted and normal frames at a configurable pulse rate.', [
    parameter('rate', 'Pulse rate', 'Number of negative flashes per second.', 10, 2, 20, 0.5, 'Hz'),
    parameter('duty', 'Flash length', 'Fraction of each pulse spent inverted.', 0.4, 0.1, 0.8, 0.05, 'x'),
  ]),

  // Short-form accents
  effect('flash-hit', 'Flash Hit', 'Social Accents', (p) => `eq=brightness=${fmt(p.brightness)}:contrast=${fmt(p.contrast)}:saturation=${fmt(p.saturation)}`, 'Lifts exposure for a short, desaturated beat accent.', [
    parameter('brightness', 'Brightness', 'Exposure lift at the flash peak.', 0.38, 0.05, 0.8, 0.01),
    parameter('contrast', 'Contrast', 'Contrast retained through the flash.', 1.08, 0.6, 1.8, 0.01, 'x'),
    parameter('saturation', 'Saturation', 'Color retained through the flash.', 0.45, 0, 2, 0.05, 'x'),
  ], false, 0.18),
  effect('rgb-punch', 'RGB Split Hit', 'Social Accents', (p) => `format=rgb24,rgbashift=rh=${fmt(p.shift)}:bh=${fmt(-p.shift)}:edge=smear,eq=contrast=${fmt(p.contrast)}:saturation=${fmt(p.saturation)}`, 'Offsets red and blue channels with a compact contrast hit.', [
    parameter('shift', 'Channel split', 'Distance between the red and blue channels.', 7, 1, 40, 1, 'px', true),
    parameter('contrast', 'Contrast', 'Contrast added during the hit.', 1.16, 0.6, 2, 0.01, 'x'),
    parameter('saturation', 'Saturation', 'Color intensity during the hit.', 1.2, 0, 3, 0.05, 'x'),
  ], false, 0.16),
  effect('analog-flicker', 'Analog Flicker', 'Social Accents', (p) => `eq=brightness='${fmt(p.amount)}*sin(2*PI*${fmt(p.rate)}*t)':contrast=${fmt(p.contrast)}:eval=frame,noise=alls=${fmt(p.grain)}:allf=t+u:all_seed=29`, 'Modulates exposure gently and adds fine temporal grain.', [
    parameter('amount', 'Flicker amount', 'Maximum luminance variation.', 0.035, 0, 0.15, 0.005),
    parameter('rate', 'Flicker rate', 'Exposure oscillations per second.', 8, 1, 15, 0.5, 'Hz'),
    parameter('contrast', 'Contrast', 'Base contrast beneath the flicker.', 1.03, 0.8, 1.4, 0.01, 'x'),
    parameter('grain', 'Grain', 'Fine temporal noise added to the image.', 3, 0, 20, 1, '%', true),
  ]),

  // Film and texture
  effect('film-grain', 'Animated Grain', 'Film & Texture', (p) => `noise=alls=${fmt(p.strength)}:allf=t+u:all_seed=${fmt(p.seed)}`, 'Adds deterministic temporal uniform component noise.', [
    parameter('strength', 'Strength', 'Amount of grain added to every component.', 12, 0, 100, 1, '%', true),
    parameter('seed', 'Seed', 'Deterministic grain pattern seed.', 12345, 0, 65535, 1, undefined, true),
  ]),
  effect('analog-damage', 'Analog Damage', 'Film & Texture', 'eq=contrast=1.12:brightness=-0.03:saturation=0.72,noise=alls=10:allf=t+u:all_seed=7,format=rgb24,chromashift=cbh=2:cbv=1:crh=-2:crv=-1:edge=smear,vignette=angle=PI/4', 'Combines a faded grade, noise, chroma displacement, and vignette.'),
  effect('scanlines', 'Scanlines', 'Film & Texture', (p) => `drawgrid=width=iw:height=${fmt(p.spacing)}:thickness=${fmt(p.thickness)}:color=black@${fmt(p.opacity)}`, 'Draws translucent horizontal lines at a configurable interval.', [
    parameter('spacing', 'Spacing', 'Distance between horizontal lines.', 4, 2, 32, 1, 'px', true),
    parameter('thickness', 'Thickness', 'Width of each horizontal line.', 1, 1, 12, 1, 'px', true),
    parameter('opacity', 'Opacity', 'Darkness of the lines.', 0.35, 0, 1, 0.05),
  ]),
  effect('block-damage', 'Digital Block Damage', 'Film & Texture', (p) => `pixelize=width=${fmt(p.blockSize)}:height=${fmt(p.blockSize)}:mode=avg,noise=alls=${fmt(p.noise)}:allf=u:all_seed=11`, 'Combines block averaging with low-level static noise.', [
    parameter('blockSize', 'Block size', 'Size of damaged digital blocks.', 8, 2, 64, 1, 'px', true),
    parameter('noise', 'Noise', 'Static noise mixed into the blocks.', 4, 0, 100, 1, '%', true),
  ]),
  effect('vignette', 'Vignette', 'Film & Texture', 'vignette=angle=PI/4:x0=w/2:y0=h/2:mode=forward:eval=init:dither=1', 'Applies cosine-based radial attenuation around frame center.'),

  // Restoration and detail
  effect('global-beauty', 'Whole-Frame Smoothing', 'Restoration', (p) => `hqdn3d=luma_spatial=${fmt(p.spatial)}:chroma_spatial=${fmt(p.spatial * 0.75)}:luma_tmp=${fmt(p.temporal)}:chroma_tmp=${fmt(p.temporal * 0.75)},gblur=sigma=${fmt(p.softness)},unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${fmt(p.detail)}`, 'Smooths spatial and temporal noise before mild detail recovery.', [
    parameter('spatial', 'Spatial smoothing', 'Smoothing applied within each frame.', 2, 0.1, 20, 0.1),
    parameter('temporal', 'Temporal smoothing', 'Smoothing applied between frames.', 3, 0.1, 30, 0.1),
    parameter('softness', 'Skin softness', 'Fine Gaussian diffusion.', 0.35, 0, 3, 0.05, 'px'),
    parameter('detail', 'Detail recovery', 'Luma detail restored after smoothing.', 0.25, 0, 2, 0.05),
  ]),
  effect('deband', 'Smooth Color Bands', 'Restoration', (p) => `deband=1thr=${fmt(p.threshold)}:2thr=${fmt(p.threshold)}:3thr=${fmt(p.threshold)}:4thr=${fmt(p.threshold)}:range=${fmt(p.range)}:blur=1:coupling=1`, 'Replaces sufficiently similar neighboring samples to smooth bands.', [
    parameter('threshold', 'Threshold', 'Maximum difference treated as a color band.', 0.02, 0.001, 0.5, 0.001),
    parameter('range', 'Sample range', 'Radius used to find replacement samples.', 16, 1, 64, 1, 'px', true),
  ]),
  effect('deflicker', 'Deflicker', 'Restoration', 'deflicker=size=5:mode=am', 'Normalizes frame luminance against a five-frame arithmetic mean.'),
  effect('denoise', 'Noise Reduction', 'Restoration', (p) => `hqdn3d=luma_spatial=${fmt(p.lumaSpatial)}:chroma_spatial=${fmt(p.chromaSpatial)}:luma_tmp=${fmt(p.lumaTemporal)}:chroma_tmp=${fmt(p.chromaTemporal)}`, 'Applies spatial and temporal low-pass denoising.', [
    parameter('lumaSpatial', 'Luma spatial', 'Per-frame luminance smoothing.', 4, 0.1, 20, 0.1),
    parameter('chromaSpatial', 'Chroma spatial', 'Per-frame color smoothing.', 3, 0.1, 20, 0.1),
    parameter('lumaTemporal', 'Luma temporal', 'Between-frame luminance smoothing.', 6, 0.1, 30, 0.1),
    parameter('chromaTemporal', 'Chroma temporal', 'Between-frame color smoothing.', 4.5, 0.1, 30, 0.1),
  ]),
  effect('dust-reduction', 'Reduce Small Specks', 'Restoration', (p) => `median=radius=${fmt(p.radius)}`, 'A spatial median suppresses isolated sample impulses.', [
    parameter('radius', 'Radius', 'Neighborhood searched for isolated specks.', 1, 1, 10, 1, 'px', true),
  ]),
  effect('chromatic-correction', 'Shift Color Fringes', 'Restoration', (p) => `chromashift=cbh=${fmt(p.blueOffset)}:crh=${fmt(p.redOffset)}:edge=smear`, 'Moves Cb and Cr independently to counter color fringe.', [
    parameter('blueOffset', 'Blue offset', 'Horizontal shift of the blue-difference channel.', -2, -20, 20, 1, 'px', true),
    parameter('redOffset', 'Red offset', 'Horizontal shift of the red-difference channel.', 2, -20, 20, 1, 'px', true),
  ]),
  effect('deinterlace', 'Deinterlace', 'Restoration', 'yadif=mode=send_frame:parity=auto:deint=all', 'YADIF spatially and temporally interpolates missing field lines.'),
  effect('sharpen', 'Sharpen', 'Restoration', (p) => `unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${fmt(p.lumaAmount)}:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=${fmt(p.chromaAmount)}`, 'Unsharp masking enhances luma and chroma detail.', [
    parameter('lumaAmount', 'Luma amount', 'Sharpening applied to image detail.', 0.8, 0, 5, 0.05),
    parameter('chromaAmount', 'Chroma amount', 'Sharpening applied to color detail.', 0.2, 0, 5, 0.05),
  ]),
  effect('sharpen-edges', 'Sharpen Edges', 'Restoration', (p) => `cas=strength=${fmt(p.strength)}`, 'Contrast-adaptive sharpening limits enhancement near strong edges.', [
    parameter('strength', 'Strength', 'Contrast-adaptive edge enhancement.', 0.5, 0, 1, 0.05),
  ]),
  effect('soften', 'Soften', 'Restoration', (p) => `unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${fmt(p.lumaAmount)}:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=${fmt(p.chromaAmount)}`, 'Negative unsharp amounts soften luma and chroma globally.', [
    parameter('lumaAmount', 'Luma softness', 'Negative luma unsharp amount.', -0.6, -2, 0, 0.05),
    parameter('chromaAmount', 'Chroma softness', 'Negative chroma unsharp amount.', -0.3, -2, 0, 0.05),
  ]),

  // Stylize
  effect('edge-detect', 'Edge Detect', 'Stylize', 'edgedetect=low=0.08:high=0.25:mode=colormix', 'Canny-style edge detection is mixed with source colors.'),
  effect('emboss', 'Emboss', 'Stylize', 'format=gray,convolution=0m=-2 -1 0 -1 1 1 0 1 2:0rdiv=1:0bias=0.5', 'A directional 3 by 3 convolution creates grayscale relief.'),
  effect('pencil-sketch', 'Pencil Sketch', 'Stylize', 'format=gray,edgedetect=low=0.06:high=0.2:mode=wires,negate', 'Extracts grayscale edge wires and inverts them onto white.'),
  effect('posterize', 'Posterize', 'Stylize', (p) => {
    const expression = `floor(val*${p.levels}/256)*255/${p.levels - 1}`
    return `format=rgb24,lutrgb=r=${expression}:g=${expression}:b=${expression}`
  }, 'Quantizes each RGB component into a configurable number of levels.', [
    parameter('levels', 'Color levels', 'Number of values retained per RGB component.', 6, 2, 32, 1, undefined, true),
  ]),
  effect('prism', 'Prism Split', 'Stylize', (p) => `format=rgb24,rgbashift=rh=${fmt(p.shift)}:bh=${fmt(-p.shift)}:edge=smear`, 'Shifts red and blue samples horizontally in opposite directions.', [
    parameter('shift', 'Channel shift', 'Distance between red and blue samples.', 4, 0, 50, 1, 'px', true),
  ]),
  effect('watercolor', 'Watercolor Softening', 'Stylize', (p) => `bilateral=sigmaS=${fmt(p.spatial)}:sigmaR=${fmt(p.range)}`, 'Edge-preserving bilateral smoothing flattens color regions.', [
    parameter('spatial', 'Spatial radius', 'Size of the smoothing neighborhood.', 5, 0.1, 20, 0.1, 'px'),
    parameter('range', 'Edge retention', 'Sensitivity to color differences across edges.', 0.12, 0.01, 1, 0.01),
  ]),
  effect('mirror', 'Mirror', 'Stylize', 'hflip', 'Reverses horizontal sample order.'),
  effect('flip-v', 'Flip Vertical', 'Stylize', 'vflip', 'Reverses vertical sample order.'),

  // Temporal
  effect('motion-trails', 'Motion Trails', 'Temporal', (p) => {
    const frames = p.frames
    return `tmix=frames=${frames}:weights=${Array(frames).fill('1').join(' ')}:scale=${fmt(1 / frames)}`
  }, 'Averages successive frames to leave temporal trails.', [
    parameter('frames', 'Trail frames', 'Number of frames blended into each output frame.', 5, 2, 20, 1, undefined, true),
  ]),
  effect('frame-echo', 'Frame Echo', 'Temporal', (p) => {
    const frames = p.delayFrames + 1
    const weights = Array(frames).fill('0')
    weights[0] = '1'
    weights[frames - 1] = fmt(p.opacity)
    return `tmix=frames=${frames}:weights=${weights.join(' ')}:scale=${fmt(1 / (1 + p.opacity))}`
  }, 'Mixes the current frame with one delayed frame to create a discrete ghost.', [
    parameter('delayFrames', 'Echo delay', 'Distance to the ghost frame.', 3, 1, 12, 1, 'frames', true),
    parameter('opacity', 'Echo opacity', 'Strength of the delayed frame.', 0.55, 0.05, 1, 0.05, 'x'),
  ]),
  effect('stop-motion', 'Stop Motion', 'Temporal', (p) => `fps=${fmt(p.fps)}`, 'Drops frames onto a configurable cadence; delivery FPS duplicates them.', [
    parameter('fps', 'Capture rate', 'Frame cadence used for the stop-motion look.', 12, 1, 30, 1, 'fps', true),
  ], true),

  // Transform and warp
  effect('rotate', 'Rotate', 'Transform & Warp', (p) => `rotate=angle=${fmt(p.angle)}*PI/180:fillcolor=black`, 'Inverse-maps pixels through a configurable rotation.', [
    parameter('angle', 'Angle', 'Clockwise frame rotation.', 5, -180, 180, 0.5, 'deg'),
  ]),
  effect('lens-distortion', 'Lens Distortion', 'Transform & Warp', (p) => `lenscorrection=cx=${fmt(p.centerX)}:cy=${fmt(p.centerY)}:k1=${fmt(p.k1)}:k2=${fmt(p.k2)}:i=bilinear:fc=black`, 'Applies quadratic and quartic radial coordinate distortion.', [
    parameter('centerX', 'Center X', 'Horizontal center of distortion.', 0.5, 0, 1, 0.01),
    parameter('centerY', 'Center Y', 'Vertical center of distortion.', 0.5, 0, 1, 0.01),
    parameter('k1', 'Primary distortion', 'Quadratic radial correction coefficient.', -0.2, -1, 1, 0.01),
    parameter('k2', 'Secondary distortion', 'Quartic radial correction coefficient.', 0.05, -1, 1, 0.01),
  ]),
  effect('fisheye', 'Fisheye', 'Transform & Warp', (p) => `lenscorrection=cx=${fmt(p.centerX)}:cy=${fmt(p.centerY)}:k1=${fmt(p.k1)}:k2=${fmt(p.k2)}:i=bilinear:fc=black`, 'Applies positive radial distortion around a configurable center.', [
    parameter('centerX', 'Center X', 'Horizontal center of distortion.', 0.5, 0, 1, 0.01),
    parameter('centerY', 'Center Y', 'Vertical center of distortion.', 0.5, 0, 1, 0.01),
    parameter('k1', 'Primary distortion', 'Quadratic radial correction coefficient.', 0.35, -1, 1, 0.01),
    parameter('k2', 'Secondary distortion', 'Quartic radial correction coefficient.', 0.08, -1, 1, 0.01),
  ]),
  effect('shear', 'Shear', 'Transform & Warp', (p) => `shear=shx=${fmt(p.horizontal)}:shy=${fmt(p.vertical)}:fillcolor=black`, 'Applies an affine shear in the fixed frame canvas.', [
    parameter('horizontal', 'Horizontal shear', 'Horizontal affine skew.', 0.15, -1, 1, 0.01),
    parameter('vertical', 'Vertical shear', 'Vertical affine skew.', 0, -1, 1, 0.01),
  ]),
  effect('waviness', 'Waviness', 'Transform & Warp', (p) => `geq=lum='lum(X+${fmt(p.amplitude)}*sin(Y/${fmt(p.wavelength)}),Y)':cb='cb(X+${fmt(p.amplitude / 2)}*sin(Y/${fmt(p.wavelength)}),Y)':cr='cr(X+${fmt(p.amplitude / 2)}*sin(Y/${fmt(p.wavelength)}),Y)'`, 'Samples each scanline at a sinusoidally displaced X coordinate.', [
    parameter('amplitude', 'Amplitude', 'Maximum horizontal displacement.', 8, 0, 50, 0.5, 'px'),
    parameter('wavelength', 'Wavelength', 'Vertical distance over which the wave changes.', 18, 2, 100, 1, 'px'),
  ]),
  effect('camera-shake', 'Camera Shake', 'Transform & Warp', (p) => {
    const margin = Math.ceil(p.amount) + 2
    return `crop=w=iw-${margin * 2}:h=ih-${margin * 2}:x=${margin}+${fmt(p.amount)}*sin(${fmt(13 * p.speed)}*t):y=${margin}+${fmt(p.amount)}*sin(${fmt(17 * p.speed)}*t),scale=w=iw+${margin * 2}:h=ih+${margin * 2}`
  }, 'Moves a cropped viewport with deterministic sine waves, then rescales it.', [
    parameter('amount', 'Shake amount', 'Maximum viewport displacement.', 8, 0, 30, 0.5, 'px'),
    parameter('speed', 'Shake speed', 'Frequency multiplier of the motion.', 1, 0.1, 4, 0.1, 'x'),
  ]),

  // Light and lens
  effect('glow-bloom', 'Glow / Bloom', 'Light & Lens', (p, _dur, tag) => `split[${tag}a][${tag}b];[${tag}b]gblur=sigma=${fmt(p.radius)},eq=brightness=${fmt(p.brightness)}:saturation=${fmt(p.saturation)}[${tag}g];[${tag}a][${tag}g]blend=all_mode=screen:all_opacity=${fmt(p.opacity)}`, 'Blurs a lifted copy of the frame and screen-blends it over the source.', [
    parameter('radius', 'Radius', 'Spread of the luminous bloom.', 8, 0.5, 40, 0.5, 'px'),
    parameter('opacity', 'Opacity', 'Strength of the screened glow.', 0.35, 0, 1, 0.01),
    parameter('brightness', 'Brightness', 'Lift applied to the glow layer.', 0.08, -0.2, 0.5, 0.01),
    parameter('saturation', 'Saturation', 'Color intensity in the glow layer.', 1.15, 0, 3, 0.05, 'x'),
  ]),
  effect('halation', 'Red Highlight Glow', 'Light & Lens', (p, _dur, tag) => `split[${tag}a][${tag}b];[${tag}b]gblur=sigma=${fmt(p.radius)},colorbalance=rs=${fmt(p.red)}:gs=${fmt(-p.red * 0.25)}:bs=${fmt(-p.red * 0.55)}[${tag}h];[${tag}a][${tag}h]blend=all_mode=screen:all_opacity=${fmt(p.opacity)}`, 'Adds a soft red-biased diffusion layer around bright detail.', [
    parameter('radius', 'Radius', 'Spread of the halation layer.', 5, 0.5, 30, 0.5, 'px'),
    parameter('opacity', 'Opacity', 'Strength of the halation layer.', 0.24, 0, 1, 0.01),
    parameter('red', 'Red bias', 'Warm color bias of the halo.', 0.18, 0, 0.5, 0.01),
  ]),
  effect('lens-flare', 'Stylized Lens Flare', 'Light & Lens', "format=gbrp,geq=r='r(X,Y)+70*exp(-((X-W*0.72)*(X-W*0.72)+(Y-H*0.28)*(Y-H*0.28))/(W*H*0.006))':g='g(X,Y)+52*exp(-((X-W*0.72)*(X-W*0.72)+(Y-H*0.28)*(Y-H*0.28))/(W*H*0.006))':b='b(X,Y)+30*exp(-((X-W*0.72)*(X-W*0.72)+(Y-H*0.28)*(Y-H*0.28))/(W*H*0.006))'", 'Adds a warm procedural radial highlight near the upper-right lens axis.'),
  effect('light-rays', 'Light Rays', 'Light & Lens', (p) => `edgedetect=low=${fmt(p.threshold)}:high=${fmt(Math.min(1, p.threshold * 3))}:mode=colormix,dblur=angle=${fmt(p.angle)}:radius=${fmt(p.length)},eq=brightness=${fmt(p.brightness)}:contrast=1.08`, 'Extracts bright boundaries and stretches them in a configurable direction.', [
    parameter('threshold', 'Threshold', 'Edge threshold used to seed the rays.', 0.08, 0.01, 0.3, 0.01),
    parameter('angle', 'Angle', 'Direction of the rays.', 45, 0, 360, 1, 'deg'),
    parameter('length', 'Length', 'Directional spread of the rays.', 14, 1, 64, 1, 'px', true),
    parameter('brightness', 'Brightness', 'Luminance lift after ray extraction.', 0.04, -0.2, 0.4, 0.01),
  ]),
  effect('radial-aberration', 'Radial Chromatic Aberration', 'Light & Lens', (p) => `format=rgb24,rgbashift=rh=${fmt(p.shift)}:rv=${fmt(p.vertical)}:bh=${fmt(-p.shift)}:bv=${fmt(-p.vertical)}:edge=smear,vignette=angle=PI/${fmt(p.vignette)}`, 'Offsets red and blue in opposing axes and weights the split toward the frame edge.', [
    parameter('shift', 'Horizontal split', 'Horizontal channel displacement.', 5, 0, 40, 1, 'px', true),
    parameter('vertical', 'Vertical split', 'Vertical channel displacement.', 2, 0, 40, 1, 'px', true),
    parameter('vignette', 'Edge weight', 'Vignette angle divisor controlling edge emphasis.', 5, 2, 12, 0.5),
  ]),

  // Analog and digital damage
  effect('vhs-tracking', 'VHS Tracking Error', 'Analog & Glitch', (p) => `geq=lum='lum(X+${fmt(p.amount)}*sin(Y/${fmt(p.band)}+T*${fmt(p.speed)}),Y)':cb='cb(X+${fmt(p.amount / 2)}*sin(Y/${fmt(p.band)}+T*${fmt(p.speed)}),Y)':cr='cr(X-${fmt(p.amount / 2)}*sin(Y/${fmt(p.band)}+T*${fmt(p.speed)}),Y)',noise=alls=${fmt(p.noise)}:allf=t+u:all_seed=41`, 'Displaces scan rows over time and adds tape-like temporal noise.', [
    parameter('amount', 'Displacement', 'Maximum horizontal tracking displacement.', 10, 0, 40, 0.5, 'px'),
    parameter('band', 'Band size', 'Vertical scale of the tracking waves.', 18, 2, 80, 1, 'px'),
    parameter('speed', 'Speed', 'Tracking movement speed.', 7, 0.5, 20, 0.5, 'x'),
    parameter('noise', 'Noise', 'Tape noise strength.', 6, 0, 30, 1, '%', true),
  ]),
  effect('vhs-head-noise', 'VHS Head Switching Noise', 'Analog & Glitch', (p) => `geq=lum='lum(X+if(gt(Y,H*${fmt(p.start)}),${fmt(p.amount)}*sin(Y/2+T*25),0),Y)':cb='cb(X+if(gt(Y,H*${fmt(p.start)}),${fmt(p.amount / 2)},0),Y)':cr='cr(X-if(gt(Y,H*${fmt(p.start)}),${fmt(p.amount / 2)},0),Y)',noise=alls=${fmt(p.noise)}:allf=t:all_seed=53`, 'Adds unstable displacement and noise to the lower tape head-switching band.', [
    parameter('start', 'Band start', 'Vertical position where head noise begins.', 0.82, 0.5, 0.98, 0.01),
    parameter('amount', 'Displacement', 'Horizontal instability in the lower band.', 14, 0, 50, 1, 'px', true),
    parameter('noise', 'Noise', 'Noise mixed into the damaged band impression.', 8, 0, 40, 1, '%', true),
  ]),
  effect('datamosh', 'Datamosh Simulation', 'Analog & Glitch', (p) => {
    const frames = p.frames
    return `tmix=frames=${frames}:weights=${Array(frames).fill('1').join(' ')}:scale=${fmt(1 / frames)},pixelize=width=${fmt(p.blockSize)}:height=${fmt(p.blockSize)}:mode=avg,eq=saturation=${fmt(p.saturation)}:contrast=${fmt(p.contrast)}`
  }, 'Blends adjacent frames and macroblock-like regions to imitate motion-vector smearing.', [
    parameter('frames', 'Trail frames', 'Frames retained in the temporal smear.', 4, 2, 12, 1, 'frames', true),
    parameter('blockSize', 'Block size', 'Size of the simulated macroblocks.', 6, 2, 32, 1, 'px', true),
    parameter('saturation', 'Saturation', 'Color intensity in the damaged image.', 1.25, 0, 3, 0.05, 'x'),
    parameter('contrast', 'Contrast', 'Contrast in the damaged image.', 1.08, 0.5, 2, 0.01, 'x'),
  ]),
  effect('glitch-bands', 'Digital Glitch Bands', 'Analog & Glitch', (p) => `geq=lum='lum(X+${fmt(p.amount)}*if(lt(mod(Y+T*${fmt(p.speed)},${fmt(p.spacing)}),${fmt(p.width)}),sin(T*31),0),Y)':cb='cb(X+${fmt(p.amount / 2)}*if(lt(mod(Y+T*${fmt(p.speed)},${fmt(p.spacing)}),${fmt(p.width)}),1,0),Y)':cr='cr(X-${fmt(p.amount / 2)}*if(lt(mod(Y+T*${fmt(p.speed)},${fmt(p.spacing)}),${fmt(p.width)}),1,0),Y)',format=rgb24,rgbashift=rh=2:bh=-2:edge=smear`, 'Moves narrow horizontal bands independently and separates their color channels.', [
    parameter('amount', 'Displacement', 'Maximum band displacement.', 18, 0, 80, 1, 'px', true),
    parameter('spacing', 'Spacing', 'Distance between glitch bands.', 72, 16, 256, 1, 'px', true),
    parameter('width', 'Band width', 'Height of each displaced band.', 10, 1, 64, 1, 'px', true),
    parameter('speed', 'Speed', 'Vertical band travel speed.', 90, 1, 300, 1, 'px/s'),
  ]),
  effect('bad-tv', 'Bad TV', 'Analog & Glitch', 'eq=contrast=1.16:brightness=-0.025:saturation=0.68,noise=alls=13:allf=t+u:all_seed=67,format=rgb24,chromashift=cbh=4:cbv=1:crh=-4:crv=-1:edge=smear,drawgrid=width=iw:height=5:thickness=1:color=black@0.22,crop=w=iw-8:h=ih-8:x=4+3*sin(19*t):y=4+2*sin(23*t),scale=w=iw+8:h=ih+8', 'Combines unstable framing, chroma drift, scanlines, noise, and crushed television contrast.'),
  effect('crt-curvature', 'CRT Curvature', 'Analog & Glitch', (p) => `lenscorrection=cx=0.5:cy=0.5:k1=${fmt(p.curvature)}:k2=${fmt(p.curvature * 0.24)}:i=bilinear:fc=black,vignette=angle=PI/${fmt(p.vignette)}`, 'Bends the frame with barrel distortion and darkens the tube edges.', [
    parameter('curvature', 'Curvature', 'Barrel distortion strength.', 0.22, 0, 0.8, 0.01),
    parameter('vignette', 'Edge darkness', 'Vignette angle divisor.', 4, 2, 12, 0.5),
  ]),
  effect('crt-phosphor', 'CRT Phosphor Mask', 'Analog & Glitch', (p) => `format=rgb24,rgbashift=rh=1:bh=-1:edge=smear,drawgrid=width=${fmt(p.pitch)}:height=ih:thickness=${fmt(p.thickness)}:color=black@${fmt(p.opacity)},drawgrid=width=iw:height=${fmt(p.scanline)}:thickness=1:color=black@${fmt(p.opacity * 0.8)}`, 'Overlays vertical phosphor columns and horizontal scanlines on split RGB samples.', [
    parameter('pitch', 'Phosphor pitch', 'Width of each vertical phosphor group.', 3, 2, 12, 1, 'px', true),
    parameter('thickness', 'Mask thickness', 'Width of the vertical mask line.', 1, 1, 4, 1, 'px', true),
    parameter('scanline', 'Scanline spacing', 'Distance between horizontal scanlines.', 4, 2, 16, 1, 'px', true),
    parameter('opacity', 'Opacity', 'Darkness of the phosphor mask.', 0.3, 0, 0.8, 0.05),
  ]),

  // Color mapping
  effect('color-isolation', 'Color Isolation', 'Color Mapping', (p) => `colorhold=color=0x${Math.round(p.red).toString(16).padStart(2, '0')}${Math.round(p.green).toString(16).padStart(2, '0')}${Math.round(p.blue).toString(16).padStart(2, '0')}:similarity=${fmt(p.similarity)}:blend=${fmt(p.blend)}`, 'Desaturates pixels away from a selected RGB color.', [
    parameter('red', 'Red', 'Red component of the retained color.', 220, 0, 255, 1, undefined, true),
    parameter('green', 'Green', 'Green component of the retained color.', 45, 0, 255, 1, undefined, true),
    parameter('blue', 'Blue', 'Blue component of the retained color.', 40, 0, 255, 1, undefined, true),
    parameter('similarity', 'Similarity', 'Accepted color distance.', 0.18, 0.01, 1, 0.01),
    parameter('blend', 'Blend', 'Softness around the selected color.', 0.08, 0, 1, 0.01),
  ]),
  effect('duotone', 'Duotone', 'Color Mapping', "format=gray,format=rgb24,lutrgb=r='11+236*val/255':g='16+162*val/255':b='38+65*val/255'", 'Maps grayscale luminance between deep navy shadows and warm amber highlights.'),
  effect('tritone', 'Tritone', 'Color Mapping', "format=gray,format=rgb24,lutrgb=r='if(lt(val,128),18+0.55*val,88+1.25*(val-128))':g='if(lt(val,128),24+0.75*val,120+0.72*(val-128))':b='if(lt(val,128),54+1.05*val,188+0.45*(val-128))'", 'Maps shadows, midtones, and highlights through three coordinated color ranges.'),
  effect('false-color', 'False Color', 'Color Mapping', 'pseudocolor=preset=turbo', 'Maps luminance through the Turbo diagnostic color palette.'),
  effect('solarize', 'Solarize', 'Color Mapping', (p) => `format=rgb24,lutrgb=r='if(lt(val,${fmt(p.threshold)}),val,255-val)':g='if(lt(val,${fmt(p.threshold)}),val,255-val)':b='if(lt(val,${fmt(p.threshold)}),val,255-val)'`, 'Inverts channel values above a configurable threshold.', [
    parameter('threshold', 'Threshold', 'Value above which each channel is inverted.', 128, 0, 255, 1, undefined, true),
  ]),
  effect('infrared', 'Infrared Color Map', 'Color Mapping', 'format=rgb24,colorchannelmixer=rr=0.1:rg=0.9:rb=0.2:gr=0.45:gg=0.2:gb=0.1:br=0.1:bg=0.25:bb=0.85,curves=all=0/0 0.35/0.2 0.72/0.88 1/1,eq=contrast=1.12:saturation=0.9', 'Remaps green foliage toward bright tones while retaining a deep cool sky response.'),
  effect('thermal', 'Heat Color Map', 'Color Mapping', 'format=gray,pseudocolor=preset=inferno', 'Maps luminance through an Inferno heat palette.'),
  effect('cross-process', 'Cross Processing', 'Color Mapping', "curves=r='0/0.04 0.35/0.24 0.68/0.82 1/0.97':g='0/0.01 0.42/0.52 1/0.94':b='0/0.12 0.38/0.46 0.72/0.78 1/0.9',eq=saturation=1.18:contrast=1.08", 'Applies opposing RGB curves associated with chemically cross-processed film.'),

  // Film simulation
  effect('gate-weave', 'Film Frame Drift', 'Film Simulation', (p) => {
    const margin = Math.ceil(p.amount) + 2
    return `crop=w=iw-${margin * 2}:h=ih-${margin * 2}:x=${margin}+${fmt(p.amount)}*sin(${fmt(p.speed * 7)}*t):y=${margin}+${fmt(p.amount * 0.7)}*sin(${fmt(p.speed * 11)}*t),scale=w=iw+${margin * 2}:h=ih+${margin * 2}`
  }, 'Moves the film aperture with small, independently phased horizontal and vertical drift.', [
    parameter('amount', 'Weave amount', 'Maximum aperture displacement.', 2, 0, 12, 0.25, 'px'),
    parameter('speed', 'Weave speed', 'Frequency multiplier of the aperture movement.', 1, 0.1, 4, 0.1, 'x'),
  ]),
  effect('dust-scratches', 'Dust & Scratch Overlay', 'Film Simulation', (p) => `noise=alls=${fmt(p.dust)}:allf=t+u:all_seed=79,format=rgb24,drawgrid=width=${fmt(p.spacing)}:height=ih:thickness=${fmt(p.thickness)}:color=white@${fmt(p.opacity)}`, 'Combines temporal dust noise with fine vertical scratch lines.', [
    parameter('dust', 'Dust', 'Temporal dust density.', 10, 0, 40, 1, '%', true),
    parameter('spacing', 'Scratch spacing', 'Distance between vertical scratches.', 173, 24, 512, 1, 'px', true),
    parameter('thickness', 'Scratch width', 'Width of each scratch.', 1, 1, 4, 1, 'px', true),
    parameter('opacity', 'Scratch opacity', 'Brightness of the scratches.', 0.12, 0, 0.6, 0.01),
  ]),
  effect('film-flicker', 'Irregular Exposure Flicker', 'Film Simulation', (p) => `eq=brightness='${fmt(p.amount)}*(0.58*sin(2*PI*${fmt(p.rate)}*t)+0.29*sin(2*PI*${fmt(p.rate * 2.37)}*t)+0.13*sin(2*PI*${fmt(p.rate * 5.11)}*t))':contrast=${fmt(p.contrast)}:eval=frame`, 'Combines three incommensurate exposure oscillations for irregular projector flicker.', [
    parameter('amount', 'Flicker amount', 'Maximum exposure variation.', 0.07, 0, 0.25, 0.005),
    parameter('rate', 'Base rate', 'Base flicker frequency.', 5, 0.5, 15, 0.5, 'Hz'),
    parameter('contrast', 'Contrast', 'Base projector contrast.', 1.06, 0.7, 1.6, 0.01, 'x'),
  ]),
  effect('old-projector', 'Old Projector Simulation', 'Film Simulation', "curves=preset=vintage,eq=contrast=1.08:brightness='0.055*(0.65*sin(2*PI*5*t)+0.35*sin(2*PI*11.7*t))':saturation=0.72:eval=frame,noise=alls=14:allf=t+u:all_seed=83,format=rgb24,drawgrid=width=181:height=ih:thickness=1:color=white@0.1,vignette=angle=PI/4", 'Combines vintage color, irregular flicker, dust, scratches, and projector vignette.'),

  // Graphic stylization
  effect('comic-book', 'Comic Book', 'Graphic Stylize', (p, _dur, tag) => {
    const expression = `floor(val*${p.levels}/256)*255/${p.levels - 1}`
    return `split[${tag}a][${tag}b];[${tag}a]format=rgb24,lutrgb=r=${expression}:g=${expression}:b=${expression}[${tag}p];[${tag}b]format=gray,edgedetect=low=${fmt(p.edgeLow)}:high=${fmt(p.edgeHigh)}:mode=wires,negate[${tag}e];[${tag}p][${tag}e]blend=all_mode=multiply:all_opacity=${fmt(p.edgeOpacity)}`
  }, 'Multiplies dark edge wires over quantized source colors.', [
    parameter('levels', 'Color levels', 'Number of retained values per channel.', 7, 2, 24, 1, undefined, true),
    parameter('edgeLow', 'Edge low', 'Lower edge detection threshold.', 0.06, 0, 1, 0.01),
    parameter('edgeHigh', 'Edge high', 'Upper edge detection threshold.', 0.22, 0, 1, 0.01),
    parameter('edgeOpacity', 'Ink opacity', 'Strength of the black edge layer.', 0.82, 0, 1, 0.01),
  ]),
  effect('oil-painting', 'Oil-Paint Style', 'Graphic Stylize', (p) => {
    const expression = `floor(val*${p.levels}/256)*255/${p.levels - 1}`
    return `bilateral=sigmaS=${fmt(p.spatial)}:sigmaR=${fmt(p.range)},median=radius=${fmt(p.median)},format=rgb24,lutrgb=r=${expression}:g=${expression}:b=${expression}`
  }, 'Flattens similarly colored regions, suppresses small detail, and quantizes the palette.', [
    parameter('spatial', 'Brush size', 'Spatial smoothing radius.', 7, 0.1, 20, 0.1, 'px'),
    parameter('range', 'Edge retention', 'Sensitivity to color boundaries.', 0.16, 0.01, 1, 0.01),
    parameter('median', 'Median radius', 'Radius used to simplify fine texture.', 1, 1, 5, 1, 'px', true),
    parameter('levels', 'Color levels', 'Number of retained values per channel.', 12, 3, 32, 1, undefined, true),
  ]),
  effect('neon-edges', 'Neon Edges', 'Graphic Stylize', (p) => `edgedetect=low=${fmt(p.low)}:high=${fmt(p.high)}:mode=colormix,eq=contrast=${fmt(p.contrast)}:brightness=${fmt(p.brightness)}:saturation=${fmt(p.saturation)},gblur=sigma=${fmt(p.glow)}`, 'Extracts colored edges, boosts their color, and diffuses them into a neon glow.', [
    parameter('low', 'Edge low', 'Lower edge threshold.', 0.04, 0, 1, 0.01),
    parameter('high', 'Edge high', 'Upper edge threshold.', 0.18, 0, 1, 0.01),
    parameter('contrast', 'Contrast', 'Neon line contrast.', 1.7, 0.5, 3, 0.05, 'x'),
    parameter('brightness', 'Brightness', 'Neon line brightness.', -0.08, -1, 1, 0.01),
    parameter('saturation', 'Saturation', 'Neon color intensity.', 2, 0, 3, 0.05, 'x'),
    parameter('glow', 'Glow', 'Diffusion around neon lines.', 0.7, 0, 5, 0.1, 'px'),
  ]),
  effect('kaleidoscope', 'Kaleidoscope', 'Graphic Stylize', "geq=lum='lum(abs(mod(X,W/2)-W/4)*2,abs(mod(Y,H/2)-H/4)*2)':cb='cb(abs(mod(X,W/2)-W/4)*2,abs(mod(Y,H/2)-H/4)*2)':cr='cr(abs(mod(X,W/2)-W/4)*2,abs(mod(Y,H/2)-H/4)*2)'", 'Mirrors a central image quadrant repeatedly across both frame axes.'),
  effect('tiny-planet', 'Tiny Planet', 'Graphic Stylize', "geq=lum='lum((atan2(Y-H/2,X-W/2)/(2*PI)+0.5)*W,max(0,min(H-1,H-2*hypot(X-W/2,Y-H/2))))':cb='cb((atan2(Y-H/2,X-W/2)/(2*PI)+0.5)*W,max(0,min(H-1,H-2*hypot(X-W/2,Y-H/2))))':cr='cr((atan2(Y-H/2,X-W/2)/(2*PI)+0.5)*W,max(0,min(H-1,H-2*hypot(X-W/2,Y-H/2))))'", 'Remaps equirectangular coordinates into a polar tiny-planet projection.'),
  effect('tilt-shift', 'Miniature Tilt-Shift', 'Light & Lens', (p, _dur, tag) => {
    const half = p.focus / 2
    const top = fmt(0.5 - half)
    const bottom = fmt(0.5 + half)
    return `split[${tag}a][${tag}b];[${tag}b]gblur=sigma=${fmt(p.blur)}[${tag}g];[${tag}a][${tag}g]blend=all_expr='if(between(Y/H,${top},${bottom}),A,B)'`
  }, 'Keeps a horizontal focus band sharp while strongly blurring the foreground and background.', [
    parameter('blur', 'Blur', 'Out-of-focus diffusion radius.', 9, 0.5, 40, 0.5, 'px'),
    parameter('focus', 'Focus width', 'Fraction of frame height retained in focus.', 0.24, 0.05, 0.8, 0.01),
  ]),
]

export const EFFECTS: EffectDef[] = [...CATALOG_TRANSITIONS, ...CATALOG_EFFECTS].map((definition) => ({
  ...effectImplementations.find((implementation) => implementation.id === definition.id),
  ...definition,
}))

const BY_ID = new Map(EFFECTS.map((item) => [item.id, item]))
const XFADE_NAMES = new Set(
  EFFECTS.flatMap((item) => item.kind === 'transition' && item.xfade ? [item.xfade] : []),
)
const CUSTOM_XFADE_EXPRESSIONS = new Map(
  EFFECTS.flatMap((item) => item.kind === 'transition' && item.xfade && item.xfadeExpr
    ? [[item.xfade, item.xfadeExpr] as const]
    : []),
)

export function getEffect(id: string): EffectDef | undefined {
  return BY_ID.get(id)
}

export function defaultEffectParams(effectId: string): EffectParams {
  const def = getEffect(effectId)
  return Object.fromEntries((def?.parameters ?? []).map((item) => [item.key, item.defaultValue]))
}

export function normalizeEffectParams(effectId: string, params: Readonly<EffectParams> = {}): EffectParams {
  const def = getEffect(effectId)
  const normalized: EffectParams = {}
  for (const parameter of def?.parameters ?? []) {
    const candidate = Number(params[parameter.key])
    let value = Number.isFinite(candidate) ? candidate : parameter.defaultValue
    value = Math.max(parameter.min, Math.min(parameter.max, value))
    if (parameter.integer) value = Math.round(value)
    normalized[parameter.key] = value
  }
  return normalized
}

export function effectParamsKey(effectId: string, params: Readonly<EffectParams>): string {
  return JSON.stringify(normalizeEffectParams(effectId, params))
}

// --- intensity ramp (easing envelope) ---

const RAMP_MODES: RampMode[] = ['in', 'out', 'in-out']
const RAMP_CURVES: RampCurve[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out']

export function clampRampAmount(mode: RampMode, amount: number): number {
  const cap = mode === 'in-out' ? 0.5 : 1
  const value = Number.isFinite(amount) ? amount : 0.25
  return Math.min(cap, Math.max(0.05, value))
}

export function normalizeRamp(ramp: Readonly<EffectRamp> | null | undefined): EffectRamp | null {
  if (!ramp) return null
  const mode = RAMP_MODES.includes(ramp.mode) ? ramp.mode : 'in'
  const curve = RAMP_CURVES.includes(ramp.curve) ? ramp.curve : 'linear'
  return { mode, curve, amount: clampRampAmount(mode, ramp.amount) }
}

function curveValue(curve: RampCurve, value: number): number {
  const u = Math.max(0, Math.min(1, value))
  switch (curve) {
    case 'ease-in': return u * u
    case 'ease-out': return 1 - (1 - u) * (1 - u)
    case 'ease-in-out': return u * u * (3 - 2 * u)
    default: return u
  }
}

// Numeric counterpart of rampIntensityExpr, used to draw the same envelope
// on the timeline. progress is normalized over the whole effect block.
export function rampIntensityAt(
  ramp: Readonly<EffectRamp> | null | undefined,
  progress: number,
): number {
  const normalized = normalizeRamp(ramp)
  if (!normalized) return 1
  const p = Math.max(0, Math.min(1, progress))
  const length = normalized.amount
  const fadeIn = p < length ? curveValue(normalized.curve, p / length) : 1
  const fadeOut = p > 1 - length
    ? curveValue(normalized.curve, (1 - p) / length)
    : 1
  if (normalized.mode === 'in') return fadeIn
  if (normalized.mode === 'out') return fadeOut
  return Math.min(fadeIn, fadeOut)
}

// Easing curve C(u) as an ffmpeg expression fragment; u is itself an
// expression that evaluates to 0..1 inside the ramp window.
//
// The output must stay pure arithmetic: no commas, semicolons, or quoted
// strings (no clip()/min()/max()/if()). The same fragment is embedded into
// `sendcmd=c='...'` arguments by commandRamp, and sendcmd's parser splits
// commands on bare commas with no parenthesis awareness (f_sendcmd.c
// COMMAND_DELIMS) — a single comma aborts the whole segment render with
// "No command specified in interval #0, command #1". Comma-bearing
// constructs (if/lt/gt/min) belong only in blend=all_expr='...', which is
// single-quoted at the filtergraph level.
function curveExpr(curve: RampCurve, u: string): string {
  switch (curve) {
    case 'ease-in': return `(${u})*(${u})`
    case 'ease-out': return `(1-(1-(${u}))*(1-(${u})))`
    case 'ease-in-out': return `(${u})*(${u})*(3-2*(${u}))`
    default: return `(${u})`
  }
}

// Intensity I(T) in 0..1 as an ffmpeg expression over the segment-local
// timestamp T. The envelope is relative to the whole block: segments that
// start mid-block pass their block-relative `offset` so the curve stays
// continuous across region boundaries.
export function rampIntensityExpr(ramp: Readonly<RampTiming>): string | null {
  const d = ramp.blockDuration
  const r = clampRampAmount(ramp.mode, ramp.amount) * d
  if (!(d > 0) || !(r > 0)) return null
  const off = Number.isFinite(ramp.offset) ? ramp.offset : 0
  const B = `(T${off >= 0 ? '+' : '-'}${fmt(Math.abs(off))})`
  const R = fmt(r)
  const D = fmt(d)
  const inExpr = `if(lt(${B},${R}),${curveExpr(ramp.curve, `${B}/${R}`)},1)`
  const outExpr = `if(gt(${B},${D}-${R}),${curveExpr(ramp.curve, `(${D}-${B})/${R}`)},1)`
  switch (ramp.mode) {
    case 'in': return inExpr
    case 'out': return outExpr
    default: return `min(${inExpr},${outExpr})`
  }
}

export function effectSupportsRamp(effectId: string): boolean {
  const def = getEffect(effectId)
  return !!def?.build && !def.noRamp
}

interface RampPhase {
  start: number
  end: number
  intensity: string
}

function rampPhases(ramp: Readonly<RampTiming>, segmentDuration: number): RampPhase[] {
  const duration = ramp.blockDuration
  const length = clampRampAmount(ramp.mode, ramp.amount) * duration
  if (!(duration > 0) || !(length > 0) || !(segmentDuration > 0)) return []
  const offset = Number.isFinite(ramp.offset) ? ramp.offset : 0
  const blockTime = `(T${offset >= 0 ? '+' : '-'}${fmt(Math.abs(offset))})`
  const up = curveExpr(ramp.curve, `${blockTime}/${fmt(length)}`)
  const down = curveExpr(ramp.curve, `(${fmt(duration)}-${blockTime})/${fmt(length)}`)
  const source: Array<{ start: number; end: number; intensity: string }> = []
  if (ramp.mode !== 'out') source.push({ start: 0, end: length, intensity: up })
  if (ramp.mode === 'out') source.push({ start: 0, end: duration - length, intensity: '1' })
  if (ramp.mode === 'in-out') source.push({ start: length, end: duration - length, intensity: '1' })
  if (ramp.mode === 'in') source.push({ start: length, end: duration, intensity: '1' })
  if (ramp.mode !== 'in') source.push({ start: duration - length, end: duration, intensity: down })

  const segmentEnd = offset + segmentDuration
  return source.flatMap((phase) => {
    const start = Math.max(offset, phase.start)
    const end = Math.min(segmentEnd, phase.end)
    return end - start > 1e-6
      ? [{ start: start - offset, end: end - offset, intensity: phase.intensity }]
      : []
  })
}

function parameterValueExpr(neutral: number, target: number, intensity: string): string {
  if (intensity === '1') return fmt(target)
  const delta = target - neutral
  if (neutral === 0) return `${fmt(delta)}*(${intensity})`
  return `${fmt(neutral)}+${fmt(delta)}*(${intensity})`
}

function commandRamp(
  target: string,
  option: string,
  neutral: number,
  value: number,
  ramp: Readonly<RampTiming>,
  segmentDuration: number,
): string {
  const commands = rampPhases(ramp, segmentDuration).map((phase) => {
    const interval = `${fmt(phase.start)}-${fmt(phase.end)}`
    const argument = parameterValueExpr(neutral, value, phase.intensity)
    return phase.intensity === '1'
      ? `${interval} ${target} ${option} ${argument}`
      : `${interval} [expr] ${target} ${option} ${argument}`
  })
  return commands.length > 0 ? `sendcmd=c='${commands.join(';')}'` : ''
}

type ParameterRampBuilder = (
  dur: number,
  params: Readonly<EffectParams>,
  ramp: Readonly<RampTiming>,
  tag: string,
) => string

function animatedGblur(
  tag: string,
  sigma: number,
  steps: number,
  planes: number,
  ramp: Readonly<RampTiming>,
  dur: number,
): string {
  const initialProgress = ramp.blockDuration > 0 ? ramp.offset / ramp.blockDuration : 0
  const initialSigma = sigma * rampIntensityAt(ramp, initialProgress)
  const target = `gblur@${tag}`
  return [
    commandRamp(target, 'sigma', 0, sigma, ramp, dur),
    // FFmpeg resolves sigmaV=-1 once at initialization, not after sigma commands.
    commandRamp(target, 'sigmaV', 0, sigma, ramp, dur),
    `${target}=sigma=${fmt(initialSigma)}:steps=${fmt(steps)}:planes=${fmt(planes)}:sigmaV=${fmt(initialSigma)}`,
  ].filter(Boolean).join(',')
}

const PARAMETER_RAMP_BUILDERS: Partial<Record<string, ParameterRampBuilder>> = {
  // NOTE: only gaussian-blur animates its parameter. `blur` used to do the
  // same (gblur via sendcmd) but that diverged from the Pixi preview, which
  // crossfades the boxblur: keep it on wrapIntensity like everything else.
  'gaussian-blur': (dur, p, ramp, tag) => (
    animatedGblur(tag, p.sigma, p.steps, 15, ramp, dur)
  ),
}

export function effectUsesParameterRamp(effectId: string): boolean {
  return !!PARAMETER_RAMP_BUILDERS[effectId]
}

// Ramp an effect by crossfading between the untouched stream and the fully
// effected stream: split -> effect -> blend with the per-frame intensity I(T).
// Both branches are normalized to gbrp (planar RGB, no chroma subsampling)
// because some effects (sepia, emboss, ...) change the pixel format, which
// blend would reject. gbrp keeps the blend in RGB so it matches the Pixi
// preview mix; yuv420p would subsample chroma and shift colors vs preview.
// `tag` must be unique within the surrounding filtergraph.
function wrapIntensity(inner: string, expr: string, tag: string): string {
  // Normalize before any framesync: blend can otherwise evaluate T using
  // source ticks after its PTS have already been rescaled to AVTB.
  // Packed RGB first keeps YUV chroma reconstruction consistent with the
  // decoded preview, including the unchanged branch at zero intensity.
  // Force the effected branch to RGB as well: the Pixi preview always works
  // on decoded RGB, so the inner filters must see rgb24 in both ramped and
  // constant blocks, otherwise drawgrid/vignette/noise would negotiate YUV
  // on YUV sources and diverge from the preview.
  return `settb=AVTB,split[${tag}a][${tag}b];[${tag}b]format=rgb24,${inner}[${tag}f];`
    + `[${tag}a]format=rgb24,format=gbrp[${tag}o];[${tag}f]format=rgb24,format=gbrp[${tag}e];`
    + `[${tag}o][${tag}e]blend=all_expr='A*(1-(${expr}))+B*(${expr})'`
}

// Split a filter chain on top-level commas: commas inside () or '...' stay.
// Returns null when the graph is not a plain comma chain (labeled pads,
// semicolons, unbalanced input) — those keep a single whole-chain crossfade.
export function splitTopLevelFilters(inner: string): string[] | null {
  const stages: string[] = []
  let depth = 0
  let inQuote = false
  let current = ''
  for (const ch of inner) {
    if (ch === "'") {
      inQuote = !inQuote
      current += ch
      continue
    }
    if (!inQuote) {
      if (ch === '(') depth += 1
      else if (ch === ')') depth = Math.max(0, depth - 1)
      else if (ch === ',' && depth === 0) {
        stages.push(current)
        current = ''
        continue
      } else if (ch === ';' || ch === '[' || ch === ']') return null
    }
    current += ch
  }
  stages.push(current)
  if (inQuote || depth !== 0) return null
  if (stages.some((stage) => stage.trim().length === 0)) return null
  return stages
}

function rampFilterStages(inner: string): string[] | null {
  const filters = splitTopLevelFilters(inner)
  if (!filters) return null
  const stages: string[] = []
  let pending: string[] = []
  for (let index = 0; index < filters.length; index++) {
    const filter = filters[index]
    pending.push(filter)
    // Pixel-format conversions belong to the operation, not to a separate fade.
    if (filter.startsWith('format=') && index < filters.length - 1) continue
    // Blending the cropped intermediate against the full frame is invalid.
    if (filter.startsWith('crop=') && filters[index + 1]?.startsWith('scale=')) continue
    stages.push(pending.join(','))
    pending = []
  }
  return stages
}

function wrapRamp(inner: string, expr: string, tag: string): string {
  const stages = rampFilterStages(inner)
  if (!stages || stages.length < 2) return wrapIntensity(inner, expr, tag)
  return stages.map((stage, index) => wrapIntensity(stage, expr, `${tag}s${index}`)).join(',')
}

export function buildFilter(
  effectId: string,
  dur: number,
  params: Readonly<EffectParams> = {},
  ramp: Readonly<RampTiming> | null = null,
  tag = 'r0',
): string {
  const def = getEffect(effectId)
  if (!def?.build) throw new Error(`unknown effect: ${effectId}`)
  const normalized = normalizeEffectParams(effectId, params)
  const inner = def.build(dur, normalized, `${tag}i`)
  // Isolate every stage in RGB like the Pixi preview (each shader takes RGB
  // and outputs RGB). Without this, a planar filter (noise, eq, chromashift)
  // changes the negotiated format for the next stage (vignette, drawgrid),
  // which then uses YUV math while the preview uses RGB. Stages already on
  // packed RGB keep a single prefix; gray/planar/split stages get an explicit
  // `format=rgb24` first so they derive from full-resolution RGB exactly like
  // the preview shaders.
  const isolateStages = (chain: string): string => {
    const stages = rampFilterStages(chain) ?? [chain]
    return stages.map(stage => stage.trim().startsWith('format=rgb24') ? stage : `format=rgb24,${stage}`).join(',')
  }
  if (!ramp || def.noRamp) return isolateStages(inner)
  const parameterRamp = PARAMETER_RAMP_BUILDERS[effectId]
  if (parameterRamp) return `format=rgb24,${parameterRamp(dur, normalized, ramp, tag)}`
  const expr = rampIntensityExpr(ramp)
  // Browser textures contain decoded RGB. Fix the effect's input domain so
  // FFmpeg negotiation cannot silently change its math for YUV source files.
  return `format=rgb24,${expr ? wrapRamp(inner, expr, tag) : inner}`
}

export function buildFilterChain(effects: EffectInstance[], dur: number): string {
  const stages = effects.map((effect, index) => {
    const graph = buildFilter(effect.id, dur, effect.params, effect.ramp, `r${index}`)
    return { graph, ramped: graph.includes('split[') }
  })
  if (stages.every((stage) => !stage.ramped)) {
    return stages.map((stage) => stage.graph).join(',')
  }
  // Labeled filtergraph: each stage consumes the previous stage's output pad.
  return stages.map((stage, index) => {
    const prefix = index === 0 ? '' : `[c${index}]`
    const suffix = index === stages.length - 1 ? '' : `[c${index + 1}]`
    return `${prefix}${stage.graph}${suffix}`
  }).join(';')
}

export function xfadeName(transitionId: string | undefined): string {
  const def = transitionId ? getEffect(transitionId) : undefined
  return def?.xfade ?? 'fade'
}

export function sanitizeXfade(name: string): string {
  return XFADE_NAMES.has(name) ? name : 'fade'
}

// Catalog expressions use the editor's forward progress (0 = A, 1 = B),
// while FFmpeg 5.1 xfade exposes P in the opposite direction (1 = A, 0 = B).
export function compileXfadeExpression(expression: string): string {
  return expression.replace(/\bP\b/g, '(1-P)')
}

// Builds only whitelisted xfade options. Callers pass the returned fragment
// directly after `xfade=`; arbitrary expressions from project payloads never
// reach FFmpeg.
export function xfadeFilter(name: string): string {
  const safeName = sanitizeXfade(name)
  const expression = CUSTOM_XFADE_EXPRESSIONS.get(safeName)
  return expression
    ? `transition=custom:expr='${compileXfadeExpression(expression)}'`
    : `transition=${safeName}`
}
