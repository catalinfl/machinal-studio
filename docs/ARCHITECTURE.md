# Architecture

## Editing and rendering

The browser editor captures a document/snapshot, the Go compiler resolves it to a validated composition, and render adapters execute that plan. AI proposes document changes or materializes explicitly requested assets; it does not replace compiler validation. Ordinary compilation does not call providers or render media.

- `api/editengine/document`: strict public input contract and time representation.
- `api/editengine/compiler`: normalization, validation, binding, timing and diagnostics.
- `api/editengine/composition`: resolved render input.
- `api/internal/core/editor`: application orchestration, generation and native export.
- `api/internal/platform`: authentication, storage, persistent jobs, credits and MCP transport.

The `@machinal/scenes` npm package owns explicit frame time, resource readiness and Chromium/FFmpeg capture. The client consumes its `/runtime` entrypoint; `services/scene-renderer` compiles application scenes and invokes the native renderer included in the same package. Reproducibility controls do not make generated JavaScript safe for arbitrary host execution; container/process isolation remains required.

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

Durable job state lives in `/data/.jobs.db` (bbolt), and saved projects live in `/data/.projects`. Browser-local originals use IndexedDB and are not automatically available on another device. Missing sources open offline and can be relinked without retiming the edit.

Run one API instance with its persistent volume. Interrupted running jobs are not blindly replayed because provider calls may already have incurred costs.

See [projects](PROJECTS.md) and [testing](TESTING.md) for detailed contracts.
