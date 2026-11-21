import { describe, expect, it } from 'vitest'
import {
  EFFECTS,
  buildFilter,
  buildFilterChain,
  clampRampAmount,
  compileXfadeExpression,
  defaultEffectParams,
  effectSupportsRamp,
  normalizeRamp,
  rampIntensityAt,
  rampIntensityExpr,
  sanitizeXfade,
  splitTopLevelFilters,
  xfadeFilter,
  xfadeName,
} from '../lib/effects'

describe('FFmpeg effect registry', () => {
  const effects = EFFECTS.filter((item) => item.kind === 'effect')
  const transitions = EFFECTS.filter((item) => item.kind === 'transition')

  it('exposes the complete WASM-compatible preset catalog', () => {
    expect(effects).toHaveLength(84)
    expect(transitions).toHaveLength(76)
    expect(new Set(EFFECTS.map((item) => item.id)).size).toBe(EFFECTS.length)
    expect(new Set(transitions.map((item) => item.xfade)).size).toBe(transitions.length)
    expect(effects.filter((item) => (item.parameters?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(30)
    expect(effects.every((item) => item.summary.trim().length > 0)).toBe(true)
    expect(effects.every((item) => item.summary !== item.algorithm)).toBe(true)
  })

  it('builds ordered linear filter chains for local rendering', () => {
    expect(buildFilterChain([
      { id: 'grayscale', params: {} },
      { id: 'vignette', params: {} },
    ], 2)).toBe(
      `${buildFilter('grayscale', 2)},${buildFilter('vignette', 2)}`,
    )
    for (const item of effects) {
      const filter = buildFilter(item.id, 2)
      expect(filter).not.toBe('')
      if (['glow-bloom', 'halation', 'comic-book', 'tilt-shift'].includes(item.id)) {
        expect(filter).toContain('split[r0ia][r0ib]')
        expect(filter).toContain(';')
      } else {
        expect(filter).not.toContain(';')
        expect(filter).not.toContain('[')
      }
    }
  })

  it('builds configurable filters from clamped effect parameters', () => {
    expect(defaultEffectParams('blur')).toEqual({
      lumaRadius: 8,
      lumaPower: 1,
      chromaRadius: 4,
      chromaPower: 1,
    })
    expect(buildFilter('blur', 2, {
      lumaRadius: 20,
      lumaPower: 3,
      chromaRadius: 12,
      chromaPower: 2,
    })).toBe(`format=rgb24,boxblur=luma_radius='min(20,min(w,h)/2)':luma_power=3:chroma_radius='min(12,min(cw,ch)/2)':chroma_power=2`)
    expect(buildFilter('blur', 2, { lumaRadius: 999 })).toContain('min(64')
    expect(buildFilter('directional-blur', 2, { angle: -20, radius: 8 })).toContain('angle=0')
    expect(buildFilter('denoise', 2, {
      lumaSpatial: 0,
      chromaSpatial: 0,
      lumaTemporal: 0,
      chromaTemporal: 0,
    })).toContain('luma_spatial=0.1')
    expect(buildFilter('posterize', 2, { levels: 3 })).toBe(
      'format=rgb24,lutrgb=r=floor(val*3/256)*255/2:g=floor(val*3/256)*255/2:b=floor(val*3/256)*255/2',
    )
    expect(buildFilter('negative-strobe', 0.3, { rate: 10, duty: 0.4 })).toBe(
      "format=rgb24,negate=enable='lt(mod(t*10+0.0000001,1),0.4)'",
    )
    expect(buildFilter('frame-echo', 0.3, { delayFrames: 3, opacity: 0.5 })).toBe(
      'format=rgb24,tmix=frames=4:weights=1 0 0 0.5:scale=0.666667',
    )
    expect(buildFilter('sepia-dream', 2)).toContain('vignette=angle=PI/4')
    expect(buildFilter('flash-hit', 0.18)).toBe('format=rgb24,eq=brightness=0.38:contrast=1.08:saturation=0.45')
    expect(buildFilter('rgb-punch', 0.16, { shift: 9 })).toContain('rgbashift=rh=9:bh=-9')
    expect(buildFilter('prism', 2, { shift: 4 })).toBe('format=rgb24,rgbashift=rh=4:bh=-4:edge=smear')
    expect(buildFilter('analog-flicker', 2)).toContain("brightness='0.035*sin(2*PI*8*t)'")
    expect(buildFilter('color-isolation', 2, { red: 12, green: 34, blue: 56 })).toContain('color=0x0c2238')
    expect(buildFilter('solarize', 2, { threshold: 96 })).toContain('lt(val,96)')
    expect(buildFilter('glow-bloom', 2, { radius: 12, opacity: 0.4 })).toContain('gblur=sigma=12')
    expect(buildFilter('tilt-shift', 2, { blur: 6, focus: 0.4 })).toContain('between(Y/H,0.3,0.7)')
  })

  it('builds eased intensity envelopes and preserves non-rampable effects', () => {
    const ramp = {
      mode: 'in-out' as const,
      curve: 'ease-in-out' as const,
      amount: 0.25,
      blockDuration: 4,
      offset: 1,
    }

    const expression = rampIntensityExpr(ramp)
    expect(expression).toContain('min(')
    expect(expression).toContain('(T+1)')
    expect(expression).toContain('if(lt(')
    expect(expression).toContain('if(gt(')

    const filter = buildFilter('sepia', 2, {}, ramp)
    expect(filter).toMatch(/^(format=rgb24,)?settb=AVTB,split\[r0a\]\[r0b\]/)
    expect(filter).toContain('[r0b]format=rgb24,')
    expect(filter).toContain('blend=all_expr=')
    expect(filter).toContain('format=gbrp')

    expect(effectSupportsRamp('sepia')).toBe(true)
    expect(effectSupportsRamp('stop-motion')).toBe(false)
    expect(buildFilter('stop-motion', 2, {}, ramp)).toBe('format=rgb24,fps=12')
  })

  it('normalizes the directional blur clock without restarting a cut-spanning ramp', () => {
    for (const offset of [0, 4.275]) {
      const filter = buildFilter('directional-blur', 10.21678 - offset, { angle: 0, radius: 8 }, {
        mode: 'in-out', curve: 'linear', amount: 0.5, blockDuration: 10.21678, offset,
      })
      expect(filter).toMatch(/^(format=rgb24,)?settb=AVTB,split/)
      expect(filter).toContain(`(T+${offset})`)
      expect(filter).toContain('dblur=angle=0:radius=8')
      expect(filter).not.toContain('setpts=')
    }
  })

  it('crossfades blur instead of animating gblur parameters (Pixi parity)', () => {
    // blur must stay a boxblur on both sides: the Pixi preview crossfades it,
    // so a sendcmd-driven gblur here would diverge mid-ramp. Only
    // gaussian-blur animates its sigma on both sides.
    const filter = buildFilter('blur', 3.5, {
      lumaRadius: 41, lumaPower: 1, chromaRadius: 4, chromaPower: 1,
    }, {
      mode: 'in-out', curve: 'ease-in-out', amount: 0.25,
      blockDuration: 3.5, offset: 0,
    })

    expect(filter).toContain('boxblur=')
    expect(filter).toContain('blend=all_expr=')
    expect(filter).not.toContain('sendcmd=')

    const animated = buildFilter('gaussian-blur', 3.5, { sigma: 6, steps: 2 }, {
      mode: 'in-out', curve: 'ease-in-out', amount: 0.25,
      blockDuration: 3.5, offset: 0,
    })
    expect(animated).toContain("sendcmd=c='0-0.875 [expr] gblur@r0 sigma")
    expect(animated).toContain('gblur@r0=sigma=0:steps=2:planes=15')
    expect(animated).toContain('[expr] gblur@r0 sigmaV')
    expect(animated).toContain(':sigmaV=0')
    expect(animated).toContain('(3-2*(')
    expect(animated).not.toContain('blend=all_expr=')
  })

  it('crossfades every stage of a multi-filter effect (Pixi parity)', () => {
    // The preview fades each stage once in order; a single whole-chain
    // crossfade would decay the surviving original as (1-I)^n mid-ramp.
    const filter = buildFilter('soft-focus', 3.5, {}, {
      mode: 'in', curve: 'linear', amount: 0.5, blockDuration: 3.5, offset: 0,
    })
    expect(filter).toContain('r0s0')
    expect(filter).toContain('r0s1')
    expect(filter.match(/blend=all_expr=/g)?.length).toBe(2)
    // Split graphs (labeled pads) keep one whole-chain crossfade instead.
    const glow = buildFilter('glow-bloom', 3.5, {}, {
      mode: 'in', curve: 'linear', amount: 0.5, blockDuration: 3.5, offset: 0,
    })
    expect(glow).not.toContain('r0s0')
    expect(glow.match(/blend=all_expr=/g)?.length).toBe(1)
  })

  it('splits chains on top-level commas only', () => {
    expect(splitTopLevelFilters('gblur=sigma=1.2,eq=brightness=0.03:saturation=1.05'))
      .toEqual(['gblur=sigma=1.2', 'eq=brightness=0.03:saturation=1.05'])
    expect(splitTopLevelFilters('boxblur=luma_radius=8:luma_power=1'))
      .toEqual(['boxblur=luma_radius=8:luma_power=1'])
    // Commas inside parens/quotes stay; labeled graphs fall back to null.
    expect(splitTopLevelFilters("blend=all_expr='if(between(Y/H,0.38,0.62),A,B)'")).toHaveLength(1)
    expect(splitTopLevelFilters('split[a][b];[b]gblur=sigma=8[c]')).toBeNull()
    expect(splitTopLevelFilters('gblur=sigma=8,')).toBeNull()
    // Every catalog effect round-trips through the splitter.
    for (const item of EFFECTS) {
      if (!item.build) continue
      const inner = item.build(2, defaultEffectParams(item.id), 't0')
      expect(splitTopLevelFilters(inner)?.join(',') ?? inner, item.id).toBe(inner)
    }
  })

  it('keeps sendcmd arguments free of bare commas for every ramp shape', () => {
    // sendcmd splits commands on bare commas with no parenthesis awareness
    // (f_sendcmd.c COMMAND_DELIMS): a single comma inside c='...' aborts the
    // segment with "No command specified in interval #0, command #1"
    // (ffmpeg exit 234). Easing fragments embedded in sendcmd args must stay
    // pure arithmetic — no clip()/min()/max()/if().
    const modes = ['in', 'out', 'in-out'] as const
    const curves = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const
    for (const mode of modes) {
      for (const curve of curves) {
        // Only gaussian-blur still animates parameters via sendcmd; every
        // other effect crossfades (see the parity test above).
        const filter = buildFilter('gaussian-blur', 3.5, {}, {
          mode, curve, amount: 0.5, blockDuration: 3.5, offset: 0.25,
        })
        for (const match of filter.matchAll(/sendcmd=c='([^']*)'/g)) {
          expect(match[1], `gaussian-blur ${mode}/${curve}`).not.toContain(',')
        }
        expect(filter, `gaussian-blur ${mode}/${curve}`).toContain('sendcmd=')
      }
    }
  })

  it('normalizes ramp settings and builds labeled mixed-effect graphs', () => {
    expect(clampRampAmount('in-out', 0.9)).toBe(0.5)
    expect(normalizeRamp({ mode: 'out', curve: 'ease-out', amount: 2 })).toEqual({
      mode: 'out', curve: 'ease-out', amount: 1,
    })

    const graph = buildFilterChain([
      { id: 'grayscale', params: {} },
      {
        id: 'vignette',
        params: {},
        ramp: { mode: 'in', curve: 'linear', amount: 0.5, blockDuration: 2, offset: 0 },
      },
    ], 2)
    expect(graph).toContain('hue=s=0[c1];[c1]format=rgb24,settb=AVTB,split[r1a][r1b]')
    expect(graph).toContain('[r1b]format=rgb24,vignette=')
    expect(graph).toContain("blend=all_expr='A*(1-")
  })

  it('samples the same ramp shapes used by the timeline envelope', () => {
    expect(rampIntensityAt(null, 0)).toBe(1)
    expect(rampIntensityAt({ mode: 'in', curve: 'linear', amount: 0.5 }, 0)).toBe(0)
    expect(rampIntensityAt({ mode: 'in', curve: 'linear', amount: 0.5 }, 0.25)).toBe(0.5)
    expect(rampIntensityAt({ mode: 'in', curve: 'ease-in', amount: 0.5 }, 0.25)).toBe(0.25)
    expect(rampIntensityAt({ mode: 'out', curve: 'ease-out', amount: 0.5 }, 0.75)).toBe(0.75)
    expect(rampIntensityAt({ mode: 'in-out', curve: 'ease-in-out', amount: 0.5 }, 0)).toBe(0)
    expect(rampIntensityAt({ mode: 'in-out', curve: 'ease-in-out', amount: 0.5 }, 0.5)).toBe(1)
    expect(rampIntensityAt({ mode: 'in-out', curve: 'ease-in-out', amount: 0.5 }, 1)).toBe(0)
  })

  it('allows registered xfade primitives and rejects arbitrary names', () => {
    for (const item of transitions) {
      expect(sanitizeXfade(item.xfade!)).toBe(item.xfade)
      expect(xfadeName(item.id)).toBe(item.xfade)
    }
    expect(sanitizeXfade('custom=malicious')).toBe('fade')
    expect(xfadeName('missing')).toBe('fade')
    expect(xfadeFilter('wipeleft')).toBe('transition=wipeleft')
    expect(compileXfadeExpression('P+PI+PLANE')).toBe('(1-P)+PI+PLANE')
    expect(xfadeFilter('custom-whip-left')).toContain("transition=custom:expr='min(255,if(lt(X/W,(1-P)),B,A)")
    expect(xfadeFilter('custom=malicious')).toBe('transition=fade')
  })
})
