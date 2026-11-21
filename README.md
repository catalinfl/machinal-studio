# machinal

A standalone video editor and composition studio: Svelte 5 editor, Go/FFmpeg processing, `@machinal/scenes` runtime and HTTP MCP tools, running on **your own computer**.

Projects, originals, generated media, persistent jobs and exports live in your installation's Docker volume. Optional AI features use **your own OpenRouter key**; editing and rendering run on your hardware.

## Start

Install and start Docker with Compose v2 (2.20+), then run from this directory:

```sh
docker compose up --build -d
```

Open **http://localhost:5173**. The welcome screen can verify and save your OpenRouter key, or you can choose **Continue without AI**. You can configure it later under **Settings → OpenRouter API key**. No `.env` file is required. An optional root `.env.example` documents the key and ports; never put secrets in `VITE_*` variables.

The API/MCP endpoint is **http://127.0.0.1:8080/mcp**. Both published ports bind only to `127.0.0.1`. The scene service is internal. **Do not publish this single-user installation to a network or reverse proxy.** Host/Origin checks reject unrelated websites and DNS-rebinding hosts, but this is not a multi-user server: other programs/users on this same machine can access it.

Once the stack is running, install the `@machinal/mcp` CLI globally to connect your coding agent (see [MCP integration](#mcp-integration) below):

```sh
npm i -g @machinal/mcp
machinal setup
```

```sh
docker compose logs -f
docker compose down
```

`down` keeps your volumes. **`down -v` deletes them.** Back up your volume, including the private saved key. Upload quota defaults to 10 GiB per workspace; `WORKSPACE_MAX_BYTES=0` disables that quota without deleting existing media.

The Chromium scene image supports Linux AMD64. AI features require internet access; this is not an offline model distribution.

## Your OpenRouter key

The API verifies the key against OpenRouter's key-status endpoint without generating content. It saves it with private permissions in `/data/.openrouter-key`, never returns it, and never stores it in browser storage. A failed replacement leaves the old key intact. The saved key takes precedence over `OPENROUTER_API_KEY` after container recreation.

Optional environment configuration belongs in a root `.env` on your installation. Editing, recipe compilation, source inspection, scene compilation and native/browser export work without an AI key.

Blank model settings receive defaults: `deepseek/deepseek-v4.1-flash` for editing/scene planning, `qwen/qwen3.7-flash` for vision, timestamped `openai/whisper-large-v3` via Groq, `openai/gpt-image-2.5-sunburst` for images, and `fish-audio/s2.1-pro` for speech. Explicit model overrides and per-request choices are preserved.

## MCP integration

Install the Machinal MCP CLI globally (requires Node.js 22.13+ or 24+) and run the interactive setup wizard:

```sh
npm i -g @machinal/mcp
machinal setup
```

During `machinal setup` (or directly via `machinal setup --client <opencode|claude|codex>`):
- Choose your coding agent: **OpenCode**, **Claude Code**, or **Codex**.
- Choose **Local** mode to connect to this Docker installation (`http://127.0.0.1:8080/mcp`) using your own OpenRouter key and an automatically generated device token (no Machinal account or credits required).
- Optionally install the bundled editing, recipe, scene, media, and animation/sound skills into your client's native skills directory (pass `--no-skills` to skip).

Useful CLI commands:
- `machinal local status` / `machinal local install` — inspect or configure the local Docker MCP connection
- `machinal place` / `machinal place --uploads PATH --downloads PATH` — configure host-side upload/download folder preferences
- `machinal uninstall` — cleanly remove client registrations, bundled skills, and local adapter settings before running `npm uninstall -g @machinal/mcp`

### Manual OpenCode V2 configuration

If you prefer manual configuration instead of `@machinal/mcp`, add the loopback endpoint to your OpenCode V2 config (HTTP transport is called `remote` even on loopback):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "machinal": {
        "type": "remote",
        "url": "http://127.0.0.1:8080/mcp",
        "oauth": false
      }
    }
  }
}
```

MCP keeps source/use/spending approvals, revision-bound preflight, exact caption preservation, current-client Svelte/Three.js authoring, job recovery and idempotency. Links are temporary, revocable and **same-machine only**, not public hosting. Source-folder mounts are opt-in through `compose.local-media.yaml`, with read-only access to one approved folder. See [docs/MCP.md](docs/MCP.md) for the full MCP reference.

## Data and pages

The editor is `/` (also available at `/editor`). `/docs` contains setup documentation and `/toolkit` the preset catalog.

Projects use versioned JSON under `/data/.projects/local`; isolated media spaces use the project/session layout. Durable queue state lives in `/data/.jobs.db`, and inputs in the private job payload directory. One API instance owns this volume. Queued jobs survive restart; claimed/running jobs become interrupted failures and are **never replayed automatically**, because provider usage may already have occurred. Recover assets before explicitly resubmitting.

Use **Projects** to select a saved project, including compositions prepared through the API/MCP. Its timeline and Media Bin open in the editor; **Recipe → Code DSL** shows the editable YAML, with **Save YAML** and **Import recipe** for portable files. The Projects panel also plays the last retained render and offers its exact JSON snapshot. Exported YAML references media; it does not embed the original media files.

## Development and checks

Use Node 24, pnpm 11.9.0 and the Go version in `api/go.mod`. The scene service uses the `@machinal/scenes` package.

```sh
pnpm --dir client install --frozen-lockfile
pnpm --dir client check
pnpm --dir client build
```

From `api`, run `go test ./...` and `go vet ./...`.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) (`PolyForm-Noncommercial-1.0.0`). Noncommercial use, modification, and distribution are permitted; commercial use and selling the software or offering it as a commercial service are not permitted without a separate license.
