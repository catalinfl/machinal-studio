# Looks and motion are different controls

Topic `looks` returns exact look descriptions plus their expanded effects, parameters, ramps and optional motion/frames. Topic `motions` returns the real normalized transform frames and optional cap. Fetch the selected IDs, not just a list of names.

## Look choices

Use one coherent base look where appropriate: `creator-natural`/`balanced-enhance` for light natural enhancement; `clean-tutorial` for explanatory clarity; `fine-film`/`documentary-16mm`/`kodak-portra-soft` for restrained film direction; `teal-amber`/`blockbuster-35mm` for a stronger cinematic palette; `travel-golden-hour`/`kodak-gold-summer` for warm travel; `food-commercial`/`beauty-commercial` for relevant product content; `film-noir-hard-light` for monochrome/noir; `vhs-rental-tape`/`y2k-camcorder` for intentional retro; `cyberpunk-magenta-cyan`/`neon-night` for justified neon direction. These are suggestions, not a claim that uninspected footage suits them.

Many looks include motion, grain, bloom, contrast or vignette. Example: `fine-film` already includes `vintage`, `contrast-pop`, `film-grain`, `sharpen-edges`, `vignette` and a zoom-in. Read the entry before adding a second independent grain/vignette or a competing motion. A look has an ID, not user-defined arbitrary `look.params`.

## Motion choices

- `none`: deliberate still treatment. An explicitly nonempty `motion: none` also overrides look-generated motion with empty frames; inspect normalized output.
- `zoom-in`, `zoom-out`, `ken-burns`, `drift`: measured emphasis or photo movement. Preserve subject framing and avoid unnecessary motion behind detailed text.
- `pan-left`, `pan-right`, `pan-up`, `pan-down`, `reframe-left`, `reframe-right`: purposeful reframing/direction; verify crop/bounds on actual media.
- `punch`, `zoom-pulse`, `settle`: short emphasis/settling. Do not repeat a punch on every spoken word.
- `whip-left`, `whip-right`, `impact-shake`: deliberate energetic accents, not default reading/teaching movement.

Motion frame `at` values are fractions of the clip span. A positive `cap` limits the animated span, after which the last transform is held; it does not trim the source. `motion` chosen explicitly supersedes existing/auto-generated transform keyframes during expansion. Hand-authored clip-local keyframes need increasing times and valid transform bounds; do not combine mutually competing motion systems without checking compiled output.

## Supported placement

Uniform sequence: `sequence.each.look: fine-film`, `sequence.each.motion: ken-burns` (or `none` when the look's motion is unwanted).

Explicit clip: `tracks[].clips[].look`/`motion`.

Selector rule:
```yaml
rules:
  - id: documentary-treatment
    target: {kind: video, trackId: main}
    apply: {look: documentary-16mm, motion: none}
```

Commands: `look.apply`, `look.remove`, `motion.apply`; `transform.reset` and `keyframe.clear` have distinct effects on transforms/motion. See `commands`. Montage motion has its own exact-preset/random choice contract.

A **style profile** combines editorial intent, candidate looks, transitions, motion, text and scene briefs. It is not itself a catalog look, and must not be written as `document.style`, `styles` or an unsupported preset name. The SceneVideo component's look names inside generated scene source are a different namespace from these video-edit catalog look IDs.
