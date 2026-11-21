# Choosing and authoring transitions

Read exact catalog entries through topic `transitions` (`query` for a family/description, `id` for an exact preset). Every deployed entry retains its summary, algorithm and renderer mapping; do not promise a physical camera move because a preset name says “whip” or “lens”.

## Editorial choices

| Intent | Catalog starting points | Guidance |
| --- | --- | --- |
| Continuous explanation, dialogue, demonstrations | **Cuts**; omit `between` | Keep causal continuity and complete spoken thoughts. Not every junction needs a transition. |
| Quiet cinematic/travel/memory | `cross-dissolve`, `film-dissolve-slow`, `film-dissolve-fast` | Use dissolves for temporal/emotional continuity, not between unrelated statements solely for decoration. |
| Chapter break or deliberate blackout | `fade-black`, `fade-white`, `fade-grayscale` | A fade is not automatically a gap or extra blank clip. Budget its overlap. White flashes need restraint/accessibility consideration. |
| Directional handoff, reveal of the next step | `smooth-left`, `smooth-right`, `wipe-left`, `wipe-right`, `slide-up`, `diagonal-tr` | Match subject/layout direction. Left/right semantics follow the catalog algorithm, not a guessed convention. |
| Energetic social/sports | `whip-pan-left`, `whip-pan-right`, `zoom-blur-in`, `shutter-snap` | Short motivated accents; avoid shaking a whole tutorial or repeating one aggressive transition at every cut. |
| Film-memory aesthetic | `light-leak-transition`, `film-burn-transition`, `luma-fade` | Keep the whole grade coherent; do not pile on unrelated glitch effects. |
| Deliberate digital/retro disruption | `digital-glitch-transition`, `rgb-split-transition`, `vhs-tracking-transition`, `tv-static-transition` | Use only when the brief supports disruption. Strobes/flashes/high-contrast flicker are not default accessibility-safe choices. |
| Graphic/editorial reveal | `circle`, `rectangle-crop`, `barn-horizontal-open`, `split-panels`, `page-turn-2d` | Useful for designed sections; not a substitute for inspecting an actual source change. |

These are suggestions, not the complete catalog. Query/search/paginate to inspect all entries, including geometric, custom motion, distortion, glitch and organic categories.

## Three supported authoring locations

Uniform sequence:
```yaml
sequence:
  use: shots
  each: {take: {from: 0s, duration: 4s}, source_audio: remove}
  between: {preset: cross-dissolve, duration: 600ms, policy: error}
```

Explicit timeline pair (clips must actually overlap by 300ms):
```yaml
transitions:
  - {id: a-to-b, trackId: main, leftClipId: a, rightClipId: b,
     preset: whip-pan-left, duration: 300ms}
```

Version 3 montage: `montage.between: {preset: film-dissolve-fast, duration: 250ms, policy: error}`. Randomness is only a montage choice and must be deliberate and seeded. Never add `params` to a transition: this DSL exposes preset and duration, not arbitrary effect parameters on transitions.

## Overlap math is mandatory

- Same video track, adjacent clips, one transition per pair, no triple overlap. A named transition must match `left.End - right.start` exactly.
- Minimum 100ms. Between two images the maximum is half the shorter timeline duration. Otherwise it is `(shorterDuration - 100ms) / 2`. Montage uses the latter whole-moment rule.
- Sequence/montage overlaps shorten total duration: sum clip durations minus junction overlaps (plus any other track/text extension). Two 4s clips with a 600ms overlap produce 7.4s, not 8s.
- `policy: shrink` permits a reduction with a warning; do not silently change a user-required transition duration or shorten speech to make it fit. Compile and report actual resolved duration.
- An explicit overlapping video pair without a declared preset becomes `cross-dissolve`; omission is not a hard cut if timing still overlaps.
- `transition.remove` with `closeGap: false` retains overlap as a cross-dissolve. With `closeGap: true`, it realigns following clips and removes the overlap. `transition.set` targets an existing transition; it does not create arbitrary clip geometry.
