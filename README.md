# machinal local

A standalone, single-user fork of the current machinal monorepo: the Svelte 5 editor, Go/FFmpeg processing, current `@machinal/scenes` runtime and HTTP MCP tools, running on **your own computer**.

**No machinal account, application API key, subscription, credit wallet, PocketBase, PayPal or S3 is used by the local runtime.** Projects, originals, generated media, persistent jobs and exports live in your installation's Docker volume. AI uses only **your own OpenRouter key**. Provider usage may charge your OpenRouter account; rendering itself uses your hardware without machinal billing.

## Start

Install and start Docker with Compose v2 (2.20+), then run from this directory:

```sh
docker compose up --build -d
```

Open **http://localhost:5173**. The welcome can verify and save your OpenRouter key, or choose **Continue without AI**. You can configure it later under **Settings → OpenRouter API key**. No `.env` file is required. An optional root `.env.example` documents the key and ports; never put secrets in `VITE_*` variables.

The API/MCP endpoint is **http://127.0.0.1:8080/mcp**. Both published ports bind only to `127.0.0.1`. The scene service is internal. **Do not publish this keyless single-user installation to a network or reverse proxy.** Host/Origin checks reject unrelated websites and DNS-rebinding hosts, but this is not a multi-user server: other programs/users on this same machine can access it.

```sh
docker compose logs -f
docker compose down
```

`down` keeps your volumes. **`down -v` deletes them.** Back up your local volume, including the private saved key. Original sources and exports are not evicted after idle heartbeats or the third export. Upload quota defaults to 10 GiB per workspace; `WORKSPACE_MAX_BYTES=0` disables that quota without deleting existing media.

The current Chromium scene image supports Linux AMD64. AI needs internet access; this is not an offline model distribution. Builds download public dependencies and Chromium, not maintainer media or credentials.

## Your OpenRouter key

The API verifies the key against OpenRouter's key-status endpoint without generating content. It saves it with private permissions in `/data/.openrouter-key`, never returns it, and never stores it in browser storage. A failed replacement leaves the old key intact. The saved key takes precedence over `OPENROUTER_API_KEY` after container recreation.

Optional environment configuration belongs in a root `.env` on **your** installation. Compose explicitly allows the user's OpenRouter key/model overrides only; it does not load an existing maintainer `api/.env`. S3's shared runtime client is permanently disabled even if S3 environment variables are inherited. No production volume, account database, payment config or provider key was copied into this fork.

Editing, recipe compilation, source inspection, scene compilation and native/browser export work without an AI key. Missing provider configuration must not silently fall back to a hosted service. Provider generation itself has not been exercised by automated tests with a real key.

Blank model settings receive standalone defaults (matching the public installation's key-only onboarding): `deepseek/deepseek-v4.1-flash` for editing/scene planning, `qwen/qwen3.7-flash` for vision, timestamped `openai/whisper-large-v3` via Groq, `openai/gpt-image-2.5-sunburst` for images, and `fish-audio/s2.1-pro` for speech. Explicit model overrides and per-request choices are preserved. These are configuration defaults, not availability/quality guarantees or permission to call a provider.

## MCP: Server and Local are different products

| Selection | Requirements | Resources and billing |
| --- | --- | --- |
| **Server** | An existing hosted API, that deployment's machinal account/application key and access | That server's storage and credit/provider policy; setup never starts Docker |
| **Local** | This `machinal-local` Docker stack running on the user's computer | The user's own volume, CPU/GPU and OpenRouter key; no machinal login/key/credits/S3 |

The installer in this fork implements both choices. Source usage:

```sh
npm --prefix packages/mcp-installer ci --ignore-scripts
node packages/mcp-installer/bin/machinal-mcp.mjs setup --mode local --client opencode
```

Choose `claude` or `codex` for another client. `--scope global` is optional. Local setup verifies the **machinal-local** server identity before writing keyless configuration. It never reads a hosted key or installs the Windows hosted-authentication companion. It installs a separately named `machinal-local` skill, leaving hosted/custom skills intact. With no running local API, `--docker-dir PATH` can locate this standalone checkout; starting/building requires confirmation or `--start-docker`, not merely `--yes`. Containers keep running afterward.

After setup, start your client normally. Alternatively use `launch opencode --mode local`; ordinary `launch` remains the explicit hosted-key workflow. No npm release or global client configuration is changed by this source fork automatically.

Manual OpenCode V2 configuration (HTTP transport is called `remote` even on loopback):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "machinal-local": {
        "type": "remote",
        "url": "http://127.0.0.1:8080/mcp",
        "oauth": false
      }
    }
  }
}
```

No Authorization header, application key or OAuth is needed. Do not reuse a hosted authentication plugin for this registration. MCP keeps source/use/spending approvals, revision-bound preflight, exact caption preservation, current-client Svelte/Three.js authoring, job recovery and idempotency. Only the user's own provider operations incur AI charges. Links are temporary, revocable and **same-machine only**, not public hosting. Source-folder mounts are opt-in through `compose.local-media.yaml`, with owner `local` and read-only access to one approved folder.

## Local data and pages

The editor is `/` (also available at `/editor`). `/docs` contains local setup and `/toolkit` the current preset catalog. Hosted landing, about, login, account, API-key, membership, pricing, account-jobs, MCP marketing and hosted legal/cookie pages have been removed from this edition. Local processing jobs remain available through the editor/API/MCP.

Projects use versioned local JSON under `/data/.projects/local`; isolated media spaces use the current project/session layout. Durable queue state lives in `/data/.jobs.db`, and inputs in the private job payload directory. One API instance owns this volume. Queued jobs survive restart; claimed/running jobs become interrupted failures and are **never replayed automatically**, because provider usage may already have occurred. Recover assets before explicitly resubmitting.

Use **Projects** to select a saved project, including compositions prepared through the local API/MCP. Its timeline and Media Bin open in the editor; **Recipe → Code DSL** shows the editable YAML, with **Save YAML** and **Import recipe** for portable files. The Projects panel also plays the last retained render and offers its exact JSON snapshot. These operations use only the local API and browser, without an account, cloud connection or AI key. Applying pending AI actions is separate and requires your own OpenRouter configuration. Exported YAML references media; it does not embed the original media files.

## Development and checks

Use Node 24, pnpm 11.9.0 and the Go version in `api/go.mod`. The scene service installs the published `@machinal/scenes` package; no outdated embedded `directional-public/scene-engine` tree is used.

```sh
pnpm --dir client install --frozen-lockfile
pnpm --dir client check
pnpm --dir client build
```

From `api`, run `go test ./...` and `go vet ./...`. The new local tests cover keyless API/MCP, hosted-service isolation, Host/Origin checks, workspace scope and durable queue restart/idempotency. Installer local tests are in `packages/mcp-installer/test/local-edition.test.mjs`.

See [LOCAL_FORK.md](LOCAL_FORK.md) for boundaries and verification notes. Other inherited architecture/deployment guides describe upstream behavior unless explicitly marked local; this README, `/docs`, local MCP initialization and the local media/cost references are authoritative for this edition. The source snapshot includes the current upstream working tree; provenance is in `.machinal-local.json`. The original repositories and their user data were left unchanged.
