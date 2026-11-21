# Rendering performance and quality

Commands and code paths are relative to the repository root unless stated otherwise. See [testing](TESTING.md) for reproducible checks; measurements below describe specific workloads, not a general performance guarantee.

## Browser editing budget

Autosave observes committed edit/media notifications and defers project capture/JSON serialization until the debounce, rather than cloning and traversing a large project throughout a drag. Active text lookup uses a start-time index with prefix end bounds, preserving original overlay order and half-open cue endpoints. Preview caches fitted text layouts and keeps GPU text sprites only for currently active cues; completed captions no longer accumulate resident text textures across the whole film.

On browsers reporting at most 4 GiB device memory or four hardware threads, preview work is capped at 30 updates/second and pixel ratio 1. Other previews cap pixel ratio at 2. These are preview-only budgets: output resolution, cadence, fonts, captions, scene assets and local/server export settings are not lowered. Browsers without FontFaceSet retain readable canvas fallback; font-load failures are bounded to the requested font rather than retried every frame. Export reports a failed required font load instead of silently changing saved captions.

The CPU-throttled Chromium regression uses 2,000 synthetic captions and verifies culling, advancing playback and no page errors with FontFaceSet unavailable. It is not a physical-device memory benchmark or a reproduction of every reported `fontFamily` stack trace.

A warmed, isolated JavaScript lookup check in this Windows workspace used 2,000 non-overlapping cues and 20,000 point queries: full-array filtering took 225.81 ms; `activeTimedItems` took 3.38 ms. Both returned 18,000 active items in total. This measures only cue lookup, not browser frame rate, input latency, overlapping-cue worst cases or overall editor speed; timings vary by device.

## What the API actually exports

Both editor exports and recipe/composition exports use the same renderer in
`api/internal/core/editor/render`. Visual presets (looks, transitions, motions,
text treatments) are not FFmpeg encoder presets.

The video path is:

1. Materialize live `.scene.json` sources through the scene service.
2. Render clip segments with their effects, speed, transforms and exact cadence.
3. Stream-copy segments into clips; render overlap transition groups.
4. Assemble tracks, including gaps. Render alpha masks only when needed.
5. Composite tracks and render bounded batches of text/caption overlays.
6. Encode the delivery video once, and encode/mux the PCM audio timeline.

Steps 2–5 produce temporary intermediate files. Previously these were x264
`ultrafast`, CRF 23, YUV420, even when delivery quality was `high` (CRF 18).
Repeated passes could accumulate irreversible compression and chroma losses.
They now use x264 `ultrafast`, **CRF 0, YUV444**. They preserve the pixels in
that working format; they do not promise to reverse prior source compression
or make RGB/YUV conversions mathematically lossless.

The scene service captures **PNG**, not JPEG quality 85. Opaque scene
intermediates use lossless **RGB H.264**; transparent scenes use lossless VP9
with alpha (VP9 alpha still uses YUV420 chroma). These files are not the final
delivery encode. They can be larger: the bounded scene output limit is 1 GiB,
enforced by both the scene service and the API receiver. A full-length Full HD
lossless scene can exceed the former 512 MiB ceiling even when rendering succeeds.
API staging lives on the persistent Linux named volume, not a Windows bind mount.

Delivery defaults remain x264 `medium`, YUV420, with existing `low`/`normal`/
`high` CRF values **30 / 23 / 18**. Resolution, FPS, frame count, effects and
audio quality settings are unchanged. `ultrafast` on a CRF-0 intermediate
changes encoding speed/file size, not its decoded pixels. A faster preset on
a *lossy delivery encode* is a separate tradeoff and is not enabled by default.

## Resource configuration

`compose.editengine.yaml` defaults to four CPU equivalents and a 3 GiB limit for
the scene container. These are ceilings, not reservations. Docker Desktop must
have enough total VM memory for **both** containers and the Linux OS. On a 16 GiB
Windows machine start with 4 GiB for Docker, consider 6 GiB only with sufficient
host headroom. Keep `shm_size: 1gb`, sandbox isolation and the existing read-only
filesystem. Do not remove security constraints as a performance workaround.

| Variable | Default | Meaning |
|---|---|---|
| `SCENE_CPU_LIMIT` | `4` | Compose CPU ceiling |
| `SCENE_MEMORY_LIMIT` | `3g` | Compose memory ceiling |
| `SCENE_WORKERS` | `auto` | Up to four capture pages, bounded by quota, available memory and frame count; explicit 1–16 also memory-bounded |
| `SCENE_RENDER_CONCURRENCY` | `auto` | Up to two scene jobs with at least four CPU equivalents, 2304 MiB available and 384 available PID/thread slots at worker startup (or no PID cap); otherwise one. Explicit 1–2 remains resource-bounded. Parallel jobs divide the CPU/RAM/capture-page budget. |
| `SCENE_ENCODER_THREADS` | `auto` | Bounded FFmpeg thread budget; explicit 1–32 |
| `SCENE_X264_PRESET` | `ultrafast` | Lossless intermediate compression speed |
| `RENDER_X264_PRESET` | `medium` | Final CPU encode speed; does not change the selected CRF |
| `RENDER_VIDEO_ENCODER` | `libx264` | Final MP4 encoder; `h264_nvenc` is explicit opt-in |
| `SCENE_CACHE_MAX_BYTES` | `2147483648` | Persistent scene cache budget; `0` disables it |
| `SCENE_CACHE_VERSION` | `1` | Explicit cache invalidation salt |

Auto mode reads cgroup CPU quotas and memory limits/usage, plus host available
memory, instead of trusting the host's logical processor count. Text overlay
workers also divide their per-process encoder/filter thread budgets rather
than each spawning the full-machine allowance.

For Hyper-V Docker Desktop, change **Settings → Resources → Memory**, then Apply
and restart. For WSL2, use its resource settings/`.wslconfig` instead. The backend
is not migrated automatically. Restart interrupts running containers/jobs.

After changes, rebuild and recreate without deleting volumes:

```powershell
docker compose -f compose.editengine.yaml up -d --build api scene-renderer
```

## Compilation reuse and bounded scene work

The scene service also retains a bounded **32 MiB in-memory compilation cache**, keyed by component source, preview/export mode, visual mode and inspection entry point. Concurrent identical compilations share one build; failures are not cached and oversized bundles are returned without displacing retained entries. Bundled runtime/font changes require restarting the service. This skips repeated Svelte/esbuild work, not layout inspection or final-render identity checks.

Scene exports admit up to two jobs through a bounded FIFO, falling back to one on smaller CPU/RAM/PID budgets. Concurrent jobs divide the existing CPU/RAM budget and use at most four capture pages in aggregate, not four per job. The API submits at most two independent scene materializations per export and reuses each unique source once. Where parallel admission is safe, text preparation has its own one-job FIFO so a scene encode does not hold the text queue; constrained servers retain shared serial admission. Compilation/diagnostic queues retain their existing separate bounds. Transparent native capture sets the background override once per worker page rather than making the same CDP call for every frame. The 60-second idle shutdown and page-cache reclamation policy are unchanged. None of these changes lowers output resolution, cadence or image quality.

### File-backed scene delivery and fewer encoding passes

Scene outputs and cache hits retain an open read-only file descriptor, not an entire video Buffer. SHA-256 verification reads 256 KiB chunks; authenticated HTTP delivery uses a backpressured 64 KiB stream. Cancellation/response closure releases the descriptor and temporary render directory, and the worker remains active through streaming. Cache publication first tries an immutable hard link, with an OS file-copy fallback across filesystems, then atomically publishes the manifest. Cached files are still length/checksum verified before delivery; this removes the up-to-1-GiB Node video allocation, not necessary Chromium/frame/encoder memory.

Identity transforms no longer run perspective/rotation/shear filters. Eligible single opaque clips fuse clip filtering, up to 24 caption/text rasters and final delivery encoding in one FFmpeg pass, bypassing video intermediates. More complex timelines with up to 24 rasters retain their existing layer/transition pipeline but fuse text compositing into the final encode. Larger text stacks, alpha/masks and segmented/transition work retain the bounded lossless fallback. Encoder, CRF, output dimensions, FPS and caption/source data are unchanged; no faster lossy preset or automatic GPU substitution is introduced.

### Interval-based previews and scene frame ranges

Previews operate on a render-private interval and necessary temporal dependencies, not the complete timeline. Plain isolated clips are trimmed; connected transition groups and effect/animated-transform/speed/fade history are conservatively retained. Unrelated sources are not warmed/staged/materialized. Only intersecting caption rasters are prepared, and their original motion timing is retained; the YAML/caption entries themselves are untouched. The actual work window can therefore exceed the requested excerpt, and is returned as `processedDuration` and used for final-render billing.

Scene materialization captures the union of referenced original frame ranges (rounded outward to source frames), for both previews and final exports. The component still sees its original full-duration configuration and absolute frame/time/progress, so a late excerpt does not restart its animation. Range and original configuration are cache identity inputs. Only the captured range contributes to scene-render duration accounting. Final excerpt selection happens after compositing/audio mixing, with the existing tariff/rounding. This is not a promise that every temporal effect can be rendered without preroll.

## Persistent scene cache

### Packaged fingerprints and idle RAM reclamation

Both scene Docker images generate a root-owned `SCENE_RENDER_MANIFEST` at build
time. Runtime cache identity reuses the exact SHA-256 values for matching,
image-owned executable paths, sizes and modification times. Missing, malformed,
untrusted or mismatched entries fall back to content hashing. All existing
render-cache identity inputs and cached-video checksum checks remain in place.
The build normalizes executable modification times to whole seconds before
pinning them, because OCI layer archives can discard subsecond timestamps.
Runtime metadata matching stays exact; it does not tolerate changed timestamps.
This prevents the on-demand worker from rereading the whole Chromium executable
just to identify an existing disk-cache entry after every cold start.

In the **managed Railway worker** path, Linux termination is followed by targeted
`POSIX_FADV_DONTNEED` advice. A build-time inventory prioritizes executable files
and their linked libraries, then selected browser/Node resources of at least
64 KiB. Completed videos in up to 65 inspected scene-cache directory entries are
also eligible. The inventory is capped at 8,192 files / 1 MiB, and cleanup checks a
two-second context budget between filesystem operations. It does not recursively
walk `/data`, delete files, clear global caches or require root at runtime.

New worker acquisition waits for termination/reclamation through a cancellable
gate, not a mutex held across cache I/O. In-flight requests and streaming keep the
worker alive. Failure/unsupported advice is logged and never turns a successful
render into a failed job. `scene_worker page_cache_release` logs total, anonymous,
file and kernel memory before/after, plus advice/failure counts. Advice counts are
not reclaimed bytes; dirty, mapped or shared pages and filesystem behavior mean
there is no guaranteed idle-memory target.

### Media page-cache lifetime

Linux render paths favor low idle RAM over warm disk reads. Once a source has
been copied and version-checked into a composition's private staging directory,
its original descriptor is flushed and advised with `POSIX_FADV_DONTNEED`.
Legacy exports release their named source files after the FFmpeg passes finish.
The completed output is released after encoding, and S3 publication releases its
descriptor again after hashing/uploading so publication does not leave it warm.
Failed upload attempts also release their descriptor while retaining local bytes.

Saved-project and prepared-presentation snapshots follow the same policy after
atomic writes, complete reads and streamed-response closure. Media HTTP streams
release their descriptors only on response closure (including partial/cancelled
transfers), not when the handler returns. Thumbnail/metadata/proxy generation
releases local source pages after generation and completed disk-cache entries
after publication; remote sources are not opened locally for reclamation.

The targeted flush is necessary because newly written files can still have dirty
pages that `DONTNEED` alone will not discard. Temporary render/staging files retain
their existing deletion lifecycle. Files remain on disk and are reread as needed;
no media deletion, recursive `/data` scan, global `drop_caches`, new background
worker or privileged kernel configuration is involved. Advice failures are logged
without changing a render/upload result. Non-Linux platforms keep existing behavior.
In-use/mapped pages and subsequent readers can retain or repopulate cache: this is
not a zero-RAM guarantee or a change to runtime/decoded-frame memory requirements.

Verification used the Linux test executable on the existing Railway `/data`
volume as UID/GID 10001, with only temporary synthetic files. A newly written
5.5 MiB file went from 1,408 resident pages to zero after release, with identical
persisted bytes and an unchanged open-descriptor position. The test also rejected
symlinks, directories and FIFOs. All temporary diagnostic files were removed.
This establishes targeted eviction on that filesystem, not an end-to-end render
memory benchmark. The portable full Go suite, `go vet ./...` and documentation
checks also passed before deployment.

An externally managed Compose scene service does not gain the Go idle lifecycle;
it benefits from packaged fingerprints only. Rebuild the relevant image to adopt
the manifest and binaries. Do not override the manifest with a user-writable file.

#### Managed Railway verification (2026-11-05 UTC)

The isolated memory patch was deployed as `ba2a7036-6c8b-4d99-ae17-fb5bf6d49ee6`,
based on production commit `10b9689`, without unrelated local commits/UI changes.
The existing volume, source connection, single replica and deployment settings
were preserved. The protected manifest reused all three executable hashes without
runtime hashing. Linux synthetic tests measured 1,216 resident pages becoming zero,
with unchanged persisted bytes.

Two bounded health/compile cycles and controlled reads of the packaged executables
checked real idle behavior without encoding a video, accessing user media or
calling an AI provider. The second cycle reached 505,176,064 container bytes while
the worker was awake. At `22:23:57 UTC`, after worker exit:

| Cgroup measurement | Before targeted advice | Immediately after |
| --- | ---: | ---: |
| Total bytes | 314,482,688 | 20,836,352 |
| File-cache bytes | 292,945,920 | 77,824 |

The release log reported 454 advised files, zero failures, no timeout and 25 ms.
A follow-up reading was 18,923,520 total bytes / 90,112 file-cache bytes, with no
Node/Chromium/FFmpeg process remaining. Per-file `fincore` residency can still show
shared image pages resident elsewhere; it is not the container's charged cache.
The subsequent Railway memory metric was 0.014913536 GB (approximately 15 MB), with
one healthy running replica and no pending deployment work.
These are controlled point-in-time observations, not a full-render benchmark or a
guaranteed idle-memory floor. This was a manual archive deployment; the source
patch must be included before the next GitHub `master` autodeploy.

### Disk retention

The private `scene-render-cache` named volume retains up to 2 GiB / 64 entries,
with a seven-day idle TTL and LRU eviction. No source library is scanned, and
the cache is not exposed by a public download endpoint.

The key covers the compiled bundle (including runtime and embedded fonts), HTML,
normalized scene configuration, original embedded image/video bytes, renderer /
browser / FFmpeg binary fingerprints, container system-package versions and
encoding settings. Workers do not change artwork and do not invalidate it.
Non-container system-library/font/driver upgrades require bumping
`SCENE_CACHE_VERSION` and restarting the service.

Publication is atomic. Cache reads verify byte count and SHA-256; corrupt entries
are discarded and rerendered. Cancellation/failure never publishes a partial
entry. Cache failures fall back to rendering rather than failing a valid export.
Compilation still runs to obtain the exact artifact identity; a hit skips browser
startup, frame capture and video encoding. API materialization uses bounded
parallelism matching the resource-aware service admission described above.

The cache contains derived private media. Removing the named volume removes it;
ordinary container recreation does not. Do not run `down -v` to deploy an update.

## GPU: optional, not a silent quality change

`compose.gpu.yaml` is an **opt-in override**, not the default. It requires NVIDIA
Container Toolkit on Linux or NVIDIA GPU support through Docker Desktop's WSL2
backend and a compatible host driver. The Windows Hyper-V backend cannot provide
this path. No driver installation or backend migration is performed automatically.

```powershell
docker compose -f compose.editengine.yaml -f compose.gpu.yaml up -d --build
```

The override selects the Debian GPU API image (the Alpine CPU image does not
bundle NVENC), requests GPU devices, permits Chromium hardware rendering and
uses NVENC `p7` / HQ for final MP4 encoding. Missing device/encoder support fails
visibly: no silent switch of encoder or quality. CPU lossless intermediates remain
unchanged. CRF and NVENC CQ are **not equivalent quality measurements**; compare
representative real material before adopting NVENC for delivery.

Check actual NVENC initialization, not just its presence in `ffmpeg -encoders`:

```powershell
docker compose -f compose.editengine.yaml -f compose.gpu.yaml exec api ffmpeg -v error -f lavfi -i color=s=128x72:r=1 -frames:v 1 -c:v h264_nvenc -f null -
```

Chromium GPU acceleration and NVENC are separate paths. GPU access does not
automatically accelerate CPU FFmpeg filters, caption compositing or CDP screenshots.
Hardware scene caching is disabled unless `SCENE_GPU_FINGERPRINT` identifies the
GPU and driver; change it after either changes.

## Measurements and verification

### Applied pipeline optimizations (2026-10-29)

- **Concurrent scene initialization:** worker tabs load together within the existing
  CPU/memory-selected worker count. A failed load cancels the sibling loads; all
  tabs are released before the job returns. Captures remain ordered and bounded.
- **Image readiness reuse:** exact frame seeks reuse a successful image decode
  while its source/selected responsive source is unchanged and the image remains
  complete. New sources and failed/incomplete images still pass the decode barrier.
  Fonts, scene videos and explicitly tracked resources are still awaited per frame.
- **Faster lossless alpha encoding:** VP9 intermediates use `-deadline good
  -cpu-used 4 -row-mt 1`. This trades compression efficiency for encoding speed
  under `-lossless 1`; decoded RGBA pixels are checked against the former encoder
  settings. Lossy delivery presets are separate.
- **Parallel video segments:** independent segments share the bounded task pool
  used for text chunks, with CPU/memory/resolution limits, ordered assembly,
  monotonic progress and sibling cancellation on failure. Decoder, filter and
  encoder threads are bounded per task, including each input in multi-input passes.
- **Single-piece assembly:** immutable, same-container intermediates are hard-linked
  instead of launching FFmpeg to remux one file. Filesystems without hard-link
  support retain the existing remux fallback. This applies to video, masks, text
  chunks and audio timelines.
- **Cheaper timestamp validation:** repeated identical source windows are checked
  once per validation pass. Decoding still verifies real frame coverage, with
  `showinfo=checksum=0`, video-only decoding and passthrough timestamps, avoiding
  unused per-pixel checksums and audio decoding.

Synthetic local observations on Windows / Ryzen 7 1700, 1920×1080:

| Workload | Before | After | Observation |
|---|---:|---:|---|
| Four 1-second video clips, API track assembly | 2.663 s | 1.360 s | About 49% less wall time; excludes source fixture creation and delivery encode |
| Opaque scene, 60 frames, 4 workers, Headless Shell | 4.021 s | 3.773 s | About 6% less wall time; page loading 707 → 362 ms |
| Transparent scene, 60 frames, 4 workers, Headless Shell | 13.413 s | 10.346 s | About 23% less wall time; identical decoded RGBA, larger encoded file |

These are single synthetic observations, not production latency guarantees. Browser
startup and compilation warm-up affect short jobs. The comparison script checks
decoded frames across binaries/worker counts and byte-identical cache hits.
PNG capture/compositing remains a significant cost for uncached scenes.

Use the **pinned Chrome Headless Shell** for native benchmarks, matching deployment.
In a local Windows measurement, full Chromium with one worker spent roughly one
second per screenshot; that result is not representative of the container's
Headless Shell. `SCENE_BROWSER` selects the executable explicitly.

For paired comparisons, retain the previous CLI binary before rebuilding and set
`BENCHMARK_BASELINE_BIN` to it. `BENCHMARK_WORKERS=4` selects a worker count and
`BENCHMARK_TRANSPARENT=true` exercises lossless alpha. The API benchmark runs from
`api/` with FFmpeg on PATH:

```powershell
$env:FFMPEG_INTEGRATION = '1'
go test ./internal/core/editor/render -run '^$' -bench '^BenchmarkVideoSegments$' -benchtime=1x -count=1
```

Verification for this change: scene build/type checks, runtime/service tests,
native scene rendering (RGB, alpha, images, Three.js, video and audio), API unit
tests/vet and render race tests passed. Native API render checks passed after
correcting a test that expected audio in a video-only intermediate. The extended
Windows media suite hit the old ffprobe limitation described in [testing](TESTING.md).
Rerunning those metadata/audio/proxy checks in the Linux API image passed except
the existing `TestAssetsWithFFmpeg/long.mp4` thumbnail expectation (expects HTTP
422, implementation returns a valid JPEG with HTTP 200); that unrelated assertion
is not a renderer regression.

### Stage diagnostics

Scene logs report `scene_render_started`, compilation, native process PID,
`scene_render_progress` (first frame, at most one update every five seconds and
the last frame), and `scene_render_encoded` with actual bytes and the configured
ceiling before the size check. `renderId` identifies the invocation; `requestId`
correlates it with the API job when available. Only numeric frame progress is
streamed from renderer stderr, not arbitrary component output or embedded media.
Cache hit/miss, total wall time, bytes, workers and encoder settings remain in
the final `scene_render` event. Manifests include page loading, capture/encode overlap,
encoder drain and aggregate per-worker seek/screenshot durations. Worker totals
overlap and must not be added to infer wall time. A hit's manifest describes the
original render; its log describes the current cache lookup.

API logs emit `render_stage` for each FFmpeg processing stage, including delivery
encoding, and `render_text_plan` / `render_video_plan` for bounded task parallelism. These timings exclude
provider generation/queue waits, source staging, stream-copy concatenation and
cloud publication; do not present them as end-to-end job latency.

For caption-heavy MP4 exports, the API packs runs of nonoverlapping Canvas
rasters without cue-level motion into cropped, transparent inputs. Word
animation is already in those rasters. FFmpeg composites the inputs during the
delivery encode, with any separate titles kept in draw order. This also works
for captions on a black background with no video clips. If the layer or input
budget is exceeded, the API still uses the existing chunked compositor.

- `render_caption_transcription` measures materialization of a pending caption
  job, including extraction and any provider calls. A resolved caption job
  does not enter this stage.
- `render_text_prepare` measures server-side preparation (including any wait
  for the text service) and reports the input cue and output raster counts.
- `render_caption_layer` measures packing the existing PNG states into the
  transparent layer, separately from `render_stage` for the delivery encode.
- Re-export with materialized `texts` and `resultTextIds` to measure rendering
  without transcription. For new captions, `highlightMode: word` with
  `highlightAnimation: none` retains word highlighting without the intermediate
  animation states. Do not change an existing caption style just to benchmark.

Compare the two compositors on the same prepared caption states with
`FFMPEG_INTEGRATION=1 go test ./internal/core/editor/render -run TestNativeCaptionLayerMatchesStagedExport -v`
from `api/`, using a current FFmpeg. The test does not invoke a speech provider.

Follow both services after rebuilding to activate changed logging code:

```powershell
docker compose -f compose.editengine.yaml logs -f --tail 100 api scene-renderer
```

Logs go to Docker stdout/stderr, not a file inside either container. In Docker
Desktop select **scene-renderer → Logs** for Chromium/native failures; the API
log may only contain the sanitized scene-service response. Search both by job ID.
Docker timestamps are UTC; a local display may add a timezone offset.

Save a bounded copy outside Docker before recreating a container (from the repo root):

```powershell
node services/scene-renderer/scripts/collect-render-logs.mjs services/scene-renderer/out/render-logs-new test-web-api-1 test-web-scene-renderer-1
```

Use a **new output directory** each time. It retains the last 3,000 lines of
stdout and stderr separately with Docker timestamps; no credentials/configuration
are read. Container recreation does not preserve the previous container's logs.

#### PID exhaustion versus out-of-memory

`capture frame N: context deadline exceeded` identifies the stage, not the root
cause. Check `/sys/fs/cgroup/pids.events` as well as `memory.events`.
`pids.events: max N` counts denied process/thread creation; it is unrelated to
the number of currently running processes. Both processes and threads consume
the container's `pids_limit`. Chromium can stall before FFmpeg or Go reports
`resource temporarily unavailable` / `failed to create new OS thread`.

The scene service uses `init: true` to reap orphaned Chromium children. Without
it, PID 1 is Node, zombie processes accumulate across renders/compilations, and
even an idle container eventually cannot start all the threads for a new job.
Recreate the service after applying the setting; restarting the Node process
alone does not add an init process. Do not disable PID/memory limits or the
existing read-only filesystem as a workaround. If a capture fails, the encoder
is deliberately cancelled: a following `FFmpeg ... signal: killed` may be
secondary, not an OOM event.

`scene_render_failed` includes `renderId`, `requestId`, worker/encoder options
and bounded before/after cgroup PID/memory counters. `scene_request_failed`
retains the bounded subprocess stderr tail. These internal diagnostics do not
expose manifests, embedded media, credentials or raw stderr to public clients.

To compare a saved scene source through the service adapter **locally**, without
account jobs, provider calls, publication or credit metering:

```powershell
node services/scene-renderer/scripts/diagnose-render.mjs path/to/saved.scene.json services/scene-renderer/out/scene-diagnostic-new
```

Configure `SCENE_BROWSER` and `SCENE_FFMPEG` for local tools (the native renderer comes from npm; `SCENE_RENDER_BIN` is an optional override),
or run inside the isolated scene container with `DIAGNOSTIC_SERVICE_ROOT` set
to `/opt/scene-service`. Keep its service idle during the test: direct
adapter invocation intentionally does not enter the HTTP queue. The script
disables cache, runs 4/1/4 requested workers sequentially, samples resource
counters, and saves `render.jsonl`, per-success manifests (without embedded
sources) and `summary.json`. It does not retain video outputs. Override the
sequence with `DIAGNOSTIC_WORKERS=4,4,4` when checking repeated exports.

API `scene_export_started`, `scene_export_response` and `scene_export_completed`
events delimit the scene-service call and transfer. Unexpected scene-service
failures retain a bounded internal stderr tail. Composition errors distinguish
`render` from `cloud_publish` instead of replacing both with the same message.

### Live stage progress and ETA

API scene exports opt into authenticated, invocation-scoped `/render-progress/<id>`
snapshots. Only the active bounded render slot retains these numeric snapshots;
completion/failure/cancellation removes them. They expose no source, media or
diagnostic text. The API reads them at most once per second while its original
render request runs, without resubmission. Older services may return 404; missing
telemetry never retries paid work or fails an otherwise valid export.

Job summaries expose the current scene phase/index and actual captured frame
counts. Overall progress remains a weighted work indicator, **not a fraction of
elapsed time**. `timing.stageRemainingSeconds` estimates only remaining capture
for the current scene, excluding encoder drain, later scenes, timeline/captions
and cloud publication. Overall/queue estimates use recent successful job history
when available; an outgrown or unknown estimate is omitted, not replaced with an
invented countdown. `scene_export_completed.transfer_ms` separately measures the
video body transfer. These changes improve observability, not rendering speed,
and do not change quality, resource ceilings or serial scene admission.

Queued recipe/editor exports log `render_publication` separately with wall time,
job correlation and success/failure, distinguishing cloud upload from final
encoding. No media filename, signed link or credential is included.

The editor Render dialog also suppresses its timeline-only ETA/calibration when
the payload contains live scenes. It retains real work progress and elapsed time
instead of extrapolating the scene stage's fixed work share into a full-export
countdown. Ordinary footage-only and browser-local estimates are unchanged.

For a synthetic Full HD benchmark (no account media or paid providers), install the
service dependencies then run from `services/scene-renderer/`:

```powershell
npm ci
node scripts/benchmark-render.mjs
```

The benchmark compares 1/2/4 workers, checks identical decoded RGB frames, and
compares cold/warm cache bytes. It uses existing local test dependencies and
temporary files. Timing results are machine/workload-specific, not a speedup SLA.

Regression coverage includes byte-identical warm cache results, invalidation,
corruption recovery, eviction, cancellation, frame determinism, pixel-exact RGB
scene intermediates, repeated lossless API passes, masks, alpha overlays, fonts,
Three.js, source-video seeking, transitions and final narration/audio timing.

Run the complete sequential verification from `services/scene-renderer/` with
`node scripts/verify-render.mjs`. Suites run sequentially so competing Chromium
instances do not distort startup timeouts or consume the entire host RAM.
