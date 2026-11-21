# Typography, captions and audio

Use topics `text` and `fonts` for exact deployed preset/font IDs. Text presets contain actual default style values, not just visual names. Text fields go directly on `texts[]`; there is no nested `texts[].style` object. A generation job's `style` is a separate caption-style contract.

## Text and caption choices

`title`/`subtitle`/`lower-third` organize information; `hook-pop`/`social-hook` introduce a truthful short hook; `step-label`/`numeric-proof`/`callout` clarify steps or supported numbers; `quote`/`quote-pull` frame supplied quotations; `caption`/`clean-phrase`/`clean-outline` emphasize reading; `active-word`/`tiktok-pop`/`tiktok-box`/`tiktok-glow` are appropriate only with real timed words when using word highlighting. Branded options include `cobalt-rail`, `signal-block`, `electric-line`, `lime-label`. Read entries before assuming their colors, animations or caption requirements. Do not render the catalog preview/sample text as the user's copy.

Every item needs a unique `id`, explicit `text`, nonnegative `start`, positive `duration`, optional `preset`, optional `sourceClipId` and `words`. Preset sample `text`, `duration`, `start`, `words` are deliberately **not** supplied as real content/timings by materialization. Overridden fields are applied on top of preset values.

With a preset, positions scale from the 1920×1080 catalog design space unless explicitly provided. Explicit text `x/y` are **output design pixels**: landscape 1920×1080, portrait 1080×1920, classic 1440×1080, independent of encoded resolution. Use safe margins and place important portrait captions clear of bottom overlays; do not use clip position percentages as text coordinates.

`anchor` is the horizontal reference point for `x`: `left`, `center` (the compatible default), or `right`. `align` only aligns lines INSIDE the text box. To begin a title at x=150, use `x: 150`, `anchor: left`, `align: left`; align:left alone still positions the box around x. `y` remains the vertical center. Preview and export load identical embedded fonts before measuring and fit text inside the frame; never compensate by guessing negative positions or inflating font sizes. UTF-8 and extended Latin are supported, including **ă â î ș ț Ă Â Î Ș Ț**. Named catalog fonts use their real embedded files; OS-specific aliases use deterministic bundled equivalents.

```yaml
texts:
  - id: step-one
    text: '01 / Prepare the ingredients'
    start: 0s
    duration: 3s
    preset: step-label
    anchor: left
    align: left
    x: 180
    y: 260
    color: '#15171b'
```

Supported flattened style fields: `x`, `y`, `fontFamily`, `fontSize` (8–600), `fontWeight` (400 or 700), `italic`, `align` (left/center/right/justify), `color`, `strokeColor`, `strokeWidth`, `backgroundColor`, `backgroundOpacity`, `backgroundPadding`, `backgroundRadius`, `bannerStyle` (none/rail/block/underline), `accentColor`, `animation` (none/slide-left/slide-right/rise/pop/drop/bounce/shake/float), `animationDuration`, `opacity`, `rotation`, `isCaption`, `highlightMode` (none/word), `highlightColor`, `highlightBackgroundColor`, `highlightBackgroundOpacity`, `highlightAnimation` (none/pop/bounce/slide-up/glow). Colors are quoted six-digit hex; opacity fields are 0–1, padding/radius/stroke width 0–200. Use registered font IDs, not downloaded font URLs or CSS family strings.

`anchor` is also a flattened style field. Keep title labels separate from captions and scene text. Do not put multiple words in one `words[].text` entry while requesting word highlighting: one measured interval must identify one display token. Grouped phrases require phrase display, not invented per-word timing. Review sentence boundaries and avoid flashing isolated one-word cues.

For `highlightMode: word`, set `isCaption: true` and supply nonempty `words: [{text, start, end}]` with **cue-local** seconds: ordered, nonoverlapping, within the text item's duration, whose joined text matches the item's text. Do not invent these timings or pretend a title is a transcript. Manual supplied/verified timings are free to author; generating a transcript/captions through the provider is paid.

## Caption generation

### TikTok caption font

When the brief targets **TikTok** or requests **TikTok-style captions**, NEW captions must explicitly use **`fontFamily: montserrat` and `fontWeight: 700`** unless the user explicitly chooses another font. These are the actual font values in the deployed `tiktok-pop`, `tiktok-box` and `tiktok-glow` presets. Verify `get_editing_reference(topic=fonts,id=montserrat)` and the chosen text preset. Montserrat is the supported TikTok-style choice, **not official TikTok Sans**; do not invent a `tiktok`/`tiktok-sans` font ID or claim that an unavailable font is embedded.

Set both fields in `captions.generate.style` before the timing-first pass, as in the caption job below. For newly authored manual captions, set flattened `texts[].fontFamily` and `texts[].fontWeight`. A TikTok animation/preset name alone does not select the caption font: caption generation uses `style`, not `job.preset`. Keep animation/highlighting choices separate and require real word timings for word highlighting.

**Preserve existing caption fonts/configuration** unless the user explicitly requests a font change; merely changing the destination to TikTok does not authorize restyling successful captions or regenerating them. An explicit font change alters only the requested font fields, preserving text, grouping, IDs and measured timings. A generic portrait/social brief does not imply TikTok, and mentioning TikTok does not authorize adding unrequested captions.

### Preserve existing captions

Treat existing YAML captions as **read-only unless the user explicitly requests a caption change**. Once captions exist, adding scenes, effects, transitions or final rendering is not permission to redesign them. Preserve complete caption entries, including:

- Exact `texts[].text` and `words[].text`: spaces, line breaks, punctuation, spelling and diacritics. Do not paraphrase, trim/collapse whitespace or reconstruct strings from joined words/a transcript.
- Cue grouping/order, `id`, `resultTextIds`, `sourceClipId`, `start`, `duration` and every word's cue-local `start`/`end`. Do not split/merge/reflow cues or invent new timings.
- Positions, `anchor`/`align`, fonts/sizes, colors, stroke/background, opacity and all animation/highlighting/effects values. Do not apply a different preset or reset explicit fields to defaults.

The renderer already handles font measurement, fitting, wrapping and collision avoidance. Do not simulate layout by rewriting caption text, manually spreading words across separate text items, inserting spaces, changing line breaks or moving/resizing captions. Adapt scene labels/visuals around the existing caption band, not the other way around; keep separate captions out of Svelte source.

Existing caption configuration takes precedence over style profiles and `captionMaxWords`. Four-word/two-line defaults apply only to **NEW caption generation**, never retroactively. Use `sourceJobId` for unchanged continuation. For visual edits, patch the resolved `recipeYaml` from `get_job_result` and compare complete caption entries and `resultTextIds` against that baseline before submission; undo unintended caption changes. A successful validation/compile does not prove preservation. Do not regenerate successful captions. This is an editing rule, not a new YAML lock flag.

The encoding repairs below are limited exceptions: deterministic reversible normalization or exact recovery from an intact source, never editorial/layout changes. If a real caption diagnostic requires other caption changes, report the specific blocker and ask first; do not silently “fix” an already configured layout.

### AI recipe text integrity

Keep caption text **UTF-8** end to end, including local `.edit.yaml` reads/writes (explicit UTF-8 on Windows). Inspect both `texts[].text` and `words[].text` before rendering: correct Romanian diacritics must not become mojibake such as `È™` or `Ã¢`. The compiler repairs known reversible Romanian encoding damage and composes Unicode text; `compile_recipe` returns the normalized document. Keep corrected text and word spellings consistent, preserving measured timings, caption IDs and `resultTextIds`. Do not rewrite a successful transcript through a legacy code page.

`invalid_text_encoding` means invalid UTF-8 or lost characters (`U+FFFD`): restore exact spelling from an intact transcript or supplied script. Never guess lost letters or remove diacritics. Do not regenerate successful speech/captions or bake captions into scenes to hide encoding damage. If no intact source is available, report the blocker before paid rendering. Revalidate the repaired recipe.

For **NEW caption generation only**, read `get_workflow_preferences`: default to **four words per caption**, especially for **1080×1920 portrait**. Do not increase this without an editorial/user reason. Preview and export fit captions using actual font measurements into at most two lines in the safe area, preserving word timings. Do not manually split/reflow existing cues to enforce these defaults. Report a genuine fitting failure instead of changing existing captions without the user's request.

Before paid work check `get_capabilities().generation.textPreparation.configured`. With `SCENE_SERVICE_URL` configured, the server prepares text internally; avoid sending large rasterized preparedText through MCP. An unset service needs deployment configuration, not a style change. `preparedText` keys/images must come from the renderer, never be invented. Do not discard requested word highlighting just to fit transport limits.

For narrated edits, materialize requested captions during an **audio-only timing-first pass**, before generating images or 2D/Three.js scenes. Use `generate_assets` with speech plus its audio placement (or approved existing audio) and the following `after` job; no visual-generation jobs yet. Wait for completion, read `get_job_result` and retain measured `texts`/`words`, audio assets and materialized job results before authoring timed visuals. All `before` jobs execute before `after` captions within one request: speech listed before scenes is not a caption-timing checkpoint. Read topic `jobs` and examples `narration-timing` then `narrated-documentary`. For footage/montage captions, continue using `after` on the resolved edit whose audio must be transcribed.

Example caption job for either pass:
```yaml
after:
  - id: spoken-captions
    type: captions.generate
    language: ro
    maxWords: 4
    style:
      fontFamily: montserrat
      fontWeight: 700
      fontSize: 58
      color: '#ffffff'
      highlightMode: word
```

`language` is a two-letter code, `auto`, or omitted; it selects transcription language, not translation. `maxWords` is 1–50 in caption materialization. `style` contains TextStyle fields, not a preset ID or nested CSS. The current caption materializer uses `style`, not `job.preset`; do not assume setting that string applies a text preset. Legacy `jobs` also permits `analysis.transcribe`; it does not automatically become `captions.generate`. Caption `input` is omitted or `montage` (version 3 montage-provenance scope), not arbitrary text. For ordinary generated narration, omit `input`; use `assetId` only when selecting a real audio-bearing asset intentionally.

Caption windows include audible audio/video clips; linked source audio is not transcribed twice. Narration tracks take priority when available. Muted clips, zero volume and sources without audio cannot produce a transcript. Preserve generated `resultTextIds` with their actual returned `texts`, rather than rerunning paid transcription.

## Audio, volume and duration

### Speech models and user choice

The backend, editor and MCP share `speech/catalog.json`, a curated allowlist, not an automatic import of every provider model. `list_speech_models(language: ro|en)` returns compact choices; `get_speech_model(model: exact-id, language: ro|en)` returns compatible voices and format. These lookups do not call providers or spend credits. Catalog configuration does not prove provider health; the supported language lists are a conservative subset, not all provider languages.

For Romanian, recommend `google/gemini-3.8-flash-tts` and offer `google/gemini-3.8-flash-lite-tts` for economy. For English, ask the user to choose between economical `hexgrad/kokoro-82m`, multilingual Gemini 3.8 Flash-Lite and expressive Gemini 3.8 Flash. Put this choice in the initial native brief form unless already answered/delegated. Respect an explicit model request; no silent fallback to Gemini 3.1 or to a cheaper model. Keep old 3.1 recipes unchanged. Use explicit model/language/voice in new YAML, not an implicit API default. Do not expose provider USD tariffs as commercial credit prices or promise an exact cost/latency from the tier label.

Gemini models request PCM from OpenRouter, with delivery direction in `instructions` and spoken copy in `text`; the server converts the 24 kHz mono PCM to MP3. All Gemini versions share the family adapter rather than checks specific to 3.1. Kokoro uses language-specific voices and cannot narrate Romanian; an English voice cannot be used for another narration language. A model choice alone is not source-use, cloning or spending authorization. No paid preview samples or alternative-model retries without permission.

For `speech.generate`, set `language: ro` for Romanian and `language: en` for English. `auto` conservatively recognizes Romanian/English when there is sufficient evidence; explicitly select the language for short or ambiguous copy. `instructions` supplies delivery guidance separately from the spoken `text`. The backend forwards native-pronunciation instructions, and for Gemini also its speech language configuration. Romanian without an explicit model/reference uses the multilingual Gemini voice; incompatible language-specific voices are rejected rather than silently using French/Spanish/English pronunciation. A cloned speaker can carry the original speaker's accent: choose an appropriate reference and listen to the result.

Finish speech and requested captions before fixing scene/chapter durations or submitting image/scene generation. Reuse existing approved timing results; do not add unrequested TTS or paid captions. Without captions, measured speech duration supports whole-section scenes, not invented per-word cues. Use `narrationJob` to bind a scene to its actual speech and content, or use measured captions to select a partial window. Never pad a mismatched plan with long silent holds or speed up scenes just to force provisional timing. Music mixing is available, **music generation is not**; do not promise original generated music or synthesize it with a local script without a separately approved alternative.

Declare an audio input slot, bind one actual audio asset, then:
```yaml
audio:
  - id: bed
    use: music
    start: 0s
    from: 0s
    fit: sequence
    repeat: true
    volume: 18
```

`fit: sequence` uses the current sequence/timeline span minus `start`; `source`/omitted uses explicit `duration` or remaining source. `repeat` must be explicitly true if the desired span exceeds available audio. Each loop uses the selected `from` source offset. Volume is percent (0–200); start with a restrained music bed under speech and verify audibility. This is not automatic loudness normalization, ducking, beat detection, music generation or rights clearance. `sequence.each.source_audio: keep|remove` affects source audio only; don't remove narration by mistake. Explicit audio clips support fades and timeline placement through normal clip fields/overrides.

Treat requested or AI-proposed runtime as approximate unless the user explicitly sets a hard duration cap. If a planned 30-second video yields 38–40 seconds of successful speech, preserve the full voice/captions and extend the video to the measured narration end. Do not regenerate, truncate or speed up narration solely to hit an estimate, or rerun successful captions/images. Lengthen/recompile existing scenes and holds or add relevant client-authored scenes within the approved visual scope; update placements and transition overlaps so the picture covers all speech. Keep real caption words/timings unchanged when audio placement is unchanged. State the adjusted runtime and continue without reconfirmation within existing permissions. Resolve an explicit hard duration cap or spending limit before changing paid narration or exceeding approval. Do not assume character count predicts exact spoken duration. `mp3` output is audio-only; video/scene/effect choices do not turn it into a video container.
