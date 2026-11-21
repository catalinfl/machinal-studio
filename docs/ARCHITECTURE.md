# Architecture

## Editing and rendering

The browser editor captures a document/snapshot, the Go compiler resolves it to a validated composition, and render adapters execute that plan. AI proposes document changes or materializes explicitly requested assets; it does not replace compiler validation. Ordinary compilation does not call providers or render media.

- `api/editengine/document`: strict public input contract and time representation.
- `api/editengine/compiler`: normalization, validation, binding, timing and diagnostics.
- `api/editengine/composition`: resolved render input.
- `api/internal/core/editor`: application orchestration, generation and native export.
- `api/internal/platform`: authentication, storage, persistent jobs, credits and MCP transport.

The independently published `@machinal/scenes` npm package owns explicit frame time, resource readiness and Chromium/FFmpeg capture. The client consumes its public `/runtime` entrypoint; `services/scene-renderer` compiles application scenes and invokes the native renderer included in the same package. Library sources, native builds and library release CI live in [the separate repository](https://github.com/catalinfl/machinal-scenes), not this checkout. The private service remains an authenticated application adapter, not a public render endpoint. Saved scenes using the former `@direction/scene-*` imports are mapped to the installed public entrypoints by the compiler. Reproducibility controls do not make generated JavaScript safe for arbitrary host execution; container/process isolation remains required.

## Client boundaries

- `components/`: markup and DOM-facing interaction.
- `composables/`: feature-scoped reactive orchestration.
- `stores/`: shared application state and public editor/render facades.
- `lib/`: pure transformations and focused browser/service adapters.

The `editor` facade remains compatible with existing callers. `lib/editor-types.ts` owns domain shapes; the facade re-exports them for existing consumers. `useEditorHistory.svelte.ts` owns bounded history, microtask batching, nested transactions, cancellation and rollback; the editor supplies snapshot capture/restore and document notifications. Clip-time arithmetic lives in `lib/clip-time.ts`; collision/overlap/trim geometry and shared lane packing live in `lib/timeline-geometry.ts`, without importing runtime store state.

The render facade owns node scheduling and browser effects. `lib/render-segments.ts` computes source-time regions and filter payloads from explicit clip/block input, without DOM, network or editor singleton access. `useWasmLoader.svelte.ts` owns the loader state machine, concurrent load sharing and retry lifecycle.

`usePreview.svelte.ts` orchestrates presentation. `lib/preview-playback.ts` owns media play promises, seek synchronization, voice lifetime and the WebAudio graph. Late play completion must verify element identity and desired state, so a replaced/disposed element cannot restart playback.

Keep new functionality behind these boundaries rather than adding more unrelated state to a facade. Extract coherent behavior with direct tests, not arbitrary line-count fragments. Larger clip-editing and visual-composition operations still live in the facades and should be decomposed incrementally under their regression suites.

## Persistence and operation

PocketBase supplies accounts and the durable hosted job queue; its migrations/hooks are external deployment prerequisites, absent from this checkout. Owned project state, media and the bbolt credit ledger use persistent API storage, with optional S3 integration. Browser-local originals use account/project-scoped IndexedDB and are not automatically available on another device.

Run one API instance with its persistent volume. Queue atomicity alone does not make the local ledger or media volume horizontally scalable. Interrupted running jobs are not blindly replayed because provider calls may already have incurred costs. Credits settle actual usage rather than reserving a wallet in advance.

See [projects](PROJECTS.md), [jobs](BACKGROUND_JOBS.md), [credits](API_CREDITS.md) and [testing](TESTING.md) for detailed contracts.
