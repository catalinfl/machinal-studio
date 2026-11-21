<script lang="ts">
  import { useClipLooksPalette } from '../composables/usePalette.svelte'
  import PaletteSearch from './PaletteSearch.svelte'
  import { filterPaletteItems } from '../lib/palette-search'

  const palette = useClipLooksPalette()
  let query = $state('')

  const filteredLooks = $derived(filterPaletteItems(palette.looks, query,
    (look) => [look.label, look.description, look.category, look.id]))
</script>

<section class="looks" aria-label="Clip looks">
  <div class="search-wrap">
    <PaletteSearch label="styles" count={palette.looks.length} bind:query />
  </div>
  {#if filteredLooks.length === 0}
    <div class="no-results" role="status">No matching styles.<br /><span>Try another name or clear the search.</span></div>
  {/if}
  <div class="look-grid">
    {#each filteredLooks as look (look.id)}
      <button
        type="button"
        class="look-card"
        data-look-id={look.id}
        draggable="true"
         ondragstart={palette.dragLookCard(look.id)}
         onclick={palette.applyLookCard(look.id)}
        aria-label={`${look.label}. ${look.description} Applies across the full clip.`}
         title={palette.disabledReason ? `${look.description} Drag onto a video clip to apply the full style.` : `${look.description} Applies across the full clip.`}
      >
        <span class="look-preview look-{look.id}" aria-hidden="true">
          <span class="scene">
            <span class="sun"></span>
            <span class="horizon"></span>
            <span class="figure"></span>
          </span>
          <span class="scan"></span>
        </span>
        <span class="copy">
          <strong>{look.label}</strong>
          <span class="meta">
            <span>{look.category}</span>
            {#if look.popular}<span class="popular">Top</span>{/if}
          </span>
        </span>
      </button>
    {/each}
  </div>
</section>

<style>
  .looks {
    padding: var(--space-8);
    color: var(--foreground);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .search-wrap { position: sticky; top: 0; z-index: 2; margin: calc(var(--space-8) * -1) calc(var(--space-8) * -1) var(--space-6); background: var(--surface); border-bottom: 1px solid var(--border); }
  .no-results { padding: var(--space-16) var(--space-8); color: var(--muted-foreground); font-size: var(--text-xs); text-align: center; line-height: var(--leading-copy); }
  .no-results span { font-size: var(--text-2xs); }
  .look-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
     gap: 1px;
     background: var(--border);
  }
  @container tool-sheet (min-width: 530px) {
    .look-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @container tool-sheet (max-width: 340px) {
    .look-grid { grid-template-columns: minmax(0, 1fr); }
  }
  .look-card {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
     padding: 9px;
     border: 1px solid transparent;
     border-radius: 0;
    color: inherit;
     background: var(--surface-elevated);
    cursor: grab;
    text-align: left;
  }
  .look-card:hover {
    border-color: var(--primary-border);
    background: var(--primary-subtle);
  }
  .look-card:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .look-card:active { cursor: grabbing; }
  .look-preview {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 2 / 1;
    height: auto;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: #20262e;
  }
  .scene {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: linear-gradient(110deg, #324e62, #8fa8ae 55%, #e2bc91);
  }
  .sun {
    position: absolute;
    top: 18%;
    right: 16%;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #eee5d4;
  }
  .horizon {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 22%;
    background: linear-gradient(90deg, #263544 0 20%, #526f80 20% 40%, #94acb0 40% 60%, #d6b38d 60% 80%, #eee5d4 80%);
  }
  .figure {
    position: absolute;
    bottom: 22%;
    left: 20%;
    width: 22%;
    height: 58%;
    border: 1px solid rgb(255 255 255 / 65%);
    background: rgb(38 53 68 / 45%);
  }
  .scan {
    position: absolute;
    inset: 0;
    z-index: 1;
    opacity: 0;
    background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(4, 4, 8, .7) 4px);
    pointer-events: none;
  }

  .look-balanced-enhance .scene { filter: contrast(1.06) saturate(1.04); }
  .look-hook-punch .scene { filter: brightness(1.13) contrast(1.3) saturate(1.2); transform: scale(1.08); }
  .look-hook-punch .figure { box-shadow: -3px 0 rgba(255,28,88,.75), 3px 0 rgba(35,218,255,.72), 0 -5px 0 -2px #17151a; }
  .look-whip-switch .scene { filter: blur(.8px) contrast(1.15) saturate(1.1); transform: translateX(-4px) scale(1.16); }
  .look-whip-switch .figure { box-shadow: 6px 0 rgba(44,216,255,.58), 0 -5px 0 -2px #17151a; }
  .look-flash-beat .scene { filter: brightness(1.42) contrast(1.12) saturate(.62); transform: scale(1.05); }
  .look-clean-tutorial .scene { filter: brightness(1.06) contrast(1.16) saturate(1.14); }
  .look-warm-routine .scene { filter: sepia(.24) brightness(1.08) contrast(.94) saturate(1.08); }
  .look-raw-story .scene { filter: contrast(1.03) saturate(.98); }
  .look-card:hover .look-hook-punch .scene, .look-card:focus-visible .look-hook-punch .scene { animation: look-punch 360ms cubic-bezier(.16,1,.3,1); }
  .look-card:hover .look-whip-switch .scene, .look-card:focus-visible .look-whip-switch .scene { animation: look-whip 420ms cubic-bezier(.16,1,.3,1); }
  .look-card:hover .look-flash-beat .scene, .look-card:focus-visible .look-flash-beat .scene { animation: look-flash 480ms ease-out; }
  @keyframes look-punch { 0% { filter: brightness(1.65) contrast(1.2) saturate(.45); transform: scale(1); } 35% { transform: scale(1.13); } 100% { transform: scale(1.08); } }
  @keyframes look-whip { 0% { filter: blur(2.2px) contrast(1.15); transform: translateX(14px) scale(1.2); } 62% { transform: translateX(-2px) scale(1.17); } 100% { transform: translateX(-4px) scale(1.16); } }
  @keyframes look-flash { 0% { filter: brightness(1.9) contrast(1.05) saturate(.25); } 100% { filter: brightness(1.42) contrast(1.12) saturate(.62); } }
  .look-fine-film .scene { filter: sepia(.24) contrast(1.12) saturate(.82); }
  .look-creator-natural .scene { filter: contrast(1.02) saturate(.96); }
  .look-clean-social-pop .scene { filter: brightness(1.08) contrast(1.16) saturate(1.3); }
  .look-teal-amber .scene {
    background: linear-gradient(#286b78 0 57%, #d28b4c 58%);
    filter: contrast(1.18) saturate(1.1);
  }
  .look-warm-memory .scene { filter: sepia(.34) brightness(1.06) contrast(.88) saturate(.82); }
  .look-dream-bloom .scene { filter: brightness(1.14) contrast(.9) saturate(.94) blur(.35px); transform: scale(1.02); }
  .look-silver-contrast .scene { filter: grayscale(1) contrast(1.38); }
  .look-neon-night .scene {
    background: linear-gradient(#123b61 0 57%, #a52675 58%);
    filter: contrast(1.25) saturate(1.55);
  }
  .look-analog-tape .scene { filter: sepia(.2) contrast(.9) saturate(.72) blur(.45px); transform: scale(1.02); }
  .look-action-steel .scene { filter: hue-rotate(175deg) contrast(1.35) saturate(.48); }
  .look-low-light-rescue .scene { filter: brightness(1.2) contrast(1.04) saturate(.84); }
  .look-golden-glow .scene { filter: sepia(.25) brightness(1.13) saturate(1.22) blur(.25px); }
  .look-direct-flash .scene { filter: brightness(1.17) contrast(1.32) saturate(1.2); }
  .look-bleach-grit .scene { filter: grayscale(.72) contrast(1.48) saturate(.35); }
  .look-pastel-haze .scene { filter: brightness(1.15) contrast(.76) saturate(.72); }
  .look-blue-night .scene {
    background: linear-gradient(#17385b 0 57%, #35556b 58%);
    filter: brightness(.82) contrast(1.14) saturate(.62);
  }
  .look-soft-silver .scene { filter: grayscale(1) brightness(1.12) contrast(.78) blur(.3px); }
  .look-rgb-glitch .scene { filter: contrast(1.2) saturate(1.35) hue-rotate(8deg); }
  .look-rgb-glitch .figure { box-shadow: -3px 0 #35d5ff, 3px 0 #ef347c, 0 -5px 0 -2px #17151a; }
  .look-backlight-rescue .scene { filter: brightness(1.16) contrast(.86) saturate(1.02); }
  .look-lo-fi-zine .scene { filter: contrast(1.28) saturate(1.45); }
  .look-watercolor-drift .scene { filter: brightness(1.06) saturate(1.18) blur(.65px); transform: scale(1.03); }
  .look-cyber-trails .scene {
    background: linear-gradient(#123d68 0 57%, #722d79 58%);
    filter: contrast(1.18) saturate(1.65);
  }
  .look-cyber-trails .figure { box-shadow: -5px 0 rgba(52, 217, 255, .5), 5px 0 rgba(238, 55, 169, .45), 0 -5px 0 -2px #17151a; }
  .look-sepia-strobe .scene { filter: sepia(.78) contrast(.92) saturate(.72); }
  .look-analog-tape .scan,
  .look-rgb-glitch .scan,
  .look-lo-fi-zine .scan,
  .look-cyber-trails .scan,
  .look-sepia-strobe .scan { opacity: .32; }

  .copy { display: flex; min-width: 0; flex-direction: column; gap: var(--space-2); width: 100%; padding: var(--space-4) 0 var(--space-2); }
  .meta { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .meta > span:first-child {
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta .popular {
    padding: 0;
    border: 0;
    border-radius: 0;
    color: var(--muted-foreground);
    background: transparent;
    font-size: var(--text-2xs);
    font-style: normal;
    font-weight: var(--weight-bold);
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .copy strong {
    color: var(--foreground);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-ui);
    overflow-wrap: anywhere;
  }
  @media (max-width: 340px) {
    .look-grid { grid-template-columns: minmax(0, 1fr); }
    .look-card { display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: center; }
    .look-preview { aspect-ratio: 16 / 10; border-right: 1px solid var(--border); border-bottom: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .look-card:hover .scene, .look-card:focus-visible .scene { animation: none; }
  }
</style>
