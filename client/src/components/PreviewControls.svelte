<script lang="ts">
  import { usePreviewControls } from '../composables/usePreviewControls.svelte'
  import type { VideoFit } from '../lib/video-fit'

  let {
    playing,
    muted,
    volume,
    aspect,
    fit,
    onFitChange,
    onTogglePlay,
    onToggleMute,
    onVolumeInput,
    onToggleAspect,
  }: {
    playing: boolean
    muted: boolean
    volume: number
    aspect: string
    fit: VideoFit
    onFitChange: (fit: VideoFit) => void
    onTogglePlay: () => void
    onToggleMute: () => void
    onVolumeInput: (volume: number) => void
    onToggleAspect: () => void
  } = $props()

  const controls = usePreviewControls({ getOnVolumeInput: () => onVolumeInput })
</script>

<div class="controls-live">
  <div class="transport-cluster">
    <button class="cbtn control-key" onclick={onTogglePlay} aria-label={playing ? 'Pause preview' : 'Play preview'}>{#if playing}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 5v10M13.5 5v10" /></svg>{:else}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5z" /></svg>{/if}</button>
    <button class="cbtn control-key" onclick={onToggleMute} aria-label={muted ? 'Unmute preview' : 'Mute preview'}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4z" />{#if muted}<path d="m14 8 3 4M17 8l-3 4" />{:else}<path d="M14 7.5c1.5 1.4 1.5 3.6 0 5" />{/if}</svg></button>
  </div>
  <label class="level-strip">
    <span class="level-label">Output</span>
    <input type="range" min="0" max="100" value={volume} oninput={controls.onVolumeEvent} aria-label="Preview volume" />
    <span class="measure">{volume}%</span>
  </label>
  <button class="cbtn aspect-key" onclick={onToggleAspect} title="Toggle preview orientation" aria-label="Toggle horizontal or vertical preview">
    <span class="aspect-label">Frame</span>
    <span class="aspect-value">{aspect}</span>
  </button>
  <select
    class="fit-select"
    aria-label="Video framing"
    title={fit === 'cover' ? 'Fill the frame by cropping the sides or top and bottom. Applies to preview and export.' : 'Show the entire image, with bars when needed. Applies to preview and export.'}
    value={fit}
    onchange={(event) => onFitChange(event.currentTarget.value as VideoFit)}
  >
    <option value="contain">Fit</option>
    <option value="cover">Fill (crop)</option>
  </select>
</div>

<style>
  .controls-live {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    min-height: 52px;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-5) var(--space-8);
    border-top: 1px solid var(--border-strong);
    background: var(--surface-elevated);
  }
  .transport-cluster {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .control-key {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--secondary-foreground);
    background: transparent;
    cursor: pointer;
  }
  .control-key:first-child {
    border-color: var(--primary);
    color: var(--primary-foreground);
    background: var(--primary);
    box-shadow: inset 0 -1px rgb(0 0 0 / 18%);
  }
  .control-key:hover {
    border-color: var(--border);
    background: var(--surface-muted);
  }
  .control-key:first-child:hover {
    border-color: var(--primary-hover);
    background: var(--primary-hover);
  }
  .control-key:focus-visible, .aspect-key:focus-visible, .fit-select:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .control-key svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .level-strip {
    display: grid;
    grid-template-columns: auto minmax(72px, 160px) 40px;
    min-width: 0;
    align-items: center;
    justify-content: start;
    gap: var(--space-6);
  }
  .level-label,
  .aspect-label {
    color: var(--muted-foreground);
    font-size: 0.625rem;
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .level-strip input {
    width: 100%;
    min-width: 0;
    height: 16px;
  }
  .level-strip input::-webkit-slider-runnable-track { height: 3px; background: color-mix(in srgb, var(--foreground) 14%, var(--surface-elevated)); }
  .level-strip input::-webkit-slider-thumb { width: 13px; height: 13px; margin-top: -5px; border-width: 2px; box-shadow: 0 1px 2px rgb(23 27 34 / 16%); }
  .level-strip input::-moz-range-track { height: 3px; }
  .level-strip input::-moz-range-progress { height: 3px; }
  .level-strip input::-moz-range-thumb { width: 9px; height: 9px; border-width: 2px; box-shadow: 0 1px 2px rgb(23 27 34 / 16%); }
  .measure {
    color: var(--primary);
    font: var(--text-2xs)/1.2 var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .aspect-key {
    display: inline-flex;
    min-width: 92px;
    height: 32px;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: 0 var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--foreground);
    background: var(--surface);
    cursor: pointer;
  }
  .aspect-key:hover {
    border-color: var(--border-strong);
    background: var(--surface-muted);
  }
  .aspect-value {
    color: var(--foreground);
    font: var(--weight-semibold) var(--text-2xs)/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .fit-select {
    width: auto;
    min-width: 0;
    height: 32px;
    min-height: 32px;
    align-items: center;
    justify-content: space-between;
    padding: 0 calc(var(--icon-sm) + var(--space-6)) 0 var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--foreground);
    background-color: var(--surface);
    background-position: right var(--space-4) center;
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .fit-select:hover { border-color: var(--border-strong); background-color: var(--surface-muted); }
  @supports (appearance: base-select) {
    .fit-select { padding-inline: var(--space-4); }
  }
  @media (max-width: 1024px) {
    .controls-live {
      min-height: 48px;
      gap: var(--space-6);
      padding: var(--space-3) var(--space-6);
    }
    .level-strip { grid-template-columns: minmax(32px, 1fr) 36px; gap: var(--space-4); }
    .level-label { display: none; }
    .aspect-key { min-width: 58px; }
    .aspect-label { display: none; }
  }
  @media (max-width: 540px) {
    .controls-live { gap: var(--space-3); }
    .level-strip { grid-template-columns: minmax(24px, 1fr); }
    .measure { display: none; }
  }
  @media (pointer: coarse) {
    .controls-live { min-height: 54px; }
    .control-key { width: 44px; height: 44px; }
    .level-strip input { height: 44px; }
    .aspect-key { min-width: 58px; height: 44px; }
    .fit-select { height: 44px; }
  }
</style>
