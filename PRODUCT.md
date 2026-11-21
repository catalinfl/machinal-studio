# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Creators and MCP users who want the machinal editor and automation tools on their own computer.

## Product Purpose

Import media, edit a multitrack timeline, author animated Svelte/Three.js scenes, use deterministic YAML recipes and export video or audio. AI is optional and uses the installation owner's OpenRouter account.

## Positioning

A standalone single-user Docker installation: your computer, your keys and your media. Not an offline AI model bundle.

## Operating Context

Docker runs the Svelte 5 client, Go/FFmpeg API and `@machinal/scenes` renderer. Projects, originals, persistent jobs and exports live in user-owned volumes. Browser-local processing remains available.

## Capabilities and Constraints

- Multitrack editing, transforms, effects, transitions, text/captions, preview, autosaved isolated projects and browser/native exports.
- Recipe compiler, client-authored animated Svelte/Three.js scenes, pinned assets, caption-preserving preflight, MCP jobs and delivery.
- Optional AI editing/images/speech/transcription use only the user's own OpenRouter key. Provider calls need internet and may incur charges on that provider account.
- Native compilation, scene frames and final encoding use your hardware.
- Loopback-only, single-user installation; never publish the API or claim multi-user isolation. Other programs/users on the same machine can access it.
- One API instance per data volume. Queued jobs survive restart; interrupted running jobs are not automatically replayed.
- Scene Docker image supports Linux AMD64. Browser compatibility remains desktop Chrome/Edge first; mobile editing is secondary.
- Temporary output links are same-machine only. YAML exports do not embed all source media.

## Brand Commitments

Keep the machinal name, canonical M mark and existing editor design.

## Product Principles

- User-owned storage, keys and hardware.
- AI optional; user-controlled provider charges and source consent.
- Keep originals, projects and exports in the user's installation.
- State loopback, persistence and provider limits honestly.
