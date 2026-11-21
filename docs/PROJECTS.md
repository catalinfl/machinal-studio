# Saved editor projects

Code paths in this guide are relative to the repository root. Run frontend commands from `client/`.

Signed-in users can create, rename and select projects from **Projects** in the editor header. Changes save automatically; the selector shows pending/saving/saved state and recoverable errors. Switching projects saves the current timeline before reloading the workspace, clearing in-memory preview, undo and AI state.

## Storage

- Project records: `/data/.projects/<PocketBase-user-id>/<project-id>.json`.
- Initial project: preserves the existing `u_<user-id>` media session and S3 prefix.
- Additional projects: server-generated `p_<random-id>` sessions, independent local media directories and S3 prefixes. Ownership is persisted in `/data/.project-owners/` and remains enforced after backend restart.
- Saved-project records and sole local originals survive automatic cleanup. Idle working caches, including those in saved-project workspaces, can be reclaimed under the verified-copy rules in [workspace retention](WORKSPACE_RETENTION.md). Keep the existing Docker `/data` volume mounted; `DATA_DIR` can select a native development directory.
- Browser-local/WASM originals are retained in IndexedDB, scoped by account and project. These originals remain in the importing browser; server-imported originals use the project's server space. Opening a project with unavailable browser-local originals reports the missing file and still allows selecting or creating another project.
- Timeline restoration retains tracks, clip edits, transforms, effects, transitions, text/captions, frame rate, resolution, aspect and composition-document state. Transient blob URLs, effect nodes, selections and undo history are regenerated/reset.
- Media Bin's pencil action saves a project-specific display name for any ready source or render. The original filename, source ID, preview URLs and export references stay unchanged; names persist with project autosave and appear on timeline clips and in inspectors. Renaming does not copy or move media.
- Clips within one project reference their existing originals. Separate projects currently have separate server spaces and browser-local storage scopes; importing the same file into multiple projects is not globally deduplicated.

## HTTP interface

All project endpoints require the current PocketBase Bearer token. Account ownership is derived from the verified token, never from request input.

- `GET /projects`: list summaries and initialize a default project for existing media.
- `POST /projects` with `{ "name": "My film" }`: create a project.
- `GET /projects/<id>`: load its state and activate the owned media session.
- `POST /projects/<id>` with `{ "name": "My film", "version": 1, "state": { ... } }`: save. Omit `state` to rename only. Stale versions return HTTP 409, with reload recovery in the editor.

Media requests keep `X-Session-Id` / `?session=` for scoping, but a predictable `u_<user-id>` is **not** read authorization. Fetch requests can send the owner's PocketBase Bearer token; native image/video/audio tags additionally use the separate `mediaToken` returned by the authenticated project load or session create/heartbeat response. The 256-bit token grants reads of that workspace only, never uploads, deletion or paid work. Unknown anonymous workspaces return 404 without creating directories. Registered opaque project/session identifiers retain their existing read-capability contract.

The browser keeps the read token in memory, scoped to the selected workspace and account; it is not the login JWT and is not written to localStorage. Each editor tab pins its active media session, so another tab's selection or a late session response cannot redirect its uploads. Heartbeats authorize their path ID and reject conflicting header/query IDs.

Read tokens are stored privately at `/data/.media-tokens/<session-id>` and survive idle media cleanup/restarts. Treat token-bearing URLs as bearer secrets: redact query strings in proxy/access logs and never share them. They do not expire automatically or revoke on logout. An operator can revoke a workspace's read capability by removing **only its token file** during controlled maintenance; the next authenticated issuance generates a replacement. Existing pages must reload afterward. Do not delete the working volume to rotate a token. Rebuild/deploy API and client together: old legacy-session URLs without read authorization intentionally stop working.

## Public local installation

The same project UI is implemented separately in the `machinal-public` repository. Its records and original media live exclusively in the local Docker `composition-data` volume. It uses `X-Project-Id` / `?project=` scoping with no authentication or cloud dependencies. Local/WASM originals are copied to the project's local API storage during automatic saving. See that repository's README for paths and startup.

## Verification

Focused browser coverage: `pnpm exec playwright test e2e/projects.spec.ts`. The main application uses mocked authentication/API with actual browser IndexedDB restoration; the public test opts into a real isolated Docker API using `LOCAL_WORKSPACE_TEST=1`, `E2E_API_BASE`, and optionally `PROJECT_DOCKER_NAME` for restart verification. Backend tests cover persistence, migration, account ownership, version conflicts and isolated media deletion.
