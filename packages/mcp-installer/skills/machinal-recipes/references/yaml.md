# YAML composition contract and field map

Author **one YAML mapping** and save it as `.edit.yaml`. JSON input remains accepted for backwards compatibility, but agents should not author JSON recipes. Use the complete envelope with `document`, `bindings`, `assets`, and optional `snapshot`/`preparedText`. `get_recipe_schema` describes `document`, **not the envelope**. `document` contains the edit DSL; `bindings` and `assets` are its siblings. `recipe` is a legacy envelope field, not a substitute for `document`. Use a YAML composition string in MCP tools, never a local filename as its value. For unchanged continuation after generation, `sourceJobId` replaces the composition argument; `get_job_result` returns resolved `recipeYaml` when editing is needed.

No duplicate/unknown keys, YAML anchors, aliases, merge keys or nulls. Omit optional fields instead. Quote `#RRGGBB` colors. Times are numeric seconds or strings such as `0.25s` and `250ms`, not SMPTE timecode. The compiler stores microseconds internally, but callers send seconds.

## Select the authoring layer

| Field | Purpose and constraints |
| --- | --- |
| `version` | 1 = explicit timeline/sequence; 2 = preferred staged recipe authoring; 3 = required for `montage`. Staged fields are also accepted in explicitly versioned 1/3 documents; do not rewrite an existing version needlessly. |
| `mode` | `assemble` builds tracks/sequence. `modify` needs a real `snapshot` with nonempty `revision`; modify must not also supply `tracks`, `sequence` or `audio`. |
| `catalogVersion`, `compilerVersion` | Optional **string** compatibility pins, unlike numeric `version`. Omit unless needed; otherwise quote the deployed values (for example `'1'`, never numeric `1`). Read deployed values; do not invent or increment them. |
| `revision` | Compiler-produced document identity, not the project-save version. Preserve/refresh through compilation; do not fabricate a live revision. |
| `instanceId` | Stable namespace for generated sequence IDs (default `sequence`). Keep it stable across edits and retries. |
| `inputs` | Named slots: `kind: video|image|audio`, optional `multiple` and `optional` booleans. Required slots need matching bindings. |
| `sequence` | Uniform ordered video/image assembly. `use` names a slot, `order: input|reverse`; `each` applies one treatment per binding. |
| `tracks` | Explicit stable IDs/timing for nonuniform clips, layers and selected transitions. Types are `video` and `audio`, not `image` or `scene`. |
| `montage` | Version 3: restructure targeted existing video clips using complete source ranges/candidates. Read the montage section below. |
| `overrides` | Patch a known clip ID: `target`, optional `start`, `from`, `duration`, `rate`, `volume`, `opacity`, `fadeIn`, `fadeOut`, `transform`, `keyframes`, `look`, `motion`. |
| `commands` | Typed edits with selectors and per-command operands; see topic `commands`. |
| `rules` | Reusable selectors with unique `id`, `target` and `apply.look`, `apply.motion` or `apply.effect`. Rules target video/image clips and must match actual unlocked clips. |
| `effects` | Timed video-track effect blocks with real preset IDs and parameters; see `effects`. |
| `transitions` | Explicit adjacent same-track video pairs with matching overlap; see `transitions`. |
| `texts` | Ordinary titles, labels or verified captions. See `text`; typography fields are flattened directly onto each text item. |
| `audio` | Slot-bound audio tracks, source trim, fit, repeat and percent volume. See `audio`. |
| `jobs` | Legacy un-staged generation declarations. Placement uses an existing `trackId`; prefer staged fields for new generation recipes. |
| `before` | Image, speech, scene generation/edit jobs executed before timeline compilation. |
| `placements` | Reference a `before` job and put its result on `{type: video|audio, role: ...}` at `start`, optional `duration`, optional video `transform`. |
| `after` | Currently only `captions.generate`, after the resolved timeline/audio exists. |
| `output` | Aspect `landscape|portrait|classic` (aliases `16:9|9:16|4:3` normalize); fit `contain|cover`; resolution `480p|720p|1080p|2k|4k`; integer fps 1–120; format `mp4|avi|mp3`; quality `low|normal|high`. Defaults: landscape/contain/1080p/30/mp4/normal. Scene generation has narrower dimensions/fps limits. |

`output.fit: contain` preserves the whole source image with bars when needed (the backwards-compatible default). `output.fit: cover` fills the frame without squeezing or shrinking the whole image to fit: it preserves proportions and center-crops the excess. For landscape footage in portrait output, the left and right sides are cropped. Example: `output: {aspect: portrait, resolution: 1080p, fit: cover}`. This applies consistently to visual clips, images and live scenes, including transitions and alpha masks, in browser previews and local/server exports. Text/captions keep their output-aspect layout. Do not confuse this with audio `fit: sequence|source` or transition overlap `policy: shrink`.

For narrated edits, use a separate **timing-first** submission: speech/audio placement plus requested `after` captions, without image/scene jobs. All `before` jobs run before `after` in one request; a single all-in-one recipe cannot first expose caption timings to the host for visual planning. Wait for completion and retrieve the resolved YAML before adding timed visuals. Preserve materialized job IDs/results, texts and assets; normalization may move staged jobs into `jobs`. Adding visuals needs an edited composition, not unchanged `sourceJobId`. Read topic `jobs` and examples `narration-timing` then `narrated-documentary`.

Existing captions are **read-only unless the user explicitly requests a caption change**. Preserve complete caption entries: exact `texts[].text`/`words[].text` including spaces and line breaks, grouping/order, IDs/`resultTextIds`, source anchors, timings and all layout, animation/highlighting/effects values. Do not reword, trim, split/merge/reflow, reposition or restyle them when adding visuals or repairing unrelated fields. Existing caption configuration wins over style/profile/`captionMaxWords` defaults; four-word/two-line defaults apply only to NEW caption generation. The renderer handles fitting/wrapping/collision avoidance; adapt new scene labels around captions instead. Read topic `text` for the narrowly scoped encoding-repair exception. This is not a new YAML lock flag.

## Assets, bindings and snapshots

An asset identifies `{id, file, version, kind, duration, width?, height?, hasAudio?, local?}`. Obtain real metadata/version from `get_asset_metadata`; never reuse `example-only` fixture versions in a real request. Bind slots to IDs, with matching kinds and cardinality. Using filenames as IDs is convenient but does not remove the need for source metadata in standalone validation/compilation. Rendering resolves existing uploaded filenames. `local` is an internal asset flag, not permission for MCP to read a caller's local path.

`snapshot` has `{revision, tracks, effects, transitions, textItems, selectedIds}` and captures the **compiler timeline**. `get_project` returns editor state, not automatically a ready compiler snapshot; obtain/construct an appropriate current snapshot rather than treating `state.timeline` as this object verbatim. `save_project` takes full editor state and its numeric current project `version`, never raw recipe YAML. `preparedText` is renderer-produced text preparation; do not fabricate its hashes/images.

A project is the saved **editable timeline and its source assets**, not a recipe download. Successful generation and final rendering publish their resolved composition into that owned project's editor state when it is empty/media-only or still matches the untouched previous preparation. Tracks/clips, narration, exact captions and resolved job IDs, effects, transitions, output settings and pinned assets are retained. Manual edits (including intentionally cleared documents) are not silently replaced; **Open prepared timeline / Open rendered timeline** in Projects explicitly restores a retained edit with confirmation and keeps the project's media. `get_project` also repairs legacy media-only states from retained snapshots without paid work. Check the saved project after production; a local `.edit.yaml` checkpoint alone is not project delivery. Free validation/compilation is not a save operation, and no recipe file substitutes for the editor timeline.

## Sequence and clips

`sequence.each`: `take: {from, duration}`; duration is **timeline** duration. A rate of 2 consumes twice that much source. `rate` is 0.25–4. `source_audio` is `keep|remove` (default keep). `volume` is 0–200 **percent**, not 0–1 gain. `look` and `motion` are exact catalog IDs. A clip must have at least 100ms timeline time and fit the real source (images can be held without a finite source duration).

Sequence track IDs are `<instanceId>/video` and, when needed, `<instanceId>/source-audio`. A generated clip ID is `<instanceId>/<slot>/<assetId>/<occurrence>`. Inspect compilation before targeting these IDs. `sequence.between` is optional: omit it for cuts. It takes `{preset, duration, policy: error|shrink}`; there is no sequence `random` field.

Explicit `tracks[]`: `{id, name?, type, muted?, hidden?, locked?, clips}`. Each clip uses `{id, assetId, start, inPoint, outPoint, playbackRate?, volume?, linkedClipId?, transform?, transformKeyframes?, opacity?, fadeIn?, fadeOut?, look?, motion?, layerEntrance?, layerExit?, provenance?}`. `start` is timeline time; `inPoint/outPoint` are source times. Timeline duration is `(outPoint-inPoint)/playbackRate`. Do not invent links/provenance; preserve real reciprocal aligned audio links. `layerEntrance/layerExit` are opaque strings in the model, not an independently advertised preset contract: use documented capabilities, not guessed CSS animations.

To place a clip for timeline duration `D`, set `outPoint = inPoint + D * playbackRate`, **not** `start + D`. For an image with `inPoint: 0` and `playbackRate: 1`, `outPoint` is its hold duration regardless of `start`. Example: `start: 2.8, inPoint: 0, outPoint: 4.77` ends at `7.57`; the next clip at `7.22` overlaps by `0.35`. Setting `outPoint: 7.57` instead would end at `10.37`. Do not blame floating-point drift for this source/timeline mix-up: the compiler compares integer microseconds.

`transform`: zoomX/zoomY 0.01–40, linkZoom (equal axes if true), positionX/positionY -100–100 (editor-relative percentages), rotation -180–180 degrees, anchorX/anchorY 0–1, pitch/yaw -90–90 degrees, flipH/flipV booleans. `transformKeyframes[]` is `{time, transform}` with strictly increasing **clip-local** times within the clip. Do not confuse these positions with text pixel coordinates.

## Pre-submit checks

- Edit the existing resolved `.edit.yaml` with normal workspace tools. Preserve successful assets, speech/caption results and unrelated fields; do not reconstruct the whole document to repair one field.
- Compare complete caption entries and `resultTextIds` against the resolved baseline before submission; undo unintended caption changes. Preserve YAML string values, including spaces and line breaks, when choosing scalar quoting/block syntax. A successful validation/compile does not prove that captions were preserved.
- Write valid YAML directly or use an existing YAML serializer. Do not write an ad-hoc JSON-to-YAML emitter. `tracks`, each track's `clips`, `transitions`, `texts`, caption `words` and `assets` are lists: use `- ` entries or `[...]`, not repeated mapping keys. Keep numeric `version` distinct from quoted string compatibility pins.
- For every explicit transition compute `leftEnd = left.start + (left.outPoint - left.inPoint) / left.playbackRate` and require `leftEnd - right.start == transition.duration` at microsecond precision; also obey the duration bounds and no-triple-overlap rule in topic `transitions`.
- Submit the exact complete YAML string to `validate_recipe` after every edit, including after generation adds visuals. It checks timeline geometry when bindings/assets/jobs are resolved, without paid generation or rendering. Pending requirements mean geometry is not yet fully checked: resolve them and validate again. Use `compile_recipe` to inspect the normalized editing plan and duration. A successful transport response alone is not validation success: inspect `statusCode`, error diagnostics and requirements.
- Before final `render_video`, require no error diagnostics and no unresolved requirements for that same YAML. Any edit invalidates the previous check. Never use a paid render as a syntax, type, overlap or timing test.

## Montage version 3

`target: {kind: video, ids?, trackId?, position?, index?, selected?}` must match unlocked video clips on one track and include intervening clips. Supply **either** `ranges: [{clipId, from, to}]` or scored `candidates` with score 0–100. `from/to` are source positions inside the targeted clips; ranges must not overlap. Candidates require `targetDuration`; `tolerance` bounds whole-moment selection, not arbitrary truncation of speech. Maximum range count comes from the deployed compiler limits/reference.

`between` takes `duration`, optional `policy: error|shrink` and **exactly one** of `preset` or `random: true`. `motion` similarly chooses an exact preset or `random: true`; the only supported random motion `family` is `zoom`. `seed` makes random choices deterministic; explicit IDs are preferable when the brief calls for a specific style. No `random` flags belong on ordinary effects, sequence treatments or text.

Compilation remaps montage attachments, applies overrides/commands/rules and expands looks/motions. It can normalize the result into explicit tracks and merge resolved staged jobs. Save the returned resolved document/assets when reusing generated work; do not paste a stale unmaterialized recipe over it.
