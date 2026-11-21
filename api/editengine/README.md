# Video edit engine — DSL v1, v2 and v3

Timeline ↔ YAML/JSON → deterministic Go compilation → resolved composition → FFmpeg. **Recipe → Actions** offers forms for deferred image generation, speech, captions and ordinary text. Each image/voice action includes its generation settings and destination; adding or editing an action does not call AI. **Apply actions** executes the recipe as one undoable edit. **Code DSL** retains direct YAML editing. **Save YAML** saves the document, reusable definition, asset bindings, editable text and prepared PNG overlays in one `.edit.yaml` file. **Use timeline** captures the current project.

Saving a recipe with pending generation actions exports its instructions without calling AI. Once actions have been applied, saving prepares the editable text and PNG overlays for native replay/rendering.

## Packages

| Package | Responsibility |
|---|---|
| `document` | Public DSL types, strict YAML/JSON parser, schema, revision-checked patches, integer-microsecond time |
| `catalog` | Versioned shared effects, transitions, look recipes, motion curves and text presets |
| `compiler` | Validation, binding, selection, timing, look/motion expansion, effect segmentation, verification |
| `composition` | Resolved tracks, asset versions, effects, transitions, keyframes, materialized text and render segments |
| `text` | Prepared PNG overlays and validation against the text content, styles, timing and output dimensions |
| `render/ffmpeg` | Public adapter to the application's existing native renderer |

The compiler does not call AI, generate media, read files or require the editor. Rendering stages copies of referenced files and verifies their SHA-256 versions before encoding. The FFmpeg adapter currently reuses application-internal rendering packages; extraction into a separately distributed Go module is still pending.

## Run

Go 1.27.2 or newer, FFmpeg and ffprobe are required for native rendering. The browser prepares text using the existing Canvas rasterizer when saving/exporting, after loading the fonts. The saved YAML contains those PNGs as base64 with their positions, timing and animation settings. Rendering a saved project needs no browser, Node process, text server or installed fonts.

The repository-level `compose.editengine.yaml` builds the API service. It reads API configuration from the existing, untracked `api/.env`:

```sh
docker compose -f compose.editengine.yaml up --build
```

## Compile and render

Use `examples/reel.yaml` with three videos of at least 5 seconds and music of at least 13 seconds. Binding JSON:

```json
{"shots":["shot-a","shot-b","shot-c"],"music":["music"]}
```

Asset manifest entries contain actual metadata and immutable file fingerprints:

```json
{"id":"shot-a","file":"a.mp4","version":"sha256:<64 hex digits>","kind":"video","duration":12.5,"hasAudio":true}
```

`POST /compositions/assets` creates these entries from session files; the CLI expects a JSON array of entries. `duration` is in seconds; images have no finite source-window limit.

```sh
cd api
go run ./cmd/editengine -document editengine/examples/reel.yaml -assets assets.json -bindings bindings.json
go run ./cmd/editengine -document composition.edit.yaml -root /path/to/media -render
```

The CLI accepts both standalone recipes (with optional separate manifests/bindings) and complete saved YAML/JSON projects. It also accepts these on stdin with `-stdin`. Compilation prints the normalized document, composition, diagnostics, requirements and summary. Unmet requirements or errors produce a nonzero exit status. Rendering prints the generated filename and composition ID. Keep the referenced video/audio/image files in `-root`; the YAML embeds prepared text images, not the source media.

Recipes such as `examples/reel.yaml` contain editable text definitions. Apply and save them in the editor once to prepare text images before native rendering. Editing text, word timings, position, style, aspect or resolution invalidates those images; save/export in the editor regenerates them. Encoding-only changes (format, quality, FPS) reuse the saved images. MP3 export does not require text images.

## HTTP API

For Premium **application API keys**, the versioned project-scoped YAML→video route, S3 reuse, keyless local Docker and the `edit render recipe.yaml --root /media` command, see [YAML automation](../../docs/API_AUTOMATION.md). The versioned render job also prepares text automatically through the internal scene service; the legacy browser contract below remains compatible.

| Route | Contract |
|---|---|
| `GET /compositions/schema` | Structural JSON Schema |
| `GET /compositions/capabilities` | Catalog, compiler version, implemented commands and limits |
| `POST /compositions/validate` | Static recipe validation; asset binding is deferred |
| `POST /compositions/compile` | Full compile request below |
| `POST /compositions/compile-and-generate` | Executes pending image/speech/scene jobs and captions; generates before placement and captions after compiling the intermediate timeline; authenticated, owned session, paid access |
| `POST /compositions/assets` | `{ "files": [{"id":"shot-a","file":"a.mp4"}] }`; authenticated, owned session |
| `POST /renders` | Same compile request, including `preparedText` for video with text; also accepts a saved YAML project; returns HTTP 202 with job ID; existing authentication, paid-access and session ownership rules |
| `GET /renders/{id}` | Owned-session job status, progress, message and completed filename |
| `POST /ai/compositions` | `{ "instruction":"…", "project": <compile request> }`; AI emits compact document patches, then Go compiles |

```json
{
  "document": "version: 1\nmode: assemble\n…",
  "bindings": {"shots":["shot-a","shot-b","shot-c"]},
  "assets": [],
  "snapshot": {
    "revision":"captured-editor-revision",
    "tracks":[], "effects":[], "transitions":[], "textItems":[], "selectedIds":[]
  }
}
```

`document` accepts a YAML string or JSON object. Saved YAML projects wrap `document`, `bindings`, `assets` and optional `preparedText: {key, overlays}`. Compilation returns `composition.textRenderKey`; the browser associates its prepared overlays with that key. Text is editable in `document.texts`; FFmpeg receives `preparedText.overlays` through the same render-plan and text-overlay pipeline as the existing export route.

`assets` must contain the referenced manifest entries. `snapshot` is optional for assembly and required for `modify`; it is materialized when saving. Recipes are limited to 4 MiB, complete projects/requests to 128 MiB to accommodate text images. Compile and validate requests larger than 8 MiB require login. Bad syntax is HTTP 400; semantic failures are HTTP 422. Compile requirements are returned without a composition; renders reject requirements and missing/stale text images with HTTP 422. Downloads use the existing `/download?file=…&session=…` endpoint.

Render manifests retain the exact document and composition in the session volume. Two jobs execute concurrently; excess requests receive HTTP 429. Status survives an API restart while the session volume exists; interrupted jobs report failure instead of pretending to resume. Manifests follow session-volume retention, not permanent project storage.

## Semantics

### Frame fitting

The preview's **Fit / Fill (crop)** selector is a project setting, saved in YAML as `output.fit`. `contain` (the default for existing recipes/projects) shows the whole image with bars when needed. `cover` preserves proportions, fills the output frame and crops the excess symmetrically. For landscape footage in portrait output, this removes the left/right sides rather than shrinking the whole source into the narrow frame. The setting applies to video/image/live-scene layers, transitions and alpha masks in preview and local/server rendering; text keeps its output-aspect layout. AI Edit can explicitly request aspect/framing changes and otherwise preserves them.

```yaml
output: {aspect: portrait, resolution: 1080p, fit: cover}
```

Audio `fit: sequence|source` and transition overlap `policy: shrink` are unrelated settings.

### Timeline semantics

- One YAML document, known fields only, no duplicate keys, aliases, merge keys or null values. Syntax diagnostics include paths and positions where available.
- DSL/catalog/compiler versions are pinned in the normalized document. Unknown IDs and unsupported commands fail explicitly.
- Times accept numeric seconds or unit strings. Internal arithmetic uses integer microseconds. `take.from` is source time; `take.duration` is timeline time. Rates are 0.25–4; volume is 0–200 percent.
- Three 5-second clips with two 1-second transitions start at 0, 4 and 8 seconds and finish at 13 seconds. Source windows are preserved; no implicit handles are added.
- `between.policy` is `error` by default. Explicit `shrink` emits a warning with the actual adjusted duration. Overlap limits match the editor; transitions must be at least 100ms for the existing renderer.
- Clip IDs are stable within an instance: `instanceId/slot/assetId/occurrence`. Duration overrides participate before sequence timing. Recompilation replaces the derived composition and does not append duplicate elements.
- Selectors are captured before commands execute. Implemented selectors are ID lists, track filters, media kind, all/first/last/nth and snapshot selection. `nth` is 1-based.
- `transition.remove` preserves overlap as an explicit cross-dissolve. `closeGap: true` turns the junction into a cut by moving the following clips to remove the overlap.
- Effects retain insertion order. Source segments and ramp offsets are computed in Go. Look motion is expanded first, an explicit motion preset supersedes it, and explicit keyframes can be supplied through clip overrides.
- Full track documents retain transforms, compositing, links, text anchoring and word timing. Editor application bypasses geometry-adjusting mutation helpers, verifies its result, rejects stale revisions and rolls back atomically.
- Manual geometry changes to a sequence become stable clip overrides. Structural changes or explicit effect/transition changes materialize an explicit track document. Preserving every reusable sequence rule through structural UI changes remains future work.
- AI Edit captures every editor timeline as a DSL snapshot and sends a focused request to `/ai/compositions` (except standalone undo). The server returns a compact recipe, compiles it, and returns either the resolved document or pending generation requirements. The client materializes pending `before`/`after` jobs before applying the result as one undoable, revision-checked edit.

### Transcript-based montages (version 3)

`montage` targets unlocked video clips in a captured snapshot. Exact source-time `ranges` are hard selections; scored, nonoverlapping `candidates` let the compiler select complete moments within `targetDuration ± tolerance`, accounting for transition overlaps. Times are numeric **seconds**, or strings with explicit `s`/`ms` units. A requested 2-minute result is `120s`, never `0.002`. The compiler creates the clip IDs, synchronized linked audio, timeline positions and reproducible random transition/motion presets. It rejects infeasible durations or transitions instead of silently shortening an explicit request.

```yaml
version: 3
mode: modify
montage:
  target: {kind: video, ids: [clip-1]}
  candidates:
    - {clipId: clip-1, from: 100s, to: 142s, score: 90}
    - {clipId: clip-1, from: 300s, to: 342s, score: 80}
    - {clipId: clip-1, from: 650s, to: 690s, score: 75}
  targetDuration: 120s
  tolerance: 5s
  seed: stable-seed
  between: {random: true, duration: 2s, policy: error}
  motion: {random: true, family: zoom}
after:
  - {id: captions, type: captions.generate, input: montage, language: ro, maxWords: 4}
```

For AI highlights, transcription covers the targeted source windows. The server groups timestamped speech into candidate moments and gives the planner short IDs to rank, then expands those IDs into source times itself. This prevents invented clip IDs, incorrect units and cut boundaries. If the available speech cannot meet the duration/transition constraints, the plan is rejected before changing the editor. Caption generation runs after the intermediate montage is compiled and uses the timeline's actual word timestamps; transcription language is a recognition hint, not automatic translation of foreign speech.

## Captions and generation

### Reusable recipes (version 2)

Version 2 accepts `rules` targeting `video` or `image` clips with the existing `all`/`first`/`last`/`nth` selectors and optional `trackId`. A rule applies a catalog `look`, `motion`, or clip-owned `effect`. Later rules can specialize a particular clip after a shared rule. `mode: modify` resolves these against the captured timeline; no asset or clip IDs need to be copied into the recipe. The recipe editor offers templates and **Generalize timeline** to extract shared looks/effects and per-position exceptions.

`before` accepts `image.generate`, `speech.generate`, `scene.generate` and `scene.edit`. `placements` references their job ID with `job`, `track: {type: video|audio, role: ...}`, `start` and optionally `duration`. Duration defaults to the job's `duration`, then the generated asset's duration; images need a duration in either the job or placement. Video placements accept an optional `transform` with the same zoom, position and rotation fields as clips; omitted fields use identity defaults. `after` accepts `captions.generate` and transcribes the intermediate composition, including generated narration. Staged jobs are supported on existing DSL versions 1–3; adding an action preserves an explicitly supplied version. `POST /compositions/compile` remains pure and returns requirements for pending jobs; `/compositions/compile-and-generate` resolves those requirements and recompiles. Successful compilation returns an explicit, replayable document; saved YAML additionally carries an optional `recipe` with the original reusable rules. Replaying the document does not regenerate media; editing the recipe intentionally runs the generators again.

Scene jobs use `prompt` and `duration` (1–60 seconds), with optional `model`, `aspect` (`16:9`, `9:16`, `4:3`), paired even `width`/`height` (2–1920), and `fps` (1–60). Generation follows the project format by default and stores a live `.scene.json` component, rendering video only at export. `images` may contain up to four uploaded JPEG/PNG/WebP references (`id: image_1` through `image_4`, `file`, `name`, optional `description`). `scene.edit` additionally requires the existing live scene's `assetId`; it edits that component, keeps its format, embedded images and narration, and publishes a new immutable asset. Narration is placed as linked audio with its original source offset. An explicit placement duration may trim the generated scene.

```yaml
version: 1
mode: assemble
before:
  - {id: scene, type: scene.generate, prompt: 'A seed grows into a tree', duration: 8s}
  - {id: image, type: image.generate, prompt: 'A sunset', duration: 3s, aspect: '16:9'}
placements:
  - {job: scene, track: {type: video, role: scene}, start: 0s}
  - {job: image, track: {type: video, role: overlay}, start: 5s}
```

To edit a stored scene, use `before: [{id: revision, type: scene.edit, assetId: <existing-scene-asset-id>, prompt: 'Make the background warmer', duration: 8s}]` and a placement referring to `revision`. Include the original scene manifest entry in the project `assets`.

```yaml
version: 2
mode: modify
rules:
  - id: every-video
    target: {kind: video, position: all}
    apply: {effect: {preset: vignette}}
  - id: second-video
    target: {kind: video, position: nth, index: 2}
    apply: {look: warm-memory}
before:
  - {id: cover, type: image.generate, prompt: 'City at night', aspect: '16:9'}
placements:
  - {job: cover, track: {type: video, role: overlay}, start: 5, duration: 5}
after:
  - {id: captions, type: captions.generate, language: ro, maxWords: 4}
```

`texts[]` stores full `TextItem` JSON, including style, `sourceClipId` and cue-relative `words[]` times. A preset is resolved once into these explicit values and removed from the normalized text item. Active-word captions require actual timings; compilation does not distribute words uniformly.

`jobs[]` recognizes `captions.generate`, `analysis.transcribe`, `image.generate` and `speech.generate`. Unmaterialized jobs become requirements. The application supplies `resultAssetId` or `resultTextIds`; subsequent compilation reuses those results. `compiler.MaterializeCaptions` groups timestamped words without losing transcription gaps. Browser saving/export prepares the text images; native rendering only composites the saved overlays and never calls AI/transcription.

Jobs also carry YAML-only orchestration fields: `language` (`ro` or `auto` for captions), `prompt` (image description), `text`/`voice`/`model` (speech), `aspect` (image shape) and placement `trackId`/`start`/`duration` for generated media. When a job has `resultAssetId` plus `trackId`, the compiler appends a clip referencing it (images require an explicit `duration`; an unset `start` appends at the track end). `POST /compositions/compile-and-generate` executes pending jobs automatically — transcribing every timeline clip with audio (or only `assetId` when set) for captions, calling the image/TTS providers for `image.generate`/`speech.generate`, registering the files as versioned assets, materializing `texts`/`resultAssetId` and recompiling — so YAML alone drives captions, images and voice end to end.

The existing caption, image and speech UI can continue materializing data into the document-backed timeline. Automatic orchestration of arbitrary DSL generation requirements, cloning and resumable generation queues is not implemented.

## Coverage and next stages

Catalog coverage: 84 video effects, 76 transitions, 60 looks, 17 motions, 35 text presets. The compiler supports sequence assembly/reverse ordering, source audio, music fitting/repetition, stable overrides, explicit multi-track documents, materialized text, and the commands advertised by `/compositions/capabilities`.

The broader vocabulary in the synthesis is a roadmap, not a list of accepted commands. Remaining work includes advanced selector relationships/ranges, sequence distribute/fit/repeat/insert, rich split/duplicate with linked media and annotations, audio processing/ducking, preset-instance lifecycle policies, universal manual-edit-to-rule reconciliation, SRT import/export and fully independent native text rendering. Unsupported rich split/duplicate cases fail with actionable diagnostics.

## Verification

```sh
# api
go test ./...
# With FFmpeg and ffprobe available:
go test ./internal/core/editor/render -run TestHeadlessComposition -v

# client
pnpm run check
pnpm exec vitest run --maxWorkers=4
COMPOSITION_TEST_API=http://localhost:8080 pnpm exec playwright test e2e/composition-document.spec.ts
# Point COMPOSITION_TEST_CLI to a built cmd/editengine executable and put
# FFmpeg/ffprobe on PATH to also test saved YAML rendering after browser close.
```

The native integration renders 13-second and revised 11-second MP4s, checks audio/video duration, representative color frames and prepared overlay pixels, and asserts unchanged materialized text. Browser coverage checks timeline placement, YAML saving, manual trims and undo, plus styled multilingual text/caption round-tripping, image regeneration after edits and rendering saved YAML with the browser closed.
