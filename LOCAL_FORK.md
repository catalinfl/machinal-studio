# Local fork boundaries

## Runtime

- `api/internal/api/router.go` registers only `routes.RegisterLocal`.
- `api/internal/routes/local.go` reuses the current compiler, scene tooling and provider adapters, without hosted login, API-key management, billing or payment routes.
- `api/internal/platform/localaccess` establishes the one local workspace and validates Host/Origin. A stable internal preference namespace is not an accepted credential.
- `api/internal/platform/jobqueue/local.go` uses an exclusive local Bolt database, atomic idempotency and conservative interrupted-job recovery. No PocketBase is required.
- The shared object-store client cannot read environment configuration in this edition. No S3 network operations can be enabled through Compose variables.
- No session garbage collector is started, and ordinary post-export retention does not remove old outputs.
- Local workflow execution bypasses machinal render accounting while preserving the provider-call restriction on source-only compilation.

## Compatibility boundaries

Upstream billing/auth/S3 adapters and their deterministic tests remain as unregistered source compatibility code, not local services. They are not a supported switch for exposing this edition publicly. A future upstream merge must preserve the local router entry point, disabled shared cloud client and local queue.

The editor currently retains small compatibility access/session facades named `auth`, `paid` and `pocketbase`. They contain no SDK, network connection, account token or subscription lookup. Account/login pages, their login composables and the PocketBase npm dependency have been removed.

Local MCP setup never calls hosted credential APIs. It uses a separate registration and skill name. Hosted setup remains available only through the explicit Server branch. An already configured hosted registration is not modified automatically.

Local offline guides are generated from the local API sources into `packages/mcp-installer/skills/machinal-local/references`. Hosted compatibility guides have their own Markdown-only source snapshot under `packages/mcp-installer/server-reference`; Server setup never installs the local deployment contract. `npm run check:reference` checks both without mixing authentication or billing rules.

## Verification scope

See [the verification report](docs/LOCAL_VERIFICATION.md) for concrete test results, isolated Docker/browser evidence and deliberate limits.

Synthetic tests do not spend OpenRouter funds. Verify a provider on the user's own installation only with actual permission. A successful build or recipe compile does not prove final rendered visual/audio quality.

Legacy hosted integration tests/agent-installation checks may need edition-specific maintenance because this snapshot intentionally excludes personal `.opencode` configuration and installed skills. Do not copy credentials or restore hosted gates just to make those expectations pass. Local tests must assert keyless behavior and no calls to maintainer services.
