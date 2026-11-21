# Project-open egress — 2026-11-10

## Observed cause

Read-only Railway HTTP/network-flow logs for `viral-server` around 14:59:19–14:59:27 UTC show two dominant API-response flows:

| Correlated request | Network bytes |
| --- | ---: |
| Project detail GET | 48,120,898 |
| Project caption `text-assets` GET | 23,945,887 |
| Total of those flows | 72,066,785 |

The scoped 14:59:15–14:59:45 UTC network-flow sample contained 72,320,737 outgoing bytes overall, including 72,115,235 on API-response connections. These are observed network bytes, not JSON file sizes or a statement about the billing meter's exact accounting.

Read-only structural inspection found a 110,593-byte saved project and a 45,596,917-byte retained presentation. `prepared.composition.preparedText` and `lastRender.composition.preparedText` each contained the same 22,726,684-byte cache with 924 overlays. Both caches had the same SHA-256 as the separately requested text asset. No caption/media contents, credentials or signed URLs were copied into this report.

The media download/thumbnail/waveform requests returned 302 S3 redirects. The remaining large egress was JSON containing raster images, not a video-proxy regression. Both project detail and text-asset routes previously used `no-store`.

## Repair

- Presentation writes externalize exact prepared raster JSON into the existing immutable project text-asset store. Both retained snapshots reference it. Legacy presentations compact once, atomically, without rewriting project state/version, caption entries or job IDs; subsequent reads keep the existing bounded streaming path.
- Newly server-prepared editor states also use references, so generation/export completion does not recreate duplicate inline caches.
- Authorized cloud text-asset requests publish/reuse one private owner/project-scoped object and return a signed S3 redirect. Publication/signing failures fail closed, never stream the cache through the API.
- Browser Cache Storage retains the exact verified JSON under an account/project/content/render-key identity, bounded to 64 MiB and 12 entries. No signed URL or Authorization header is persisted. Reloads and other same-browser tabs can reuse the asset without another network download. Corrupt cache entries are rejected and refetched; storage failures do not regenerate text or discard the edit.
- Prepared-timeline reopening and JSON export hydrate the existing reference before using the successful raster payload. Captions, words, geometry and generation result IDs remain unchanged.

## Cost boundary and rollout

This removes the repeated large **API-to-browser** raster transfer. It cannot make all service traffic zero: small authorized JSON/redirect responses remain. A legacy text cache not already in S3 requires one initial publication; with public-network bucket access that upload is still Railway egress. Browser-cold downloads then come from S3 and retain that provider's applicable delivery charges. Warm-cache opens avoid the raster download entirely.

API and client changes must be deployed together, then existing editor tabs refreshed. Implementation and synthetic tests do not establish a measured production post-deploy result. Do not claim zero billed egress or silently deploy/migrate production data based only on this report.

A subsequent read-only, in-memory projection against the same saved project reduced its presentation from 45,596,917 to 143,866 JSON bytes, projecting a 254,475-byte project response including its 110,593-byte saved state and response junction. The complete prepared/last-render documents and compiled caption entries hashed identically before/after; both cache identities matched the existing project text reference. This is a payload-size projection, not a measured post-deploy Railway billing result. No production writes, cloud uploads, renders, restarts or deploys were performed.

## Verification

- Complete Go test suite and `go vet ./...` passed; projects/object-store race tests passed.
- All 1,225 frontend unit tests passed. The 25 focused presentation/text-asset/cache tests passed again after the final cache-pruning change.
- Svelte/TypeScript check: zero errors/warnings; production client build passed (existing Rollup annotation/chunk-size warnings remain).
- Ten Chromium regression tests passed, covering legacy scene compaction, multi-tab conflict preservation, caption raster reuse and prepared-timeline opening/export at desktop/mobile sizes in light/dark themes.
- The new browser regression follows a real cross-origin 302 into a loopback synthetic storage server. The storage request has no Authorization header; reload and a second tab make no second raster download. Reference-only JSON export recovers the exact successful raster cache without extra network/provider work.

An initial browser run exposed an invalid test interception of the post-redirect URL (Playwright only intercepts the first request in that chain), and one existing recorded-video fixture timed out during playback. The storage fixture was corrected to real bounded loopback HTTP, and the complete ten-test run subsequently passed. No production render or paid diagnostic was used.
