<script lang="ts">
  import { useTextToSpeech } from '../composables/useTextToSpeech.svelte'
  import { editor } from '../stores/editor.svelte'
  import UiSelect from './UiSelect.svelte'
  import WorkbenchDialog from './WorkbenchDialog.svelte'
  import RecipeSnippet from './RecipeSnippet.svelte'
  import { speechJobSnippet } from '../lib/composition-recipes'

  interface Props {
    onClose?: () => void
  }

  let { onClose }: Props = $props()
  const speech = useTextToSpeech()

  let resultAudio: HTMLAudioElement | undefined = $state()
  let isPlaying = $state(false)

  $effect(() => {
    const url = speech.result?.url
    if (resultAudio && url !== resultAudio.src) {
      resultAudio.pause()
    }
    if (!url) {
      resultAudio?.pause()
    }
    isPlaying = false
  })

  $effect(() => {
    if (speech.phase.kind === 'generating') {
      resultAudio?.pause()
      isPlaying = false
    }
  })

  async function toggleResultPlayback(): Promise<void> {
    const element = resultAudio
    if (!element || !speech.result) return
    if (element.paused) {
      try {
        await element.play()
        isPlaying = true
      } catch {
        isPlaying = false
      }
    } else {
      element.pause()
      isPlaying = false
    }
  }

  function handleResultEnded(): void {
    isPlaying = false
  }
</script>

<WorkbenchDialog id="text-to-speech-panel" ariaLabel="Text to Speech dialog" title="Text to Speech" subtitle="Generate narration at the playhead" metered {onClose}>
  <form class="controls" onsubmit={speech.submitForm}>
    <div class="intent-strip">
      <div class="intent-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M4 12h2m2-4v8m4-7v6m4-10v14m4-8v4" /></svg>
      </div>
      <p>Shape a voice track, then place it exactly where the playhead is parked.</p>
    </div>

    <section class="control-section text-section">
      <div class="section-head">
        <label for="speech-text">Script</label>
        <span class:limit={speech.characterCount > 4000}>{speech.characterCount} / 4,000</span>
      </div>
      <textarea id="speech-text" rows="2" bind:value={speech.input} maxlength="4001" disabled={speech.phase.kind === 'generating'} placeholder="Paste dialogue, narration, or a voice-over script…"></textarea>
      <div class="field-hint"><span>Keep the first draft conversational.</span><span aria-hidden="true">Auto-saved</span></div>
      <div class="field-stack">
        <label for="speech-language">Narration language</label>
        <UiSelect
          id="speech-language"
          label="Narration language"
          value={speech.language}
          options={[
            { value: 'auto', label: 'Detect from script' },
            { value: 'ro', label: 'Română · Romanian' },
            { value: 'en', label: 'English' },
            { value: 'fr', label: 'Français · French' },
            { value: 'es', label: 'Español · Spanish' },
            { value: 'de', label: 'Deutsch · German' },
            { value: 'it', label: 'Italiano · Italian' },
          ]}
          disabled={speech.busy}
          onChange={(language) => { speech.language = language }}
        />
        <p class="field-hint">The script is read in this language, not translated. Romanian narration uses a multilingual voice, not a French or Spanish preset.</p>
      </div>
    </section>

    <details class="advanced-settings">
      <summary>Generation model · {speech.selectedModel.label}</summary>
    <section class="control-section model-section">
      <div class="model-row">
        <div class="field-stack">
          <label for="speech-model">Model</label>
          <UiSelect
            id="speech-model"
            label="Model"
            value={speech.model}
            options={speech.models.map((option) => ({ value: option.id, label: option.label }))}
            disabled={speech.phase.kind === 'generating'}
            onChange={(id) => speech.selectModel(id as typeof speech.model)}
          />
        </div>
        <p>{speech.selectedModel.detail}</p>
      </div>
    </section>
    </details>

    <details class="advanced-settings">
      <summary>Voice · {speech.voiceMode === 'clone' ? speech.referenceName || 'Choose a voice sample' : speech.voiceLabel(speech.voice)}</summary>
    <section class="control-section voice-section">
      <fieldset disabled={speech.phase.kind === 'generating'}>
        <legend>Voice source</legend>
        <div class="voice-modes">
          <button type="button" class:active={speech.voiceMode === 'clone'} aria-pressed={speech.voiceMode === 'clone'} disabled={!speech.canClone} title={!speech.canClone ? 'This model does not support voice cloning' : 'Clone from a server voice sample'} onclick={speech.selectCloneVoiceMode}>Clone a voice</button>
          <button type="button" class:active={speech.voiceMode === 'preset'} aria-pressed={speech.voiceMode === 'preset'} disabled={!speech.hasPresetVoices} title={!speech.hasPresetVoices ? 'This model has no built-in voices' : 'Use a ready-made voice'} onclick={speech.selectPresetVoiceMode}>Built-in voice</button>
        </div>
      </fieldset>

      {#if speech.voiceMode === 'clone'}
        <div class="reference-grid">
          <div class="field-stack">
            <label for="voice-reference">Voice sample</label>
            <UiSelect
              id="voice-reference"
              label="Voice sample"
              value={speech.referenceName}
              options={speech.references.map((reference) => ({ value: reference, label: reference }))}
              placeholder={speech.references.length ? 'Choose from Media Bin' : 'No server audio in Media Bin'}
              disabled={speech.phase.kind === 'generating' || speech.references.length === 0}
              onChange={(name) => { speech.referenceName = name }}
            />
          </div>
          <button class="secondary upload" type="button" disabled={speech.busy} onclick={speech.openFilePicker}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11.5v3A2.5 2.5 0 0 0 6.5 17h7a2.5 2.5 0 0 0 2.5-2.5v-3" /></svg>
            Choose audio or video
          </button>
          <input bind:this={speech.fileInput} type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.mp4,.mov,.mkv,.avi,.webm,.mpeg,.mpg,.ogv" onchange={speech.selectReferenceFileEvent} hidden />
        </div>
        <div class="field-stack">
          <label for="media-bin-audio">Media Bin audio</label>
          <UiSelect
            id="media-bin-audio"
            label="Media Bin audio"
            value={speech.mediaBinAudioName}
            options={speech.proxyAudios.map((source) => ({
              value: source.name,
              label: source.duration > 0 ? `${source.name} · ${speech.formatDuration(source.duration)}` : source.name,
            }))}
              placeholder={speech.proxyAudios.length ? 'Choose audio already in the project' : 'No server audio in Media Bin'}
            disabled={speech.busy || speech.proxyAudios.length === 0}
            onChange={(name) => { void speech.selectMediaBinAudio(name) }}
          />
        </div>
        {#if speech.voiceSample.file}
          <div class="sample-editor" aria-label="Voice sample segment">
            <div class="sample-file"><strong>{speech.voiceSample.file.name}</strong><span>{speech.formatDuration(speech.voiceSample.duration)} available</span></div>
            {#if speech.requiresTrim}
              <div class="trim-notice" role="note">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h3l2 9h2l2-9h3M7.5 9.5h5" /></svg>
                <span><strong>Trim this sample to 30 seconds</strong><small>The file is {speech.formatDuration(speech.voiceSample.duration)}. Choose the section that best represents the voice.</small></span>
              </div>
              <label class="trim-range" for="sample-start-range">
                <span>Start point <strong>{speech.formatDuration(speech.voiceSample.start)}</strong></span>
                <input id="sample-start-range" aria-label="Voice sample start" type="range" min="0" max={Math.max(0, speech.voiceSample.duration - speech.voiceSample.sampleDuration)} step="0.1" value={speech.voiceSample.start} oninput={speech.updateSampleStartEvent} disabled={speech.phase.kind === 'uploading'} />
              </label>
              <div class="time-fields">
                <label for="sample-start">Start (seconds)<input id="sample-start" type="number" min="0" max={Math.max(0, speech.voiceSample.duration - 0.1)} step="0.1" value={speech.voiceSample.start} oninput={speech.updateSampleStartEvent} disabled={speech.phase.kind === 'uploading'} /></label>
                <label for="sample-duration">Duration (seconds)<input id="sample-duration" type="number" min="0.1" max={Math.min(speech.maxReferenceSeconds, speech.voiceSample.duration - speech.voiceSample.start)} step="0.1" value={speech.voiceSample.sampleDuration} oninput={speech.updateSampleDurationEvent} disabled={speech.phase.kind === 'uploading'} /></label>
              </div>
            {/if}
            <p>{speech.requiresTrim ? `Only the selected ${speech.voiceSample.sampleDuration.toFixed(1)}s is converted locally and uploaded.` : `The full ${speech.voiceSample.sampleDuration.toFixed(1)}s sample is converted locally and uploaded.`}</p>
            <button class="secondary upload-segment" type="button" disabled={speech.phase.kind === 'uploading' || speech.voiceSample.sampleDuration <= 0} onclick={speech.uploadReferenceEvent}>{speech.phase.kind === 'uploading' ? 'Preparing MP3…' : 'Upload selected segment'}</button>
          </div>
        {/if}
        <details class="advanced-settings"><summary>Sample transcript · optional</summary>
          <div class="field-stack">
            <label for="reference-transcript">Sample transcript</label>
            <textarea id="reference-transcript" rows="1" class="transcript" bind:value={speech.referenceTranscript} maxlength="4000" disabled={speech.phase.kind === 'generating'} placeholder="What is being said in the sample?"></textarea>
          </div>
        </details>
        <label class="permission">
          <input type="checkbox" bind:checked={speech.permissionConfirmed} disabled={speech.phase.kind === 'generating'} />
          <span><strong>I have permission to use this voice.</strong><small>Only clone your own voice or a voice whose owner has consented.</small></span>
        </label>
      {:else}
        <div class="field-stack">
          <label for="preset-voice">Built-in voice</label>
          <UiSelect
            id="preset-voice"
            label="Built-in voice"
            value={speech.voice}
            options={speech.selectedModel.voices.map((option) => ({ value: option, label: speech.voiceLabel(option) }))}
            disabled={speech.phase.kind === 'generating'}
            onChange={(name) => { speech.voice = name }}
          />
        </div>
      {/if}
    </section>

    </details>
    <details class="advanced-settings"><summary>Advanced · reusable recipe</summary>
      <RecipeSnippet title="Reuse voice settings" description="Copy into the recipe document. Edit the script in YAML before compiling; the voice is placed at the selected time." yaml={speechJobSnippet({ text: speech.input, language: speech.language, model: speech.model, voice: speech.voiceMode === 'preset' ? speech.voice : undefined, referenceName: speech.voiceMode === 'clone' ? speech.referenceName : undefined, referenceTranscript: speech.voiceMode === 'clone' ? speech.referenceTranscript : undefined, start: editor.currentTime })} />
    </details>

    <div class="action-dock">
      <button class="generate" type="submit" disabled={!speech.ready || speech.busy} aria-describedby="speech-action-note">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h2m2-4v8m3-11v14m3-11v8m3-6v4" /></svg>
        {speech.phase.kind === 'generating' ? 'Generating speech…' : 'Generate at Playhead'}
      </button>
      <span class="action-context" id="speech-action-note">Starts at {speech.formatDuration(editor.currentTime)} · new audio clip</span>
    </div>
    {#if speech.error}<div class="error" role="alert">{speech.error}</div>{/if}
    {#if speech.result}
      <section class="result" aria-label="Speech output">
        <div class="result-head"><span>New voice track</span><span class="result-state">Ready</span></div>
        <div class="result-player">
          <button type="button" class="play" onclick={toggleResultPlayback} aria-label={isPlaying ? `Pause ${speech.result.name}` : `Play ${speech.result.name}`} aria-pressed={isPlaying} title={isPlaying ? 'Pause' : 'Play'}>
            {#if isPlaying}
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg>
            {:else}
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5z" /></svg>
            {/if}
          </button>
          <div class="result-meta"><strong>{speech.result.name}</strong><span>{speech.formatDuration(speech.result.duration)} · {speech.selectedModel.label} · {isPlaying ? 'Playing…' : 'Press play to listen'}</span></div>
        </div>
        <!-- svelte-ignore a11y_media_has_caption -->
        <audio bind:this={resultAudio} src={speech.result.url} preload="metadata" onended={handleResultEnded}></audio>
      </section>
    {/if}
    {#if speech.status}<div class="status" class:busy={speech.busy} role="status" aria-live="polite"><span></span>{speech.status}</div>{/if}
  </form>
</WorkbenchDialog>

<style>
  .controls { min-height:100%; padding:var(--space-8); background:var(--surface); }
  .intent-strip { display:grid; grid-template-columns:40px minmax(0, 1fr); align-items:center; gap:var(--space-5); margin-bottom:var(--space-10); padding:var(--space-5) var(--space-6); border:1px solid var(--primary-border); border-radius:var(--radius-md); background:var(--primary-subtle); }
  .intent-mark { display:grid; width:40px; height:40px; place-items:center; border-radius:var(--radius-sm); color:var(--primary); background:var(--surface-elevated); }
  .intent-mark svg { width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; }
  .intent-strip p { margin:0; color:var(--foreground); font-size:var(--text-xs); line-height:var(--leading-copy); }
  .control-section { display:flex; flex-direction:column; gap:var(--space-4); padding:0 0 var(--space-10); margin:0 0 var(--space-10); border-bottom:1px solid var(--border); }
  .section-head { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); }
  label, legend { color:var(--foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
   .section-head span { color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); font-weight:var(--weight-normal); }
  .section-head span.limit { color:var(--destructive); }
  textarea { width:100%; border:1px solid var(--border); border-radius:var(--radius-sm); background-color:var(--surface-elevated); color:var(--foreground); font:var(--text-xs)/var(--leading-copy) var(--font-sans); transition:border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease; }
   textarea { min-height:60px; padding:var(--space-4); resize:vertical; }
   textarea.transcript { min-height:36px; }
  textarea::placeholder { color:var(--muted-foreground); }
  textarea:focus-visible, button:focus-visible, input:focus-visible { outline:none; border-color:var(--primary); box-shadow:var(--focus-ring); }
  .field-hint { display:flex; align-items:center; justify-content:space-between; gap:var(--space-5); color:var(--muted-foreground); font-size:var(--text-2xs); }
  .field-hint span:last-child { color:var(--primary); font-family:var(--font-mono); }
  .model-row { display:grid; grid-template-columns:minmax(0, 1fr); align-items:start; gap:var(--space-3); }
  .model-section p { margin:0; color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); }
  fieldset { display:flex; min-width:0; flex-direction:column; gap:var(--space-4); margin:0; padding:0; border:0; }
  legend { margin:0; }
  .voice-modes { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-1); padding:var(--space-1); border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface-muted); }
  .voice-modes button { min-height:var(--height-control-lg); border:0; border-radius:var(--radius-sm); background:transparent; color:var(--muted-foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; transition:background-color 140ms ease, color 140ms ease, box-shadow 140ms ease; }
  .voice-modes button:hover:not(:disabled) { color:var(--foreground); background:var(--surface-elevated); }
  .voice-modes button.active { color:var(--primary-foreground); background:var(--primary); box-shadow:var(--shadow-object); }
  .voice-modes button:disabled { opacity:.4; cursor:not-allowed; }
  .reference-grid { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:end; gap:var(--space-4); }
  .secondary.upload { white-space:nowrap; flex-shrink:0; }
  .sample-editor { display:flex; flex-direction:column; gap:var(--space-5); padding:var(--space-6); border:1px solid var(--primary-border); border-radius:var(--radius-md); background:var(--surface-muted); }
  .sample-file { display:flex; min-width:0; align-items:baseline; justify-content:space-between; gap:var(--space-5); }
  .sample-file strong { overflow:hidden; color:var(--foreground); font-size:var(--text-xs); text-overflow:ellipsis; white-space:nowrap; }
  .sample-file span, .sample-editor p { margin:0; color:var(--muted-foreground); font:var(--text-2xs)/var(--leading-ui) var(--font-mono); }
  .trim-notice { display:grid; grid-template-columns:20px minmax(0, 1fr); gap:var(--space-4); padding:var(--space-5); border:1px solid var(--warning); border-radius:var(--radius-sm); background:var(--warning-subtle); }
  .trim-notice svg { width:20px; height:20px; fill:none; stroke:var(--warning); stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .trim-notice span { display:flex; min-width:0; flex-direction:column; gap:var(--space-1); }
  .trim-notice strong { color:var(--foreground); font-size:var(--text-xs); }
  .trim-notice small { color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); }
  .trim-range { display:flex; flex-direction:column; gap:var(--space-2); }
  .trim-range > span { display:flex; justify-content:space-between; color:var(--muted-foreground); font-size:var(--text-2xs); }
  .trim-range > span strong { color:var(--foreground); font-family:var(--font-mono); }
  .trim-range input { width:100%; }
  .time-fields { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4); }
  .time-fields label { display:flex; flex-direction:column; gap:var(--space-3); }
  .time-fields input { width:100%; min-height:var(--height-control); padding:0 var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font:var(--text-xs)/1 var(--font-mono); transition:border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease; }
  .upload-segment { width:100%; }
  .field-stack { display:flex; flex-direction:column; gap:var(--space-3); min-width:0; }
  .secondary, .generate { display:inline-flex; align-items:center; justify-content:center; gap:var(--space-4); min-height:var(--height-control-lg); padding:0 var(--space-8); border-radius:var(--radius-sm); font-size:var(--text-xs); font-weight:var(--weight-semibold); line-height:1; cursor:pointer; transition:border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease; }
  .secondary { border:1px solid var(--border); background:var(--surface-elevated); color:var(--secondary-foreground); }
  .secondary:hover:not(:disabled) { border-color:var(--primary-border); background:var(--primary-subtle); color:var(--primary); }
  .secondary:active:not(:disabled), .generate:active:not(:disabled) { transform:translateY(1px); }
  .secondary svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  .permission { display:grid; grid-template-columns:18px minmax(0, 1fr); gap:var(--space-5); align-items:start; padding-top:var(--space-2); cursor:pointer; }
  .permission input { appearance:none; width:18px; height:18px; margin:0; border:1px solid var(--border-strong); border-radius:var(--radius-xs); background:var(--input); }
  .permission input:checked { border-color:var(--primary); background:var(--primary) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m2 6 2.5 2.5L10 3' fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.8'/%3E%3C/svg%3E") center/12px no-repeat; }
  .permission span { display:flex; flex-direction:column; gap:var(--space-2); }
  .permission strong { font-family:var(--font-sans); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .permission small { color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); font-weight:var(--weight-normal); }
  .action-dock { position:sticky; bottom:0; z-index:2; display:flex; flex-direction:column; gap:var(--space-3); margin:calc(var(--space-3) * -1) calc(var(--space-8) * -1) 0; padding:var(--space-5) var(--space-8) var(--space-4); border-top:1px solid var(--border); background:var(--surface); box-shadow:0 -10px 18px rgb(22 29 36 / 8%); }
  .generate { width:100%; border:1px solid var(--primary); background:var(--primary); color:var(--primary-foreground); }
  .generate:hover:not(:disabled) { background:var(--primary-hover); }
  .generate svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; }
  .action-context { color:var(--muted-foreground); font:var(--text-2xs)/1 var(--font-mono); text-align:center; }
  button:disabled, textarea:disabled, input:disabled { opacity:.5; cursor:not-allowed; }
  .error { margin-top:var(--space-6); padding:var(--space-6); border:1px solid var(--destructive); border-radius:var(--radius-md); background:var(--destructive-subtle); font-size:var(--text-xs); line-height:var(--leading-ui); }
  .result { display:flex; flex-direction:column; gap:var(--space-5); margin-top:var(--space-8); padding:var(--space-6); border:1px solid var(--success); border-radius:var(--radius-md); background:var(--success-subtle); }
  .result-head { display:flex; align-items:center; justify-content:space-between; gap:var(--space-5); color:var(--foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
  .result-state { color:var(--success); font:var(--text-2xs)/1 var(--font-mono); text-transform:uppercase; }
  .result-player { display:grid; grid-template-columns:40px minmax(0, 1fr); align-items:center; gap:var(--space-5); }
  .play { display:grid; width:40px; height:40px; place-items:center; border:1px solid var(--success); border-radius:var(--radius-pill); background:var(--surface-elevated); color:var(--success); cursor:pointer; transition:background-color 140ms ease, color 140ms ease; }
  .play:hover { background:var(--success); color:#fff; }
  .play svg { width:18px; height:18px; fill:currentColor; stroke:none; }
  .result audio { display:none; }
  .result-meta { display:flex; min-width:0; flex-direction:column; gap:var(--space-2); font-size:var(--text-2xs); }
  .result-meta strong { overflow:hidden; color:var(--foreground); text-overflow:ellipsis; white-space:nowrap; }
  .result-meta span { color:var(--muted-foreground); font-family:var(--font-mono); }
  .status { display:flex; align-items:flex-start; gap:var(--space-4); margin-top:var(--space-6); padding:var(--space-6); border:1px solid var(--success); border-radius:var(--radius-sm); background:var(--success-subtle); color:var(--foreground); font-size:var(--text-xs); }
  .status span { width:7px; height:7px; margin-top:3px; flex:0 0 auto; border-radius:var(--radius-pill); background:var(--success); }
  .status.busy { border-color:var(--primary-border); background:var(--primary-subtle); }
  .status.busy span { background:var(--primary); }
  @media (max-width:760px) { .controls { padding:var(--space-6); } .reference-grid, .time-fields, .model-row { grid-template-columns:1fr; } .secondary.upload { width:100%; } .action-dock { margin-inline:calc(var(--space-6) * -1); padding-inline:var(--space-6); } }
  @media (pointer:coarse) { .voice-modes button, .secondary, .generate { min-height:40px; } }
</style>
