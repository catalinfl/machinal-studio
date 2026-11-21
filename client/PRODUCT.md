# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyday video creators making personal or social videos without professional editing expertise.

## Product Purpose

machinal enables people to import media, arrange and inspect timeline content, preview edits, and render video in a browser-based editing workspace. Success means creators can confidently review and refine an edit without needing a professional desktop suite.

## Positioning

Browser-native precision: frame-accurate editing and preview directly in the browser.

## Operating Context

The product is a desktop-first, full-screen editing workspace organized around media and editing panels, a central preview, an inspectable timeline, and browser-based rendering. Mobile layouts retain the workflow by adapting panels and controls to constrained viewports.

## Capabilities and Constraints

The existing product supports local media import, multi-channel timeline editing, direct manipulation of visual content, text and captions, effects, transitions, audio, optional AI-assisted tools, preview playback and rendering. This standalone edition autosaves isolated projects in the user's own Docker volume, needs no account or machinal key, and configures the user's own OpenRouter key through Settings. Only the editor, local documentation and toolkit are routed. The repository-level [product scope](../PRODUCT.md) is authoritative. Preserve current editor appearance, keyboard access and responsive behavior.

## Brand Commitments

The project and website are named **machinal**. Use this exact spelling and capitalization in all branding and public-facing content. Broader market positioning remains open.

Preserve the current scope-specific styles, Light/Dark preferences and real-media colors. See [DESIGN.md](../DESIGN.md) and the implemented styles for the applicable surface contract; older palette statements are not permission to restyle unrelated pages.

## Evidence on Hand

The implemented Svelte application is the source of truth for current capabilities and workflows. No external customer claims, testimonials, benchmarks, or proof assets are currently established and future work must not fabricate them.

## Product Principles

- Make precise video editing approachable to everyday creators.
- Keep the preview and timeline spatially connected so edits remain understandable.
- Prefer immediate, trustworthy feedback over hidden processing or ambiguous state.
- Preserve productive density without importing the complexity of professional suites.
