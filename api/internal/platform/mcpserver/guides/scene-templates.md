# Reusable scene effects

This is a versioned example library, not model training, persistent conversation memory or a new rendering engine. The CURRENT client AI retrieves a relevant working component, understands its motion, adapts it to the actual subject and sends complete source to `compile_scene`. MCP does not learn from a submitted component automatically. New examples become persistent only when explicitly added to this bundled catalog and deployed.

## Discover → retrieve → adapt → compile

Use `get_editing_reference` with these independent argument examples:

```json
{"topic":"scene-templates","limit":3}
{"topic":"scene-templates","query":"parallax"}
{"topic":"scene-templates","id":"lens-assembly-3d"}
```

Discovery/query pages return metadata only, with `nextOffset` for pagination. An exact `id` returns the same metadata plus the complete `component` string. Alternatively read the returned `uri` (`machinal://scene-templates/<id>`) for source only. Read `scene-runtime` for the authoritative runtime API and `scene-authoring` for submission/repair semantics. Cache unchanged entries within a workflow.

Entries describe the version, visual mode, example output configuration, source-level parameters, required image IDs, when to use/avoid the effect, choreography and adaptation rules. `parameters[].path` refers to constants inside the component's `design` object, **not tool arguments or runtime props**. Edit that source yourself. Do not invent `templateId`, `scenePreset`, inline YAML components or a server-side instantiation tool. Template IDs are not recipe effects/transitions. `config` is an example of compile_scene output settings; pass `visualMode` separately. No compiled JavaScript, project files or customer media are in the library.

1. Choose an example for its actual action, not just its label. Keep the production contract and current brief over sample styling. It is valid to choose no template or author a new scene.
2. Retrieve only the chosen source. Replace demo copy, palette, geometry and layout as needed; a renamed lens is not an illustration of an unrelated subject. Do not impose every effect on every video.
3. Preserve deterministic frame-driven motion, independent moving objects, a readable central hold and caption-safe regions. Normalized progress makes the samples retimable, but narration-specific changes must use measured cues. All examples respond to width/height and `captionSafeBottom`; verify the adapted aspect and copy, not only the sample config.
4. For image templates, obtain source-use approval for the specific files, then attach their real project filenames through compile_scene's `images` argument. Components use embedded `images.image_1`/`image_2`, never paths/URLs/base64 literals. Parallax needs an actual separate transparent foreground. A missing layer does not authorize generating one or inventing hidden geometry. Do not ship an empty image frame as a substitute for the subject.
5. Send the full adapted component to `compile_scene` with the actual duration, dimensions/fps, visualMode, captionSafeArea and approved attachments. Reuse the existing job/idempotency workflow and returned pinned asset. No local imports of these `.svelte` files are supported in submitted scene source.
6. Review diagnostics and preserve the intended effects when repairing. Compilation/layout checks are not aesthetic approval. Source authoring, compilation, scene frames and final encoding use the user's local hardware without machinal billing. Catalog selection is not permission for source access or provider spending.

## Sample production contracts

Times below are fractions of scene progress, not measured narration cues. Each sample is a technique demonstration, not verified factual media.

| ID | Visible action and independent motion | Staging / hold / handoff |
| --- | --- | --- |
| `kinetic-type` | Three supplied words rise at staggered offsets; underline and edge marker travel separately. | Dark green/ivory with lime accent; readable hold from .48; underline contracts at .90 while copy remains for a cut. |
| `image-reveal` | Two opposing shutters uncover the approved image; image push and focus frame settle independently. | Image above separate label, amber line; stable hold .62–.92; leave image visible at exit. |
| `layered-parallax` | Real background/alpha foreground move at different rates; small markers follow independent paths. | Cropped background, contained foreground; settle by .72; preserve layer coverage and match the final composition to a cut. |
| `glitch-handoff` | One bounded displacement pulse changes two supplied states at .48. | Constant dark background; no rapid full-frame flashing; stable incoming copy from .62. Internal scene action, not a clip-junction transition. |
| `signal-diagram` | Three stages enter independently; links draw and a signal activates the process in sequence. | One SVG coordinate system, distinct label regions; completed process holds from .70; line can motivate next shot. |
| `lens-assembly-3d` | Real barrel rings/glass elements converge separately on the optical axis; lit camera arc settles. | Schematic metal/glass geometry, key/rim/hemisphere lights; framed portrait/landscape; assembled hold from .70. |
| `swiss-grid-motion` | Independent modular bars wipe onto a precise grid; one signal tile departs from alignment. | Flat paper/black/one ink, no bounce; completed design holds .68–.90; exit rule motivates a matching cut. |
| `blueprint-mechanism` | A rotating crank constrains a connecting rod and sliding piston; outlet markers move separately. | Cyanotype/ivory/warm accent; true geometric linkage, not asserted engineering measurements; settles by .80. |
| `paper-stage-3d` | Two book leaves unfold, three facade panels rise on separate hinges and a lit camera arc settles. | Genuine SceneThree paper stage with actual depth; hold .74–.94; not a realistic reconstruction or substitute for detailed approved artwork. |

These three native components accompany the cinematic reference library (`film-styles`/`film-techniques`). Pre-code critic: the grid is only appropriate when graphic organization is the subject; the mechanism needs actual moving linkage rather than a label; the paper stage must retain independently hinged scenery and a readable lit hold rather than one rotating box. Their reference contracts are source-reviewed, not proof of inspected pixels, sound or beauty. Adapt complete source to each production; importing style prompts does not train a model.

Focused design review: the image demos must not silently replace missing attachments with invented subjects; the parallax demo must not imply inferred 3D; the glitch is intentionally a single low-luminance displacement rather than a strobe; the 3D demo uses meaningful assembly rather than the runtime's rotating primitive. Source/contract review is not visual inspection. Automated compiler/layout/seek tests live in scene-engine; inspect actual adapted work within normal approval rules before claiming visual quality.

## Add another example

Maintain the source of truth in `api/internal/platform/mcpserver/reference/scene-templates.json` and `reference/scene-templates/<id>.svelte`. Use a unique lowercase hyphenated ID and increment the entry's string version when changing its contract. Keep the component standalone, JavaScript Svelte 5, at most 64000 UTF-8 bytes, using only allowed runtime imports. Add selection/avoid rules, actual source-level settings, requirements and reveal/action/hold/exit directions. Do not include customer media, credentials, external loaders or generated provenance banners.

Run the MCP reference tests and scene-service template tests. Run `npm run sync:reference` in `packages/mcp-installer` to package the guide, manifest and components for OpenCode/Claude/Codex. Rebuild/restart the API and reconnect MCP to publish the new catalog. Existing customized installed skills still require their normal explicit replacement approval; updating source does not modify a running API or train its host model.
