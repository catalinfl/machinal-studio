<script lang="ts">
  import Inspector from './Inspector.svelte'
  import { useEffectInspector } from '../composables/useEffectInspector.svelte'
  import { mediaDisplayName } from '../lib/media-bin'

  const inspector = useEffectInspector()
</script>

<Inspector
  id="effect-inspector"
  ariaLabel="Effect inspector"
  eyebrow="Inspector"
  title={inspector.showClips
    ? inspector.selectedClips.length === 1
      ? 'Clip'
      : `${inspector.selectedClips.length} clips`
    : inspector.selectedBlocks.length === 1 ? inspector.commonEffect?.label ?? 'Effect' : `${inspector.selectedBlocks.length} effects`}
  selectionLabel={inspector.showClips
    ? inspector.selectedClips.length === 1
      ? `${inspector.selectedClips[0].channel.name} / 1 selected`
      : `${new Set(inspector.selectedClips.map(({ channel }) => channel.id)).size} tracks / ${inspector.selectedClips.length} selected`
    : inspector.selectedBlocks.length === 1
      ? `${inspector.trackLabel} / 1 selected`
      : inspector.commonEffect
        ? `${inspector.commonEffect.label} / ${inspector.trackLabel}`
        : `Multiple effect types / ${inspector.trackLabel}`}
  onClose={inspector.close}
>

  {#if inspector.showClips}
    <section class="section clip-info">
       <div class="section-title"><h3>Clip</h3><span>{inspector.selectedClips.length === 1 ? 'Timeline media' : 'Selection'}</span></div>
      <div class="field">
        <span class="field-copy">
          <strong>Name</strong>
          <small class="ellipsis">{inspector.selectedClips.length === 1 ? mediaDisplayName(inspector.selectedClips[0].clip.fileName) : 'Multiple clips'}</small>
        </span>
      </div>
      <div class="field">
        <span class="field-copy">
          <strong>Track</strong>
          <small>{inspector.selectedClips.length === 1 ? inspector.selectedClips[0].channel.name : `${new Set(inspector.selectedClips.map(({ channel }) => channel.id)).size} tracks`}</small>
        </span>
      </div>
       {#if inspector.selectedClips.length === 1}
        <div class="field">
          <span class="field-copy">
            <strong>Source range</strong>
             <small>{inspector.selectedClips[0].clip.inPoint.toFixed(2)} – {inspector.selectedClips[0].clip.outPoint.toFixed(2)} s</small>
          </span>
        </div>
        <div class="field">
          <span class="field-copy">
            <strong>Timeline duration</strong>
             <small>{inspector.timelineDuration(inspector.selectedClips[0].clip).toFixed(2)} s</small>
          </span>
        </div>
      {/if}
    </section>
    <section class="section speed">
      <div class="section-title">
        <h3>Speed</h3>
       <span>{inspector.selectedClips.length === 1 ? 'Clip playback' : 'Selection'}</span>
      </div>
      <label class="field">
        <span class="field-copy">
          <strong>Playback speed</strong>
           <small>{inspector.commonPlaybackRate === null ? 'Mixed values' : 'Changes timeline duration'}</small>
        </span>
        <span class="number-wrap">
          <input
            type="number"
            min="0.25"
            max="4"
            step="0.05"
             value={inspector.commonPlaybackRate === null ? '' : inspector.commonPlaybackRate.toFixed(2)}
             placeholder={inspector.commonPlaybackRate === null ? 'Mixed' : ''}
             onchange={inspector.applyPlaybackRate}
             disabled={inspector.clipsHaveLockedTrack}
            aria-label="Clip playback speed"
          />
          <span>x</span>
        </span>
      </label>
       {#if inspector.selectedClips.some(({ clip }) => clip.linkedClipId)}
        <p class="linked-note">Linked audio and video use the same speed.</p>
      {/if}
       {#if inspector.clipsHaveLockedTrack}
        <p class="locked-note">Unlock the clip and its linked track to adjust speed.</p>
      {/if}
    </section>

     {#if inspector.selectedAudioClips.length > 0}
      <section class="section audio">
        <div class="section-title">
          <h3>Audio</h3>
           <span>{inspector.selectedAudioClips.length === 1 ? 'Clip level' : `${inspector.selectedAudioClips.length} clips`}</span>
        </div>
        <label class="field vol-field">
          <span class="field-copy">
            <strong>Volume</strong>
             <small>{inspector.commonVolume === null ? 'Mixed values' : 'Playback level'}</small>
          </span>
          <span class="vol-wrap">
            <input
               bind:this={inspector.volSliderEl}
              type="range"
              min="0"
              max="200"
               value={inspector.commonVolume ?? 100}
              aria-label="Clip volume"
               disabled={inspector.clipsHaveLockedTrack}
               onfocus={inspector.beginHistory}
               onblur={inspector.endHistory}
               oninput={inspector.applyVolume}
               onchange={inspector.endHistory}
            />
             <span class="vol-value">{inspector.commonVolume === null ? 'Mixed' : `${inspector.commonVolume.toFixed(2)}%`}</span>
          </span>
        </label>
         {#if inspector.clipsHaveLockedTrack}
          <p class="locked-note">Unlock the track to adjust volume.</p>
        {/if}
      </section>
    {/if}
  {/if}

   {#if inspector.selectedBlocks.length > 0}
    <section class="section timing">
      <div class="section-title">
        <h3>Timing</h3>
         <span>{inspector.selectedBlocks.length > 1 ? 'Selection' : 'Effect range'}</span>
      </div>

      <label class="field">
        <span class="field-copy">
          <strong>Position</strong>
           <small>{inspector.selectedClips.length > 0 ? 'Earliest selected item' : inspector.selectedBlocks.length > 1 ? 'Earliest selected effect' : 'Start on timeline'}</small>
        </span>
        <span class="number-wrap">
           <input type="number" min="0" step={(1 / inspector.editor.fps).toFixed(6)} value={inspector.selectionStart.toFixed(2)} onchange={inspector.applyPosition} disabled={inspector.hasLockedTrack} aria-label="Effect position" />
          <span>s</span>
        </span>
      </label>
      <label class="field">
        <span class="field-copy">
          <strong>Duration</strong>
           <small>{inspector.commonDuration === null ? 'Mixed values' : 'Length of effect'}</small>
        </span>
        <span class="number-wrap">
           <input type="number" min="0.2" step={(1 / inspector.editor.fps).toFixed(6)} value={inspector.commonDuration === null ? '' : inspector.commonDuration.toFixed(2)} placeholder={inspector.commonDuration === null ? 'Mixed' : ''} onchange={inspector.applyDuration} disabled={inspector.hasLockedTrack} aria-label="Effect duration" />
          <span>s</span>
        </span>
      </label>

       {#if inspector.hasLockedTrack}<p class="locked-note">Unlock every affected track to edit timing.</p>{/if}
    </section>
  {/if}

   {#if inspector.selectedBlocks.length > 1}
    <section class="section selected-list">
      <div class="section-title"><h3>Individual timing</h3><span>Edit each effect</span></div>
      <ul>
         {#each inspector.selectedBlocks as block, index (block.id)}
           {@const blockLocked = inspector.channelFor(block.channelId)?.locked ?? true}
          <li>
            <span class="effect-copy">
               <strong>{inspector.effectFor(block.effectId)?.label ?? block.effectId}</strong>
               <small>{inspector.channelFor(block.channelId)?.name ?? 'Unknown track'}</small>
            </span>
            <label class="compact-number">
              <span>Start</span>
               <span class="number-wrap"><input type="number" min="0" step={(1 / inspector.editor.fps).toFixed(6)} value={block.start.toFixed(2)} onchange={inspector.blockPosition(block.id)} disabled={blockLocked} aria-label={`Effect ${index + 1} position`} /><span>s</span></span>
            </label>
            <label class="compact-number">
              <span>Duration</span>
               <span class="number-wrap"><input type="number" min="0.2" step={(1 / inspector.editor.fps).toFixed(6)} value={block.duration.toFixed(2)} onchange={inspector.blockDuration(block.id)} disabled={blockLocked} aria-label={`Effect ${index + 1} duration`} /><span>s</span></span>
            </label>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

   {#if !inspector.showClips && inspector.commonEffect}
    <section class="section effect-settings">
      <div class="section-title settings-title">
        <div>
          <h3>Effect Settings</h3>
           <span>{inspector.commonParameters.length > 0 ? `${inspector.commonParameters.length} adjustable parameters` : 'Fixed operation'}</span>
        </div>
         {#if inspector.commonParameters.length > 0}
          <button
            class="reset"
            type="button"
             disabled={inspector.hasLockedTrack}
             onclick={inspector.resetParameters}
          >Reset</button>
        {/if}
      </div>
       <p class="effect-summary">{inspector.commonEffect.summary}</p>
      <details class="algorithm">
        <summary>How it works</summary>
         <p>{inspector.commonEffect.algorithm}</p>
      </details>

       {#if inspector.commonParameters.length > 0}
         {#each inspector.commonParameters as parameter (parameter.key)}
           {@const commonValue = inspector.parameterValue(parameter)}
          <label class="parameter-field">
            <span class="field-copy">
              <strong>{parameter.label}</strong>
              <small>{commonValue === null ? 'Mixed values' : parameter.description}</small>
            </span>
            <span class="parameter-controls">
              <input
                class="parameter-slider"
                type="range"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={commonValue ?? parameter.defaultValue}
                 disabled={inspector.hasLockedTrack}
                aria-label={`${parameter.label} slider`}
                 onfocus={inspector.beginHistory}
                 onblur={inspector.endHistory}
                 oninput={inspector.applyParameter(parameter)}
                 onchange={inspector.endHistory}
              />
              <span class="parameter-number">
                <input
                  type="number"
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  value={commonValue === null ? '' : commonValue.toFixed(2)}
                  placeholder={commonValue === null ? 'Mixed' : ''}
                   disabled={inspector.hasLockedTrack}
                  aria-label={`${parameter.label} value`}
                   onfocus={inspector.beginHistory}
                   onblur={inspector.endHistory}
                   onchange={inspector.applyParameter(parameter)}
                />
                <span>{parameter.unit ?? ''}</span>
              </span>
            </span>
          </label>
        {/each}
      {:else}
        <p class="fixed-note">This FFmpeg operation has no adjustable parameters.</p>
      {/if}
       {#if inspector.hasLockedTrack}
        <p class="locked-note">Unlock every affected track to edit effect settings.</p>
      {/if}
    </section>
  {/if}

   {#if !inspector.showClips && inspector.commonEffect && inspector.rampableEffect}
    <section class="section ramp-settings">
      <div class="section-title">
        <h3>Intensity Ramp</h3>
         <span>{inspector.commonRamp.mixed ? 'Mixed values' : 'Easing over time'}</span>
      </div>
      <p class="algorithm">Control how quickly the effect reaches full strength and, optionally, fades away again.</p>

      <div class="ramp-label">Mode</div>
      <div class="ramp-options mode-options" role="group" aria-label="Intensity ramp mode">
         {#each inspector.RAMP_MODE_OPTIONS as option (option.value)}
          <button
            type="button"
             class:active={!inspector.commonRamp.mixed && (option.value === 'constant'
               ? inspector.commonRamp.value === null
               : inspector.commonRamp.value?.mode === option.value)}
             disabled={inspector.hasLockedTrack}
             onclick={inspector.rampMode(option.value)}
          >{option.label}</button>
        {/each}
      </div>

       {#if inspector.commonRamp.value && !inspector.commonRamp.mixed}
        <div class="ramp-label">Curve</div>
        <div class="ramp-options curve-options" role="group" aria-label="Intensity ramp curve">
         {#each inspector.RAMP_CURVE_OPTIONS as option (option.value)}
            <button
              type="button"
               class:active={inspector.commonRamp.value.curve === option.value}
               disabled={inspector.hasLockedTrack}
               onclick={inspector.rampCurve(option.value)}
            >{option.label}</button>
          {/each}
        </div>

        <label class="parameter-field ramp-amount">
          <span class="field-copy">
            <strong>Ramp length</strong>
             <small>{inspector.commonRamp.value.mode === 'in-out' ? 'Per side of the effect block' : 'Portion of the effect block'}</small>
          </span>
          <span class="ramp-slider-row">
            <input
              type="range"
              min="5"
               max={inspector.commonRamp.value.mode === 'in-out' ? 50 : 100}
              step="1"
               value={Math.round(inspector.commonRamp.value.amount * 100)}
               disabled={inspector.hasLockedTrack}
              aria-label="Intensity ramp length"
               onfocus={inspector.beginHistory}
               onblur={inspector.endHistory}
               oninput={inspector.applyRampAmount}
               onchange={inspector.endHistory}
            />
             <span>{Math.round(inspector.commonRamp.value.amount * 100)}%</span>
          </span>
        </label>
       {:else if inspector.commonRamp.mixed}
        <p class="fixed-note">Choose a mode to apply the same ramp to every selected effect.</p>
      {/if}
       {#if inspector.hasLockedTrack}
        <p class="locked-note">Unlock every affected track to edit the intensity ramp.</p>
      {/if}
    </section>
  {/if}

</Inspector>

<style>
  .settings-title { align-items: center; }
  .settings-title > div { display: flex; flex-direction: column; gap: var(--space-1); }
  .reset {
    min-height: var(--height-control-sm); padding: 0 var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--secondary-foreground); background: var(--secondary); font-size: var(--text-2xs); cursor: pointer;
  }
  .reset:hover:not(:disabled) { color: var(--foreground); border-color: var(--border-strong); background: var(--surface-muted); }
  .reset:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .reset:disabled { opacity: .4; cursor: not-allowed; }
  .effect-summary {
    margin: calc(-1 * var(--space-1)) 0 var(--space-4); color: var(--foreground); font-size: var(--text-xs); line-height: var(--leading-ui);
  }
  .algorithm {
    margin: 0 0 var(--space-6); color: var(--muted-foreground); font-size: var(--text-2xs); line-height: var(--leading-ui);
  }
  .algorithm summary { width: fit-content; cursor: pointer; font-weight: var(--weight-medium); }
  .algorithm summary:hover { color: var(--foreground); }
  .algorithm summary:focus-visible { border-radius: var(--radius-xs); outline: 2px solid var(--ring); outline-offset: 2px; }
  .algorithm p { margin: var(--space-3) 0 0; }
  .fixed-note {
    margin: 0; padding: var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--muted-foreground); background: var(--surface-elevated); font-size: var(--text-2xs); line-height: var(--leading-ui);
  }
  .parameter-field {
    display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5) 0;
    border-top: 1px solid var(--border);
  }
  .parameter-field:last-of-type { border-bottom: 1px solid var(--border); }
  .parameter-field .field-copy small { max-width: 100%; white-space: normal; line-height: var(--leading-ui); }
  .parameter-controls { display: grid; grid-template-columns: minmax(0, 1fr) 86px; align-items: center; gap: var(--space-5); }
  .parameter-slider { width: 100%; min-width: 0; height: 20px; margin: 0; }
  .parameter-slider:disabled { opacity: .4; cursor: not-allowed; }
  .parameter-number {
    height: var(--height-control-sm); display: grid; grid-template-columns: minmax(0, 1fr) 25px; align-items: center;
    border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--input);
  }
  .parameter-number:focus-within { border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent); }
  .parameter-number input {
    width: 100%; height: 100%; min-width: 0; padding: 0 var(--space-4); box-sizing: border-box;
    border: 0; outline: 0; color: var(--foreground); background: transparent;
    font: var(--text-2xs) var(--font-mono); text-align: right;
  }
  .parameter-number input::placeholder { color: var(--muted-foreground); font-style: italic; }
  .parameter-number > span { overflow: hidden; color: var(--muted-foreground); font-size: var(--text-2xs); white-space: nowrap; }
  .ramp-label {
    margin: var(--space-6) 0 var(--space-3); color: var(--muted-foreground); font-size: var(--text-2xs); font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label); text-transform: uppercase;
  }
  .ramp-options { display: grid; gap: var(--space-2); }
  .mode-options { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .curve-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ramp-options button {
    min-width: 0; min-height: var(--height-control-sm); padding: var(--space-2) var(--space-1);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--secondary-foreground); background: var(--secondary); cursor: pointer; font-size: var(--text-2xs);
  }
  .ramp-options button:hover:not(:disabled) { color: var(--foreground); border-color: var(--border-strong); background: var(--surface-muted); }
  .ramp-options button.active {
    color: var(--primary); border-color: var(--primary); background: var(--primary-subtle);
  }
  .ramp-options button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .ramp-options button:disabled { opacity: .4; cursor: not-allowed; }
  .ramp-amount { margin-top: var(--space-6); border-bottom: 1px solid var(--border); }
  .ramp-slider-row { display: flex; align-items: center; gap: var(--space-5); }
  .ramp-slider-row input { flex: 1; min-width: 0; height: 20px; }
  .ramp-slider-row span {
    min-width: 34px; color: var(--foreground);
    font: var(--text-2xs) var(--font-mono); text-align: right;
  }
  .number-wrap {
    width: 116px; height: var(--height-control-sm); flex: 0 0 auto;
    display: grid; grid-template-columns: 1fr 20px; align-items: center;
    border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden;
    background: var(--input);
  }
  .number-wrap:focus-within { border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent); }
  .number-wrap input {
    width: 100%; height: 100%; min-width: 0; padding: 0 var(--space-5);
    box-sizing: border-box; border: 0; outline: 0;
    color: var(--foreground); background: transparent;
    font: var(--text-2xs) var(--font-mono);
    text-align: right;
  }
  .number-wrap input::placeholder { color: var(--muted-foreground); font-style: italic; }
  .number-wrap input:disabled { color: var(--muted-foreground); cursor: not-allowed; }
  .number-wrap > span { color: var(--muted-foreground); font-size: var(--text-2xs); }
  .locked-note {
    margin: var(--space-5) 0 0; padding: var(--space-4) var(--space-5);
    color: var(--warning); background: var(--warning-subtle); border: 1px solid var(--warning); border-radius: var(--radius-sm);
    font-size: var(--text-2xs); line-height: var(--leading-ui);
  }
  .linked-note { margin: var(--space-4) 0 0; color: var(--muted-foreground); font-size: var(--text-2xs); line-height: var(--leading-ui); }
  .ellipsis {
    max-width: 170px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  .vol-field { align-items: stretch; flex-direction: column; gap: var(--space-4); padding: var(--space-6) 0; }
  .vol-wrap {
    display: flex; align-items: center; gap: var(--space-5);
    width: 100%; height: var(--height-control-sm);
    padding: 0 var(--space-5); box-sizing: border-box;
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--input);
  }
  .vol-wrap:focus-within { border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent); }
  .vol-wrap input {
    flex: 1; min-width: 0; height: 14px; margin: 0;
    accent-color: var(--primary);
    cursor: ew-resize;
  }
  .vol-wrap input:disabled { cursor: not-allowed; opacity: .45; }
  .vol-wrap input::-moz-range-thumb { cursor: ew-resize; }
  .vol-value {
    flex: 0 0 7ch; width: 7ch; text-align: right; white-space: nowrap;
    color: var(--foreground); font: var(--text-2xs) var(--font-mono);
  }
  .selected-list ul { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .selected-list li {
    padding: var(--space-4);
    display: grid; grid-template-columns: minmax(0, 1fr) 92px 92px; align-items: end; gap: var(--space-4);
    border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-elevated);
  }
  .effect-copy { min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .effect-copy strong { overflow: hidden; color: var(--foreground); font-size: var(--text-2xs); font-weight: var(--weight-medium); white-space: nowrap; text-overflow: ellipsis; }
  .effect-copy small { color: var(--muted-foreground); font-size: var(--text-2xs); }
  .compact-number { min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); color: var(--muted-foreground); font-size: var(--text-2xs); }
  .compact-number .number-wrap { width: 100%; grid-template-columns: minmax(0, 1fr) 16px; }
  .compact-number .number-wrap input { padding: 0 var(--space-3); }
</style>
