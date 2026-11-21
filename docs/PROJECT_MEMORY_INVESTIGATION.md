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
