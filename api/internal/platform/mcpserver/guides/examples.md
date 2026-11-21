# Complete, compiler-tested recipe examples

Topic `examples` returns complete YAML composition strings; use `id` to retrieve one. Resource URIs are `machinal://examples/<id>`. They demonstrate authoring contracts, not media in a user's account. All filenames, immutable asset versions, source durations, copy/word timings and snapshot revisions are **synthetic**: replace them with uploaded project media, measured metadata and current state. Never pretend an example transcript or visual description is observed source content.

| ID | Demonstrates | Expected pure compile |
| --- | --- | --- |
| `cinematic-sequence` | v2 sequence, fine-film look, explicit no-motion override, cross-dissolve geometry | Finished composition, no generation |
| `social-hook` | Explicit video tracks, short named transition, first-clip motion rule, readable title | Finished composition, no generation |
| `tutorial-clean` | Step label, deliberate static treatment and real source audio | Finished composition, no generation |
| `caption-audio` | Verified example word timings, active-word preset, percent music volume/fit/repeat | Finished composition, no generation |
| `montage-v3` | Complete source ranges, exact duration tolerance, seeded deterministic choices | Finished composition, no generation |
| `modify-snapshot` | Real-shaped compiler snapshot, selector commands, trim and motion | Finished composition, synthetic snapshot only |
| `scene-generation` | Paid scene brief in before, portrait size/fps, staged placement | Pending scene.generate requirement, no provider call |
| `scene-three-explainer` | Detailed procedural Three.js storyboard, assembly, independent mesh action, lighting, camera orbit and stable hold | Pending scene.generate requirement, no provider call |
| `scene-image-insert` | Footage at 0–4s and 10–16s, six-second Svelte scene inserted at 4s, real image attachment and independently moving objects | Pending scene.generate requirement, no provider call |
| `scene-generated-image` | Complex subject generated first, referenced by images[].job, then embedded inside a genuine Three.js scene | Pending image.generate + scene.generate, no provider call |
| `scene-edit` | Existing server .scene.json asset, preservation-directed edit and placement | Pending scene.edit requirement, no provider call |
| `generated-media` | Single-request stage syntax: image + speech before and captions after; not a timing-first visual-planning workflow | Pending image/speech/captions requirements, no provider call |
| `narration-timing` | Pass 1: Romanian speech, audio placement and requested captions only; wait and retrieve the result before authoring visuals | Pending speech/captions requirements, no provider call |
| `narrated-documentary` | Pass 2: retain synthetic resolved voice/caption fixtures, then add an image and a partial-narration Three.js scene at measured times, plus a safe FHD heading | Pending image/scene requirements only, no provider call |

Read the relevant topical reference for the demonstrated fields and fetch current catalog entries before adopting exact values. Returned examples **never execute**. Unit tests parse them through the same strict API parser and run the real compiler with synthetic metadata; pending examples assert requirements rather than generating assets. No test requires a real API key, paid provider or renderer.

For narrated edits, start with `narration-timing`, call `generate_assets` only after approval, wait for completion and read `get_job_result` once. Build the visual pass by editing that returned resolved YAML, following `narrated-documentary`; never copy its synthetic result IDs, transcript, word times or assets. Preserve materialized narration/captions and submit edited `composition` to add visuals; `sourceJobId` is only for unchanged continuation. Do not put visual jobs in the timing pass or use `render_video` to discover narration duration. Existing approved audio/captions can satisfy the timing checkpoint; do not add unrequested TTS/captions.

Scene prompts are concrete storyboards, not vague CSS requests. The 2D/3D examples specify subject/action, visual hierarchy, palette/material/light and local reveal/action/hold/exit. Do not copy a generic heading or demo primitive instead of the requested scene, and never add AI-production labels, disclaimers or watermarks on screen.

After paid materialization, keep the returned resolved document/assets and add/verify the intended effects, transitions and rules against existing track/clip IDs. An empty pre-generation timeline may not accept rules for future clips; that is not a reason to silently remove the user's requested final treatments.
