# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Creators and MCP users who want the current machinal editor and automation tools on their own computer, without a hosted account or maintainer infrastructure.

## Product Purpose

Import media, edit a multitrack timeline, author animated Svelte/Three.js scenes, use deterministic YAML recipes and export video or audio locally. AI is optional and uses the installation owner's OpenRouter account.

## Positioning

The current machinal monorepo adapted into a single-user Docker installation: your computer, your keys and your media. Not a hosted service and not an offline AI model bundle.

## Operating Context

Docker runs the Svelte 5 client, Go/FFmpeg API and current published @machinal/scenes renderer. Projects, originals, persistent jobs and exports live in user-owned local volumes. Browser-local processing remains available. No account, application key, PocketBase, subscription, credit wallet, PayPal or S3 participates in this edition's runtime.

## Capabilities and Constraints

- Preserve current multitrack editing, transforms, effects, transitions, text/captions, preview, autosaved isolated projects and browser/native exports.
- Preserve current recipe compiler, client-authored animated Svelte/Three.js scenes, pinned assets, caption-preserving preflight, MCP jobs and delivery.
- Optional AI editing/images/speech/transcription use only the user's own OpenRouter key. Provider calls need internet and may incur charges on that provider account.
- Native compilation, scene frames and final encoding use local hardware without machinal billing.
- Loopback-only, single-user installation; never publish the keyless API or claim multi-user isolation. Other local programs/users can access it.
- One API instance per data volume. Queued jobs survive restart; interrupted running jobs are not automatically replayed.
- Scene Docker image supports Linux AMD64. Browser compatibility remains desktop Chrome/Edge first; mobile editing is secondary.
- Temporary output links are same-machine only. YAML exports do not embed all source media.

## Brand Commitments

Keep the machinal name, canonical M mark and existing editor design. The edition is **machinal local**, repository **machinal-local**. This request changes deployment/access and removes irrelevant hosted pages; it does not authorize a visual redesign.

## Evidence on Hand

Source tests, local Docker build/readiness, synthetic keyless MCP scene-to-MP4 integration, and desktop/mobile browser checks. Synthetic verification uses no provider key or paid AI. Compilation alone is not aesthetic or audio inspection. See LOCAL_FORK.md for boundaries.

## Product Principles

- No silent dependency on maintainer accounts, storage, keys or services.
- AI optional; user-controlled provider charges and source consent.
- Keep originals, projects and exports in the user's local installation.
- Preserve current editorial/runtime features instead of reviving the outdated public tree.
- State loopback, persistence and provider limits honestly.
