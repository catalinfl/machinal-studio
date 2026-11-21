# Workspace retention and private operation

The API's `/data` volume is **not entirely disposable**. It contains the exclusive billing ledger, saved projects, durable ownership records and pending job inputs in addition to media workspaces. Never delete the volume, `credits.db`, `.projects`, `.project-owners` or `.job-inputs` to clear rendering cache.

The private `.media-tokens` directory also lives outside collectible workspaces. Preserve it across normal cleanup and redeploys so authorized legacy media URLs remain stable. See [media authorization and controlled token rotation](PROJECTS.md#http-interface); deleting an individual capability file revokes its old read URLs and is a security maintenance operation, not cache reclamation.

## Automatic media cleanup

`SESSION_TTL` defaults to 10 minutes of workspace inactivity; `SESSION_GC_INTERVAL` defaults to one minute. `SESSION_DISK_MAX` defaults to 0.8. Cleanup includes persistent project workspaces and directories left by a previous process, rather than considering only the current process's non-project session map.

Cleanup waits for a successful active-job inventory. During an outage it retains the last protection set; at startup without a verified inventory it fails closed, including under disk pressure. Queued/running job workspaces are protected. Workspace read leases keep cleanup from racing job execution and uploads; upload quota checks/writes are serialized per session.

The collector only removes:

- **Verified cloud copies.** Successful S3 publication/hydration records a private `.cloud-copies` receipt containing the exact object key/version, local size/modification time and SHA-256. Before eviction the collector verifies the object with HEAD and rechecks the local fingerprint and contents. A missing object, changed version, S3 outage or local replacement retains the file.
- **Regenerable `.media-cache` entries** in idle, unprotected workspaces. Saved projects and source manifests outside that cache are not derived-cache entries.
- **Empty non-project workspace directories.** It does not recursively delete an idle workspace containing unverified or local-only originals.

Legacy files without receipts are adopted only when a size-matching single-part S3 ETag matches their local MD5 checksum. Opaque/multipart ETags are not treated as proof: those legacy files remain local until republished or rehydrated through the receipt-aware path. Discovery checks at most 100 legacy candidates per workspace/pass and has a one-minute workspace network budget. Automatic cleanup never deletes S3 objects.

New MCP/API uploads retain their existing **volume-only** contract. Browser uploads publish to S3 in the background. Therefore an MCP source with no confirmed cloud copy is intentionally not removed by TTL. To make every original disposable locally, a separate approved storage-policy migration must first publish and verify those originals; do not just shorten TTL or delete them. Failed background uploads are also retained. Disk pressure cannot guarantee reclamation when the only remaining files are sole originals; monitor capacity and keep backups.

Idle cache eviction is session-level, not an LRU for every file in a continuously active project. A page sending heartbeats keeps its current workspace warm. Generated scene service cache is separate: its own size/entry/TTL limits are documented in [render performance](RENDER_PERFORMANCE.md).

## Downloads and publication

Queued editor exports publish exactly once to S3, synchronously before completion. The old path uploaded the same output both in the background and synchronously; this duplicated bandwidth and could race pruning. Immediate pruning of older final exports was removed from this path; receipt-aware cleanup preserves failed publications and local-only results. Failed final encoding removes its incomplete output; failed scene transfers do not leave a partial video reusable as a finished asset.

The account [jobs page](BACKGROUND_JOBS.md#jobs-page-and-approximate-timing) requests fresh signed S3 links. It never puts an application key on the download link. Signed URLs are temporary bearer credentials; do not log, persist or publish them. No media, production volume or merchant account was inspected or deleted by these code changes.

## Deployment hardening

- Set a private `SCENE_SERVICE_TOKEN` on both API and scene-engine; the scene service now refuses to start without it. The Compose fallback is development-only, not a production secret. Do not expose the scene port publicly. Heavy scene/text requests use a bounded FIFO (one active, eight waiting); compilation has a separate two-active/eight-waiting budget. Disconnects remove queued tasks. The outer deadline is 30 minutes, including queue time; native encoding remains bounded separately.
- Set `TRUSTED_PROXY_CIDRS` only to the actual reverse proxy's source IPs/networks. Without it forwarded client IPs are not trusted. Never use `0.0.0.0/0` or `::/0`; otherwise spoofed forwarded headers can defeat IP limits. Configure the edge proxy to replace, not append untrusted client IP headers.
- Put authenticated upload/body/concurrency limits at the edge. The application bounds ordinary bodies at 128 MiB before buffering and billing bodies at 4 KiB / 1 MiB for webhooks, but legitimate multipart uploads still have a 2 GiB transport allowance and can consume resources before application middleware runs.
- Confirm PocketBase collection rules and hooks on the real deployment. Paid profile fields and subscription records must not be user-editable; project/job/API-key ownership must be locked. Those external assets are not shipped in this repository, so source tests do not certify the deployment.
- Back up PocketBase and `/data` together and run only one API instance with this ledger. TLS, bucket access policies/lifecycle, rate limits, PayPal sandbox webhooks and merchant review operations remain deployment responsibilities.
