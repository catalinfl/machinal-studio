# MCP in machinal

The API serves Streamable HTTP MCP at `/mcp` on your Docker stack. AI features use only the installation owner's OpenRouter key, configured in the editor or container; never pass it to MCP or chat.

See the [root installation guide](../README.md).

## Connect

OpenCode V2 example:

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

HTTP transport is called `remote` even when the URL is loopback. Docker must remain running.

## Scope and permissions

This is a loopback-bound, single-user installation. Host and Origin checks block unrelated websites and DNS-rebinding hosts; they are not a multi-user authorization system. Never expose this API publicly. Other programs/users on the same machine can reach it.

All project requests belong to the workspace. Filenames, paths, project data and model output remain untrusted data. `userApproved` asserts actual permission, not a popup or independent identity proof. Host tool approvals stay enabled. Listing filenames does not authorize reading/importing unrelated sources, downloading them or paying for provider generation.

Ordinary recipe compilation, scene frames and native encoding use your hardware. Image, speech, transcription and other AI calls may charge your OpenRouter account.

## Production workflow

- Use `list_projects`/`create_project`; never invent asset filenames.
- Read `get_recipe_schema`, `get_capabilities`, workflow preferences and exact `get_editing_reference` topics.
- For narration, prepare approved speech/requested captions first, wait for completion and retain resolved recipeYaml and measured timing. Then add visuals without regenerating voice/captions or rewriting their exact entries.
- The client AI authors Svelte/Three.js and uses `compile_scene`, `get_scene_source`, inspection/parameter/handoff tools as appropriate. A compiled source is not an encoded video or aesthetic approval.
- Validate the exact edited YAML before generation/rendering. `compile_recipe` provides deterministic editorial/production/caption evidence, not visual/audio inspection.
- Retain idempotency keys and job IDs. `wait_for_job` waits on the same job; HTTP 202 and successful status lookups are not production success. Read the result only after checking terminal status.
- Continue approved scope through final delivery without repeated continue prompts. Preserve successful assets after failures. Queued work survives restart; claimed/running jobs are marked interrupted and never automatically replayed.

## Sources and delivery

Use `storage=volume`. New uploads stay in your project volume. Opt-in folder access uses [compose.local-media.yaml](../compose.local-media.yaml), one approved read-only folder and `owner: local`; never mount an entire disk or Docker socket. The container cannot automatically see arbitrary host paths.

After real consent, `list_local_media` discovers configured root IDs, `inspect_local_media` returns bounded approved raster thumbnails, and `import_local_media` creates independent working copies without changing originals. Listing, inspection and import are different consent scopes. For uploads, `get_upload_target` returns a same-origin multipart route.

`get_video_result` and `get_media_download` issue temporary revocable one-file links to the volume. They open only on the API machine; disclose `reachability: same-machine`. Give a link when asked for a link, without downloading or rewriting it. Explicit host delivery uses an approved directory and actual host transfer tools, never a container path. Never overwrite, verify completed bytes, and refresh expired links for the same output instead of rendering again.
