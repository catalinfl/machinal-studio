# Selectors, overrides and edit commands

Read the deployed command list from `get_capabilities` or this tool's `commands` topic. Exact IDs and operand semantics matter; no free-form “apply effect” command exists.

Selectors have `{kind, ids?, trackId?, position?, index?, selected?}`. `kind` is clip/video/audio/image/track/transition (rules only video/image; montage only video). `position` is all/first/last/nth; `index` is 1-based. `selected: true` uses captured snapshot `selectedIds`, not a new selection invented by the model. Explicit IDs must all resolve. Commands resolve all their targets against the captured base timeline before execution; do not target a new ID created by an earlier command in the same batch.

| Command | Target / operands |
| --- | --- |
| `clip.move` | Clip selector, `patch.start`; optional destination `trackId` must be compatible/unlocked. |
| `clip.trim` | Clip selector, `patch.from` (source time) and/or `patch.duration` (timeline time). |
| `clip.duration` | Clip selector, `patch.duration`; must fit source at current playback rate. |
| `clip.speed` | Clip selector, `patch.rate` 0.25–4; supply intended duration explicitly if needed and compile source/timeline geometry. |
| `clip.delete` | Clip selector; also removes linked clips/attached effects, text and transitions. Ask before destructive edits. |
| `clip.duplicate` | Clip selector, `time` for duplicate start. Links/keyframes/attachments are not supported by this shortcut; author explicit items instead. |
| `clip.split` | Clip selector, `time` timeline split position. Links/keyframes/transitions/attachments require explicit items rather than this shortcut. |
| `clip.source_audio.remove` | Video clip with actual reciprocal linked audio; not a general mute command for arbitrary media. |
| `track.create` | `track: {id, name?, type: video|audio, clips: []}`; no selector needed. Subsequent commands in the same batch cannot select its new IDs. |
| `track.delete` | Track selector; removes its media/attachments, subject to locks. |
| `track.mute` | Track selector, explicit boolean `value`. |
| `track.hide` | Track selector, explicit boolean `value`. |
| `track.lock` | Track selector, explicit boolean `value`. Do not silently unlock protected edits. |
| `look.apply` | Clip selector, exact look `preset`; may replace treatment-owned effects and auto keyframes. |
| `look.remove` | Clip selector; removes the look and its owned look effects, not arbitrary independent effects. |
| `motion.apply` | Clip selector, exact motion `preset`; replaces motion keyframes. |
| `transform.set` | Clip selector, `patch.transform` or supported patch geometry; use full intended transform/default identity values where needed. |
| `transform.reset` | Clip selector; identity transform, clears keyframes and motion. |
| `keyframe.clear` | Clip selector; clears keyframes/motion, without promising reset of the base transform. |
| `transition.set` | Existing transition selector, exact transition `preset`. It changes a real pair, not arbitrary two clips. |
| `transition.duration` | Existing transition selector, `duration` matching valid overlap; retimes following clips. |
| `transition.remove` | Existing transition selector, optional `closeGap`; false retains an overlap as cross-dissolve, true removes overlap/repositions followers. |

Example fragment for an actual selected clip:
```yaml
commands:
  - type: clip.trim
    target: {kind: video, ids: [clip-a]}
    patch: {from: 1s, duration: 4s}
  - type: motion.apply
    target: {kind: video, ids: [clip-a]}
    preset: settle
```

`overrides` patches one real clip via `target: clip-id` directly; commands use `target` as a selector. Do not interchange these shapes. Order is montage, overrides, commands, rules and treatment expansion; look/motion may replace auto transforms. Validate final source bounds, linked audio alignment, locks, transition overlaps and text/effect anchors.

For `mode: modify`, supply a current compiler snapshot with a real revision; for `assemble`, commands can target explicit/compiled sequence IDs. A successful compile does not save the user's editor state; `save_project` is separately version checked.
