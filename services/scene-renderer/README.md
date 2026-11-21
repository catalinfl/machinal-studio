# AI scenes in the main editor

This directory is the application's private adapter, not the scene-engine library. It installs `@machinal/scenes@0.1.1` from npm and uses its runtime, Svelte integration and included native renderer. Library development and releases live in [the separate repository](https://github.com/catalinfl/machinal-scenes). No library checkout, Go renderer build, `file:` dependency or external drive path is required to install, test or deploy this application.

The editor's **Generate scenes** button opens its own workbench dialog. The standalone studio remains an engine example; the main application uses the runtime/renderer through a private rendering service.

## Flow

1. Visual directions, optional exact on-screen text and duration create one scene. Scene design can be automatic, 2D motion graphics or genuine Three.js 3D. A voice upload or server audio source is transcribed through the existing STT integration and split into up to eight coherent ideas. The chosen duration is a target for voice scenes; phrase boundaries and complete narration coverage take precedence.
2. OpenRouter authors a complete Svelte 5 component plus separate user-facing design notes. Only isolated component source reaches the compiler; tool JSON, JSON text, standalone legacy Svelte and prose with one fenced `svelte` block are accepted. Multiple code blocks or incomplete fences are rejected. Frame-derived motion uses the scene runtime; cue and word timestamps supplied to the model are local to that scene.
3. `POST /compile` compiles the component and npm-installed runtime with Svelte/esbuild and returns a self-contained JavaScript bundle. Generation does not launch Chromium, FFmpeg or MP4 rendering. One compiler rejection can trigger a component repair; service transport failures do not trigger another AI turn. A prompt needs one AI component request; voice additionally needs transcription and idea planning.
4. The API saves the component, design notes, exact text, visual medium, compiled bundle, frame configuration, embedded original images/videos and original narration reference as `ai_scene_<job>_<index>.scene.json`, with request/cue provenance in its `.meta.json` companion. The asset fingerprint identifies this source file.
5. Each completed scene enters the media library. **Add scene to timeline** appends its live visual source and the appropriate original narration range as one undoable edit. The dialog uses a sandboxed Svelte iframe with playback/seek controls. The main preview seeks the same live component to clip-local time. Independent scene/image/video layers are browser-composited in channel order, with transforms and transparency; a transparent Pixi canvas supplies captions above them. Linear color effects and cross-dissolves stay browser-composited; spatial, temporal, LUT effects and other transitions use fast snapshots in the existing Pixi compositor.
6. Ordinary server export stages/fingerprints the source, materializes each referenced scene once through Chromium/FFmpeg, then passes the resulting temporary video into the normal composition renderer. Local export captures the live component into bounded frame batches and encodes them through the existing FFmpeg-WASM pipeline. Temporary scene videos are export work files, not replacements for timeline sources.

The generated component executes in an opaque-origin `sandbox="allow-scripts"` iframe, with network access denied by its CSP. It cannot access application storage or authenticated page objects. The host permits data-script resources so the self-contained bundle can load in this isolated iframe; inline scripts in the application stay restricted. Scene capture does not depend on a hidden iframe's animation frame, which browsers may suspend. Results remain while the dialog is closed; account changes reset generation state. Existing generated MP4 clips remain supported.

## Transparent overlays

**Scene output** offers **Full scene** (the default) and **Transparent overlay** before the brief. A prompt creates one isolated foreground effect, drawing or object; voice input retains the existing idea-splitting and original narration workflow. **Add overlay to timeline** creates a new highest video track at the current playhead, optionally linking the original voice range, as one undoable edit. Existing clips do not move; Full scene still appends at the end.

Send `transparent:true` to `POST /ai/scenes`. It reaches the AI instructions, compiler configuration and saved `source.config.transparent`; omitted/false retains full-scene behavior. Overlay instructions require genuinely empty pixels and partial alpha, without a backdrop or painted checkerboard. Editing through `sourceFile` inherits the saved transparency rather than changing it through the request; compiler repairs retain the same contract. The selected source controls Overlay metadata, preview and insertion wording independently of the current authoring dropdown. Its preview uses a themed checkerboard, which is not part of exported frames; the sandbox iframe uses `color-scheme:normal` to avoid UA white backing in a dark host.

Ordinary server export materializes each referenced scene source once. Transparent sources become temporary VP9/`yuva420p` WebM files; the private `/render` response uses `video/webm`. The composition renderer explicitly selects `libvpx-vp9` for both color and alpha-mask inputs, because FFmpeg's native VP9 decoder discards WebM alpha. Local export captures PNG alpha frames in bounded batches and encodes temporary `qtrle`/ARGB MOV sources before the existing color-plus-alpha-mask compositor. Full scenes retain their opaque export path. These files are export intermediates, not new downloadable source assets: **the final project MP4 remains an ordinary flattened composition, not a transparent MP4**.

Deploy/restart the updated API and scene service together, then reload the editor. The existing native renderer already supports transparent VP9 output. An older running backend does not implement the new transparency contract. No new environment variable is required.

## Configure and run

In `api/.env`, configure:

```dotenv
OPENROUTER_API_KEY=your-provider-key
OPENROUTER_SCENE_MODEL=your-code-capable-model
OPENROUTER_STT_MODEL=your-existing-transcription-model
```

`OPENROUTER_SCENE_MODEL` falls back to the existing `OPENROUTER_MODEL`. Existing `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER` and STT provider settings remain supported. Generation uses the application's existing account, paid-plan and owned-session checks.

From the repository root:

```sh
docker compose -f compose.editengine.yaml up --build
```

Compose builds the `service` Docker target, connects the API at `http://scene-renderer:8091`, and supplies a matching internal token. Its rendering port is not published. Set `SCENE_SERVICE_TOKEN` in the compose environment to override the local-development token. The service runs separately, with container memory/process/CPU limits, read-only filesystem and temporary working storage. Generated bundles have a restrictive CSP and no external media/network resources; allowed scene imports are Svelte, Three.js and the two scene packages. Inline SVG/Canvas/procedural imagery, 3D meshes/shaders and embedded video are supported.

The renderer mounts its dedicated `scene-render-work` disk volume at `/tmp`, separate from project media and the render cache. Do not replace it with a 1 GiB `tmpfs`: a supported lossless scene can itself approach 1 GiB, and Chromium's default `--disable-dev-shm-usage` also puts shared files there. Work directories are removed on normal completion/failure; abrupt container termination can leave temporary files in this volume. Progress/failure logs include available filesystem bytes/inodes, and native failures retain a bounded Chromium log tail without exposing it in HTTP responses. Apply storage/renderer changes with `docker compose -f compose.editengine.yaml up -d --build --no-deps scene-renderer` while no render is running; project media is not removed.

For native development, run `npm ci` in this directory, provision Chromium/FFmpeg, then run `npm start` with a private `SCENE_SERVICE_TOKEN`. `npm run setup` explicitly downloads the library's pinned rendering tools; `npm run doctor -- --json` reports their paths. Set `SCENE_BROWSER` and `SCENE_FFMPEG` to those paths or to your provisioned tools. The service resolves and verifies the native renderer through `@machinal/scenes/node`; `SCENE_RENDER_BIN` is an optional custom-binary override, not a required local build. Set `SCENE_SERVICE_URL=http://127.0.0.1:8091` and the matching token for the API. The API also needs native FFmpeg/ffprobe for STT, metadata and narration muxing.

New components may import `@machinal/scenes`, `@machinal/scenes/svelte` and `@machinal/scenes/runtime`. The compiler also maps the old `@direction/scene-svelte` and `@direction/scene-runtime` names to these entrypoints so existing saved scenes continue working. Generated components cannot import `/node` or private package files.

Current bounds: 1–60 seconds per requested scene, narration up to 180 seconds, 8 scenes per narration, even dimensions up to 1920px and up to 60fps. The dialog uses Full HD landscape/portrait/classic dimensions and the current project frame rate. Directions and exact text each allow 4,000 characters. Only one generation job runs at a time. Closing the dialog continues the job; **Stop generation** cancels it while retaining completed scenes.

## Readiness and native executable failures

The Docker build explicitly restores mode `0755` on the packaged Linux `scene-render` binary, then probes the native renderer, browser and FFmpeg as the non-root `scene` user. This is necessary because npm archives can preserve the native file as `0644`; `--ignore-scripts` does not repair it. The runtime filesystem stays read-only and the service does not grant itself extra privileges.

Authenticated `GET /health` probes all three executables instead of reporting ready merely because Node is listening. `/render` repeats this preflight before encoding. Known tool failures return HTTP 503 with an allowlisted `X-Scene-Error-Code`, including `scene_renderer_permission_denied` for `EACCES`. The API carries a safe actionable cause into the final failed job without exposing filesystem paths or raw subprocess stderr. Compilation/runtime/layout diagnostics remain separate HTTP 422 failures. Compiling Svelte does not prove that native encoding tools are executable or that the final video is visually correct.

For a previously built image with `EACCES`, apply the updated Dockerfile with `docker compose -f compose.editengine.yaml up -d --build --no-deps scene-renderer` while no render is active. Rebuild the API too to deploy its improved job diagnostics. No project volume needs removal and successful audio, captions, images and sources must be reused.

## Attached images and positioning

**Attach images** accepts up to four JPEG, PNG or WebP files per request, each up to 5 MiB and 40 million pixels. A retained thumbnail, filename, Remove action and optional usage direction belong to each attachment. For example: “Transparent product cutout, centered; zoom in slowly” or “Display this photograph inside the phone screen.” Image directions are limited to 600 characters. Closing/reopening retains the draft; removal or account change releases its preview URLs.

The client uploads each original under a collision-free filename. The API verifies image content and actual dimensions before requesting AI code. The model receives IDs, original names, dimensions and user directions, **not pixel content or vision recognition**. The generated component uses the supplied images directly:

```svelte
<script>
  let { images = {} } = $props();
</script>

<img src={images.image_1} alt="Product" style="object-fit:contain" />
```

The host supplies embedded raster data URLs through these props. Original bytes are unchanged, preserving PNG/WebP alpha. The saved source owns those bytes, so subsequent upload replacement or deletion does not break the generated scene. Preview, timeline capture, local FFmpeg-WASM export and native server export use the same images without external network access. Source, worker body and native request limits are 96 MiB to accommodate four images, two videos and base64 expansion; the component remains limited to 64,000 bytes and the bundle to 2 MiB. Embedded image/video bytes are omitted from the exported video's HTTP manifest header.

Inside SVG groups, attached images use `<image href={images.image_1} ... />`; HTML content belongs inside `<foreignObject>`. The compiler normalizes legacy `<img>` tags in SVG to native images so browser DOM restructuring cannot invalidate Svelte's node traversal. The runtime also supports reactive `scene.time`, `scene.progress`, `scene.config` and stable `scene.random(key)` aliases for saved AI components; new generation uses the canonical `scene.frame` API. Downloading an older preview environment recompiles its bundle with these fixes.

Generation now prescribes one coordinate system, shared subject bounds, safe margins and local anchors. Related reactions/labels must live inside their subject's positioned wrapper and inherit its translation, scale and rotation. In the phone example, hearts must be children of the phone group, positioned relative to the like button, rather than independent stage coordinates such as `x: 828`. These are instructions for newly generated components; saved components retain their existing layout.

## Attached videos and 3D

**Attach videos** accepts two originals per request, each up to 20 MiB and 60 seconds, with dimensions up to 3840px. The API probes actual duration, dimensions, container and codec: H.264 MP4 or VP8/VP9 WebM. Unsupported footage fails before AI generation. Each video has optional 600-character directions and a selected look; AI receives this metadata, not video pixels. Original bytes are saved in `source.videos`, supplied as `videos` props. Video sound is muted; narration uses **From a voice**. Drafts survive Close/reopen, and removal/account changes release object URLs.

```svelte
<script>
  import {SceneCanvas, SceneVideo, SceneThree} from '@direction/scene-svelte';
  let {videos = {}} = $props();
  function setup({THREE, world, camera}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
    world.add(mesh);
    camera.position.z = 4;
    return {update(frame) {mesh.rotation.y = frame.time;}};
  }
</script>
<SceneCanvas background="#ffffff">
  <SceneVideo src={videos.video_1} width={640} height={360} look="cinematic" playbackRate={0.5} loop />
  <div style="position:absolute;left:0;top:0"><SceneThree {setup} width={640} height={360} /></div>
</SceneCanvas>
```

Three.js is bundled locally; no CDN or external models are needed. The renderer preserves its drawing buffer for capture and cleans up GPU resources. Editing a scene preserves its embedded media, narration, visual medium and existing source; it publishes a new immutable asset.

### Preview performance

Overlapping clips on different channels no longer force live scenes through HTML-to-SVG/image capture each frame. The preview preserves sandbox iframe instances and composes cached image canvases and ordinary video elements between them. Clip transforms, fades and opacity use the same geometry as Pixi; image selection/resize remains interactive. Linear color matrices (including grayscale, negate and negative-strobe) use native sRGB SVG filters; scene filters run inside their sandbox so cross-origin iframe compositing cannot bypass them. Cross-dissolves use isolated per-channel layers with premultiplied `plus-lighter` blending.

Spatial, temporal and LUT effects and other transitions retain Pixi's exact shaders. Their snapshots serialize scene stylesheets and current DOM attributes rather than expanding every computed CSS property on every node. Only used font families/styles/character ranges are embedded; canvas/video frames preserve their computed geometry and intrinsic aspect. Bitmap transfer remains asynchronous and coalesces to the latest requested frame. Pixi effect stacks are retained while unchanged, and transition progress updates a retained shader instead of allocating it every tick. These paths are faster but are not a universal 60 FPS guarantee for complex scenes. Full-resolution capture/export retains the same authored viewport, fonts and alpha.

Scene JSON is never assigned to an HTML video player, including after project restoration. Its sandbox owns visual playback, while original narration stays on its separate audio track. This prevents a restored scene from repeatedly requesting `/download` as media and exhausting the request limit.

Preview rendering supplies transient `renderScale` and `capture` frame options. `SceneThree` keeps authored coordinates and camera geometry unchanged while sizing its GPU buffer to the visible preview. Ordinary presentation does not call `gl.finish()`; exact capture/export retains the GPU barrier. Local full-resolution capture and native rendering use scale 1, independent of preview size, and these options do not alter the saved scene manifest. Existing latest-frame coalescing skips obsolete playback frames rather than building a seek backlog.

Preview environment version 5 recompiles older saved bundles on source download without changing stored originals or their fingerprints. Deploy the updated API and scene service together, then reload the editor so already-mounted bundles are replaced.

## HTTP adapter

Authenticated, owned-session endpoints:

- `POST /ai/scenes` — paid; JSON `{prompt, text?, visualMode?: "auto"|"2d"|"3d", transparent?: boolean, duration, width, height, fps, audioFile?, language?, images?: [{id, file, name, description?}], videos?: [{id, file, name, description?, look?}]}`; image IDs are unique `image_1` through `image_4`, video IDs `video_1` through `video_2`, and files are uploaded originals in the owned session. Returns a `202` job. Scene edits use `sourceFile` and a change prompt, preserving attachments.
- `GET /ai/scenes/:id?revision=<last revision>` — waits up to 25 seconds for a changed job before returning state, recognized narration and completed scenes. No revision requests immediate status. The client uses long polling instead of repeating unchanged responses every 1.2 seconds. AI writing/transcription/planning are indeterminate phases; compilation and completed-scene counts advance progress.
- `DELETE /ai/scenes/:id` — cancellation.

The private service accepts `POST /compile` with `{component, config}` and returns `{javascript}`. `POST /render` is used at export and returns video bytes plus a base64 JSON `X-Scene-Manifest` header. AI responses may supply tool arguments, JSON text or standalone Svelte source; truncated/empty responses produce specific terminal errors. Scene AI requests explicitly send `reasoning.enabled=false`: optional-reasoning models such as DeepSeek V4.1 Flash otherwise default to high reasoning, which can consume the whole completion budget without returning code. Component output remains bounded to 16,000 tokens; narration plans use 4,096. Logs include the model/provider/generation ID, elapsed time, response shape, reasoning tokens and remaining output tokens without logging credentials or generated content. Empty `length` responses are not automatically resubmitted as another billed generation.

The private export request is `{component, config, images?: {image_1: "data:image/png;base64,..."}, videos?: {video_1: "data:video/mp4;base64,..."}}`. Embedded assets are passed as `images`/`videos` props; compilation needs only source and configuration. The client and scene CSP allow embedded media while the isolated scene retains `connect-src 'none'`.

## Verification

```sh
# From api/
go test -race ./internal/core/editor/scenes ./editengine/sceneasset
go test ./internal/routes ./internal/core/editor/subtitles
go build ./...

# From services/scene-renderer/; no library checkout or Go renderer build
npm ci
npm test
npm run test:evaluation
npm run test:native
node scripts/prepare-live-fixture.mjs
node scripts/test-live-export.mjs

# From client/ after the native fixture above has been produced
pnpm check
pnpm build
pnpm exec vitest run src/tests/lib/scene-generation.test.ts src/tests/lib/scene-images.test.ts src/tests/scene-assets.test.ts
pnpm exec playwright test e2e/scene-generation.spec.ts
```

`SCENE_BROWSER` can override the browser for native and client checks. The live fixture is compiled without video rendering. Browser tests mock account/AI job responses but run the real sandboxed component, timeline capture and FFmpeg-WASM export. The native export test starts the actual scene service and verifies animation, an ordinary clip and audio through the normal Go composition export. Provider tests mock OpenRouter; these checks do not spend live AI credits.

`TestLiveSceneProviderReturnsCompilableCode` is an opt-in exception: set `SCENE_LIVE_PROVIDER_CHECK=1` in an environment with the existing API/worker configuration to run one real provider request capped at 2,048 tokens, without automatic retries. It validates the returned component through the actual compiler and logs token counts; it is skipped by default and does spend provider credits when enabled.
