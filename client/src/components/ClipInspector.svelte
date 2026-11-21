<script lang="ts">
  import Inspector from './Inspector.svelte'
  import TransformInspector from './TransformInspector.svelte'
  import { useClipInspector } from '../composables/useClipInspector.svelte'
  import { mediaDisplayName } from '../lib/media-bin'

  const inspector = useClipInspector()
</script>

<Inspector
  id="clip-inspector"
  ariaLabel="Clip inspector"
  eyebrow="Inspector"
   title={inspector.selectedClips.length === 1 ? mediaDisplayName(inspector.selectedClips[0].clip.fileName) : `${inspector.selectedClips.length} clips`}
   selectionLabel={inspector.selectedClips.length === 1
     ? `${inspector.selectedClips[0].channel.name} / 1 selected`
     : `${new Set(inspector.selectedClips.map(({ channel }) => channel.id)).size} tracks / ${inspector.selectedClips.length} selected`}
   onClose={inspector.close}
>
  <section class="section timing">
    <div class="section-title"><h3>Timing</h3><span>{inspector.selectedClips.length > 1 ? 'Move selection together' : 'Timeline'}</span></div>
    <label class="field">
      <span class="field-copy"><strong>Position</strong><small>{inspector.selectedClips.length > 1 ? 'Earliest selected clip' : 'Start on timeline'}</small></span>
      <span class="number-wrap">
       <input type="number" min="0" step={(1 / inspector.editor.fps).toFixed(6)} value={inspector.selectionStart.toFixed(2)} onchange={inspector.applyPosition} disabled={inspector.clipsHaveLockedTrack} aria-label="Clip position" />
        <span>s</span>
      </span>
    </label>
    <label class="field">
      <span class="field-copy"><strong>Duration</strong><small>{inspector.commonDuration === null ? 'Mixed values' : 'Visible length'}</small></span>
      <span class="number-wrap">
       <input type="number" min="0.2" step={(1 / inspector.editor.fps).toFixed(6)} value={inspector.commonDuration === null ? '' : inspector.commonDuration.toFixed(2)} placeholder={inspector.commonDuration === null ? 'Mixed' : ''} onchange={inspector.applyDuration} disabled={inspector.clipsHaveLockedTrack} aria-label="Clip duration" />
        <span>s</span>
      </span>
    </label>
    {#if inspector.clipsHaveLockedTrack}<p class="locked-note">Unlock the clip and its linked track to edit timing.</p>{/if}
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

   {#if inspector.canTransform}
    <TransformInspector embedded />
  {/if}

</Inspector>

<style>
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
    flex: 1; min-width: 0; height: 20px; margin: 0;
  }
  .vol-wrap input:disabled { cursor: not-allowed; opacity: .45; }
  .vol-wrap input::-moz-range-thumb { cursor: ew-resize; }
  .vol-value {
    flex: 0 0 7ch; width: 7ch; text-align: right; white-space: nowrap;
    color: var(--foreground); font: var(--text-2xs) var(--font-mono);
  }
</style>
