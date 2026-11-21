# MCP flow reliability

The canonical integration is `machinal`. Same-endpoint legacy aliases must not expose a duplicate MCP namespace or duplicate production instructions. Installer configuration edits preserve unrelated entries and create backups.

## Progress and elapsed time

Render snapshots carry one active `stage` with a `scope` (`scene` or `job`). Moving from scene capture to video/caption/audio processing, final encoding or publication replaces the scene's frame counters. Terminal views omit active stages and ETAs, including stale snapshots from older workers.

`performance` records bounded wall-clock phase durations and observed cache-hit/miss events. Cache-disabled is a separate state, not a cache miss. These are diagnostics, not evidence of faster rendering. Historical estimates can be restored from completed-job performance in the owned project after a worker restart. At least three successful samples are required; response fields disclose the sample count, historical range and why an estimate is unavailable. Weighted progress is not a time fraction.

## Caption corrections and review evidence

Free recipe preflight accepts an intact `captionBaseline`, exact `captionTextEdits: [{from, to}]` and `captionEditsApproved:true`. OpenCode supplies the baseline through `captionBaselineRecipeFile`. The original `expectedCaptionVersion` may still pin that baseline. The server compares the complete entries and caption job result IDs after only the authorized text/word replacements; timings, styles, IDs and grouping cannot change. Require `captionReview.status: preserved` before saving a new baseline.

Preflight checkpoints explicitly record `visualInspection:false`. Delivery metadata likewise reports only job/delivery evidence, not visual or audio inspection. Approved scene inspection remains a distinct free operation; final preview/rendering retains its existing consent and billing requirements. Do not automatically inspect unapproved sources or claim that successful compilation verifies pixels/audio.

## Contract diagnostics and billing

Production contract inputs expose concrete phase/treatment types and enums. Interval checks use timeline microseconds. Invalid intervals return a structured diagnostic path, actual interval and allowed beat bounds, rather than a combined kind-or-interval error.

`cost.renderUsage` persists the duration, tariff and billed credits for each newly recorded render debit. Existing pricing floors whole credits separately for each scene and final export; it does not floor their combined duration. Refunds remove the final export's corresponding usage entry. Legacy charges without usage metadata are not reconstructed using a potentially different current tariff.

## Local versus cross-device links

Loopback descriptors declare `reachability: same-machine` and a warning. `requirePublicLink:true` rejects such delivery before issuing a link. Cross-device links need an administrator-configured reachable HTTPS `PUBLIC_API_URL`; the integration does not invent an origin, expose ports or rerender completed output. `configured-origin` is configuration metadata, not a live connectivity test.

## Activation and verification

OpenCode reloads the local plugin/configuration without restarting its service. API and scene-service source changes require the existing deployment's normal rebuild/restart; do not interrupt active jobs or remove volumes. Existing completed videos require no new paid rendering.

Regression checks:

- `npm test` in `packages/mcp-installer`.
- `node --test http-server.test.mjs render-progress.test.mjs` in `services/scene-renderer` (mocked operations, no provider calls).
- `go test ./internal/platform/jobqueue ./internal/platform/mcpserver ./internal/platform/credits ./internal/core/editor/compositions ./internal/core/editor/render ./internal/core/editor/scenes ./internal/core/media ./internal/routes` in `api`.
- `go test ./... -run '^$'` in `api` compiles all packages without running integration work.
