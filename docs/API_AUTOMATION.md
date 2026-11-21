# YAML video automation

Commands and code paths in this guide are relative to the repository root unless stated otherwise.

One project-scoped contract is available in the hosted app and the separate `machinal-public` local installation. A **machinal application API key** authenticates hosted calls. It is unrelated to any AI provider key.

## Hosted setup (administrator)

1. Obtain the deployment's `pocketbase/pb_migrations/1791936000_direction_api_keys.js` and apply it to the existing PocketBase installation (PocketBase 0.23+ collection API). **The PocketBase migrations/hooks are external deployment assets, absent from this checkout.** Do not assume cloning this repository provisions PocketBase. The `direction_api_keys` collection is locked to ordinary clients. Do not change its rules to public or expose its hashes.
   Also apply `1792540800_direction_jobs.js` and install the complete `pocketbase/pb_hooks/` jobs hooks on that server before updating the API. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) for setup and response contracts.
2. Set backend-only `POCKETBASE_URL` and `PB_SERVICE_TOKEN`. The latter is a valid PocketBase service/superuser token able to read authoritative users/subscriptions and manage the locked key collection. Keep it out of `VITE_*`, YAML, logs and source control. Payment fields on users/subscriptions must be server-managed.
3. Keep the existing S3 configuration (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) and persistent `/data` volume. S3 belongs to the application; API callers never supply bucket credentials or arbitrary object URLs. Without S3 configuration, the existing local storage fallback remains; production cloud persistence requires S3.
4. Rebuild the scene service with `docker compose -f compose.editengine.yaml up --build`. It now prepares text using the **same Canvas renderer** as the client. The scene service stays internal and uses `SCENE_SERVICE_TOKEN`; this is not a customer API key.

Missing PocketBase configuration fails closed with HTTP 503. This change supplies a migration and integration, not a deployment to your external PocketBase instance.

## Application keys

For Claude Code, OpenCode and Codex, the hosted API also exposes an authenticated **`/mcp`** endpoint using these same application keys. See [MCP.md](MCP.md) for connection examples, recipe tools, asynchronous rendering and private video transfers. No separate MCP account or key type is required.

In **API Keys** (`/api-keys`), create a named key with an active Premium account. Copy the complete `mach_…` key once; only its SHA-256 hash and a short prefix are stored. Up to 10 active keys may be issued. Revocation is explicit and takes effect on the next request. Premium is checked at creation and at every authenticated API request, including status/download.

The same page shows the shared included and purchased API credit balance. Prepaid Pro includes 1,000 credits per 30-day paid period; external subscriptions retain their displayed calendar-month allocation. Purchased credits do not expire but require active paid access. Costly versioned API operations require server-configured usage rates. See [API_CREDITS.md](API_CREDITS.md) for pricing configuration, PayPal Business, persistent storage and usage reconciliation before enabling paid generation or rendering.

Application-key clients can read that account's live wallet with `GET /v1/billing/credits` (MCP: `get_credits`). The response includes available/monthly/purchased/reserved credits, debt, pending usage, next reset and configured pricing. It does not accept an owner ID, perform paid work or initiate checkout. The MCP installer can choose a local or hosted API, show this balance and install editing/YAML/credit skills; its local mode still connects to this authenticated API and is not the public/keyless installation described below.

Key management uses your **login** credential, not an application key:

- `GET /api-keys`: safe metadata, never the secret or hash.
- `POST /api-keys` with `{ "name": "Production automation" }`: Premium-only, returns the secret once.
- `DELETE /api-keys/<id>`: revoke only a key belonging to the logged-in account. Listing/revocation remain available after Premium ends.

## What a caller sends

Upload original video/audio/images **once**, then send YAML referencing their filenames. Existing media in the selected project's storage can be reused without re-uploading. Source bytes are not embedded in YAML; `assets` may be omitted when binding IDs are filenames. Explicit `{id, file}` asset entries allow custom IDs. Missing kind/version/duration metadata is resolved on the server. Immutable, pinned manifests remain supported.

Example `composition.edit.yaml` (each source needs at least 4 seconds):

```yaml
document:
  version: 1
  mode: assemble
  inputs:
    shots: {kind: video, multiple: true}
  sequence:
    use: shots
    each:
      take: {from: 0s, duration: 4s}
      source_audio: remove
  output: {aspect: landscape, resolution: 720p, fps: 30, format: mp4}
bindings:
  shots: [clip.mp4]
```

Set `API_ORIGIN`, `MACHINAL_API_KEY` and `PROJECT_ID` in your environment. Header authentication is required; never place the key in a URL.

For a vertical crop without fitting the entire landscape image into the narrow frame, use `output: {aspect: portrait, resolution: 1080p, fit: cover}`. This preserves proportions and center-crops the left/right sides. `fit: contain` is the backwards-compatible default and keeps the entire image with bars when necessary. The same framing setting is used by the browser preview and local/server exports.

```sh
# Select an existing project (including its existing storage), or create one.
curl "$API_ORIGIN/v1/projects" -H "Authorization: Bearer $MACHINAL_API_KEY"
curl -X POST "$API_ORIGIN/v1/projects" \
  -H "Authorization: Bearer $MACHINAL_API_KEY" \
  -H 'Content-Type: application/json' --data '{"name":"API videos"}'

# Only for an original that is not already in this project.
curl "$API_ORIGIN/v1/projects/$PROJECT_ID/upload" \
  -H "Authorization: Bearer $MACHINAL_API_KEY" -F 'file=@clip.mp4'

# Returns HTTP 202 with id, status and progress; Location points at the status route.
curl -X POST "$API_ORIGIN/v1/projects/$PROJECT_ID/renders" \
  -H "Authorization: Bearer $MACHINAL_API_KEY" \
  -H 'Content-Type: application/yaml' --data-binary '@composition.edit.yaml'

curl "$API_ORIGIN/v1/projects/$PROJECT_ID/renders/$JOB_ID" \
  -H "Authorization: Bearer $MACHINAL_API_KEY"
curl "$API_ORIGIN/v1/projects/$PROJECT_ID/download?file=$FILENAME" \
  -H "Authorization: Bearer $MACHINAL_API_KEY" --output result.mp4
```

The YAML render job resolves local/S3 sources, runs unmaterialized image/voice/scene/caption actions through the **existing services**, prepares text, then encodes video. Already-materialized actions are not regenerated. Text does not require opening the editor first. New `/v1` multipart source uploads remain on the persistent project volume, without automatic S3 publication; back up that volume. Existing S3 sources hydrate to the volume before processing. Successful versioned renders are still published to configured S3 before completion. Existing browser routes retain their account/session contract and upload behavior.

For user-facing delivery, `POST /v1/projects/<id>/media/delivery-links` with `{file,storage:"s3"|"volume"}` issues an opaque one-hour application URL and `id`. Configure `PUBLIC_API_URL` to the actual HTTPS API origin. Opening that URL needs no application key: the server rechecks the issuing key/Premium/project and redirects cloud files directly to S3, or streams only the approved volume file. `DELETE /v1/projects/<id>/media/delivery-links/<id>` revokes it; already issued S3 redirects last at most 15 minutes and cannot outlive the original link. MCP defaults to this link delivery; explicitly requested client-local delivery is separate from the server's Docker volume. Never forward the application key to links/redirects or log bearer URLs. The legacy `GET .../media/download-url?file=...` remains available for direct signed-S3 clients; it is not the user-facing MCP descriptor. `/download` remains for compatibility. `S3_INTERNAL_ENDPOINT` optionally selects provider-supported private server transfers, not guaranteed zero egress. See [MCP.md](MCP.md).

Additional project-scoped routes: `GET /media`, `POST /compositions/assets`, `/compositions/validate`, `/compositions/compile`, `/compositions/compile-and-generate`, and existing `/ai/compositions`, `/ai/images`, `/ai/speech`, `/ai/subtitles`, `/ai/scenes` (create/status/cancel), all beneath `/v1/projects/<id>`. Schema/capabilities are at `/v1/compositions/schema` and `/v1/compositions/capabilities`.

`GET /v1/projects/<id>` reads the saved editor state and version. `POST /v1/projects/<id>` accepts `{ "name": "...", "version": <current version>, "state": <complete editor state> }` using the same owned-project/version checks as browser saves. Conflicts return 409. Editor state is distinct from a YAML recipe; see [MCP.md](MCP.md#recipe-and-project-state-are-different).

Only files in an account-owned project can be referenced. Browser-local files must be uploaded before server rendering. Invalid/missing sources and provider failures produce a **failed job with recovery information**, rather than a video pretending to succeed. Two shared workers process expensive operations, with one running job per account. Additional jobs wait in PocketBase/SQLite; backlog limits are 100 globally and 10 per account, plus bounded input-byte budgets. Full backlogs return HTTP 429. Queued jobs resume after an API restart. Already-running jobs interrupted by a lost worker fail conservatively rather than automatically repeating paid calls. Store the returned filename and check existing assets before resubmission.

AI edit/compositions, images, speech, subtitles, scenes and compile-and-generate also return **HTTP 202**. Follow `Location`/`statusUrl` and read the final response from `result` with its `statusCode` and `contentType`. `GET /v1/projects/<id>/jobs` recovers recent job summaries; `GET` and `DELETE /jobs/<jobID>` beneath that project provide results and cancellation. Existing render/scene status routes remain aliases. Use an `Idempotency-Key` for uncertain submission retries. See [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) for safe retry boundaries, private input files and retention.

## Local Docker

Use `D:\machinal-public` / the public repository, not the hosted Compose file. It already provides keyless single-user project storage and loopback-only published ports. Start with `docker compose up --build -d`. Use the same `/v1/projects/...` calls against `http://127.0.0.1:8080`, **without the Authorization header**. Uploaded files and outputs remain in the project's local volume. No PocketBase, Premium or S3 is required.

Application authentication does not alter the existing AI service configuration. Ordinary YAML/media rendering needs no AI provider key; a recipe that invokes a provider still needs that provider configured. No providers/models are replaced by this work.

## Native and container CLI

With Go 1.27.3 or newer, build `go build -o edit ./cmd/edit` from `api` (Windows: `-o edit.exe`). With FFmpeg/ffprobe on PATH:

```sh
edit render composition.edit.yaml --root /path/to/media --output result.mp4
edit compile composition.edit.yaml --root /path/to/media
```

Sources are read only from the explicitly selected media directory; filenames in bindings are resolved automatically. Output defaults to a generated filename under that directory. `--output` never overwrites an existing file. For text/scenes, configure `SCENE_SERVICE_URL` and its token; a saved project containing valid prepared text needs no text-service call. Native commands read environment variables, not `.env` automatically. The legacy `editengine -document ... -root ... -render`, `-assets`, `-bindings` and `-stdin` forms remain supported.

The Docker API image includes `edit`. In the **public** repository, with the scene service running:

```sh
docker compose run --rm -v /absolute/media:/media api \
  edit render /media/composition.edit.yaml --root /media --output /media/result.mp4
```

For Docker Desktop on Windows, quote the host mount path, e.g. `-v "D:\media:/media"`. Nothing is sent to the hosted app by the CLI. Provider actions, if present, use only your existing backend provider configuration.

## Limits

Existing YAML/project/upload/compiler limits remain. Automatic source resolution accepts up to 1000 assets. The headless text worker bounds one preparation to 500 text items, 20000 output overlays, 192 MiB browser output and two minutes. Larger projects may supply valid `preparedText` exported from the editor. Keys and credentials never belong in recipe files.
