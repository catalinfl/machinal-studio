# Video production: director, builder, critic

Keep machinal's existing scene-engine. This workflow changes creative direction and verification, not the rendering engine. The current client writes and repairs Svelte; no server-model planner, critic or fallback is invoked.

Use this after the collaborative brief, without repeating questions or asking for a second plan approval. For a small edit, review only the changed beat/junction. Respect minimal, footage-only, still-only, procedural-only and no-generation choices. Creative review does not grant media access, provider spending, previews or re-renders.

Existing YAML captions are read-only unless the user explicitly requests a caption change. A critic pass is not permission to reword, regroup/reflow, reposition or restyle them. Preserve exact text/word spacing and line breaks, IDs/resultTextIds, timings and all layout, animation/highlighting/effects. Adapt visuals/scene labels around the existing caption band. Before rendering compare complete caption entries with the resolved baseline, not just the transcript or word count; successful validation alone does not prove preservation. Read topic `text` for the encoding-only exception and report genuine caption blockers rather than silently redesigning them.

For authorized spelling/name corrections, keep the intact resolved baseline and run free preflight with `captionBaseline` plus exact `captionTextEdits: [{from, to}]` and `captionEditsApproved:true`. OpenCode can read it through `captionBaselineRecipeFile`. This comparison changes only caption text/word strings in the expected baseline and rejects every other entry/ID/timing/style difference. Inspect `captionReview.status: preserved`, then save the new checkpoint. Merely omitting the old hash and establishing a new baseline does not demonstrate preservation. Approval is asserted from the user's actual request, never invented by the client.

## 1. Director: define observable success before code

After the timing-first checkpoint when narration is involved, write a compact **production contract** in a local Markdown artifact (or one compact in-context table when workspace tools are unavailable). This is not recipe YAML or additional on-screen copy. Keep the resolved audio/captions and approved assets. Before measured timing exists, label times provisional.

Specify one visual thesis for the whole video: what the viewer should understand/feel, its visual language (palette, type, image treatment, framing), and the subject-specific signature action. Avoid generic adjectives such as “premium”, “cinematic” or “spectacular” without describing what is visible.

For each meaningful beat record:

| Contract field | Concrete decision |
| --- | --- |
| Timing/message | Global start/end, actual cue/excerpt or supplied copy, one takeaway |
| Subject/action | What is recognizable on screen, and what visibly changes |
| Medium/assets | Footage, image-backed Svelte, diagram or genuine SceneThree; actual approved attachment IDs |
| Staging | Subject scale, foreground/midground/background, safe area, light/material/texture, exact short labels |
| Motion ownership | Which independent objects move; path, hierarchy and cause/effect, not just one zoom over the entire shot |
| Choreography | Scene-local reveal → meaningful action → readable hold → exit; use measured cues, not invented word times |
| Handoff | Previous/next shot relationship: matching edge, direction, subject, scale, palette or intentional contrast |
| Treatment | Exact chosen transition/effect/look/motion, target and interval, or an explicit reason for no added treatment |
| Verification | What source/diagnostic/frame would demonstrate the intended change; mark unavailable evidence honestly |

Design the handoffs before implementing isolated scenes. A boundary between two clips on the same track belongs in recipe transitions with real overlap; an object reveal inside one scene belongs in frame-driven Svelte. Do not double-fade both the scene and its timeline transition. Include transition handles while planning scene-local holds so dissolves do not erase the subject or shorten the narration coverage.

For expressive briefs, choose a subject-specific transformation and pacing contrast, not only an entrance followed by a long unchanged slide. Explore two concise staging ideas for the signature beat, choose the one that communicates better, then implement only that direction. This is a text/design choice, not permission to generate alternative paid assets. A quiet reading/viewing hold is intentional, not a defect.

## 2. Critic: challenge the contract before authoring

Switch to a focused critic pass before writing scene code. Evaluate the contract rather than defending the proposed implementation. This is a separate review stage in the current client, not a claim of an independent model or visual inspection. Do not spawn agents or call another model without host/user authorization.

Check these dimensions independently:

- **Subject specificity:** would the visuals still work unchanged if the title were replaced with an unrelated topic? If yes, redesign the visual idea. Decorative particles or a floating heading do not illustrate the subject.
- **Asset suitability:** if complex subjects would read poorly as SVG/CSS, default to approved image-backed animation rather than fragile shape stacks. Reuse suitable images or plan approved generation; prefer `background: transparent` with GPT Image 2.5 for isolated foreground cutouts, not for full-frame environments. Preserve actual alpha and independent layers; never claim requested transparency is verified. Respect no-generation/procedural-only constraints and existing spending scope. See topic `scenes` for exact model IDs and fields.
- **Visual coverage:** overly simplistic SVG/CSS and one reused portrait with text, lines and nodes do not provide documentary context. Check the image-coverage list for distinct relevant people, geographic context, environments and period-grounded illustrative scenes tied to verified copy. 5–10 distinct images per video can be appropriate, not a quota or cap; the four-image attachment limit is per scene, not per video. Do not simplify solely to make the video cheap; respect the approved budget, reuse suitable successful assets and ask about a genuine scope/cap mismatch. Minimal/no-generation/procedural-only briefs still win. Assess visual variety separately from pacing; a quiet hold is not itself a defect or permission to change captions, narration or transitions.
- **Meaningful motion:** identify the exact object/state that changes and what it teaches. Moving the whole frame is camera motion, not independent object animation. Continuous spinning is not automatically meaningful action.
- **Composition and craft:** a clear focal subject, intentional scale/depth, readable type and safe areas. Reject a generic dashboard/card stack when the brief calls for a scene, but preserve a deliberately minimal composition.
- **Pacing:** actions develop across the measured beat, with anticipation/reveal/settle and enough viewing time. Avoid completing all movement in the first second or repeating identical entrances throughout the video.
- **Continuity and treatment:** every meaningful junction has a deliberate cut/transition choice, and accents have targets/times. “No effects are necessary” must relate to this beat, not be a blanket excuse to ignore an expressive brief.
- **Truth and scope:** no invented facts/word times, fake 3D reconstruction, unapproved imagery, production labels or new paid actions.

Write only actionable findings: `severity | beat/junction + time | evidence | specific change | verification`. Use `blocker`, `major`, `minor`; use `unverified` when evidence is unavailable. No uncalibrated overall beauty score, automatic 10/10, generic praise, or mandatory minimum effect count. Correct major design omissions before authoring, without another user confirmation for already-covered work. Keep this pass bounded: one focused revision, not an endless brainstorm.

### Calibrated examples (directions, not presets or inspected media)

| Weak proposal | Critic finding | Stronger subject-specific direction |
| --- | --- | --- |
| Biography: a heading, the same portrait and document/date cards at every beat | The topic exists mostly in the copy; more labels or a new crop do not supply geographic or historical context. | Use distinct approved portrait, geographic/environmental and period-grounded illustrative images for the relevant verified beats. Document/date cards can support, not replace, those views. Generate missing artwork only within approval; no invented events, depth inside a photo or archival claims. |
| Mechanism: the runtime demo cube spins behind a label | Genuine WebGL alone does not explain the mechanism. | Stage relevant schematic parts, separate them along their functional axes, engage linked motion and settle the camera on the relationship. Use actual geometry/lights; do not invent product internals. |
| Comparison: two cards fade in simultaneously, then nothing changes | The viewer cannot see what differs or why the order matters. | Match image scale, reveal the supplied contrasting states in sequence, move a truthful comparison marker, then hold both states legibly. |
| Minimal quote: typography holds quietly over an approved image | Not a failure just because there are no particles, 3D or transitions. | Preserve the quiet brief; verify hierarchy, reading time and the chosen cut. |

## 3. Builder: implement the approved creative scope

Read scene-authoring/runtime and only the exact catalog IDs selected. Write complete Svelte in the current client; keep subject, independent objects and media visible through the central hold. Use genuine Three.js only when spatial relationships help. Repairs preserve artwork, motion, attachments and narration.

Implement the effect score and junctions on the actual resolved clip/track IDs after generation. A prose promise is not implementation. Do not delete treatments to make an empty staging recipe validate, and do not substitute generic headings when layout checks fail. Keep a simple mapping from each contract item to its source component and final recipe target.

## 4. Critic: compare implementation with evidence before render

Validate the exact final YAML, then use `compile_recipe` once for its normalized plan and **editorialReview**. Reuse an unchanged successful compile; edits invalidate its evidence. The report is deterministic recipe-level evidence, not another AI review and not a provider action:

The default response is compact: diagnostics, requirements, `planSummary`, exact `compositionVersion`, conservative `captionVersion` and the reviews below. Request `fullResult:true` only for the full normalized document/plan/recovery. `expectedCaptionVersion` on preflight/generation/render rejects changes to any existing text entry or caption result ID before submission; it includes all recipe text, so authorized title/text changes require an updated baseline. OpenCode can save new `checkpointFile` artifacts alongside the resolved `recipeFile`, use `captionBaselineFile` for subsequent visual-only edits and read a preflight `checkpointFile` on paid calls to apply the reviewed hash automatically. No hand-copied hash, repeated generation or caption reconstruction is necessary. Checkpoints do not grant permission or aesthetic approval.

- `status: not_ready`: no complete normalized plan, pending requirements or compile errors. Do not accept a draft as final.
- `status: review_required`: the plan is available for the current client's critic. This does **not** mean approved or aesthetically successful.
- `junctions`: each same-track cut, gap, declared transition or implicit cross-dissolve, with actual clip IDs and seconds. Other tracks may cover a per-track gap; it is not automatically a blank output.
- `treatments`: actual look/motion selections, resolved transform-keyframe motion and expanded effect blocks with targets/intervals. `origin: look:...` distinguishes look-generated effects from separately chosen accents. Keyframe presence is not proof that transforms actually differ.
- `notices`: all cuts or no recipe effects are review prompts, not compiler errors or a requirement to add decoration. Hidden video tracks/zero-opacity clips are excluded; other occlusion and scene-internal treatment are not inferred.
- `visualInspection: false`: no scene pixels, moving footage or audio have been inspected by this report.

Detailed lists are capped at 64 entries each; `totalJunctions`, `totalTreatments` and `truncated` disclose omitted detail. Notices are computed before truncation. For a large edit, inspect the complete original normalized plan rather than treating the sampled list as exhaustive. If the existing result nearly fills the MCP response limit, detail may be omitted or the optional report absent to preserve the authoritative result; absence is never approval and must not trigger another paid action.

Compare each promised junction/accent/signature action with the actual YAML and Svelte source. If transitions/effects are absent from the final recipe, either implement the planned treatment or record a concrete brief-compatible reason to omit it. Do not claim a Svelte source review proves its rendered appearance; do not claim missing recipe effects imply a scene has no effects.

When deployed inspection tools and approval allow it, inspect representative **frames** at reveal/action/hold/exit and both sides/midpoint of a transition, then motion/audio in an available video preview. `inspect_scene` provides bounded scene-frame evidence as described below, not final-composition inspection. Still frames cannot verify motion smoothness or audio sync. Prefer existing evidence and a bounded targeted repair; a paid preview/re-render requires appropriate spending scope. If frame/video inspection is unavailable, state `source/plan reviewed; visual result unverified` and continue only within the user's approved scope. Do not invent screenshot, frame-extraction or video-understanding tools.

Close the critic's major findings using evidence or report the blocker; do not silently downgrade complexity or regenerate successful audio/images/captions. This workflow is an instruction-level quality checkpoint, not a render authorization token or a server-enforced aesthetic guarantee. Final rendering requires normal schema/timeline preflight and existing source-use/local-processing permissions. No machinal credit balance is required; any additional provider work needs covered OpenRouter spending permission.

## Structured contract and revision checks

`compile_recipe` optionally accepts `productionContract` as a TOOL argument, never as a recipe YAML field. With or without a contract it adds `productionReview`, unless the authoritative response leaves insufficient room. Missing/truncated review is never approval. `compositionVersion` is SHA-256 of the exact UTF-8 YAML bytes, including whitespace. Obtain it from an initial compile or compute that hash in the current client; do not change the recipe just to create a review. After any edit reconcile the contract and use the new version. The original compiler document/captions remain untouched.

Contract shape (replace placeholders with real clip IDs and pinned source versions):

```json
{
  "version": 1,
  "compositionVersion": "sha256:<exact YAML hash>",
  "beats": [{
    "id": "engagement", "clipId": "mechanism", "assetVersion": "sha256:<actual scene source hash>",
    "start": 0, "end": 4,
    "message": "The signal engages the receiver", "subject": "Signal and receiver",
    "action": "Signal travels to receiver, which changes state",
    "objects": ["signal", "receiver"],
    "phases": [{"kind":"reveal","at":0},{"kind":"action","at":1},{"kind":"hold","at":2.5},{"kind":"exit","at":3.8}],
    "treatments": [{"kind":"none","start":0,"duration":4,"reason":"The internal explanatory motion carries this beat"}]
  }]
}
```

All contract times are GLOBAL timeline seconds. Keep the richer prose direction for staging, lighting, measured cue excerpts and verification. Up to 64 beats, each with 1–16 stable object IDs and treatments. Beat ranges must be covered by their visible target clip. Four ordered phases can coincide for deliberately quiet/minimal work; this is not a requirement to add motion. Asset versions must match the normalized plan. `handoff: {nextBeatId, objectId}` checks a later beat declares the same identity; it cannot prove visual continuity.

Treatment interval checks use the same microsecond precision as the timeline, not binary floating-point addition. Invalid contracts return field-level diagnostics such as `productionContract.beats[0].treatments[1].duration`, with the actual interval and allowed beat bounds. Correct the diagnosed field; do not remove promised treatments to bypass a contract error.

Treatment kinds: `effect`, `look`, `motion`, `transition`, `cut`, `none`. Use exact catalog preset/start/duration; effects match actual expanded blocks on the clip/track, transitions/cuts describe the target clip's OUTGOING same-track junction, and look/motion span the entire clip. Cut/none require a brief-specific reason. Scene-internal motion/effects remain Svelte/frame-review evidence, not inferred YAML effects. No effect quota is imposed.

`productionReview.status` is `not_ready`, `contract_required`, `revision_required` or `review_required`. Even the last is NOT approval. It reports exact recipe and canonical contract hashes, stale source/recipe versions, missing targets/treatments, invalid beat coverage and broken declared handoffs. Up to 128 findings are returned with `totalFindings`/`truncated`. `visualInspection` stays false: the report does not read pixels. Render/generation accepts optional `expectedCompositionVersion` to reject a changed recipe BEFORE paid submission. This is a stale-review guard, not an aesthetic gate, approval token or replacement for authorization/validation.

## Bounded visual evidence

After explicit permission to inspect the named scene and return images to the current client, use `get_scene_source` for `sourceVersion` and frame config, then:

```json
{"projectId":"<owned project>","file":"<actual compiled scene filename>","sourceVersion":"sha256:<actual source hash>","frames":[0,30,75,114],"userApproved":true}
```

Call `inspect_scene` with 1–6 distinct integer frame indices inside that source. Returned MCP images are actual JPEG thumbnails, at most 480px on the long edge, with timestamps and sampled diagnostics. The source fingerprint uses the SAME bytes that are inspected; stale requests return 409. Evidence also reports browser version and compiled runtime bundle hash: this is not a guarantee of pixel identity across deployments. JPEG backing does not verify export alpha. Resources stay embedded, network access is denied, execution/output/queue sizes are bounded, and images are not published as cloud assets or download links. Inspection, full scene rendering and final encoding use local hardware without machinal charges. Provider generation may charge the user's own OpenRouter account. This diagnostic operation does not create or encode a preview video.

Annotate relevant DOM/SVG groups with `data-scene-object="stable-id"` to receive up to 32 object bounds/opacities per frame, plus `totalObjects`/`objectsTruncated`. Declarations/bounds are not proof of pixel visibility, absence of occlusion, semantic action or internal Three.js mesh motion. Compare actual images with the contract; cite source version and frame/time in findings. The scene view excludes timeline captions, other clips, final transitions/effects and mixed audio. Do not claim final-composition inspection, smooth motion or audio sync from these samples. Request missing evidence only when useful; do not automatically iterate inspections/renders. Existing source-use consent must actually cover image inspection; library listing is insufficient.

## Final-composition video preview (local processing)

`render_preview` renders an MP4 excerpt using the SAME final scene/layer/effect/transition/caption/audio pipeline, not a simulated browser view. It requires a fully resolved valid recipe, no pending generation and explicit source/local-processing approval. No machinal account or credits are used. Keep existing voice/images/caption results and exact recipe/caption entries. Do not trim, shift or rebuild the YAML for a short review clip.

**Current processing boundary:** the COMPLETE composition and all referenced scenes are processed before selecting the excerpt at FINAL encoding. Local CPU/memory/time are not limited to the excerpt's seconds. Explain this limitation; no regional-render shortcut or automatic review loop is promised. Local rendering has no machinal charges. Successful provider usage may already have charged the user's OpenRouter account even if later encoding fails.

After validation/compilation, call:

```json
{"projectId":"<owned project>","composition":"<exact fully resolved YAML>","expectedCompositionVersion":"sha256:<reviewed YAML hash>","start":8.5,"duration":3,"idempotencyKey":"<stable preview key>","userApproved":true}
```

Alternatively use unchanged resolved generation `sourceJobId`, not both composition and sourceJobId. `expectedCompositionVersion` is REQUIRED for previews. `start` is global timeline seconds; duration is greater than zero, at least one output frame, at most 15 seconds and inside an MP4 timeline. Output resolution/fps/quality and the original recipe remain unchanged. The native renderer clips the already-composited video and mixed audio together; captions keep their original text, grouping, IDs, word timings, layout and animation.

The preview uses the local `automation-render` queue, idempotency, cancellation, bounded waits and volume delivery. Wait for `completed`, then request `get_video_result` with delivery consent. The result includes preview start/duration, `processedDuration` and a compatibility `billingBasis` field; that field is not a local invoice. A changed interval needs a new idempotency key. An excerpt must not replace the approved complete film or its delivery destination.

Review motion/audio only if the host/user actually plays an available video. Returning a preview link, verifying streams/duration or inspecting still frames is not proof of smooth motion, semantic correctness, audio sync or aesthetic approval. `productionReview.visualInspection` stays false; no server critic or new model is invoked. Without a playback/inspection capability report the remaining evidence boundary instead of claiming the video was watched.
