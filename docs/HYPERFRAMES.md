# Hyperframes integration

The source library complements Cinema; it does not replace `@machinal/scenes`, the timeline or the renderer.

## Included

- 238 components, 210 blocks and 9 examples (457 descriptors).
- All 9 published skills with supporting source; 6 internal contributor skills from each upstream agent tree are retained as references (21 upstream entrypoints).
- 9 adapted `machinal-hyperframes*` skills, discoverable by MCP and shipped to OpenCode/Claude/Codex through the existing installer.
- Complete original text/code trees for the registry, skills and themes, with SHA-256 provenance and Apache-2.0 licence/credits and included third-party notices.
- The native Svelte port catalog is versioned and compile-tracked in `hyperframes-native.json`; outstanding entries stay explicitly pending rather than being presented as HTML/Svelte ports.

Original `SKILL.md` entrypoints are named `SKILL.upstream.md`, bytes unchanged, to avoid automatic activation. Internal upstream release/deployment scripts and all other scripts are reference-only and are never run by this integration.

Original Hyperframes registry entries are HTML/GSAP references, not automatically valid Machinal scenes. `hyperframes-native.json` tracks the per-entry native conversion status, exact source version and compile checks. Only entries marked `ported` with `nativeTemplateId` are exposed as Svelte components; `pending`/`blocked` entries remain clearly unavailable. Nothing injects upstream HTML into the application.

Binary demo/preview media, textures, models and fonts are inventoried but not redistributed; some have unconfirmed provenance in the upstream credits. External URLs are not bundled or approved project sources. The upstream Studio application, CLI and rendering/deployment packages are not installed. Apache-2.0 is not a blanket licence for GSAP, fonts or media.

## Use

1. Use Cinema for the visual language and production contract.
2. Search `get_editing_reference` with topic `hyperframes-components` and a short query (for example `count`, `chart`, `wipe`).
3. Fetch the exact descriptor. If it has `nativeStatus=ported`, inspect and use its returned `component` and `nativeLimitations`. Otherwise read the selected original `files[].id` with `get_hyperframes_source`; chunks are bounded UTF-8, continue with `sourceNextOffset`.
4. For pending entries, port the actual hierarchy and seekable motion to Svelte/SceneThree with approved copy/assets; do not substitute a generic scene. Compile through `compile_scene` and place the actual source asset in ordinary YAML video tracks.
5. Preserve existing captions, successful media and source/spending approvals. Review and preflight as usual. No live AI calls or paid renders are required to browse the library.

`hyperframes-skills` exposes original skill references; `hyperframes-files` searches all supporting source paths. The guide resource is `machinal://reference/hyperframes`.

## Locations and updates

Canonical sources/catalogs: `api/internal/platform/mcpserver/reference/hyperframes-library/` and `hyperframes-*.json`.

Adaptation guide: `api/internal/platform/mcpserver/guides/hyperframes.md`.

Offline distribution: `packages/mcp-installer/skills/machinal-hyperframes/references/`.

The import pins `heygen-com/hyperframes` at `8ec98be29a64e88239a0c05f7e5d09f36e181493`. Review a new commit, licences, registry and skill manifest before changing the pin. Then, from the repository root:

```sh
node packages/mcp-installer/scripts/import-hyperframes.mjs <trusted-upstream-checkout>
node packages/mcp-installer/scripts/build-hyperframes-adapters.mjs
node packages/mcp-installer/scripts/build-hyperframes-native.mjs
node services/scene-renderer/scripts/compile-hyperframes-native.mjs <new-compile-report.json>
node packages/mcp-installer/scripts/sync-reference.mjs
```

During an incomplete migration, `build-hyperframes-native.mjs --allow-incomplete` keeps unfinished entries explicitly pending/blocked; omit the flag for a complete release build. Compilation records landscape/portrait Svelte checks in the native ledger and each port sidecar, but does not perform visual review. Use a new report path for each run.

The importer reads source and checks the git revision; it does not execute downloaded scripts or install dependencies. It refuses modified vendored files. The manifest inventories excluded binaries and records original skill paths.

For project-local development skills, append the desired IDs through `--installed-skills=machinal-hyperframes,...` to the reference sync command. Existing setup distributes the same adapted skills to the configured client without changing permissions.

Rebuild/deploy the API to expose the new MCP topics/tool to remote clients; publishing the installer is a separate release action. No deployment or package publication is performed automatically.
