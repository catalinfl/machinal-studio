# Signal handoff with anchored labels

Two authored **960×540, 30 fps, 2-second, visualMode=2d** components demonstrate one semantic pulse moving between an emitter and receiver. No narration timings are claimed: these are synthetic technical examples, not an edit of supplied audio. Both reserve the bottom 24% for separate captions, which are never baked into the components.

| Scene | Reveal / action / hold / handoff |
| --- | --- |
| `outgoing.svelte` | Fixed readable circuit. Pulse travels from x=230 to x=630 over 0–1.4s, with an independently moving emission ring. Holds x=630 through frame 59. Label/connector follow the SAME bounds; top/bottom candidates avoid the devices. |
| `incoming.svelte` | First 0.2s holds the transferred pose. Pulse moves another 100px over 0.2–1.0s. Receiver lights and three separate response paths fan out over 0.9–1.5s, then hold. |

Contract/critic: a direct cut preserves pulse position, size, color and background; no dissolve/double fade is needed. The heading and label intentionally change at the cut. Static geometry stays in the same canvas coordinates; the small emitter-ring phase is not transferred. This demonstrates pulse-state handoff, **not identical full frames**, final-composition inspection or universal visual continuity. Text stays above y=390 (caption band starts at y=410.4). Labels use known 150×36 bounds, not inferred font measurements; `fits:false` still needs an authored repair if parameters/aspect change.

With source/edit permission, compile each complete component normally. Expose `parameters:{signal:{}}` on the outgoing scene and `parameters:{receiver:{}}` on incoming. Do not supply media or invent filenames. Retain each returned asset and exact sourceVersion. Then call `handoff_scene` with incoming file/version and:

```json
{"sourceFile":"<actual outgoing filename>","sourceVersion":"sha256:<actual outgoing hash>","frame":59,"objects":{"receiver":"signal"}}
```

The tool's other fields are `projectId`, `file`, `sourceVersion`, `idempotencyKey`, and actual `userApproved` consent covering both scenes. Wait for the existing free scene-compile job, read the new pinned asset, replace only the intended incoming timeline asset reference, then validate the exact recipe. No automatic timeline replacement or caption changes. Incoming delay/duration stay intact. Future rendering is still billed and needs normal spending permission.

`../../handoff.test.mjs` compiles/inspects these actual sources, transfers the returned declared pose, compares object bounds/state at the cut, checks caption-safe text and backward seeking. Those synthetic technical checks are not aesthetic approval of a production video. Activation requires updated API + scene service, reloaded client preview environment 9 and MCP 1.8.0; offline source alone does not update a running server.
