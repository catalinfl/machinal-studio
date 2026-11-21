# Project-open memory investigation

## Production observations — 2026-11-08

Read-only Railway metrics, runtime/HTTP logs and `/proc` inspection of `viral-server` showed:

- A 3-hour sampled memory peak of 713,023,488 bytes. This is service memory, not a Node heap measurement.
- The inspected saved project occupied 63,689,556 bytes. Its state was 63,637,869 bytes, including 56,023,208 bytes in the media array and 7,614,481 bytes in the timeline.
- Five media entries contained full `scene` objects of approximately 7.7–12.3 MB each: source, compiled JavaScript and embedded attachments. These assets already have their own immutable `.scene.json` files.
- Project opening at approximately 10:49 UTC was followed by repeated autosave HTTP 408 responses, each after the ordinary 10-second request-body deadline.
- No scene worker start or render was logged in that interval. Process inspection found the Go server but no Node/Chromium renderer. Therefore server-side scene rendering was not the cause of this observed project-open spike.

## Causes and corrections

1. `captureProjectState()` copied runtime `media[].scene` objects into every autosave. `projectMediaReference()` now excludes these payloads before serialization, while preserving names, source revisions, dimensions and other metadata. Prepared-project recovery follows the same rule. Legacy inline scenes remain readable; subsequent snapshots omit the duplicated payload, without deleting original scene assets.
2. Project listing read and unmarshaled every complete project merely to return its summary. It now reads a bounded summary header. The store writes the embedded summary before `state`, and tests enforce that path against an 8 MiB state.
3. Project fingerprinting created whole-document string, rune and UTF-16 arrays. Hashing now consumes UTF-8 incrementally and emits the same UTF-16 code units, retaining browser/server fingerprint compatibility, including supplementary characters.
4. Downloading an older scene bundle could call `/compile`, waking Node even though viewing should be read-only. Scene downloads now use the existing streaming media path with ETag/range support. The saved JavaScript executes in the browser sandbox, irrespective of its environment version. Adopting a new runtime requires explicit scene editing rather than an implicit migration on GET.

The existing browser preview engine is retained. Explicit scene authoring/diagnostics and server export still use the scene service; local export remains a separate browser option.

## Verification

- Go tests passed for projects, scenes, routes, scene-worker lifecycle and API transport.
- Client regression tests cover reference-only snapshots, legacy restoration, prepared snapshots, unchanged autosave state after preview loading and the browser scene player.
- `pnpm check`: no errors or warnings.
- Local Windows Go benchmarks with an 8 MiB state: summary reading allocated approximately 2.8 KB/op versus 16.8 MB/op for full project reading; canonical fingerprinting allocations decreased from approximately 109.1 MB/op to 50.4 MB/op. These are allocation measurements, not production RSS predictions.

Removing the duplicated scene payload would reduce the inspected state's serialized size by roughly 88%. No production data was rewritten and no deployment was performed during this investigation. Production peak-memory and autosave behavior must be rechecked after deploying both the client and API and successfully saving the compact state.

## Follow-up: the remaining project-open allocation spike

After the 11:24 UTC deployment, Railway still sampled a peak of 829,325,312 bytes. The Go process reported a historical RSS high-water mark of 848,508 KiB, but its current RSS was only 33,904 KiB when inspected. There was no Node/Chromium worker in the process list or worker-start/render event during the observed opening. The spike was transient Go allocation, not evidence of scene rendering.

The same project had successfully autosaved at 11:25:53 UTC and was now 7,621,109 bytes, with zero inline scenes. Its retained presentation file was another 7,650,701 bytes. Thus the previous fix was deployed and removed duplicate scenes, but it did not remove the expensive read path:

- `GetHandler` read/decoded the whole project, loaded/decoded its presentation, called `ApplyPrepared`, reread the project, decoded the editor state and computed its full canonical fingerprint, then marshaled the complete response again. Opening the project at 11:25 took 6.884 seconds.
- Every `/v1/projects/:id/...` scoped API call also loaded the entire saved state simply to authorize/select the project's session.

The follow-up implementation makes viewing read-only and bounded:

- Project GET opens immutable file snapshots and streams the original project and presentation JSON. It does not decode the full editor state, fingerprint it, call `ApplyPrepared`, or serialize a second full response. Raw timeline/caption bytes are retained.
- Scoped API middleware reads only the bounded summary. Ownership checks and session activation remain in place.
- A complete-state autosave also reads only the previous summary for its version check, rather than loading the old multi-megabyte inline scene payload before replacing it. Metadata-only renames still preserve the existing state.
- Background generation/export completion still persists prepared edits. Browser-side `projectStateForOpen` already handles legacy recovery; GET no longer rebuilds or increments the saved project version. The browser now explicitly saves a compact snapshot once when a legacy inline scene was present, rather than waiting for an unrelated edit.
- Open snapshots remain readable across concurrent atomic autosaves; both handles are closed by response completion. `os.Root` operations preserve this behavior on Windows as well as Unix.
- MCP can consume only the exact project GET's JSON stream, bounded by its existing 2 MiB result cap. Media and other streamed responses remain excluded from MCP bodies.

Local Windows benchmarks of the new transfer path allocated approximately 8 KB/op for an 8 MiB state and 11 KB/op for a 56 MiB state. A buffered project read plus JSON marshal alone allocated approximately 27 MB/op for the 8 MiB case, excluding the old fingerprint/preparation overhead. These are allocation benchmarks, not a prediction of production container RSS or filesystem cache.

The follow-up does not delete or rewrite production files, deploy services, regenerate media, or change caption content. Production RSS must be checked again after this new API/client change is deployed. Tests cover exact streamed state/captions, ownership, legacy history recovery, simultaneous saves, closed file handles, bounded MCP streams and browser-side one-time compaction without render/generation requests. The active restored-3D-scene browser regression also passes; its synthetic video attachment is now explicitly supplied to the test compiler, as required by the existing media-reference validator.

## After deploying `a4d06ae`: autosaves and filesystem cache

The streaming change was deployed to both services on 2026-11-08. Subsequent project GETs completed in 121–390 ms in the inspected requests. They were followed by multiple full-state POSTs, including saves taking 0.7–5.5 seconds. The new GET path alone did not address those allocations.

Read-only production inspection after the reported remaining spikes found:

- Railway's sampled service memory: current 96,411,648 bytes, one-hour maximum 175,386,624 bytes. This window includes other work (a later completed render), not an isolated project-open benchmark.
- Go process: RSS 32,688 KiB, subsequently 29,672 KiB; high-water mark 122,644 KiB since the deployment.
- Cgroup accounting: 54,714,368 bytes of file cache, of which 54,591,488 were inactive file pages. This cache is reclaimable by Linux, distinct from a retained Go object per user. The inspected process list contained no Node/Chromium renderer. There was no scene-worker start during the observed opening intervals.
- Ordinary media thumbnail/waveform generation and ffprobe metadata checks can still run on a cache miss. They are not scene preview rendering; the media runner limits ffmpeg and ffprobe to at most two concurrent processes each, across requests. These subprocesses and filesystem cache are not included in Go heap measurements.

Two reproducible defects remained:

1. `SaveHandler` copied the complete state through `json.RawMessage`; `Update` copied the timeline just to check its presence, copied the state again, and `write` marshaled another complete JSON response into an encoder buffer. Large request buffers could remain attached to idle keep-alive requests. A handler benchmark with an already-received 8 MiB body allocated 38,654,172 bytes per save.
2. The media bin compared an immutable scene's pinned SHA-256 version to its S3 listing ETag. The unequal representations caused it to discard the saved asset ID and version and trigger an autosave after loading the preview. The browser regression reproduced the second POST and the changed IDs before repair.

The correction borrows validated request JSON only for the synchronous atomic write, writes the state verbatim between small metadata fields, and releases oversized request-body buffers after saving. The public `Store.Update` still returns an independently owned state. Invalid JSON never replaces the published snapshot. The same handler benchmark now allocates about 28 KB per save, **excluding the already-received HTTP body**; incoming large concurrent saves still require transport memory.

The media bin now preserves immutable scene identity across listing/preview hydration. Mutable media retain their ETag invalidation. The browser test covers both listed and unlisted scenes, one-time legacy compaction and reopening without a second autosave or a render/generation request.

A real loopback HTTP test transfers an 8 MiB project 100 times, sequentially and concurrently, draining responses instead of buffering them in the test:

| Scenario | Total allocations, client + server | Heap before / after / after explicit test GC |
| --- | --- | --- |
| 100 sequential opens | 4.41 MiB | 8.62 / 13.03 / 8.71 MiB |
| 100 concurrent opens | 7.79 MiB | 8.66 / 15.18 / 11.84 MiB |

These local measurements disprove linear payload retention for the project GET path. They do not measure production container RSS, cold media processing, or every editor request. GC is invoked only in the test to distinguish live memory from allocations; there is no production per-request forced collection, cache purge or memory-limit workaround.
