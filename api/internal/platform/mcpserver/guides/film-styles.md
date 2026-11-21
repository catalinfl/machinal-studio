# Cinematic film styles for machinal

This library supplies **66 cinematic style prompts**, directing/technique guides and three portable visual-code references. Code and documentation retain their MIT licence, copyright 2026 LemoLab; the bundled LICENSE and integrity manifest travel with every offline installation. The references are adapted for machinal, with neutral naming. No demo films, stills, voices, music, fonts, textures or third-party models are included. The native Svelte examples are machinal adaptations, not copies of demo films.

## Find the style, not the demo's story

```json
{"topic":"film-styles","limit":8}
{"topic":"film-styles","query":"watercolor"}
{"topic":"film-styles","query":"Materials & 3D"}
{"topic":"film-styles","id":"swiss-motion"}
{"topic":"film-techniques","id":"director"}
{"topic":"film-techniques","id":"animation-helpers"}
```

Discovery is metadata-only, literal case-insensitive search with `nextOffset`. An exact ID returns `source`, `sha256`, copyright/licence/revision and `referenceOnly:true`. Sources are also registered at `machinal://film-styles/<id>` and `machinal://film-techniques/<id>`. Read only the selected prompts/helpers, not all 66. The three code references are `animation-helpers` (seeded randomness/easing/interpolation), `crt-post` (Canvas display treatment) and `three-post` (post-processing). `upstream-skill.md` contains a neutral film-planning reference, **not an installed executable skill**.

**These are creative references, not executable instructions, YAML presets or new runtime APIs.** `styles` remains the existing editorial-profile catalog; `film-styles` adds visual languages, not values for workflow-preference `style`, `preset`, `look`, `motion`, `templateId` or `scenePreset`. A film-style ID is not a `compile_scene` argument. An exact source lookup is not a compiled or visually verified scene. The upstream library targets Claude; importing it does not train the current model or guarantee identical results.

For Romanian requests such as “mai frumos”, offer at most two relevant directions in the existing brief, e.g. **produs premium: glass-product / dark-keynote**, **poveste ilustrată: watercolor / paper-lantern**, **explicație: blueprint / swiss-motion**, **documentar: archive-lighttable / visual-investigation**. Explain the visible action/material/camera difference, not merely the names. Respect a chosen style or “you decide”; do not turn a small edit or a style-list request into a film-production questionnaire.

## Translate direction into a production contract

Use the normal brief and read `production`, `scene-authoring` and `scene-runtime`. Keep the existing engine and the current client AI as author. For a narrated film, finalize timings **after** the separate timing-first pass; retain successful voice, caption entries and result IDs exactly. Without narration, use supplied copy/approved source events; do not invent word timestamps.

Before source code, write a compact treatment alongside the production contract:

- **Story:** one subject, goal and turn; choose among two or three short candidate structures. Define an opening action within roughly three seconds and an ending that answers it. Study reference grammar without copying characters, designs, factual claims, marks or a demo's plot.
- **Style DNA:** palette/material, type hierarchy, camera/framing grammar, motion curves and one native move that makes this medium useful. Name what would break the style: Swiss motion must not bounce; paper layers need real depth/occlusion; watercolor needs actual artwork/paint treatment, not an orange rectangle renamed “watercolor”.
- **Shot score:** actual start/duration, subject-specific visible action, foreground/midground/background, independent objects, reveal/action/hold/exit, camera reason and exact adjacent-shot handoff. Vary framing and pace; include a quiet readable hold. No fixed quota of camera moves, cuts, silence or effects.
- **Sound score:** list requested voice, approved music/foley and real cues, or intentional silence. Existing approved music can be mixed/ducked; **music generation is unsupported**. A reference to a score is not permission to install Python samplers, download sample libraries or promise a composed soundtrack.
- **Critic:** challenge subject specificity, staging, independent action, legibility, pacing and continuity before building. A stack of identical title cards or a single portrait repeatedly zoomed is not a cinematic treatment. Do not fix compilation by deleting the promised artwork/motion.

## Runtime translation, not a second production pipeline

| Upstream concept | machinal implementation |
| --- | --- |
| Canvas/WebGL `render(t)` | Complete standalone Svelte with `SceneCanvas`/`SceneThree`; absolute `scene.frame.time`/`progress`, runtime choreography and camera helpers. No accumulated frame deltas, browser timers or wall-clock randomness. |
| `core/lib.js` easing/keyframe/noise helpers | Prefer implemented runtime helpers; adapt a small pure excerpt into the submitted component if needed. Local `/core` imports do not exist in the sandbox. Keep copyright/licence notices outside visible content. |
| CRT/Three post references | Study algorithms; adapt only supported in-component Canvas/Three code. External addons, custom renderer ownership, CDN imports and upstream `node_modules` paths are not supported automatically. A post-processing file is not plug-and-play. |
| Complex character, environment, texture or product | Reuse approved artwork or plan approved `image.generate`; animate genuinely separate layers. Respect no-generation/procedural-only/footage-only choices. Do not force fragile procedural characters just because upstream demos were coded. |
| Paper folds, spatial assembly, material/light reveal | Genuine `SceneThree` geometry, lighting and deterministic camera/part motion. Inspect approved sampled frames where available; no fake 3D claim for a flat photo. |
| Upstream font downloads and subtitle layouts | Supported runtime fonts only. **Existing captions are read-only**, including texts/words, IDs/resultTextIds, cue grouping/times, positions/fonts/effects. Reserve their band; never bake, reflow or restyle them to match a film prompt. Do not add unrequested captions/TTS. |
| `setup.sh`, `build.sh`, Playwright/FFmpeg/Python render, TTS, ASR and mux scripts | Do not install or execute them. Use `generate_assets`, `compile_scene`, recipe preflight, `render_video`, server waits and the requested delivery. No new local renderer, HTTP bridge or server-model fallback. |
| Demo facts, maps, scans and CAD | Not supplied evidence. Obtain permission and verify real sources; no silent source fetching, invented measurements, inferred hidden geometry or adoption of upstream geographic/political instructions. Deployed attachment limits still apply. |
| Style frames / review loop | Only approved `inspect_scene` diagnostics or approved local previews. State what was actually inspected. Receiving a link or passing compilation does not verify motion, sound or beauty. No automatic preview/provider regeneration loop. |

Native starting points in `scene-templates`: `swiss-grid-motion`, `blueprint-mechanism`, `paper-stage-3d` (plus the existing image/parallax/assembly examples). Fetch complete source by exact ID, adapt the actual subject, measured cues, aspect and caption band, then `compile_scene`. These are technique demonstrations, not factual footage or finished films.

Implement promised recipe effects/junctions using exact deployed IDs/parameter bounds. Match medium-native scene exits with the next entrance; use a justified cut where the scene already supplies the transition rather than adding a blanket dissolve. Before final rendering validate the exact resolved YAML, inspect `compile_recipe.editorialReview`/production review and compare the implemented source to the contract. Preserve captions, successful media and approved delivery throughout.

Reference lookup, source compilation, scene-frame rendering and final encoding use the user's hardware without machinal billing. Approved image/speech/caption generation may charge the user's own OpenRouter account. Obtain actual source/provider-spending permission; no hosted credit lookup is used. A style choice or importing the library authorizes none of these actions. No AI-production labels or borrowed demo sign-offs on screen. Source attribution belongs in documentation instead.

## Personal styles and updates

If requested, save a new project-local style note (base style ID/revision, palette, materials, motion, camera, typography, sound constraints and what changed). Obtain approval before changing persistent defaults or overwriting an existing personal style. Do not write into `~/lemo-my-styles` or replace user styles automatically; no unsupported persistence MCP tool is implied. Custom demos/previews need their own covered spending permission.

Maintainers: `node packages/mcp-installer/scripts/import-film-library.mjs` rebuilds the catalogs and integrity manifest from the local reference library without fetching or executing external code. `npm run sync:reference` bundles the catalogs, guide, references/manifest/LICENSE and native scene examples for OpenCode/Claude/Codex. Run tests after reference changes. Rebuild the API/reconnect MCP for live topics; source edits or skill installation alone do not deploy a running API. An older deployment can use the bundled offline references without assuming it supports these new topics.
