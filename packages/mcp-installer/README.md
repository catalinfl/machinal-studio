# machinal MCP setup

Configure OpenCode V2, Claude Code or Codex. This fork separates **Server** from **Local** before reading credentials or contacting an endpoint. No npm publication is performed automatically.

## Local: your Docker, keys and volume

Start the standalone `machinal-local` checkout with Docker, then:

```sh
npm ci --ignore-scripts
node bin/machinal-mcp.mjs setup --mode local --client opencode
```

Local requires **no machinal account, application key, Premium access, credit wallet or S3**. It verifies `serverInfo.name=machinal-local`, sends no Authorization header and never reads Windows hosted credentials. It writes a separately named keyless MCP registration (`machinal-local`) and optionally the `machinal-local` skill plus local references. Hosted/custom skills are not replaced.

AI needs **the user's own OpenRouter key**, configured in the local editor's welcome/Settings or in that user's container environment, not in this wizard or chat. AI may charge the user's provider account. Compilation, scene frames and final encoding use the user's hardware without machinal billing. Editing/export work without AI.

If the endpoint is down, `--docker-dir PATH` locates a checkout containing `.machinal-local.json`; Docker build/start needs explicit confirmation or `--start-docker`. `--yes` alone is not approval. Setup starts no hosted stack and requires no `api/.env`. It verifies a local Docker daemon and never deletes volumes. An authenticated hosted API on localhost is still **Server**, not the local edition.

After setup, start the client normally, or:

```sh
node bin/machinal-mcp.mjs launch opencode --mode local
```

Keep Docker running. The API binds loopback only; do not expose this keyless single-user installation publicly. Delivery links work only on the API machine. Source/spending consent and host approvals remain enabled. Use `storage=volume`; no hosted credential/download companion is installed by Local setup.

## Server: existing authenticated deployment

```sh
node bin/machinal-mcp.mjs setup --mode server --client opencode --url https://YOUR-API/mcp
```

Server mode never inspects/starts Docker. It uses that deployment's machinal application key and account/access/credit policy. The API origin can differ from the website. Hosted key creation links use `https://machinal.app/api-keys`; use the actual deployment's page for another hosted account system.

Keys come from `MACHINAL_API_KEY`, optional Windows Credential Manager or hidden entry, never arguments/chat. Server setup verifies access/tool discovery and reads available credits without generating media. On Windows, its hosted OpenCode integration can load saved keys in memory; this is not installed or read by Local setup. `key set`, `key delete` and ordinary `launch` are hosted credential workflows, not local prerequisites.

## Shared options and safety

- `--client opencode|claude|codex`; `--scope project|global` (default project).
- `--name NAME` changes only the selected registration. Defaults: `machinal` for Server, `machinal-local` for Local.
- `--replace` approves replacement of that server only; `--replace-skills` separately approves customized bundled skills.
- `--no-skills`, `--style cinematic`, `--no-launch`, `--verbose` are optional. Use `--help` for all options.
- Existing JSONC/TOML settings are preserved and changed originals backed up. Verification is not proof that an already-running client connected.
- HTTP MCP uses OpenCode's `type: remote` even on localhost. Local configuration has `oauth:false` and no headers/bearer token.
- No provider generation, render, credit purchase or npm publication happens during setup.

## References and tests

Local live guides originate in `api/internal/platform/mcpserver/guides` and sync into `skills/machinal-local/references`. Hosted compatibility guides are separately archived in `server-reference/guides`; they never override local setup. Catalogs, examples, scene templates and cinematic references retain their current source and licences.

```sh
npm run sync:reference
npm run check:reference
npm test
npm run test:package
```

Local tests assert no credential access/headers, identity verification, user-owned references and safe Docker recovery. Hosted compatibility tests still cover credential handling. Checks against a developer's personally installed `.opencode/skills` are skipped when that directory is absent from the portable standalone checkout. No test requires production credentials or paid AI.
