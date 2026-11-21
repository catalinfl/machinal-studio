<script lang="ts">
  import Inspector from './Inspector.svelte'
  import UiSelect from './UiSelect.svelte'
  import { useTransformInspector } from '../composables/useTransformInspector.svelte'
  import { mediaDisplayName } from '../lib/media-bin'

  let { onCloseTransform, embedded = false }: { onCloseTransform?: () => void; embedded?: boolean } = $props()
  const transform = useTransformInspector({ getOnClose: () => onCloseTransform })
</script>

{#snippet transformContent()}
  {#if transform.clip}
    <details class="advanced-settings" bind:open={transform.advancedOpen}><summary>Advanced · compositing &amp; motion</summary>
    <section class="section compositing">
      <div class="section-title">
        <h3>Layer compositing</h3>
        <span>Image over image</span>
      </div>
      <p class="description">Blend this clip over lower video tracks. The fades wrap the final image after its effects.</p>
      <div class="entrance-heading"><strong>Appearance</strong><small>How the layer enters</small></div>
      <div class="entrance-grid" role="group" aria-label="Layer appearance effect">
        {#each transform.entranceEffects as effect (effect.value)}
           <button type="button" class:active={transform.selectedEntrance === effect.value} aria-pressed={transform.selectedEntrance === effect.value} onclick={transform.entranceEffect(effect.value)} disabled={transform.locked} aria-label={`Layer appearance ${effect.label}`}>
            <span class="entrance-preview preview-{effect.value}" aria-hidden="true"><i></i></span>
            <span><strong>{effect.label}</strong><small>{effect.hint}</small></span>
          </button>
        {/each}
      </div>
      <div class="entrance-heading"><strong>Disappearance</strong><small>How the layer exits</small></div>
      <div class="entrance-grid" role="group" aria-label="Layer disappearance effect">
        {#each transform.exitEffects as effect (effect.value)}
           <button type="button" class:active={transform.selectedExit === effect.value} aria-pressed={transform.selectedExit === effect.value} onclick={transform.exitEffect(effect.value)} disabled={transform.locked} aria-label={`Layer disappearance ${effect.label}`}>
            <span class="entrance-preview preview-{effect.value}" aria-hidden="true"><i></i></span>
            <span><strong>{effect.label}</strong><small>{effect.hint}</small></span>
          </button>
        {/each}
      </div>
      <label class="layer-field opacity-field">
        <span class="field-copy"><strong>Opacity</strong><small>Layer visibility</small></span>
        <span class="opacity-control">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
             value={transform.layerOpacity}
             disabled={transform.locked}
            aria-label="Clip layer opacity"
             onfocus={transform.beginHistory}
             oninput={transform.updateCompositingFor('opacity')}
             onblur={transform.endHistory}
          />
           <output>{Math.round(transform.layerOpacity * 100)}%</output>
        </span>
      </label>
      <div class="fade-fields">
        <label class="layer-field">
          <span class="field-copy"><strong>Fade in</strong><small>Bring layer in</small></span>
           <span class="number-wrap"><input type="number" min="0" max={transform.duration} step={(1 / transform.editor.fps).toFixed(6)} value={transform.fadeIn.toFixed(2)} onchange={transform.updateCompositingFor('fadeIn')} disabled={transform.locked} aria-label="Clip fade in" /><span>s</span></span>
        </label>
        <label class="layer-field">
          <span class="field-copy"><strong>Fade out</strong><small>Return to lower layer</small></span>
           <span class="number-wrap"><input type="number" min="0" max={transform.duration} step={(1 / transform.editor.fps).toFixed(6)} value={transform.fadeOut.toFixed(2)} onchange={transform.updateCompositingFor('fadeOut')} disabled={transform.locked} aria-label="Clip fade out" /><span>s</span></span>
        </label>
      </div>
       {#if transform.locked}<p class="locked-note">Unlock the video track to edit layer compositing.</p>{/if}
    </section>

    <section class="section animation">
      <div class="section-title">
        <h3>Motion presets</h3>
         <span>{transform.keyframes.length > 0 ? `${transform.keyframes.length} keyframes` : 'Static clip'}</span>
      </div>
      <p class="description">TikTok-style camera moves are created with animated zoom and position keyframes.</p>
      <label class="select-wrap">
        <span>Preset</span>
        <UiSelect
          label="Transform motion preset"
          value={transform.selectedPreset}
          options={[
            ...(transform.selectedPreset === 'custom' ? [{ value: 'custom', label: 'Custom - Edited animation' }] : []),
            ...transform.TRANSFORM_PRESETS.map((preset) => ({ value: preset.value, label: `${preset.label} - ${preset.hint}` })),
          ]}
          disabled={transform.locked}
          onChange={transform.applyPreset}
        />
      </label>
      <div class="keyframe-bar">
        <div>
          <strong>Playhead</strong>
           <small>{transform.formatTime(transform.relativeTime)} / {transform.formatTime(transform.duration)}</small>
        </div>
         <button type="button" class="keyframe-button" onclick={transform.addKeyframe} disabled={transform.locked} aria-label="Add transform keyframe">
            <svg class="keyframe-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 2 6 6-6 6-6-6z" /></svg> {transform.activeKeyframeTime === null ? 'Add keyframe' : 'Update keyframe'}
        </button>
      </div>
       {#if transform.keyframes.length > 0}
        <div class="edit-scope">
          <span>
            <strong>Edit one keyframe</strong>
             <small>{transform.editOneKeyframe ? 'Changes the value at the playhead only' : 'Changes the value on every keyframe'}</small>
          </span>
          <button
            type="button"
            class="scope-toggle"
             class:active={transform.editOneKeyframe}
            aria-label="Edit one keyframe"
             aria-pressed={transform.editOneKeyframe}
             onclick={transform.toggleEditScope}
             disabled={transform.locked}
           >{transform.editOneKeyframe ? 'On' : 'Off'}</button>
        </div>
        <div class="keyframe-list" aria-label="Transform keyframes">
           {#each transform.keyframes as keyframe (keyframe.time)}
             <button type="button" class:current={transform.activeKeyframeTime === keyframe.time} onclick={transform.selectKeyframeFor(keyframe.time)}>
                <span>{transform.formatTime(keyframe.time)}</span>
               <span class="keyframe-summary">{keyframe.transform.zoomX.toFixed(2)}x / {keyframe.transform.positionX.toFixed(0)}%</span>
               <span class="remove-keyframe" role="button" tabindex="0" aria-label={`Remove keyframe at ${transform.formatTime(keyframe.time)}`} onclick={transform.removeKeyframeFor(keyframe.time)} onkeydown={transform.removeKeyframeWithKeyboard(keyframe.time)}>x</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    </details>
     <section class="section">
        <div class="section-title"><h3>Zoom</h3><span>{transform.keyframes.length === 0 ? 'Static value' : transform.editOneKeyframe ? 'Playhead keyframe' : 'All keyframes'}</span></div>
      <label class="field">
        <span class="field-copy"><strong>Zoom X</strong><small>Horizontal scale</small></span>
         <span class="control"><input type="range" min="0.25" max="4" step="0.01" value={transform.currentTransform.zoomX} oninput={transform.updateNumberFor('zoomX')} disabled={transform.locked} aria-label="Zoom X slider" /><input type="number" min="0.01" max="40" step="0.01" value={transform.currentTransform.zoomX.toFixed(2)} onchange={transform.updateNumberFor('zoomX')} disabled={transform.locked} aria-label="Zoom X" /><span>x</span></span>
      </label>
      <label class="field">
        <span class="field-copy"><strong>Zoom Y</strong><small>Vertical scale</small></span>
         <span class="control"><input type="range" min="0.25" max="4" step="0.01" value={transform.currentTransform.zoomY} oninput={transform.updateNumberFor('zoomY')} disabled={transform.locked || transform.currentTransform.linkZoom} aria-label="Zoom Y slider" /><input type="number" min="0.01" max="40" step="0.01" value={transform.currentTransform.zoomY.toFixed(2)} onchange={transform.updateNumberFor('zoomY')} disabled={transform.locked || transform.currentTransform.linkZoom} aria-label="Zoom Y" /><span>x</span></span>
      </label>
       <label class="check"><input type="checkbox" checked={transform.currentTransform.linkZoom} onchange={transform.updateBooleanFor('linkZoom')} disabled={transform.locked} /> <span>Link zoom X and Y</span></label>
    </section>

    <section class="section">
      <div class="section-title"><h3>Position</h3><span>Screen percent</span></div>
       <label class="field"><span class="field-copy"><strong>Position X</strong><small>Left / right</small></span><span class="number-wrap"><input type="number" min="-100" max="100" step="1" value={transform.currentTransform.positionX.toFixed(1)} onchange={transform.updateNumberFor('positionX')} disabled={transform.locked} aria-label="Position X" /><span>%</span></span></label>
       <label class="field"><span class="field-copy"><strong>Position Y</strong><small>Up / down</small></span><span class="number-wrap"><input type="number" min="-100" max="100" step="1" value={transform.currentTransform.positionY.toFixed(1)} onchange={transform.updateNumberFor('positionY')} disabled={transform.locked} aria-label="Position Y" /><span>%</span></span></label>
       <div class="position-pad" aria-hidden="true"><span style={`left: ${Math.max(3, Math.min(97, 50 + transform.currentTransform.positionX / 2))}%; top: ${Math.max(3, Math.min(97, 50 + transform.currentTransform.positionY / 2))}%`}></span></div>
    </section>

    <section class="section grid-section">
      <div class="section-title"><h3>Rotation and anchor</h3><span>Fine control</span></div>
       <label class="field"><span class="field-copy"><strong>Rotation</strong><small>In-plane angle</small></span><span class="number-wrap"><input type="number" min="-180" max="180" step="0.5" value={transform.currentTransform.rotation.toFixed(1)} onchange={transform.updateNumberFor('rotation')} disabled={transform.locked} aria-label="Rotation" /><span>deg</span></span></label>
       <label class="field"><span class="field-copy"><strong>Anchor X</strong><small>Pivot, 0 to 1</small></span><span class="number-wrap"><input type="number" min="0" max="1" step="0.01" value={transform.currentTransform.anchorX.toFixed(2)} onchange={transform.updateNumberFor('anchorX')} disabled={transform.locked} aria-label="Anchor X" /><span></span></span></label>
       <label class="field"><span class="field-copy"><strong>Anchor Y</strong><small>Pivot, 0 to 1</small></span><span class="number-wrap"><input type="number" min="0" max="1" step="0.01" value={transform.currentTransform.anchorY.toFixed(2)} onchange={transform.updateNumberFor('anchorY')} disabled={transform.locked} aria-label="Anchor Y" /><span></span></span></label>
    </section>

    <section class="section">
      <div class="section-title"><h3>3D tilt</h3><span>Perspective-style skew</span></div>
       <label class="field"><span class="field-copy"><strong>Pitch</strong><small>Horizontal axis</small></span><span class="number-wrap"><input type="number" min="-90" max="90" step="1" value={transform.currentTransform.pitch.toFixed(1)} onchange={transform.updateNumberFor('pitch')} disabled={transform.locked} aria-label="Pitch" /><span>deg</span></span></label>
       <label class="field"><span class="field-copy"><strong>Yaw</strong><small>Vertical axis</small></span><span class="number-wrap"><input type="number" min="-90" max="90" step="1" value={transform.currentTransform.yaw.toFixed(1)} onchange={transform.updateNumberFor('yaw')} disabled={transform.locked} aria-label="Yaw" /><span>deg</span></span></label>
      <div class="flip-row">
          <label class="check"><input type="checkbox" checked={transform.currentTransform.flipH} onchange={transform.updateBooleanFor('flipH')} disabled={transform.locked} /> <span>Flip horizontal</span></label>
          <label class="check"><input type="checkbox" checked={transform.currentTransform.flipV} onchange={transform.updateBooleanFor('flipV')} disabled={transform.locked} /> <span>Flip vertical</span></label>
      </div>
    </section>

    <section class="section footer-actions">
       <button class="reset" type="button" onclick={transform.reset} disabled={transform.locked}>Reset transform</button>
       {#if transform.locked}<p class="locked-note">Unlock the video track to edit its transform.</p>{/if}
    </section>
  {:else}
    <div class="empty"><div class="empty-icon">+</div><strong>Select a video clip</strong><span>Transform controls apply to one video at a time.</span></div>
  {/if}
{/snippet}

  {#if embedded}
    {@render transformContent()}
  {:else}
    <Inspector
      id="transform-inspector"
      ariaLabel="Transform inspector"
      eyebrow="Inspector"
      title={transform.clip ? 'Transform' : 'Select a video'}
      selectionLabel={transform.clip ? mediaDisplayName(transform.clip.fileName) : 'Select a video clip on the timeline'}
      onClose={transform.closeInspector}
    >
      {@render transformContent()}
    </Inspector>
{/if}

<style>
  .keyframe-icon { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.5; }
  .description { margin: calc(-1 * var(--space-1)) 0 var(--space-6); color: var(--muted-foreground); font-size: var(--text-2xs); line-height: var(--leading-ui); }
  .entrance-heading { display:flex; align-items:baseline; justify-content:space-between; gap:var(--space-4); margin-bottom:var(--space-4); }
  .entrance-heading strong { color:var(--foreground); font-size:var(--text-2xs); font-weight:var(--weight-medium); }
  .entrance-heading small { color:var(--muted-foreground); font-size:var(--text-2xs); }
  .entrance-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:var(--space-2); margin-bottom:var(--space-6); }
  .entrance-grid button { display:grid; grid-template-columns:34px minmax(0, 1fr); align-items:center; gap:var(--space-3); min-height:46px; padding:var(--space-3); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--secondary-foreground); background:var(--surface-elevated); text-align:left; cursor:pointer; }
  .entrance-grid button:hover:not(:disabled) { border-color:var(--border-strong); background:var(--surface-muted); }
  .entrance-grid button.active { border-color:var(--primary); color:var(--primary); background:var(--primary-subtle); box-shadow:inset 0 0 0 1px var(--primary); }
  .entrance-grid button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .entrance-grid button:disabled { cursor:not-allowed; opacity:.45; }
  .entrance-grid button > span:last-child { min-width:0; display:flex; flex-direction:column; gap:2px; }
  .entrance-grid strong { overflow:hidden; font-size:var(--text-2xs); font-weight:var(--weight-medium); text-overflow:ellipsis; white-space:nowrap; }
  .entrance-grid small { overflow:hidden; color:var(--muted-foreground); font-size:9px; text-overflow:ellipsis; white-space:nowrap; }
  .entrance-preview { position:relative; width:34px; height:25px; overflow:hidden; border:1px solid var(--border-strong); border-radius:var(--radius-xs); background:var(--surface); }
  .entrance-preview::before { content:''; position:absolute; inset:4px; border:1px solid var(--grid-line); }
  .entrance-preview i { position:absolute; inset:7px 6px; display:block; background:var(--primary); opacity:.82; }
  .preview-none i { opacity:1; }
  .preview-fade i { opacity:.45; }
  .preview-focus i { inset:5px 4px; opacity:.5; transform:scale(1.08); }
  .preview-lift i { transform:translateY(4px); }
  .preview-zoom-out i { inset:5px 4px; opacity:.5; transform:scale(0.92); }
  .preview-sink i { transform:translateY(4px); }
  .preview-drift-left i { transform:translateX(-5px); }
  .preview-drift-right i { transform:translateX(5px); }
  .layer-field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); min-height: 42px; border-top: 1px solid var(--border); }
  .fade-fields { border-bottom: 1px solid var(--border); }
  .fade-fields .layer-field:first-child { border-bottom: 1px solid var(--border); }
  .opacity-field { align-items: stretch; flex-direction: column; gap: var(--space-3); padding: var(--space-5) 0; }
  .opacity-control { height: var(--height-control-sm); display: flex; align-items: center; gap: var(--space-5); padding: 0 var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--input); }
  .opacity-control input { flex: 1; min-width: 0; height: 20px; margin: 0; }
  .opacity-control output { flex: 0 0 4ch; color: var(--foreground); font: var(--text-2xs) var(--font-mono); text-align: right; }
  .select-wrap { display: flex; flex-direction: column; gap: var(--space-3); color: var(--muted-foreground); font-size: var(--text-2xs); }
  .select-wrap :global(.ui-select-trigger) { height:var(--height-control-sm); font-size:var(--text-2xs); }
  .keyframe-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-6); padding-top: var(--space-5); border-top: 1px solid var(--border); }
  .keyframe-bar div { display: flex; flex-direction: column; gap: var(--space-1); }
  .keyframe-bar strong { color: var(--foreground); font-size: var(--text-2xs); font-weight: var(--weight-medium); }
  .keyframe-bar small { color: var(--muted-foreground); font: var(--text-2xs) var(--font-mono); }
  .keyframe-button { min-height: var(--height-control-sm); padding: var(--space-2) var(--space-4); border: 1px solid var(--primary); border-radius: var(--radius-sm); color: var(--primary); background: var(--primary-subtle); cursor: pointer; font-size: var(--text-2xs); }
  .keyframe-button:hover:not(:disabled) { color: var(--primary-foreground); border-color: var(--primary-hover); background: var(--primary-hover); }
  .keyframe-button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .keyframe-button:disabled, .reset:disabled { opacity: .4; cursor: not-allowed; }
  .edit-scope { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); margin-top: var(--space-5); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-elevated); }
  .edit-scope > span { min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .edit-scope strong { color: var(--foreground); font-size: var(--text-2xs); font-weight: var(--weight-medium); }
  .edit-scope small { color: var(--muted-foreground); font-size: 9px; line-height: var(--leading-ui); }
  .scope-toggle { min-width: 42px; min-height: var(--height-control-sm); padding: 0 var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--secondary-foreground); background: var(--secondary); font-size: var(--text-2xs); cursor: pointer; }
  .scope-toggle:hover:not(:disabled) { border-color: var(--border-strong); background: var(--surface-muted); }
  .scope-toggle.active { border-color: var(--primary); color: var(--primary); background: var(--primary-subtle); }
  .scope-toggle:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .scope-toggle:disabled { opacity: .4; cursor: not-allowed; }
  .keyframe-list { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-5); }
  .keyframe-list > button { display: grid; grid-template-columns: 1fr auto 18px; align-items: center; gap: var(--space-3); min-height: var(--height-control-sm); padding: var(--space-2) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--foreground); background: var(--surface-elevated); cursor: pointer; font-size: var(--text-2xs); text-align: left; }
  .keyframe-list > button:hover { border-color: var(--border-strong); background: var(--surface-muted); }
  .keyframe-list > button.current { color: var(--primary); border-color: var(--primary); background: var(--primary-subtle); }
  .keyframe-list > button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .keyframe-summary { color: var(--muted-foreground); font: var(--text-2xs) var(--font-mono); }
  .remove-keyframe { color: var(--muted-foreground); font-size: var(--text-2xs); text-align: center; }
  .remove-keyframe:hover { color: var(--destructive); }
  .control { display: grid; grid-template-columns: minmax(45px, 1fr) 65px 12px; align-items: center; gap: var(--space-3); width: 166px; flex: 0 0 auto; }
  .control > input[type="range"] { width: 100%; min-width: 0; height: 20px; }
  .control > input[type="number"], .number-wrap { height: var(--height-control-sm); box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--input); }
  .control > input[type="number"] { width: 65px; padding: 0 var(--space-4); outline: 0; color: var(--foreground); font: var(--text-2xs) var(--font-mono); text-align: right; }
  .control > input[type="number"]:focus, .number-wrap:focus-within { border-color: var(--ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 22%, transparent); }
  .control > span { color: var(--muted-foreground); font-size: var(--text-2xs); }
  .number-wrap { width: 116px; display: grid; grid-template-columns: 1fr 25px; align-items: center; flex: 0 0 auto; }
  .number-wrap input { width: 100%; height: 100%; min-width: 0; padding: 0 var(--space-5); box-sizing: border-box; border: 0; outline: 0; color: var(--foreground); background: transparent; font: var(--text-2xs) var(--font-mono); text-align: right; }
  .number-wrap > span { color: var(--muted-foreground); font-size: var(--text-2xs); }
  input:disabled { opacity: .4; cursor: not-allowed; }
  .check { display: inline-flex; align-items: center; gap: var(--space-4); margin-top: var(--space-6); color: var(--secondary-foreground); font-size: var(--text-2xs); cursor: pointer; }
  .check input {
    appearance: none; position: relative; flex: 0 0 auto; width: 34px; height: 20px; margin: 0;
    border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: var(--surface-muted);
    cursor: pointer; transition: background-color 140ms ease, border-color 140ms ease;
  }
  .check input::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px;
    border-radius: 50%; background: var(--muted-foreground); box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
    transition: transform 140ms cubic-bezier(.2,.8,.2,1), background-color 140ms ease;
  }
  .check input:checked { border-color: var(--primary); background: var(--primary); }
  .check input:checked::after { transform: translateX(14px); background: var(--primary-foreground); }
  .check input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .check input:disabled { opacity: .45; cursor: not-allowed; }
  .position-pad { position: relative; height: 48px; margin-top: var(--space-6); overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-elevated); }
  .position-pad::before, .position-pad::after { content: ''; position: absolute; background: var(--grid-line); }
  .position-pad::before { inset: 0 auto 0 50%; width: 1px; }
  .position-pad::after { inset: 50% 0 auto; height: 1px; }
  .position-pad span { position: absolute; width: 7px; height: 7px; box-sizing: border-box; border: 2px solid var(--primary); border-radius: var(--radius-pill); background: var(--surface-elevated); transform: translate(-50%, -50%); }
  .flip-row { display: flex; gap: var(--space-6); flex-wrap: wrap; }
  .reset { min-height: var(--height-control-sm); padding: var(--space-2) var(--space-5); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--secondary-foreground); background: var(--secondary); cursor: pointer; font-size: var(--text-2xs); }
  .reset:hover:not(:disabled) { color: var(--foreground); border-color: var(--border-strong); background: var(--surface-muted); }
  .reset:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .locked-note { margin: var(--space-5) 0 0; padding: var(--space-4) var(--space-5); color: var(--warning); background: var(--warning-subtle); border: 1px solid var(--warning); border-radius: var(--radius-sm); font-size: var(--text-2xs); line-height: var(--leading-ui); }
  .empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); padding: var(--space-32) var(--space-12); color: var(--muted-foreground); text-align: center; }
  .empty strong { color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-medium); }
  .empty span { font-size: var(--text-2xs); line-height: var(--leading-ui); }
  .empty-icon { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); color: var(--muted-foreground); font-size: var(--text-lg); }
</style>
