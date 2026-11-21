# Native Hyperframes runtime

Hyperframes scenes use the existing Svelte → esbuild → Chromium → `scene-render`
pipeline. No second video backend, iframe renderer or external HTML runner is used.

Authoring sources and catalogs now live in
`packages/mcp-installer/library/`, distributed to the user's PC with the MCP
adapter. The API no longer embeds Svelte or the upstream Hyperframes tree.
Only the execution dependencies under this service's `hyperframes/` remain
server-side. The MCP package contains editable components and references, not the
renderer dependencies. Changing authoring storage does not change render billing
or automatically deploy a new renderer.

## GPU and browser

Use **complete Chrome for Testing**, not Chrome Headless Shell. On Windows the
tested Headless Shell could enumerate the NVIDIA adapter but failed to load Dawn's
`dxil.dll`; complete Chromium from the same Playwright release successfully created
a device. Docker now installs complete Chrome at the existing pinned version.
`scripts/scene-chromium.sh` enables WebGPU and the HTML-in-canvas API used upstream.
WebGPU scene captures use the existing native `-gpu` option and one worker.

Missing WebGPU support is an error, not permission to emit an empty canvas.
Browser/device support still has to be checked in the deployment environment;
local Windows evidence is not proof that a remote container has GPU access.

## Offline dependencies

Pinned Fontsource dependencies and the fetched Geist TrueType file retain their
font licences. Local font packs embed only the faces a scene needs. TopoJSON data,
Lottie data, original local helpers and GPU libraries are bundled into the same
scene JavaScript. The production CSP still rejects remote network dependencies;
`data:` fetches support embedded JSON/fonts/models.

Missing subject imagery is replaced only under the user's explicit substitution
approval. `mediaReplacements` records each changed path. Sample artwork, motion,
noise textures and generic device models are not described as original imagery.
They are reusable library defaults, not attachments to a user's video project.

Generated modules under `hyperframes/` must ship with the renderer, alongside
their licences. They are allowlisted by exact module family; arbitrary source
imports, filesystem access and remote script imports remain rejected.

## Rebuild

Run from `services/scene-renderer` after installing pinned dependencies:

1. `node scripts/build-hyperframes-runtime.mjs`
2. `node scripts/fetch-hyperframes-font.mjs`
3. `node scripts/build-hyperframes-models.mjs`
4. `node scripts/build-hyperframes-vendors.mjs`
5. `node scripts/port-hyperframes-library.mjs` (or pass explicit IDs)
6. `node scripts/verify-hyperframes-runtime.mjs --all`
7. `node scripts/write-native-sidecars.mjs`
8. `node ../../packages/mcp-installer/scripts/build-hyperframes-native.mjs --allow-incomplete`
9. `node ../../packages/mcp-installer/scripts/build-scene-library.mjs`
10. `node ../../packages/mcp-installer/scripts/sync-reference.mjs`

The silent sample MP4 is project-authored test/library media, generated with the
existing FFmpeg installation, not AI-generated music.

## Evidence

Runtime verification bundles the **production** entry, serves its real CSP,
blocks external requests, awaits readiness, seeks and captures three frames in
landscape and portrait. Reports pin both Svelte source and dependency versions.
Only matching successful captures can publish an adapted port.

Source/pixel equivalence is separate evidence. Captured replacements and demos
are not labelled pixel-identical to missing references, and automated capture is
never recorded as human visual inspection. The local review directory also
contains a real WebGPU MP4 encoded by the existing native scene executable.
