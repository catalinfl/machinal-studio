---
name: machinal-choreography
description: Implement deterministic Svelte motion with anticipation, staged action, restrained easing, secondary movement and readable holds; repair timing without changing captions.
---

# Choreography, not animation wallpaper

The current client writes and repairs complete source; do not invoke another model or a local production renderer.

Read the live `scene-runtime` contract. Drive every pose from `scene.frame.time` or progress with `$derived` in Svelte and `update(frame)` in SceneThree. Same frame must produce the same state after a backward seek. Never accumulate deltas, use wall clocks, random values, CSS keyframes, timers, external animation loops or unapproved animation libraries.

## Score the action

| Phase | Question | Implementation |
| --- | --- | --- |
| Reveal | What must be understood before the change? | Already-visible context, motivated mask or a brief entrance |
| Anticipation | What prepares the action? | Small purposeful opposing travel or a pause, only if it helps |
| Action | What object changes and why? | A causal path/state change, not entire-frame zoom |
| Settle | Where should attention land? | Decelerate to the intended alignment; restrained overshoot for soft things only |
| Hold | Can the viewer understand/read the result? | Keep the hero visible and stable for the required reading time |
| Exit/handoff | What continues into the next shot? | Shared edge, direction, object or an intentional cut |

Retain four production-contract phases (reveal/action/hold/exit); anticipation and settle are sub-beats, not invented tool fields. Use measured speech cues when available. Do not invent word timings; no narration means scene-local design timing, not fabricated cues.

Useful deterministic smoothstep for a bounded interval:

```js
function phase(time, start, duration) {
  const t = Math.min(1, Math.max(0, (time - start) / duration));
  return t * t * (3 - 2 * t);
}
```

Use positive duration, shared geometry for linked parts and separate envelopes for independent objects. Easing should express material: precise mechanical engagement does not bounce; a soft object may settle. Stagger by meaningful processing/depth order, not a default cascade on every scene. Secondary motion supports the main action and stops before reading. Avoid constant pulsing, spinning or flashing.

Use normalized staging only for unvoiced demos. For narrated sections map measured global cues to scene-local seconds, account for clip overlap and transition handles, and preserve the successful speech/caption baseline. A transition must not erase a scene's whole reveal or hold; avoid double-fades.

## Check

Plan samples at reveal, action midpoint, settled state and exit. Compare annotated object bounds/registered semantic state with actual pixels; neither alone proves visible causal motion. Sample a moving object at two distinct times. Validate backward-seek determinism with synthetic service tests. Only a genuinely played preview can verify fluidity/audio sync. One bounded revision, not an automatic paid review loop.

For incomplete new video intake use the native question tool, not a numbered chat questionnaire. A cancelled form is not consent; after actual authorization proceed immediately without a separate plan confirmation. Never alter existing captions or add unrequested media/audio. Free code compilation does not make server scene/final rendering free.
