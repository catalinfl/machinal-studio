# Native Hyperframes port contract

This is an implementation contract for the current migration, not video-production permission.

## Assigned work

Each worker receives a category and zero-based half-open slice in `api/internal/platform/mcpserver/reference/hyperframes-components.json`, filtered by `category` without reordering. Work only on those entries. Do not modify shared catalogs, guides, runtime, installer or tests. Do not delegate further.

For every assigned entry, inspect the actual original HTML/CSS/JavaScript listed in its `files` under `api/internal/platform/mcpserver/reference/hyperframes-library/`. Read its descriptor and README. Large bundled vendor libraries need not be reread, but inspect the composition's own implementation. Do not execute upstream scripts.

Write two new files per entry:

- `api/internal/platform/mcpserver/reference/hyperframes-native/<category>/<upstreamName>.svelte`
- Same path with `.port.json` instead of `.svelte`.

## Native source

- Complete standalone Svelte 5 component, JavaScript (not TypeScript), less than 64,000 UTF-8 bytes.
- Use `SceneCanvas`, `useScene`, `SceneThree` from `@machinal/scenes/svelte`; optional helpers from `@machinal/scenes/runtime`. Read `api/editengine/scenecontract/runtime.md` and existing native templates first. No local-file/component imports; scene bundles must remain standalone.
- Deterministic motion is a pure function of `scene.frame.time`, `scene.frame.progress` and seeded randomness. Config has `durationInFrames` and `fps`, NOT `duration`. Use `$derived` for reactive values. Pure functions called from Svelte markup track these values as usual.
- Preserve the original effect's actual mechanics, object hierarchy, staging and timing. No generic cards/rectangles relabelled as distinct ports. Use SVG/CSS for legitimate flat primitives and genuine `SceneThree` geometry/material/camera for spatial components. Inline original shader logic when compatible; document unsupported features rather than faking them.
- No `{@html}`, original HTML iframes, string-injected markup, `innerHTML`, GSAP/other unsupported imports, upstream scripts, external resources/CDNs, timers, CSS animation clocks, requestAnimationFrame, unseeded randomness, side-effectful media fetching or local production renderer.
- Use a cohesive editable `design` object for supplied copy, parameters, colors and geometry. Demo defaults may come from the upstream descriptor; do not invent real-world claims. Avoid excessive comments.
- Required raster media come ONLY from `let { images = {} } = $props()` with `images.image_1`–`image_4`, video from supported `videos` props and `SceneVideo`, models only through the supported runtime attachment contract. Do not embed external demo URLs, fake screenshots or imported binary media. Document actual attachment requirements. No more than four images/two videos per port; if the original needs more, document the exact bounded adaptation.
- Respect actual aspect/size, and the caption-safe bottom via `scene.frame.config.captionSafeBottom ?? 0`. Preserve existing captions outside scenes. For SVG, use a design viewBox with meet/contain inside the safe height. For 3D use caption-safe scene bounds and purposeful camera framing.
- Readable reveal/action/hold/exit and reverse/repeated seeks must work. No forced fade-to-blank at the end unless intrinsic to the source effect.
- Add an opening Svelte comment marking the source as a modified Svelte adaptation of the exact upstream file(s), revision `8ec98be29a64e88239a0c05f7e5d09f36e181493`, Apache-2.0 with original licence and CREDITS in `hyperframes-library/`. Preserve any directly reused third-party shader/code notices too.

## Sidecar metadata

```json
{
  "id": "components-example-name",
  "nativePath": "components/example-name.svelte",
  "status": "ported",
  "sourcePaths": ["registry/components/example-name/example-name.html"],
  "visualMode": "2d",
  "requiredImages": [],
  "requiredVideos": [],
  "parameters": ["design.example"],
  "adaptations": ["Concrete explanation of how original mechanics map to native frame-driven code."],
  "limitations": [],
  "verification": {"compiled": false, "visualInspection": false}
}
```

Attachment arrays contain `{ "id": "image_1", "role": "..." }` or equivalent video IDs. `visualMode` is `2d` or `3d`. Do not claim compilation or visual review that did not happen. If an essential effect cannot be honestly ported, use `status: "blocked"` with precise limitations, rather than ship an unrelated visual or falsely claim completion.

Use patch for authored source. A script can enumerate assignments or validate files, but must not mass-generate a generic component for different IDs. Do not overwrite existing files you did not create. Report finished IDs, blockers, checks run and exact file locations to the parent.
