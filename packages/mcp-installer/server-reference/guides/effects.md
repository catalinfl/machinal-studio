# Effects, parameters and ramps

Use topic `effects` to search the **live** catalog by ID, label, category, summary or algorithm. Fetch an exact `id` before writing `params`. Entries include parameter `key`, description, `defaultValue`, `min`, `max`, `step`, unit/integer flags, `noRamp` and default preview duration. A preview's `defaultDuration` is not an automatically inserted YAML interval.

## Choosing a treatment

- Correction/cleanup: `brightness`, `contrast-pop`, `color-boost`, `deband`, `deflicker`, `denoise`, `deinterlace`, `chromatic-correction`, `sharpen-edges`. Identify a real problem first; do not claim these fix footage you have not inspected. Denoising/softening/sharpening can trade detail for artifacts.
- Color/mood: `warm-grade`, `cool-grade`, `day-for-night`, `grayscale`, `sepia`, `bleach-bypass`, `duotone`, `cross-process`. Usually prefer one coherent look rather than stacking contradictory grades.
- Texture/light: `film-grain`, `vignette`, `halation`, `glow-bloom`, `lens-flare`, `dust-scratches`, `gate-weave`. Subtle texture can support cinema/nostalgia; do not double-apply effects already inside a look.
- Focus/privacy/design: `gaussian-blur`, `directional-blur`, `mosaic-blur`, `soft-focus`, `tilt-shift`. Effects operate on full clip/track pixels, not an automatically tracked face/object mask. Do not promise selective anonymization without an actual supported composition.
- Deliberate graphics: `pencil-sketch`, `watercolor`, `comic-book`, `oil-painting`, `posterize`, `neon-edges`, `kaleidoscope`. Reserve strong stylization for matching art direction; preserve legible explanatory content.
- Deliberate disruption: `vhs-tracking`, `datamosh`, `glitch-bands`, `bad-tv`, `rgb-punch`, `camera-shake`, `negative-strobe`. Keep them brief and purposeful; avoid flashes/flicker/strobes by default, especially for accessibility-sensitive briefs.

These examples do not exhaust the catalog. The tool returns every deployed effect on pagination, with its own description rather than forcing it into the above families.

## Build an effect score, not just a grade

Actively plan effects as part of the edit; do not stop at a base look, dissolves and a slow zoom when the brief calls for expressive visuals. An **effect score** is a short planning note per selected beat: purpose, exact catalog ID, target clip/track, start/duration, supported params/ramp, and how it resolves into the next shot. It is not a YAML field. Implement the selected accents in the final recipe after real clip IDs exist; a prose recommendation alone is not execution.

Evaluate complementary layers: a coherent base look, image/object movement, a timed focus/light/texture accent, and a motivated junction. Not every beat needs every layer. For an expressive edit, use varied accents at meaningful reveals, changes and climaxes, with quieter holds between them; do not default to an empty effects plan or repeat the same zoom/fade on every image. Explain omissions briefly at plan level for a minimal brief or incompatible material, not at every cut. There is no fixed effect count.

Possible directions, subject to exact live entries and bounds: a brief `gaussian-blur` settling into a readable image reveal; `halation` or `glow-bloom` supporting an actual luminous subject; `film-grain` or `dust-scratches` unifying an archival-inspired montage. These are alternatives, not a mandatory stack or proof that the images are archival. Check effects already expanded by the look and effects authored inside a scene before adding more. Whole-track effects can soften labels/captions and should not compromise legibility. Ramps must respect `noRamp`; never invent selective masks, bloom engines or unsupported knobs. Avoid flashes, strobes and disorienting movement by default.

## Timed block versus rule

For a timed accent on a real video track:
```yaml
effects:
  - id: intro-focus
    trackId: main
    ownerClipId: first
    preset: gaussian-blur
    start: 0s
    duration: 500ms
    params: {sigma: 2, steps: 2}
    ramp: {mode: out, curve: ease-out, amount: 1}
```

For a whole-clip treatment chosen by selector:
```yaml
rules:
  - id: subtle-grain
    target: {kind: video, trackId: main, position: all}
    apply:
      effect:
        preset: film-grain
        params: {strength: 6, seed: 31415}
```

`rules[].apply.effect` has no `start`, `duration`, `trackId` or `ownerClipId`; the compiler derives its interval from each matching clip. `effects[]` needs an actual track and interval. If anchored, the interval must fit the owner clip and track; otherwise it must fit the composition. IDs must be unique. Effects apply to video tracks, not audio/text objects.

## Do not invent knobs

`vignette`, `warm-grade` and several other effects have **no adjustable parameters**; use `{}`/omit params, not imaginary `intensity` or `strength`. `film-grain` has `strength` and deterministic `seed`. `gaussian-blur` has `sigma` and integer `steps`. `contrast-pop` has `contrast`, `brightness`, `saturation`, `gamma`. Read current bounds and defaults, and never assume that all effects share an `amount` or 0–1 range.

Omitted supported params use the catalog defaults. Unknown keys, non-finite/out-of-range values and fractional values for integer params fail validation. A fixed seed is preferable to rerandomizing on retry.

Ramps are only for effects with `noRamp: false`: `{mode: in|out|in-out, curve: linear|ease-in|ease-out|ease-in-out, amount}`. `amount` is a duration fraction: 0.05–1, or 0.05–0.5 for `in-out`. It is not the effect's strength. A ramp on a look's contained effect or an independent rule does not create an arbitrary animation system for every YAML property.
