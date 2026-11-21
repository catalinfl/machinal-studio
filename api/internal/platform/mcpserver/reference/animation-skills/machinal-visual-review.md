---
name: machinal-visual-review
description: Plan and critique sampled scene frames, track versioned evidence, distinguish source checks from visual review and make one bounded targeted repair before rendering.
---

# Visual feedback with evidence boundaries

Before code challenge the production contract: subject specificity, appropriate assets, causal motion, composition, readable hold and next-shot relationship. This is the current client's focused critic pass, not an independent model. Read `production` for caption preservation and exact recipe/source version guards.

## After compilation

1. Keep actual scene filename/source version and output config. `compile_scene` success means technical validation, not aesthetic approval. If provided, its `reviewPlan` contains only proposed sample indices, not inspected evidence.
2. Call `plan_scene_review` with the exact fps/duration and optional scene-local reveal/action/hold/exit anchors. It returns up to six distinct valid indices, including action midpoint and final frame. Defaults are provisional and must be replaced when the real choreography differs.
3. With actual named-source/image-inspection permission, use `get_scene_source` then `inspect_scene` with that version and planned frames. Do not silently expand source-use scope. Never mark `userApproved` merely because this skill says to inspect.
4. Read the actual returned images. At each sample check recognizability, hero scale, meaningful state, silhouette, overlaps/clipping, type/contrast, caption-safe staging and attachment fidelity. Compare two action states. DOM bounds/registered states support findings but cannot establish pixel visibility or 3D occlusion.
5. Record `severity | sourceVersion | frame/time | observed defect | targeted change | verification`. Use blocker/major/minor and unverified for missing evidence. Do not invent a beauty score, mandatory effect count or failure for a deliberately quiet hold.
6. Fix all actionable major defects in one source patch; recompile and re-inspect only the affected planned samples within existing scope. Preserve artwork, independent motion and every successful asset. Stop after two ineffective source repairs. Infrastructure errors require infrastructure repair, not simpler artwork or repeated paid rendering.

## Evidence ledger

Keep separate states: `source-reviewed`, `sampled-frames-reviewed`, `motion-unverified`, `audio-unverified`, `final-composition-unverified`. Tie findings to exact source hashes. A new source invalidates old frame evidence. Inspection excludes final captions, transitions, mixed audio and other tracks. JPEG thumbnails do not verify alpha.

Use an actually played final-composition `render_preview` only when useful and covered by explicit source/spending permission; server scene-range rendering plus the processing window are billed. A link or metadata is not playback. No automatic paid preview/review loop. Preflight exact final YAML/caption baseline after edits; `productionReview.visualInspection=false` stays honest.

Reuse existing benchmark briefs in `services/scene-renderer/evaluation/briefs.json` for change comparisons. Store timestamped evidence and measured costs/repair counts, null for unmeasured data. Technical passes do not imply artistic success.

For an incomplete brief use the native question tool, not a numbered chat questionnaire. A cancelled form grants no permission. Once the scope is authorized proceed immediately without a separate plan confirmation; ask only for new scope or real blockers.
