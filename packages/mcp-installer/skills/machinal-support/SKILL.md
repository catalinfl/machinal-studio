---
name: machinal-support
description: Discover and troubleshoot machinal MCP, missing tools, disconnected servers, authentication and saved API keys in Windows Credential Manager. Use immediately when machinal tools are unavailable or a connection/key fails; recover the existing integration before asking for setup or a replacement key.
---

# MCP discovery and credential recovery

Discover first; do not assume the MCP is missing because its tools are absent from the initial tool list. Use directly exposed native tools first, including `get_workflow_preferences` or `get_editing_reference`. Only for an unknown/missing tool, search the tool catalog in OpenCode Code Mode once, then reuse the exact returned namespace and signature for this session. Do not repeat discovery for every step or use web search for MCP tool names. Never invent a tool name or an API endpoint.

## OpenCode automatic integration

The local `machinal_connection` tool is independent of the remote MCP and remains available while it is disconnected:

1. Call `machinal_connection(action: status)` to discover approved server names/endpoints, actual connection states and sanitized credential diagnostics. `machinal` is the default for new setups, but existing/custom registrations may use another name. If there are multiple registrations, select the user's intended connection; ask only if ambiguous.
2. If discovery or connection/authentication fails, **immediately call `machinal_connection(action: reconnect, server: <registered name>)` once**. Do not first ask the user to locate a key, paste it, restart OpenCode or rerun the installer. The integration reloads and verifies the existing credential and reconnects the current service. It respects an explicitly chosen environment/session key.
3. Rediscover the remote tool catalog and retry only a safe read-only lookup. A verified API probe is not proof that OpenCode's MCP is connected: inspect its actual connection state. If the failed request may have submitted paid work, recover the original job/idempotency before any retry; never create a new paid submission merely to test authentication.
4. Follow the returned `code` / `nextAction`; report a persistent blocker rather than looping reconnects or silently replacing credentials.

## Exact saved-key location

There is **one machinal application API key per Windows user**, not a separate OpenCode key or an AI-provider key:

| Windows Credential Manager field | Value |
| --- | --- |
| Service | `Machinal/mcp` |
| Account | `MACHINAL_API_KEY` |
| Windows target | `Machinal/mcp.MACHINAL_API_KEY` |

This is an OS credential, **not a project file**. The integration reads its secret through the native credential API into memory, supplying it only to the MCP name and endpoint approved during setup. Saved credentials take precedence over incidental environment values; explicit session/environment selections remain binding. Do not search `.env` files, dump environment values, extract secrets with `cmdkey`/PowerShell, inspect credential files or pass keys through chat/tool inputs/command arguments. A missing environment variable does not mean a saved key is missing.

## Recovery decisions

- **`key-rejected` / HTTP 401, or `no-usable-key`:** after the recovery attempt, offer `replace` through the secure native window. It links to <https://direction.al/api-keys>, verifies before changing the old credential and reconnects. Saving requires the user's separate approval; cancellation/rejection preserves the previous saved key. Do not open replacement automatically or request a key in chat.
- **`credential-store-unavailable`:** the vault could not be read; that is not evidence of an absent key. Retry under the same Windows account or explain the vault/access problem. Do not delete the credential or demand a replacement.
- **`connection-failed`:** check the approved URL, local API/container availability, TLS/network. A network failure is not a bad-key diagnosis. Do not start containers, install software or change endpoints without appropriate authorization.
- **`account-access` / HTTP 402 or 403:** check Premium/API access or origin restrictions. More keys do not fix account access.
- **`rate-limited` / HTTP 429:** retry later, without changing the key.
- **`server-required`, `server-not-registered` or `server-configuration`:** inspect the existing approved registration. Do not send the saved key to a guessed, overridden or unrelated endpoint. Use the existing setup only when genuinely needed and preserve unrelated configuration.

If `machinal_connection` itself is unavailable, inspect the client's MCP list/panel (`opencode mcp list` / `/mcps`, `claude mcp list`, or `codex mcp list`). The automatic vault/reconnect tool is specific to the installed Windows OpenCode integration; do not invent it for other clients. The installer/legacy launcher can read the saved credential on Windows without exposing it. Never reinstall, restart services or overwrite configuration just because Code Mode tools were initially hidden. Keep host approval controls enabled. Troubleshooting grants no media access or spending permission; after recovery, resume the original task within its existing consent scope.
