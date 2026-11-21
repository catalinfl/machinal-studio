# Persistent background jobs

Commands and code paths in this guide are relative to the repository root unless stated otherwise. Versioned PocketBase migrations/hooks ship under `pocketbase/`; installation, compatibility checks and coordinated restore instructions are in [PocketBase provisioning](../pocketbase/README.md).

Hosted long-running work is queued in PocketBase's SQLite database and processed by the existing Go services. No RabbitMQ, Redis or additional container is needed. HTTP connections are not held open during generation or rendering.

## Deploy before updating the API

1. Back up PocketBase and the API's persistent `/data` volume.
2. On the **PocketBase server**, install `pocketbase/pb_migrations/1792540800_direction_jobs.js` in its migrations directory. Apply the migration using that deployment's normal migration workflow.
3. Copy **both** `pocketbase/pb_hooks/jobs.pb.js` and `pocketbase/pb_hooks/lib/jobs.js` into the corresponding PocketBase hooks directories, preserving `lib/`. Restart PocketBase so it loads the routes and retention job.
4. Keep backend-only `POCKETBASE_URL` and `PB_SERVICE_TOKEN` configured on the Go API. The token must authenticate as a PocketBase superuser. Do not expose it through `VITE_*` or browser code.
5. Rebuild/restart the API and frontend together. The migration alone is insufficient: atomic enqueue/claim/update endpoints live in the hooks.

The `direction_jobs` collection is locked to ordinary clients. All queue operations go through superuser-only custom endpoints. Never make its rules public or let browser users change job ownership, input, status, leases or results. Do not open PocketBase's SQLite files directly from the API. Request bodies are synced to private `/data/.job-inputs/<jobID>` files before acceptance; PocketBase stores only their references, SHA-256 digests and small request metadata. Workers verify the checksum before processing. Preserve the API volume: PocketBase alone is not a backup of pending inputs.

The integration tests run these actual migrations/hooks against isolated PocketBase **0.23.12 and 0.40.5** servers. They do not modify an existing PocketBase installation. This repository change does **not** deploy files to an external PocketBase server. Missing configuration/hooks fail closed; there is no lossy in-memory fallback.

## HTTP contract

These POST routes now return `202 Accepted` with a job rather than waiting for the final result:

- `/render`, `/renders`, `/compositions/compile-and-generate`
- `/ai/edit`, `/ai/compositions`, `/ai/images`, `/ai/speech`, `/ai/subtitles`, `/ai/scenes`
- Their existing `/v1/projects/<projectID>/...` counterparts; versioned rendering remains `/renders`.

Uploads, source metadata, validation and ordinary composition compilation keep their immediate contracts. Simple new-source `/v1/projects/<projectID>/scenes/compile` also completes directly, with a bounded free-compiler slot and durable idempotency receipts, without creating a background job. Edits using `sourceFile`, handoffs and explicit `Prefer: respond-async` retain the recoverable legacy compilation queue. Long AI/provider operations stay asynchronous to avoid losing accepted paid work on disconnect. The separate public/keyless repository and native CLI are not changed.

Example submission response:

```http
HTTP/1.1 202 Accepted
Location: /v1/projects/my-project/jobs/0123456789abcdef0123456789abcdef
```

```json
{
  "id": "0123456789abcdef0123456789abcdef",
  "kind": "ai-image",
  "status": "queued",
  "progress": 0,
  "statusUrl": "/v1/projects/my-project/jobs/0123456789abcdef0123456789abcdef"
}
```

Poll the returned `statusUrl` approximately every 3–5 seconds using the same authentication and owned project. Browser-account routes require the PocketBase login token and original `X-Session-Id`; versioned routes require the application key and select the project from the path.

MCP agents should use `wait_for_job` (default 120 seconds, up to 900 for long renders). The versioned status endpoint supports `?view=summary&until=terminal&wait=900`, ignoring heartbeat/progress revisions until completion/failure/cancellation or timeout. The stdio adapter divides a long tool call into HTTP waits of at most 120 seconds; direct HTTP clients requesting the maximum need a proxy/client timeout of at least 915 seconds. A timeout returns the latest progress; waiting never resubmits or cancels work. The legacy `wait=25&afterRevision=...` remains for revision-based clients. At most 64 simultaneous waits are accepted API-wide.

- `GET /jobs` lists up to 100 recent job summaries for the current account **and** project session. Fetch an individual job to recover its saved result after reconnecting.
- `GET /jobs/<id>` returns persisted status, progress and result.
- `GET /jobs/<id>/download` verifies the owned completed render and cloud object's existence, then issues a fresh 15-minute signed S3 download descriptor. It requires the login token and original `X-Session-Id`, not an application key. It never renders, hydrates or proxies the cloud video. Unconfigured S3 is an explicit 503.
- `DELETE /jobs/<id>` cancels queued work immediately or requests cancellation of running work. Running cancellation is observed on a worker heartbeat, normally within 5 seconds; provider cancellation remains best-effort.
- The same endpoints exist beneath `/v1/projects/<projectID>`.
- Existing `/renders/<id>` and `/ai/scenes/<id>` status routes remain aliases. Scene cancellation also remains at its existing route.

Statuses: `queued`, `claimed`, `running`, `completed`, `failed`, `cancelled`. Progress is a fraction from 0 to 1. Terminal jobs contain `result`, `statusCode` and `contentType`. `result` is the original operation's JSON response, or a JSON string for text/SRT results. `statusCode` describes the operation, not the successful status lookup. Failures can retain structured compiler diagnostics in `result`. Renders additionally expose `filename` at the top level; scenes expose their available `scenes` and transcript, including persisted partial previews.

The frontend accepts both the new job responses and legacy immediate responses. It polls with the original project headers, keeps submission recovery keys in browser storage without saving credentials/prompts, and restores the latest scene/API-workspace render after refresh. Generated files remain accessible through the existing media storage workflow. Closing a page or aborting polling does **not** cancel server work; use DELETE explicitly.

## Jobs page and approximate timing

`/jobs` is the signed-in project-scoped Jobs & downloads page. Choosing a project does not change the editor's selected project/session. Exports & downloads is the default category; AI operations and All activity retain access to active tasks, failures and recovery records instead of mixing every compilation/generation into the export list. Tasks stay active-first within each category, with explicit cancellation confirmation and on-demand S3 links. Link expiry is separate from the durable video; renew the link rather than submitting paid work again. Optional completion notifications require a user click and browser permission, work only while the page stays open, and may be delayed by background-tab throttling. It is not a push/email delivery service.

Non-terminal REST/MCP summaries may include `timing` with `approximate: true`, `basis`, `elapsedSeconds`, `remainingSeconds`, `estimatedQueueSeconds` and `jobsAhead`. Live progress is preferred; otherwise estimates require at least three recent successful jobs of the same kind (last 20 retained in process memory). Queue estimates use the worker count and known preceding workloads, not a precise scheduler guarantee. Unknown estimates are omitted, not replaced with invented numbers. Samples reset after an API restart. Provider stalls, scene complexity and upload bandwidth can make estimates inaccurate; treat them as guidance, not a deadline or a cost quote.

Worker start/heartbeat/finish/cancel persistence wakes local status waiters immediately. The five-second repository fallback detects changes not observed in this process, reducing periodic queue reads versus the previous one-second loop. Completion waits still ignore progress revisions and remain bounded at 120 seconds / 64 concurrent waits. A progress percentage alone never establishes completion; the final cloud-publication stage must succeed when S3 is configured.

## Idempotency and bounds

Send a stable `Idempotency-Key` header (up to 128 characters) when retrying an uncertain submission. Within one account, project and operation kind, the same key and request return the same job. Reusing it with a different input returns 409. The browser does this automatically, retaining its key if the submission acknowledgement is lost. A deliberately new generation after receiving the previous terminal result uses a new key.

- Two Go worker slots share all expensive operations; one job per account executes at a time.
- Additional requests wait persistently, instead of being rejected merely because both workers are busy.
- At most 100 active jobs globally and 10 per account; admission returns 429 once a backlog limit is reached. Existing per-route rate limits also remain.
- Queued request bodies and final results are each limited to 128 MiB, preserving large saved/prepared-text project support. Individual handlers retain their smaller operation-specific limits. Pending input budgets are 512 MiB globally and 256 MiB per account; exceeding a byte budget also returns 429. Upload source media separately, rather than embedding it in recipes.
- Jobs have a two-hour execution deadline; existing provider-specific deadlines and the 30-minute scene deadline still apply.
- Heartbeats write progress/partial snapshots every 5 seconds, not every frame. Active job workspaces are protected from automatic session eviction; cleanup also takes an exclusive workspace lease so it cannot race a running job or upload. Keep using persistent storage/S3 for media durability.
- Job metadata, results and idempotency records are retained for 30 days, then terminal records are pruned in batches of up to 1,000 each night. Input files are removed after acknowledged completion/cancellation; unreferenced files older than one hour are reclaimed only after a successful active-job inventory. Active inputs are never removed by this cleanup. The private input spool is capped at 2 GiB, including ambiguous/orphaned submissions. This does not delete source media or outputs. Save required results before retention expires.

## Restarts, outages and paid work

Enqueue, claim, cancellation and state transitions use short PocketBase transactions. No transaction is held while an AI provider or FFmpeg runs. Claim is atomic, even if workers race. Each claim has a random lease token; stale workers cannot overwrite a later state.

- **Queued jobs** survive an API restart and are picked up by the next worker.
- A worker that disappears **before execution starts** leaves a recoverable claim. After the 90-second lease expires, dispatch may retry, at most three claims total.
- Once a job is durably marked **running**, it is **not automatically replayed** after a lost worker/lease. It becomes failed with recovery guidance. A provider could have accepted a paid call even when its reply was lost; automatically replaying the whole job would risk duplicate charges and assets. Check existing outputs and reconcile ambiguous usage before submitting a new operation.
- Temporary failures while saving a finished result retry **only the state write**, never the task. A process crash before the result is persisted can still lose that result acknowledgement; exactly-once provider execution is not claimed.
- An unavailable queue prevents new acceptance. Existing workers cancel processing after sustained heartbeat failures, before their leases expire. Last-known workspace protection is retained during a queue outage.

Hosted browser AI/render jobs and versioned API usage accounting begin **when a worker starts executing**, without reserving any credits while queued or running. Subscription access and the settled balance are checked again at execution. Existing provider usage tracking, reconciliation and failed-render refunds remain in use; actual usage is charged when settled. A zero balance or debt can fail an accepted job before generation, but pending provider metadata does not lock the wallet or block unrelated work. New browser jobs share the API/MCP credit wallet; previously accepted unbilled browser jobs keep their original contract. Idempotency and conservative restart recovery prevent automatic duplicate execution; they do not make an external provider's ambiguous network response free.

Continue running **one Go API instance with one persistent `/data` volume**. The existing bbolt credit ledger is exclusive, and source files still depend on that volume/S3. Atomic queue claims do not, on their own, authorize scaling replicas onto independent volumes. Back up PocketBase (jobs) and the API volume (media/projects/credit ledger) together.

The server handles termination by cancelling workers, attempting to persist their final state and settling known usage before closing the credit ledger. Compose grants the API a 45-second stop grace period. This is not a request to finish every long-running task during deployment: interrupted running jobs retain the conservative recovery policy above.

## Verification

```powershell
# No paid provider calls: starts only isolated test PocketBase processes.
$env:POCKETBASE_TEST_BINARY = 'C:\path\to\pocketbase.exe'
cd api
go test ./...
go vet ./...
```

Without `POCKETBASE_TEST_BINARY`, deterministic unit tests run and the real-PocketBase integration tests explicitly skip. The latter cover migrations/hooks, simultaneous claims, account/project isolation, idempotency conflicts, backlog limits, stale leases, interrupted dispatch versus running work, cancellation and saved-backlog processing by a new worker. Frontend tests cover polling, preserved JSON/SRT/diagnostic results, detached browser polling and private recovery keys. No live AI generation or production deployment is part of these tests.
