# Generation actions and scene direction

For MCP use **current-client scene authoring**: read `get_editing_reference(topic=scene-authoring)`, write Svelte with the AI already connected in the client, and call `compile_scene`. Source compilation, scene frames and final video encoding use the user's hardware without machinal billing. Approved images, speech and captions/transcription may charge the user's own OpenRouter account. A saved live source is not an encoded scene video. Obtain source permission and provider spending consent; no machinal credit lookup exists locally. Catalog support does not prove runtime/provider health.

The `scene.generate`/`scene.edit` job contracts and examples below document the shared **site/server-model compatibility** path, not the current MCP submission path. MCP rejects pending server scene jobs without fallback; reuse materialized results or place the asset returned by `compile_scene` in ordinary video tracks. See example `client-scene`. Source edits use `get_scene_source` then `compile_scene(sourceFile=...)`, preserving attachments. The current client repairs diagnostics without a server model. Server video/scene rendering still requires explicit authorization to use sources and spend credits.

## Plan animated scenes proactively

Use `get_editing_reference(topic=production)` for the director/builder/critic workflow: define observable success in a production contract, critique it before writing source, then compare the implementation with `compile_recipe.editorialReview` before final rendering. This changes the harness, not scene-engine. Subject specificity and meaningful independent action are quality criteria, not a quota of shapes/effects. Keep scene-internal choreography distinct from recipe-level transitions and do not mistake compile/layout success for visual approval.

Before choosing a visual medium for a new video, read `get_editing_reference(topic=brief)` and resolve missing type, duration, aspect/output resolution, style/materials and audio choices with the user. Use the host's native question tool (OpenCode: `question`) with one `questions` array, not a numbered chat questionnaire; use an unnumbered fallback only if no interactive tool exists. In that form, recommend 1–2 relevant options such as an existing photo, a newly generated image, an animated scene or an image inside a scene, and explain the benefit. After the user answers, summarize the direction briefly and proceed immediately with the authorized work in the same turn, without a separate plan confirmation. Include known permissions as separate explicit questions in the same form where possible; never infer consent from a cancelled form or a creative preference. Respect already-specified choices and “you decide” delegation; do not ask the same questions for each beat. Do not automatically add production labels to scenes/captions or repeat them in chat. Keep generated media truthful and agree once on any requested or specifically required disclosure.

The MCP creates the same **animated Svelte components** as the editor. The host agent writes both the art direction and the actual Svelte source, sends it through `compile_scene`, and receives a pinned live `.scene.json` asset. Server export materializes it through scene-engine without another scene-model call. It is not an alias for image generation. `component` is a compile_scene tool field, not an inline recipe field.

When planning a video, evaluate **footage, still image, ordinary text and animated scene** per meaningful beat, without waiting for the user to explicitly request a scene. Make a compact beat sheet: timeline start/duration, message, visual choice, source/attachment and why motion helps. Look for:

- A process or cause/effect explanation: independently moving objects, arrows and successive states.
- A product/image reveal: use an actual uploaded image inside an animated layout, with independent labels or objects rather than baking everything into a still.
- A comparison, relationship, journey or supplied numeric progression: motion should explain the change, not manufacture data.
- An illustrative cutaway that makes narration clearer, with a readable hold and a deliberate return to footage.

Use the supplied script/copy, verified narration/cue times or sources actually inspected with approval. Metadata alone is not visual inspection and the reference tool does not watch/transcribe a video. If content/timings are unknown, ask for the relevant content or obtain it with the client's available approved inspection tools; mark proposed beat times as provisional. Never invent what happens at a source timestamp.

A pan/zoom over a still moves the entire image; it does not animate separate objects or embed a real image in an independently changing layout. Write Svelte in the current client and use `compile_scene` for those needs instead of defaulting every visual to `image.generate`. Do not silently replace requested animation with a slideshow. Reuse existing footage/text when equally effective, preserve footage-only/no-generation requests, and never impose a scene quota or generate images merely to demonstrate a capability. An unavailable compiler requires an explanation and user agreement before substituting another medium, never a server-model fallback.

For each selected scene, specify purpose, exact supplied copy, objects and hierarchy, real image IDs, palette, layout/safe areas and **scene-local choreography**: which object moves, direction/path, entrance time, reveal/change, readable hold and exit. Distinguish scene-local prompt times from the placement's global timeline time. Tie motion to a real communication need, avoid wall-clock animation and request frame-derived Svelte scene-runtime animation. For 3D, describe procedural geometry/camera in the prompt rather than inventing DSL fields. The backend, not the MCP client, owns compilation and sandbox execution.

Do not compress the scene brief to 'cinematic CSS', a generic heading or the documentary title. Name the visible subject and action, foreground/midground/background, material/light treatment, palette, scale, exact copy and what changes over the scene. A rich scene is a coherent piece of visual storytelling, not a count of shapes or effects; respect a deliberately minimal brief. For a spatial subject or an explicit Three.js request use `visualMode: 3d` and describe genuine meshes, lighting, camera target/path and deterministic mesh action. CSS perspective and a copied rotating demo primitive are not substitutes. For complex illustrative subjects, attach approved images and animate the subject, supporting diagram and labels independently rather than using a text-only card.

Visibility is part of the brief: keep the main subject legible during the central hold and most of the shot, not permanently at opacity 0, behind a backdrop, clipped offscreen or outside a Three.js camera. Specify separate reveal/hold/exit timing and sane contrast. Repairs preserve the artwork, motion and attachments rather than deleting complexity to pass compilation. No AI-production label, disclaimer or watermark belongs on screen: do not add 'AI illustration', 'AI-generated', 'Ilustrație AI', 'Generat cu AI' or 'Narațiune sintetică' to scene text, image prompts, CSS/SVG/canvas or textures. Explanations/provenance stay outside the video. Subject copy genuinely about artificial intelligence is different from an unsolicited production notice.

For example, a proposed 16-second edit could retain footage at 0–4s, insert a six-second animated explanation at 4–10s, and return to footage at 10–16s. A six-second scene brief can introduce a real image at local 0–1s, move objects/reveal labels at 1–3s, hold at 3–5s and settle at 5–6s. These are illustrative planning times, not observations about the user's media. Fetch `get_editing_reference(topic: examples, id: scene-image-insert)` for the complete compiler-tested YAML, including real-field image attachments and placements.

Fetch `scene-generation` for a more detailed portrait SVG storyboard, or `scene-three-explainer` for a complete procedural Three.js mechanism brief with staged assembly, linked mesh action, a camera orbit and stable final hold. They are synthetic pending-generation examples, not generated media or promises of visual quality; reading/compiling them does not call providers or authorize spending.

## Complex scene assets: images and transparency by default

When a character, animal, plant, realistic product, detailed object, texture or illustration would not read well as procedural SVG/CSS, **default to an image-backed animated scene**. Reuse an approved suitable image first; otherwise plan `image.generate` within approved generation/spending scope, without waiting for an explicit image request. Do not force intricate subjects into fragile shape stacks or replace them with generic headings. Keep SVG/CSS for simple diagrams and genuine SceneThree geometry for spatial action. Images complement independent motion, not a slideshow replacement. Explicit no-generation, footage-only and `imagePolicy: procedural-only` choices override this default.

### Visual coverage across the video

Make the same choice when SVG/CSS would be **overly simplistic**, not just technically difficult. A history/biography mini-documentary needs subject-specific contextual views, not one reused portrait plus text, lines and nodes. Cover relevant people, geographic context, environments and period-grounded illustrative scenes using verified narration/copy; do not invent historical events or present generated images as archival evidence. Simple, geographically accurate map diagrams remain useful alongside illustrations.

Keep a compact image-coverage list with the measured beat, narrative purpose, suitable approved existing asset or proposed new image, and destination scene. For example, a biography may need a portrait, a place-setting view, an illustrative historical environment and a relevant later-life context. These are coverage roles, not invented facts or a compulsory shot list. Reframing/recoloring one portrait does not add a distinct contextual view.

**5–10 distinct images per video can be appropriate**, neither a quota nor a cap. The **four-image attachment limit is per scene, not per video**: distribute images across `compile_scene` calls or ordinary image clips according to the approved presentation. Reuse suitable successful images, but do not collapse distinct narrative contexts into a simplistic infographic solely to make the video cheap. Respect the approved budget and generation scope; if needed coverage exceeds permission or a hard spending cap, explain the tradeoff and ask rather than silently downgrading or overspending. Minimal/no-generation/procedural-only briefs still win. This visual-source decision does not authorize changing narration, captions, pacing or transitions.

### Select the tool for the missing capability

`image.generate` is a **YAML job type, not an MCP tool**. The current client selects tools; the free `suggest_tools` catalog and optional host routing only assist selection, never execute actions or grant consent.

| Need/current stage | Actual MCP tool and boundary |
| --- | --- |
| Decide whether SVG/CSS is too complex or overly simplistic | `get_editing_reference(topic=scenes)` and `get_capabilities`; plan meaningful image coverage within approval. |
| Create missing artwork | `generate_assets` with approved `image.generate` jobs in validated YAML, after the separate timing-first checkpoint when narrated. Do not rerun successful speech/captions. |
| Materialize and reuse generated images | `wait_for_job` until completed, then `get_job_result` for actual filenames, assets and resolved recipe; no guessed filenames or regeneration. |
| Compose/animate approved images | `compile_scene` with client-authored Svelte and up to four images per scene; compilation does not generate artwork or render a video. |
| Inspect an approved scene's actual frames | `get_scene_source` for its version, then bounded `inspect_scene`; not final-composition or audio inspection. |
| Export the resolved, reviewed composition | `validate_recipe`, `compile_recipe`, then approved paid `render_video`; not a way to discover missing artwork or timing. |

Choose only the relevant stage and prerequisites, not every tool on each beat. Keep existing successful assets and normal media/spending approvals; a routing recommendation is not authorization.

For **isolated foreground subjects, sprites, cutouts and independently composited layers**, default to **`background: transparent`** on `image.generate`. Use **`openai/gpt-image-2.5-sunburst`** unless the user selected another compatible model; **`openai/gpt-image-2.5-flare`** also supports transparent backgrounds. Respect explicit model choices; do not silently substitute an incompatible model. Request a complete isolated subject, clean edges and real alpha, with no painted checkerboard, solid backdrop, frame or baked-in labels. Use `background: opaque` for full-frame environments and images whose background is part of the story; not every image should be transparent.

Example image job fragment (not a complete recipe or permission to spend):

```yaml
before:
  - id: foreground-subject
    type: image.generate
    model: openai/gpt-image-2.5-sunburst
    aspect: '1:1'
    background: transparent
    prompt: >-
      A complete oak sapling with detailed leaves and exposed roots,
      isolated on a transparent background with real alpha and clean edges.
      No painted checkerboard, solid backdrop, frame, text or labels.
```

After the timing-first checkpoint when applicable, generate the approved image, wait for completion and attach its actual returned filename to `compile_scene.images`. The image job field is `background`, not `transparent: true`; `compile_scene.transparent` controls the scene canvas separately and does not remove an opaque image background. Preserve PNG/WebP alpha; do not flatten onto a solid background or convert cutouts to JPEG. Use separate approved images for independently moving subjects/layers, within the four-image attachment limit; moving one bitmap does not articulate its internal parts or reconstruct 3D.

A transparency request alone does not verify returned alpha. Do not claim verification from a filename, metadata or a JPEG diagnostic thumbnail. If alpha is missing or unverified, report that limitation; do not automatically regenerate a paid asset or install local background-removal pipelines. Reuse existing scope approvals rather than reconfirming each covered asset; this default does not grant media access, paid generation or rendering permission.

## Integrate images; raise the visual ambition

Image sourcing and presentation are separate choices. “Use/find/generate images for this video” is not an instruction to exclude scenes. If presentation is undecided, ask once in the native brief form whether approved images may be integrated into animated Svelte scenes, optionally with genuine Three.js where it adds spatial meaning. Recommend a concrete subject-specific treatment versus a photo-only montage; explain the additional scene-frame rendering cost separately from image generation and final encoding. Reuse an answered choice or “you decide” delegation, preserve explicit still-only/no-scenes/no-generation choices, and do not expand standalone image searches into video work. Image-search/download/use still requires the appropriate permissions and actually available tools; do not invent a search provider or rights to a found image.

Treat a selected image as a scene attachment and visual anchor, not a reason to abandon animation. Preserve its proportions, identity and key details. Compose independently animated frames, labels, diagram elements or other approved images around it, and match palette, framing and movement to the neighboring footage/scenes. Moving a full flat image is not internal subject animation or recovered 3D geometry. Do not claim parallax-separated subjects, hidden surfaces or a realistic 3D reconstruction without actual layers/assets. New generated layers or artwork need their own approval.

For expressive/bold briefs, design a **signature visual action** at a meaningful beat: what the viewer sees change, why it expresses this subject, how the action builds, and where it settles into a readable hold. This is a design criterion, not a scene quota. Avoid a sequence of identical centered cards, headings and zooms. Use stronger subject-specific staging, depth, lighting, asymmetric compositions and contrasting motion speeds rather than covering generic content in particles, glow or camera shake. Minimal briefs remain deliberately quiet.

Choose the medium by what actually moves:

- **2D/Svelte:** editorial image collage, framed image reveals, independently moving labels, relationship diagrams and comparison layouts. Useful depth cues do not require 3D.
- **Three.js/SceneThree:** spatial assembly/disassembly, a mechanical relationship, scale/depth comparison, or a camera move that reveals genuinely different geometry. Proactively recommend it when helpful; do not wait for the user to name Three.js. Use actual meshes/materials/lights, a framed camera target/path and deterministic object action, not CSS perspective, a rotating cube or a flat photo mislabeled 3D. Check sceneMode and the live runtime first; do not promise unsupported image textures or postprocessing. For mixed image/3D scenes, approved images may remain a supported 2D layout alongside genuine spatial geometry.

These are illustrative storyboards, not preset IDs or permission to render:

| Subject/intent | Image integration and signature action | Continuity/hold |
| --- | --- | --- |
| Biography/history from verified material | Use distinct approved portrait, geographic/environmental and period-grounded illustrative images for the relevant measured beats; animate image layers and short factual labels independently. Document cards can support the story, not substitute for all historical context. | Match neighboring frames/palette; preserve readable viewing holds. No invented depth inside a portrait or generated image presented as archival evidence. |
| Product/process | A genuine 3D mechanism separates into functional parts, then linked parts engage; an approved product image and independently revealed labels provide context. | Camera moves to reveal the relationship, then holds the working assembly. Do not invent product internals or capabilities; use an explicitly schematic mechanism when appropriate. |
| Comparison/explanation | Two approved images enter separate aligned panels; relevant diagram elements move between supplied states while a restrained focus accent directs attention. | Match scale and alignment; hold the result and carry a panel edge/direction into the next shot. No invented data. |

Add to the beat sheet the signature action, independent moving elements, 2D/3D rationale, entrance/action/hold/exit cues and adjacent-shot continuity. For narrated work, finalize all times from the measured timing checkpoint, not these illustrative descriptions. Write the complete Svelte source in the current client and compile it; none of these planning labels are YAML fields.

Coordinate an **effect score** with topic `effects`: selected clip/track accents, exact catalog IDs/params, supported ramps and junction timing. Implement them on the real resolved tracks instead of stopping at a prose plan or removing them during staging. Check for duplicate grading/texture, label blur and excessive motion; scene lighting is not an excuse to indiscriminately stack a global glow. Do not add unapproved image/provider actions or paid preview/re-render loops to increase spectacle.

Before export, review source choreography and available Directional diagnostics for reveal, action, central hold and exit: is the actual subject visible, does something meaningful change independently, is there contrast in pace, and do neighboring shots feel related? Inspect representative frames/output only with deployed tools and within approved processing/access/spending scope. Compilation/layout success does not prove visual ambition or quality; state when visual inspection is unavailable rather than claiming a verified spectacular result. Repairs preserve artwork, motion and approved attachments; never downgrade to a static title card merely to pass checks.

## Legacy site/server-model job contracts

Read `get_workflow_preferences` and `get_editing_reference(topic: scene-runtime)` before choosing a treatment. The runtime contract supplies exact embedded font families, image bindings, imports and a genuine Three.js starter. For MCP, `sceneMode: 3d` becomes `visualMode: 3d` on compile_scene, and the current client writes the component. The following job-specific prompt fields describe legacy site generation, not pending MCP scene work.

For complex characters, animals, realistic objects, textures and artwork, prefer actual images over fragile stacks of CSS/SVG shapes. Keep the image visible and animate its wrapper and other objects independently. Obtain spending approval for a new image; current-client scene code and compilation are free. Preserve `imagePolicy: procedural-only`, explicit no-generation and footage-only briefs.

All jobs use a unique `id` and exact `type`. Prefer `before` + `placements` + `after` for new staged recipes. Legacy `jobs` remains supported, with `trackId` referencing an already declared track and explicit `start`/`duration` when placing results. `start: 0` on a legacy job with an occupied track is treated as append-to-track; staged placements make zero unambiguous.

| Type | Stage | Inputs and results |
| --- | --- | --- |
| `image.generate` | before or legacy jobs | Required `prompt`; optional configured `model`, `aspect`, `background`, `imageStyle`. Use `background: transparent` for isolated composited subjects with GPT Image 2.5 Sunburst/Flare; use `opaque` when the background belongs in the image. `imageStyle` is appended prompt text, not a catalog look or nested CSS. The orchestration passes `background` through to the configured image service; a request is not verification of returned alpha. Returns `resultAssetId`. |
| `speech.generate` | before or legacy jobs | Required `text` (legacy `input` fallback); `language: ro`/`en` for the spoken language; optional `instructions`, configured `model`, `voice`, `referenceName`, `referenceTranscript`. A reference is an uploaded project filename; never fabricate a speaker identity/consent or provider voice ID. Returned speech duration is measured, not predicted. |
| `scene.generate` | before or legacy jobs | Required `prompt`; duration 1–60s, or omit it with `narrationJob` to use the measured speech duration. Optional `text` is exact on-screen copy; `narrationJob` references an earlier before speech job, and `narrationFrom` selects source-audio seconds. Optional `aspect`, dimensions, `fps`, model, images and visualMode. Creates one live animated Svelte scene with relevant content, not an unrelated title card. |
| `scene.edit` | before or legacy jobs | Same duration/dimensions limits; required `assetId` of an existing server `.scene.json` video asset and edit `prompt`. Preserve existing media/narration. Do not pass new `images` on an edit. |
| `captions.generate` | after or legacy jobs | Real audio-bearing timeline, optional `assetId`, `language`, `maxWords`, caption TextStyle `style`; returns actual `resultTextIds` and text items. Read topic `text`. |
| `analysis.transcribe` | legacy jobs only | Recognized requirement type for transcription; do not promise that the existing orchestration materializes it into caption text automatically. Prefer `captions.generate` for automatic on-video captions. |

`resultAssetId`, `resultAudioAssetId`, `audioStart`, `resultTextIds` are returned/materialized state, not placeholders to invent to bypass a requirement. Preserve them together with actual assets/texts to avoid regeneration. `assetId` on a caption job selects source audio; on a scene edit it selects the existing live scene. They do not have the same meaning as `resultAssetId`.

## Placements and materialization

```yaml
before:
  - id: opener
    type: scene.generate
    duration: 6s
    aspect: portrait
    fps: 30
    prompt: >-
      A clean editorial infographic, portrait framing. Show the user-supplied
      three-step process as a vertical progression. Use restrained cobalt
      and white, readable type, a short entrance, a stable reading hold,
      and a quiet exit. Do not invent statistics or include external media.
placements:
  - job: opener
    track: {type: video, role: opener}
    start: 0s
    duration: 6s
```

Generated image/scene results go on a `video` role; speech on `audio`. The compiler creates `recipe/<type>/<role>` tracks and deterministic placement clip IDs. Images require at least 100ms explicit duration. For audio/video, omitted duration uses the job duration or actual asset duration; never exceed the generated asset duration. A placement `transform` only applies to video tracks. Source scene narration returned by the backend is linked automatically; do not duplicate it with another voice track.

Before generation, compilation returns requirements, **not a renderable composition**. Staged preflight can use an empty base timeline, but rules/effects/commands that target nonexistent future clips can still fail before provider calls. Safest workflow: generate only after approval; retain resolved assets/document; then add the desired look/transitions/effects/text to real tracks/IDs, validate and compile again before rendering. Never silently discard the intended final treatment to make the pending stage pass.

## Timing-first narration, captions and visuals

For narrated work use **separate submissions**, not a complete voice/image/scene/caption recipe submitted at once. Every `before` job runs before `after` captions in the same submission. Putting speech first in `before` therefore does **not** make measured captions available to subsequent visual jobs. Do not move captions into `before` or invent a dependency/stage field.

1. **Timing pass:** after checking credits and obtaining source-use/spending approval, call `generate_assets` with only the requested speech, its audio placement and requested `after: captions.generate`. No `image.generate`, `scene.generate` or `scene.edit` jobs belong in this first submission. Example `narration-timing` is an audio-only timing recipe, not a final video.
2. **Timing checkpoint:** use `wait_for_job` until `status=completed`, then read `get_job_result` once. Retain the resolved `recipeYaml`, measured audio asset duration, caption `texts`, cue-local `words`, `resultAssetId` and `resultTextIds`. If timing fails or is missing, stop dependent visuals and recover successful assets; never invent word times or start everything over.
3. **Visual pass:** only now finalize the beat sheet and image/2D/Three.js scene briefs. Derive global image holds, scene start/duration and local entrance/reveal/hold/exit times from the measured speech/caption boundaries. Caption word times are relative to their text item's start; `narrationFrom` is relative to source audio, while placements are global timeline times. Include gaps and narration placement offsets. Keep each image/prompt tied to its actual spoken excerpt, not just the video title.
4. Add approved visual jobs to the **returned resolved composition**, preserving audio tracks/assets, speech jobs, caption jobs and actual texts. Normalization may move materialized `before`/`after` jobs into `jobs`; do not recreate unmaterialized copies. `sourceJobId` replays an **unchanged** recipe, so adding visuals requires the edited `composition` YAML instead. Use a new stable idempotency key for this intentionally different operation. Example `narrated-documentary` demonstrates the second pass using explicitly synthetic resolved timing fixtures; never copy those fixtures into a real project.
5. Generate approved images before scenes that attach them, resolve/validate the completed visual pass, and then `render_video`. Preserve the same narration and captions rather than paying for them again. Retiming/replacing audio invalidates its old captions and dependent visual timings: resolve that change before generating/rendering dependent work. An already-approved workflow need not ask again for each covered stage; new provider actions or changed scope require approval.

### Narration overruns an approximate target: extend visuals, not speech work

A requested or AI-proposed runtime is approximate unless the user explicitly sets a hard duration cap. A planned 30-second video with 38–40 seconds of successful narration is valid: keep the successful audio/captions and extend the video to the measured narration end, including its placement offset. Do not regenerate, truncate or speed up narration solely to match the estimate; do not rewrite its script and pay for a second voice or rerun successful captions/images.

Lengthen suitable scene holds/actions or add relevant client-authored scenes within the approved visual scope. Recompile a scene whose source duration must grow; merely extending a placement beyond the pinned asset duration is invalid. Preserve attachments/artwork, keep each scene at most 60 seconds, update placements and transition overlaps, and validate continuous picture coverage through the full narration without a blank tail or audio cutoff. Keep actual caption words/timings unchanged when audio placement is unchanged. State the adjusted runtime and continue without reconfirmation within existing permissions. Resolve an explicit hard duration cap or spending limit before replacing paid narration or exceeding approval; a flexible runtime overrun alone is not failure or a reason to restart production.

Existing approved speech/captions can satisfy the timing checkpoint without regeneration. If TTS was not requested, use the approved existing audio and generate only requested captions. If captions were not requested, do not add paid transcription or on-screen subtitles unasked: use measured speech duration for whole-section scenes, and do not claim word-accurate timing. If neither narration nor captions is needed, skip the timing pass. Music-only or footage-only edits retain their existing workflow.

Bind `scene.generate.narrationJob` to an earlier `before` speech job or a materialized speech job retained in `jobs` from the timing pass. The backend gives the scene generator the actual spoken text and measured duration, without generating a duplicate voice track. A whole narration longer than 60 seconds must be split into meaningful sections. For a window of a longer narration, set `narrationFrom` plus `duration` only after captions with real word times have been materialized; missing cues fail instead of inventing a transcript. Exact scene-local cue times and narration content are passed to the component generator.

## Scene layout checks and recovery

New scene generation and edits are checked in a real browser at multiple representative frames before they are accepted. Off-canvas/clipped text, illegible font sizes, colliding text blocks, text in the reserved caption band, recognized visible AI-production notices and no detectable foreground across the sampled frames produce repair diagnostics. Canvas/WebGL sampling detects nonblank artwork, not its meaning. The existing single repair attempt is bounded; persistent failures are reported, not rendered as if successful. When the timeline contains captions, reserve its bottom 24% for them. This is geometry/visibility validation, not OCR or a guarantee that an arbitrary image is semantically correct or aesthetically successful.

After generation use `get_job_result` once for `recipeYaml`, or pass `sourceJobId` for unchanged continuation. Prefer `wait_for_job(timeoutSeconds:120)` to repeated progress lookups or local sleep loops; it ignores heartbeat revisions. Keep recipes as `.edit.yaml` and reuse resolved assets.

Compact job summaries may include `timing.remainingSeconds` (processing) or `timing.estimatedQueueSeconds` (before processing). Both are approximate, based on live progress or recent successful jobs, never a completion deadline or a cost quote. Missing timing means no supported estimate is available. Only `status: completed` authorizes delivery, never a progress percentage alone. Recover local jobs by project/job ID through MCP or the local API, and refresh the existing output's volume link without another render. There is no signed-in account `/jobs` page or S3 publication locally.

`stage.scope` distinguishes scene capture from whole-job video, caption, audio, encoding and publication phases. Terminal jobs omit active stage/ETA fields, including stale values from older snapshots. `performance` persists wall-clock phase durations and observed cache hits/misses; `truncated` discloses a capped phase history. These metrics identify bottlenecks but do not prove a speedup. Historical timing samples can be restored from scoped completed-job performance after worker restart. `timing.sampleCount`, `remainingRangeSeconds` and `estimateUnavailableReason` explain uncertainty; weighted progress is never used as a time fraction. With no supported history, keep the estimate unavailable instead of inventing one.

## Select a scene by communication need

- **Infographic/process:** explain a real relationship or sequence; specify hierarchy, truthful values, visual metaphor, entrance/hold/exit and readable labels. Good for tutorials, not unsupported statistics.
- **Product reveal:** use supplied product/brand images visibly, preserve logos/aspect/alpha, specify an intentional reveal and a stable benefit/call-to-action hold. Do not replace real product evidence with invented claims.
- **Comparison/split layout:** two aligned panels and consistent scales, synchronized changes, user-provided labels/data; do not claim a new YAML `splitScreen` or `scenePreset` field.
- **Map/journey/timeline:** use verified locations/events and a coherent path; no external map URLs or fabricated coordinates. Schematic illustration is acceptable when explicitly described as such.
- **Diagram/3D explainer:** use `visualMode: 3d` for genuine SceneThree geometry, lighting and deterministic camera/update; auto/2d are also supported. Read topic `scene-runtime`, rather than guessing a Three.js API. scene.edit preserves its existing mode. The DSL does **not** expose `transparent`, `videos`, `audioFile` or arbitrary component source. `text` is supported for exact on-screen copy on scene.generate; narration is a separate narrationJob binding.
- **Quiet title/quote:** prefer normal `texts` and existing footage if that communicates the same idea without paid scene generation.

These are **scene briefs**, not registered preset IDs. There is no document-level `scenes` array in this DSL; place `scene.generate`/`scene.edit` jobs correctly.

## Images, runtime and namespace limits

Scene `images` accepts at most four uploaded JPEG/PNG/WebP sources, with unique IDs `image_1` through `image_4`, `file`, human-readable `name`, optional `description` (up to 600 characters). Each input must be at most 5 MiB/40 million pixels. Metadata is not visual inspection. Scenes preserve real attachments; don't invent URLs or binary/base64 YAML payloads.

Describe how each attachment is used and animated: for example, keep `image_1` inside a product card while labels and schematic objects enter independently. Preserve the original image's proportions, existing alpha and truthful branding. Transparent image generation uses the existing `image.generate.background: transparent` field, not a new image-job `transparent` field or the scene-canvas setting. The uploaded image is supplied as a component prop by the backend, not fetched from an external URL. A scene can also be entirely procedural without an image-generation call.

For MCP asset preparation, a new image may charge the user's OpenRouter account: generate it with permission, wait for its actual project filename, then attach it with `file` to local source compilation through compile_scene. Subsequent scene frames and final encoding use local hardware without machinal billing. The legacy site/server-model path may make separate image and scene AI requests: image.generate before scene.generate can attach `{id: image_1, job: artwork-job, name: Subject}`. That legacy `job` dependency must reference an earlier image.generate; it is not a compile_scene field. Read example `scene-generated-image` only as server-model compatibility guidance, not permission to invoke that path. Never put a guessed job ID into `file` or invent resultAssetId placeholders. Keep resolved media for reuse.

On failure, inspect `result.recovery`: a resumable `{document, bindings, assets}` envelope retains successful prior outputs. Save it and resume missing stages after resolving the error; do not regenerate successful speech/images. Recovery does not grant unrelated media access or new spending permission.

The backend creates deterministic Svelte scene source using its existing renderer. Read `scene-runtime` for all embedded scene font families, supported image bindings and the exact SceneThree API; CSS family names are **not** recipe fontFamily IDs. SceneVideo look names are another namespace, not recipe look IDs or YAML job fields. Do not install libraries, access networks or introduce wall-clock animation as a workaround. The backend owns the component sandbox.
