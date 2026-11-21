# Production evaluation fixtures

Eight fixed briefs in [briefs.json](briefs.json) separate creative ambition from compilation success, including causal valve timing and aligned image comparisons. They are evaluation inputs, **not completed or visually verified videos**. Media-dependent cases require separately approved source files and the same sources/caption baseline in both runs. No fixture authorizes provider work or rendering.

Record baseline and candidate JSON separately. Each run has `version: 1` and `cases`, with one result for every manifest case:

```json
{
  "id": "process",
  "briefVersion": 1,
  "compositionVersion": "sha256:<64 lowercase hex characters>",
  "sourceVersions": ["sha256:<64 lowercase hex characters>"],
  "technical": "unverified",
  "criteria": {
    "subject_specificity": {"status": "unverified", "evidence": ""},
    "meaningful_action": {"status": "unverified", "evidence": ""},
    "composition_readability": {"status": "unverified", "evidence": ""},
    "pacing": {"status": "unverified", "evidence": ""},
    "continuity": {"status": "unverified", "evidence": ""}
  },
  "metrics": {
    "elapsedSeconds": null,
    "repairCount": null,
    "sceneRenderCredits": null,
    "renderCredits": null,
    "aiCredits": null
  }
}
```

Replace version placeholders with actual fingerprints. Technical results are `passed`, `failed`, `unverified`; rubric dimensions use `met`, `not_met`, `unverified`. Non-unknown judgments require specific evidence with times/frame references and the evidence type (source, sampled frames, preview). Still frames alone cannot establish pacing/motion/audio. Use `null` for unmeasured metrics, never zero. Record actual settled credit categories, not advance estimates. Pin exact narration/captions/source files across both runs; change the case version if its brief changes.

From `services/scene-renderer/`:

```sh
node scripts/evaluate-production.mjs baseline.json candidate.json
node --test scripts/evaluate-production.test.mjs
```

For a concrete template's developer-only synthetic contact sheet, use a new directory (never overwrites):

```sh
node scripts/review-template.mjs piston-cycle NEW_REVIEW_DIRECTORY
node scripts/review-template.mjs piston-cycle NEW_PORTRAIT_DIRECTORY --portrait
```

Set `SCENE_BROWSER` to an installed Chromium executable if the Playwright default is unavailable. This command uses the real compiler/layout inspection and bounded JPEG evidence path, writes an HTML sheet plus `evidence.json` with source/browser/bundle fingerprints, and uses synthetic image placeholders only. It does not encode video, access customer projects, run providers or spend credits. Actual visual review remains necessary. This development check is not a local production rendering alternative for an MCP agent.

The comparator validates completeness and emits per-dimension before/after judgments and measured metric differences. It neither judges images nor generates a beauty score. No provider or render is called. A first real before/after evaluation remains work requiring approved sources and any applicable spending.
