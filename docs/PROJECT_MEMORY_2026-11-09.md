# Project RAM, duplicate loads and autosave conflicts — 2026-11-09

## Scope and confidence

Read-only investigation of Railway `viral-server`, its deployed source and the browser client. No production data was rewritten, no service configuration was changed, and no deployment/restart/render/generation was performed.

- API deployment: `a1e0d5bc14a4459f46a60c86e9c2b035ff9ad12b`.
- Client deployment: `1285ad924c7955480cde8ca62f1b7d77771a543b`.
- The reviewed local API/runtime and client source have no differences from those deployed revisions.
- Browser reproductions used synthetic accounts and mocked external requests. HTTP memory reproductions used synthetic local project data, not production requests.
- Temporary diagnostic test files were removed after recording their results. Application source was unchanged during that investigation; subsequent local implementation is recorded below.

The investigation proves unnecessary large autosave payloads, same-owner auth-triggered reloads and stale-version retries. It does not retrospectively attribute every byte of the 15:39 service-memory spike to one allocator: no heap/process profile was captured at that historical instant.

## Observed production interval

Times below are Romania time, UTC+02:00. MB means decimal MB; local allocation results later use MiB.

| Time | Railway service RAM |
| --- | ---: |
| 15:37:00 | 108.93 MB |
| 15:37:30 | 109.22 MB |
| 15:38:00 | 131.27 MB |
| 15:39:00 | 133.14 MB |
| 15:40:00 | 133.20 MB |
| 15:40:30 | 123.22 MB |
| 15:41:00 | 112.51 MB |
| 15:43:00 | 112.08 MB |
| 15:47:30 | 112.12 MB |

The increase was approximately 24 MB, most of which was subsequently released. This interval is not evidence of a permanently retained 20–30 MB allocation per project opening.

Between 15:37:35 and 15:40:00 the HTTP logs contain:

- Four project-list GETs and four project-detail GETs: paired loads for each of two project selections.
- Two sustained heartbeat sequences for the same selected project, at approximately 30-second intervals.
- Eight project POSTs: two accepted, six returning 409.
- 52 download GETs: 12 status 200, eight 206, 28 304 and four client cancellations (499).
- Six thumbnail requests and three waveform requests.

The paired heartbeats indicate multiple live browser/session contexts, not merely an OPTIONS preflight followed by its request. Logs do not identify browser tab IDs, so they cannot independently prove which tabs/windows were open.

The active API deployment returned no runtime log entries when queried around the opening, through approximately 15:42. Later process inspection found no scene-renderer Node/Chromium worker. This provides no evidence that scene rendering caused the reported spike.

## Finding 1: caption raster cache is serialized twice in every full autosave

Read-only structural inspection of the affected saved project returned:

| Field | JSON bytes |
| --- | ---: |
| Project file | 8,251,508 |
| State | 8,251,273 |
| `state.timeline` | 8,243,082 |
| `state.media` | 8,011 |
| `timeline.textItems` | 32,450 |
| `timeline.documentSession` | 8,204,112 |
| `documentSession.composition` | 4,099,247 |
| `documentSession.preparedText` | 4,056,866 |
| `documentSession.composition.preparedText` | 4,056,866 |

The two `preparedText` values are identical. Each contains 140 overlays; their base64 PNG image strings total 4,048,452 characters per copy. The duplicated prepared-text values account for approximately 98.3% of the saved state. There are zero inline scene bundles: the earlier scene-payload fix remains effective.

Creation/retention paths:

- `api/internal/core/projects/editor_state.go:130-136` serializes both the complete compiled composition and its prepared text beside it.
- `client/src/lib/project-presentation.ts:48-60` constructs the equivalent duplicate for browser recovery.
- `client/src/lib/compositions.ts:164-168` also stores both after compilation.
- `client/src/stores/editor.svelte.ts:752-754` clones the full document session into snapshots.
- `client/src/composables/useProjects.svelte.ts:94-105` and `client/src/lib/project-api.ts:30-35` send the complete captured state on each save.

Even a rejected stale save therefore uploads the large cache again. The version conflict is checked in `Store.update`, after the HTTP transport has received the body and the handler has parsed its envelope.

### Local real-HTTP reproduction

A temporary loopback test sent an 8,200,098-byte synthetic JSON body through Fiber/fasthttp and the actual `SaveHandler`. Payload construction happened before allocation measurement. Client and server ran in one process; these are allocations, not production RSS measurements.

| Scenario | Status | Request-body capacity | Total allocations |
| --- | --- | ---: | ---: |
| One accepted save | 200 | 8 MiB | 8.17 MiB |
| One stale save | 409 | 8 MiB | 8.15 MiB |
| Two concurrent saves | 200 + 409 | 16 MiB | 16.27 MiB |

While both concurrent request bodies were held, heap usage rose from 8.42 to 24.64 MiB. `ReleaseBody` cleared the large body after both accepted and rejected saves; collection afterwards reclaimed temporary allocations. Test-only forced GC was used for diagnosis, never on the production server.

The large request buffers are a demonstrated transient allocation source of the same order as the observed spike. Media work and filesystem/runtime memory can add to it. This is not a fixed per-user memory reservation.

For comparison, the existing `TestProjectOpenMemoryOverRealHTTP` passed again: 100 streamed 8 MiB GETs allocated 4.41 MiB sequentially or 7.62 MiB concurrently, across all 100 requests and both client/server. Project GET alone does not retain a whole project-sized heap buffer per open.

## Finding 2: same-owner authentication updates reload the editor

`client/src/stores/auth.svelte.ts:39` replaces the reactive user object on auth-store changes, including token refresh/storage events. `useProjects.svelte.ts:169-172` reads `auth.user.id` through `projectOwner()` directly in an effect and calls `initialize` whenever that dependency is invalidated. There is no same-owner initialization guard.

Synthetic Chromium reproduction:

1. Open one editor: one project-list GET, one project-detail GET and one editor DOM instance.
2. Save the auth store again with the same user ID.
3. Observe a second list/detail pair and project restoration, despite no account or project change.

Opening a second tab refreshes authentication in that tab. Its shared auth-storage update can make the first tab reload its project as well. This reproduced the paired-load pattern locally. The first tab also reads the shared active-project preference again, which can produce an unintended project switch after another tab changes that preference.

This is separate from legitimate multi-tab request traffic. The existing session module maintains one heartbeat timer per JavaScript context; two persistent streams are consistent with two contexts. Production logs alone cannot identify their exact origin.

## Finding 3: retry after a version conflict resends the same stale version

The backend version check in `api/internal/core/projects/store.go:224-225` is correct: it prevents one editor from overwriting another editor's newer state.

The client loses the structured HTTP status in `project-api.ts:36-38`. `useProjects.svelte.ts:112` registers ordinary `save` as the retry action for every failure. There is no distinct conflict state. Retrying, subsequent edits or a visibility flush can resend the same full state with the same old version.

Synthetic two-tab Chromium reproduction:

- Both tabs load version 2.
- Tab A saves successfully, advancing the server to version 3.
- Tab B saves version 2 and gets 409.
- Clicking Retry in tab B sends version 2 again and gets 409 again; there is no intervening project GET/reconciliation.

Both browser diagnostics passed by asserting this current defective behavior. They are diagnostic reproductions, not evidence that the defects are fixed.

## Secondary contributor: waveform work is repeated on the server

`api/internal/core/media/waveform.go:49-58,82-114` starts a new FFmpeg decode for each waveform request. It does not use the shared media cache or the bounded `mediacache.Run` encoder lane. The browser deduplicates waveform loads only within its own JavaScript context (`useWaveform.svelte.ts:10,128-145`); a reload or another tab repeats server decoding.

Thumbnails do use the shared cache. Six successful thumbnail requests do not prove that six fresh FFmpeg encodes ran; some can be cache hits. Their exact historical RAM contribution was not measured.

## Service memory is not Go heap

Before the explicit Node-based structural inspections, `/proc` reported approximately 33.2 MiB RSS for the Go server. A cgroup snapshot showed approximately 73.8 MB of file-backed memory, separate from anonymous process memory and kernel accounting. RSS and cgroup file values overlap and must not be added as independent buckets.

SSH inspection introduces small temporary diagnostic processes. The later structural inspections also briefly start Node; those diagnostic allocations must not be interpreted as additional user-triggered spikes. They happened after the reported 15:39 event.

## Recommended repair order — not applied

1. Store prepared text once, then reference/reuse it. Ultimately keep immutable raster payloads out of ordinary autosave bodies and hydrate them by their verified render key. Preserve exact captions, word timings, styles and successful raster assets; do not regenerate or discard them as a memory workaround. Removing only one duplicate would roughly halve this project's payload; externalizing both cache copies leaves approximately 138 KB of other state, before adding references. These are size estimates, not guaranteed RSS savings.
2. Initialize projects only when the actual account ID changes, not on a same-owner token/profile update. Manual retry/recovery should remain explicit and should not discard unsaved work.
3. Preserve typed request errors and add a distinct conflict state. Stop automatic retries of a stale version, preserve the draft and offer safe reload/reconciliation. Do not simply increment the version or overwrite the newer project. Consider coordinated single-writer behavior across tabs.
4. Cache waveform results by source revision and use bounded, cancellable server decode concurrency across requests.
5. Measure an isolated one-tab opening again after repairs, separating request-body size, Go heap/RSS, file cache and subprocess peaks. Do not use per-request forced GC, restarts or host-wide cache purges to hide the underlying payload/retry problems.

## Subsequent implementation — local only

The four repairs were implemented after the user approved them. No Railway deployment, restart or production-data migration has been performed.

- Project autosaves now use content-addressed `preparedTextRef` assets. Their exact PNG JSON is uploaded once per content identity/project, persisted atomically on the project volume and reused after reopening. Both duplicate locations reference one asset when their bytes match. Restores verify SHA-256 and render keys, and missing references cannot replace a saved project. Ordinary snapshot capture removes the inline rasters before deep cloning or stringifying the state, not afterwards. Existing inline snapshots remain readable.
- The auth dependency is now the derived account ID. Same-account token/profile updates do not reinitialize project loading or discard a draft.
- Typed HTTP errors distinguish optimistic concurrency conflicts. A conflict stops queued/automatic/visibility saves, preserves the unsaved state and offers a complete JSON draft download and explicit reload. Retry does not resend a known stale version.
- Waveforms now use the existing source-revision-keyed disk cache and single-flight generation. Identical concurrent requests share one decode; changed source versions invalidate it. FFmpeg streaming uses the existing shared encoder slots, one decoder/filter thread, bounded stderr, a two-minute timeout and bounded peak arrays. Consumer failures cancel/reap the child before releasing its slot. Cached JSON supports ETag revalidation and streaming responses.

Permanent synthetic regression coverage includes a duplicated 8 MB raster cache whose ordinary autosaves stay below 20 KB, one upload across repeated saves/reopens, exact caption text/word/style/job-ID retention, same-owner auth refresh without a reload, two-tab conflict suppression and exact draft recovery. Existing prepared-timeline desktop/mobile light/dark tests exposed a confirmation-click race with background saving: that confirmation now remains usable during autosave, since its eventual replacement already awaits the save queue.

Verification: 1,209 frontend unit tests and 11 focused Chromium browser tests passed, together with Svelte/TypeScript checks, the complete Go suite, `go vet ./...` and race tests for projects/media/media-cache. Production RSS savings remain unmeasured until the API and client are deployed and an isolated real opening is observed. The one-time asset upload for a legacy project still needs a normal request buffer; it is not a claim of zero transient RAM.
