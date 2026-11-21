---
name: machinal-local
description: Edit videos using the user's own local machinal Docker installation, OpenRouter key and volume, without a machinal account, S3 or credits.
---

# machinal local

This endpoint requires a running user-owned Docker installation. No machinal application key, login, Premium subscription or credit balance is needed. Never read the hosted key store or ask for a machinal key. AI uses only the user's OpenRouter key configured in the local editor's Settings or container environment; never request secrets in chat. Provider operations may charge that user's OpenRouter account. Compilation and rendering use the user's hardware without machinal billing. Host approvals and real source/spending consent remain required.

Discover this configured MCP once and follow its live initialization instructions, get_recipe_schema, get_capabilities and get_editing_reference. The local runtime overrides hosted deployment/billing/storage rules. Use storage=volume, never S3. An approved read-only folder can be mounted explicitly with owner=local. Listing does not authorize reading/importing all files. Opaque output links work only on the API machine; do not rewrite URLs or download unless requested.

Ask missing video brief questions together in the host's native form. Respect known choices and delegated decisions. Continue all approved stages through final delivery without repeated continue prompts. Generate narration/captions first when requested; preserve exact resolved UTF-8 caption entries, IDs and measured timing while adding visuals. The current client authors expressive animated Svelte/Three.js source, then compile_scene validates it. Read scene-runtime, scene-authoring, production and exact cinematic styles before scene code. Use genuine Three.js for spatial scenes. Validate every edited recipe before rendering; compilation is not visual/audio inspection.

Wait on the same persistent job with wait_for_job, retrieve get_job_result once and retain the resolved recipe and idempotencyKey. Never rerun successful provider work after a failure. Recover existing assets after interruption. No credit tool exists locally. Missing Docker, compiler or FFmpeg is an infrastructure blocker, not a reason to silently switch to hosted infrastructure.

Offline references under `references/` describe this local edition. For a connected workflow the live local schema/catalog wins; do not substitute hosted account/credit/cloud guidance. A style preference never authorizes media access or provider spending.
