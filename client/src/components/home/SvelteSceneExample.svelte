<script lang="ts">
  import LandingIcon from './LandingIcon.svelte'

  let preview = $state({ time: 2.4, mode: 'scene' as 'scene' | 'overlay' })
  const duration = 4
  const entrance = $derived(Math.min(preview.time / 1.2, 1))
  const offset = $derived((1 - entrance) ** 3 * 64)
  const rotation = $derived(preview.time * 30 - 30)
  const source = `let { time = 0 } = $props()
const entrance = $derived(Math.min(time / 1.2, 1))

<g opacity={entrance}>…</g>`
</script>

<figure class="svelte-example">
  <div class="example-heading"><span><LandingIcon name="code" size={17} />ideas.svelte</span><span>Live Svelte example</span></div>
  <div class="example-modes" role="group" aria-label="Svelte example output">
    <button type="button" class:active={preview.mode === 'scene'} aria-pressed={preview.mode === 'scene'} onclick={() => preview.mode = 'scene'}>Full scene</button>
    <button type="button" class:active={preview.mode === 'overlay'} aria-pressed={preview.mode === 'overlay'} onclick={() => preview.mode = 'overlay'}>Transparent overlay</button>
  </div>
  <div class="example-stage" class:overlay={preview.mode === 'overlay'} data-mode={preview.mode}>
    <svg viewBox="0 0 960 540" fill="none" role="img" aria-label="Interactive Svelte motion graphic: Ideas, in motion.">
      <text class="scene-brand" x="48" y="55">machinal</text>
      <path d="M48 78H912" stroke="currentColor" stroke-opacity=".3" />
      <g class="scene-copy" opacity={entrance} transform="translate(0 {offset})">
        <text class="scene-title" x="48" y="253">Ideas,</text>
        <text class="scene-title" x="48" y="367">in motion.</text>
      </g>
      <g class="scene-direction" transform="translate(758 224) rotate({rotation})">
        <circle r="114" stroke="currentColor" stroke-opacity=".3" />
        <path d="M-58 58 58-58M-58-58H58V58" stroke="currentColor" stroke-width="10" />
      </g>
      <text class="scene-caption" x="48" y="442">A little code. A new creative direction.</text>
      <path d="M48 487H912" stroke="currentColor" stroke-opacity=".3" />
      <path d="M48 487H{48 + 864 * preview.time / duration}" stroke="currentColor" stroke-width="4" />
      <circle cx={48 + 864 * preview.time / duration} cy="487" r="7" fill="currentColor" />
    </svg>
  </div>
  <div class="example-transport">
    <label for="scene-example-time">Scrub the scene</label>
    <output for="scene-example-time" class="measurement">{preview.time.toFixed(2)} / {duration.toFixed(2)} s</output>
    <input id="scene-example-time" aria-label="Svelte example time" type="range" min="0" max={duration} step="0.01" bind:value={preview.time} />
  </div>
  <details class="example-source">
    <summary>See the Svelte idea <LandingIcon name="code" size={16} /></summary>
    <pre><code>{source}</code></pre>
    <p>Simplified excerpt. Time drives the component, so you can preview any frame.</p>
  </details>
  <figcaption>A local interactive example. No AI request, upload or video render.</figcaption>
</figure>

<style>
  .svelte-example { margin: 0; min-width: 0; border: 1px solid var(--home-rule); background: var(--home-surface); }
  .example-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px; font-size: 12px; border-bottom: 1px solid var(--home-rule); }
  .example-heading > span:first-child { display: flex; align-items: center; gap: 10px; font-family: var(--font-mono); }
  .example-heading :global(svg) { color: var(--home-accent); flex-shrink: 0; }
  .example-heading > span:last-child { color: var(--home-muted); font-size: 11px; }
  .example-modes { display: flex; gap: 18px; padding: 0 20px; }
  .example-modes button { min-height: 48px; padding: 10px 0; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--home-muted); font-size: 12px; cursor: pointer; }
  .example-modes button.active { color: var(--home-accent); border-bottom-color: var(--home-accent); }
  .example-modes button:hover { color: var(--home-ink); }
  .example-stage { color: #262a30; background: var(--home-lilac); aspect-ratio: 16 / 9; overflow: hidden; }
  .example-stage.overlay { color: var(--home-ink); background-color: var(--home-surface); background-image: conic-gradient(var(--home-tint) 25%, transparent 0 50%, var(--home-tint) 0 75%, transparent 0); background-size: 24px 24px; }
  .example-stage > svg { display: block; width: 100%; height: 100%; }
  .example-stage text { fill: currentColor; font-family: var(--font-sans); }
  .scene-brand { font-size: 25px; font-weight: 500; letter-spacing: -.5px; }
  .scene-title { font-size: 116px; font-weight: 500; letter-spacing: -4px; }
  .scene-caption { font-size: 23px; }
  .example-transport { display: grid; grid-template-columns: 1fr auto; gap: 16px; padding: 20px; font-size: 11px; }
  output { color: var(--home-muted); font-size: 10px; }
  input[type='range'] { grid-column: 1 / -1; width: 100%; margin: 0; min-height: 24px; cursor: pointer; accent-color: var(--home-accent); }
  .example-source { border-top: 1px solid var(--home-rule); }
  summary { display: flex; align-items: center; justify-content: space-between; gap: 15px; min-height: 48px; padding: 14px 20px; color: var(--home-accent); font-size: 12px; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: var(--home-tint); }
  summary:focus-visible { outline: 2px solid var(--home-accent); outline-offset: -4px; }
  pre { margin: 0; padding: 18px 20px; background: var(--home-code); color: var(--home-code-ink); font-size: 11px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
  .example-source p { margin: 0; padding: 12px 20px; color: var(--home-muted); font-size: 11px; line-height: 1.7; }
  figcaption { padding: 14px 20px; border-top: 1px solid var(--home-rule); color: var(--home-muted); font-size: 10px; line-height: 1.7; }
  @media (max-width: 640px) { .example-heading { padding: 16px; gap: 12px; } .example-heading > span:last-child { font-size: 10px; } .example-modes { padding-inline: 16px; } .example-transport, summary, figcaption { padding-inline: 16px; } }
</style>
