# Saved editor projects

Code paths in this guide are relative to the repository root. Run frontend commands from `client/`.

Signed-in users can create, rename and select projects from **Projects** in the editor header. Changes save automatically; the selector shows pending/saving/saved state and recoverable errors. Switching projects saves the current timeline before reloading the workspace, clearing in-memory preview, undo and AI state.

## Storage

- Project records: `/data/.projects/<PocketBase-user-id>/<project-id>.json`.
- Initial project: preserves the existing `u_<user-id>` media session and S3 prefix.
- Additional projects: server-generated `p_<random-id>` sessions, independent local media directories and S3 prefixes. Ownership is persisted in `/data/.project-owners/` and remains enforced after backend restart.
- Saved-project records and sole local originals survive automatic cleanup. Idle working caches, including those in saved-project workspaces, can be reclaimed under the verified-copy rules in [workspace retention](WORKSPACE_RETENTION.md). Keep the existing Docker `/data` volume mounted; `DATA_DIR` can select a native development directory.
- Browser-local/WASM originals are retained in IndexedDB, scoped by account and project. These originals remain in the importing browser; server-imported originals use the project's server space. Missing local files no longer block opening the timeline: an offline-media panel offers **Relink file**. Relinking checks media kind, dimensions and sufficient source duration, not cryptographic identity; it preserves clip IDs, timing, captions and measured words. Choose the original file.
- Timeline restoration retains tracks, clip edits, transforms, effects, transitions, text/captions, frame rate, resolution, aspect and composition-document state. Transient blob URLs, effect nodes, selections and undo history are regenerated/reset.
- Media Bin's pencil action saves a project-specific display name for any ready source or render. The original filename, source ID, preview URLs and export references stay unchanged; names persist with project autosave and appear on timeline clips and in inspectors. Renaming does not copy or move media.
- Clips within one project reference their existing originals. Separate projects currently have separate server spaces and browser-local storage scopes; importing the same file into multiple projects is not globally deduplicated.

### Caption image assets and autosave

The browser snapshots caption text, words, timings, styles and job IDs unchanged. Large prepared PNG overlays are persisted once as immutable project-owned text assets, identified by their SHA-256 bytes and render key. Ordinary autosaves contain `preparedTextRef` references, not repeated base64 PNG payloads. Loading verifies and restores those exact assets without rendering or generation. Distinct raster versions remain distinct even if their semantic render key is equal.

Text assets live under `/data/.projects/<owner>/.text-assets/<project>/<key-hash>/<content-sha256>.json`, on the persistent project volume, not in idle session caches. A project can retain at most 1,024 text assets and 512 MiB of text-asset data; each upload also obeys the existing 128 MiB project-body limit. Missing assets fail the save before its previous state/version is replaced. Legacy inline projects remain readable and migrate through an ordinary versioned save; successful images are never regenerated for migration. Back up this directory with the project records.

Deploy the API support before the updated web client. An older API cannot persist reference-based saves, and a rollback must retain a client capable of resolving these references. This is editor snapshot storage, not a new YAML recipe field.

Authentication refresh for the same account no longer reinitializes the editor. A save conflict enters a separate state: queued saves, autosave and visibility flushes stop instead of repeatedly sending the old version. The tab retains its draft and offers **Download unsaved draft** and **Reload project**, not a blind Retry. The draft is a complete editor-state JSON backup, including its prepared raster payloads, not a standalone recipe or a copy of original media files. No conflict recovery silently overwrites another tab.

## Named versions and project copies

**Projects → Saved versions** keeps up to 20 named checkpoints / 512 MiB per project under `/data/.projects/<owner>/.versions/<project>/`. Checkpoint saves use the current optimistic version. Restore first keeps the current edit as another checkpoint, then performs a normal versioned save; a conflicting tab cannot overwrite a newer edit. Captions and resolved generation IDs are retained exactly. Checkpoints reference existing originals, so deleting original media can still make a historical version unavailable. Removing a checkpoint does not remove originals.

**Duplicate project with originals** creates an independent project/session, streams copies of its server media (up to the configured session quota / 10 GiB), copies referenced immutable text assets, and copies available local originals into the new browser IndexedDB scope. It does not generate or render media. Missing or cloud-unavailable sources fail explicitly; local originals missing on this browser remain offline in the copy. A copy does not share mutable media storage with its parent.

**Render** shows duration, resolution, FPS, framing, warnings, live balance and an approximate rendering estimate when configured rates are available. Uploading local originals for server export requires a separate checkbox. Only sources referenced by the export are uploaded under unique names; successful uploads are reused within the mounted session. The uploaded export does not replace local references in the current browser timeline. Provider generation is not included in the rendering estimate; actual scene/video processing remains billed separately after usage.

Autosave subscribes to committed document/media changes and captures/serializes only after its debounce, instead of deep-cloning the whole project on every drag update. Playback/selection do not trigger project serialization. Before-unload still warns about committed unsaved changes.

## Recipe/MCP projects are editable projects

A recipe is an authoring/checkpoint format, not the delivered project. Successful recipe generation and final rendering save their resolved edit as the owned project's actual `state.timeline` and `state.media`, even before a browser opens it. This includes source clips/live scenes, narration, exact caption entries and resolved job IDs, effects, transitions, transforms/keyframes and output settings. The final MP4 stays a separate export; it is not flattened back into a one-clip timeline.

An empty or media-only workspace is populated automatically. An untouched prepared timeline advances through subsequent timing/visual passes; manually edited timelines, renamed media and intentionally cleared documents are not silently overwritten. Background saves and HTTP autosaves share optimistic concurrency protection; stale browser saves receive 409 instead of erasing a newly prepared edit. Legacy media-only states are repaired from retained owned snapshots on project load, without generating or rendering anything.

Projects also offers **Open prepared timeline** and **Open rendered timeline** for explicit recovery/replacement, with confirmation, autosave and the existing media kept. These actions open the real edit in the timeline, not a JSON download, and do not incur generation/render charges. A filename-only historical export without a retained composition cannot be reconstructed exactly; the UI reports that limitation instead of inventing a project.

Deploy the API and web client together to activate this behavior. Source changes and passing local tests do not update an already running hosted installation or repair a historical export that never retained an editable snapshot.

## HTTP interface

All project endpoints require the current PocketBase Bearer token. Account ownership is derived from the verified token, never from request input.

- `GET /projects`: list summaries and initialize a default project for existing media.
- `POST /projects` with `{ "name": "My film" }`: create a project.
- `GET /projects/<id>`: load its state and activate the owned media session.
- `POST /projects/<id>` with `{ "name": "My film", "version": 1, "state": { ... } }`: save. Omit `state` to rename only. Stale versions return HTTP 409, with reload recovery in the editor.
- `POST /projects/<id>/text-assets/<sha256>?key=<render-key>`: persist one exact prepared-text JSON asset, after checking ownership, content digest and storage limits. Identical uploads are idempotent.
- `GET /projects/<id>/text-assets/<sha256>?key=<render-key>`: stream that owned immutable asset. It is not an anonymous media capability or an S3 delivery URL.

Media requests keep `X-Session-Id` / `?session=` for scoping, but a predictable `u_<user-id>` is **not** read authorization. Fetch requests can send the owner's PocketBase Bearer token; native image/video/audio tags additionally use the separate `mediaToken` returned by the authenticated project load or session create/heartbeat response. The 256-bit token grants reads of that workspace only, never uploads, deletion or paid work. Unknown anonymous workspaces return 404 without creating directories. Registered opaque project/session identifiers retain their existing read-capability contract.

The browser keeps the read token in memory, scoped to the selected workspace and account; it is not the login JWT and is not written to localStorage. Each editor tab pins its active media session, so another tab's selection or a late session response cannot redirect its uploads. Heartbeats authorize their path ID and reject conflicting header/query IDs.

Read tokens are stored privately at `/data/.media-tokens/<session-id>` and survive idle media cleanup/restarts. Treat token-bearing URLs as bearer secrets: redact query strings in proxy/access logs and never share them. They do not expire automatically or revoke on logout. An operator can revoke a workspace's read capability by removing **only its token file** during controlled maintenance; the next authenticated issuance generates a replacement. Existing pages must reload afterward. Do not delete the working volume to rotate a token. Rebuild/deploy API and client together: old legacy-session URLs without read authorization intentionally stop working.

## Public local installation

The same project UI is implemented separately in the `machinal-public` repository. Its records and original media live exclusively in the local Docker `composition-data` volume. It uses `X-Project-Id` / `?project=` scoping with no authentication or cloud dependencies. Local/WASM originals are copied to the project's local API storage during automatic saving. See that repository's README for paths and startup.

## Verification

Focused browser coverage: `pnpm exec playwright test e2e/projects.spec.ts e2e/project-previews.spec.ts e2e/project-concurrency.spec.ts e2e/project-open-memory.spec.ts e2e/recipe-project-restore.spec.ts`. The main application uses mocked authentication/API with actual browser IndexedDB restoration; the public test opts into a real isolated Docker API using `LOCAL_WORKSPACE_TEST=1`, `E2E_API_BASE`, and optionally `PROJECT_DOCKER_NAME` for restart verification. Backend tests cover persistence before browser access, complete composition-to-editor mapping, caption/job-ID preservation, media-only recovery, manual-edit protection, account ownership, version conflicts, immutable text assets and isolated media deletion.
