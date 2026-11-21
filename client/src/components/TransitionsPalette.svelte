<script lang="ts">
  import { useTransitionsPalette } from '../composables/usePalette.svelte'
  import PaletteSearch from './PaletteSearch.svelte'
  import { filterPaletteGroups } from '../lib/palette-search'

  const palette = useTransitionsPalette()
  let query = $state('')

  const filteredGroups = $derived(filterPaletteGroups(palette.transitionGroups, query,
    (transition) => [transition.label, transition.algorithm, transition.category, transition.id]))
</script>

<section class="browser" aria-label="Available transitions">
  <div class="search-wrap">
    <PaletteSearch label="transitions" count={palette.transitionGroups.reduce((n, g) => n + g.items.length, 0)} bind:query />
  </div>
  {#if filteredGroups.length === 0}
    <div class="no-results" role="status">No matching transitions.<br /><span>Try another name or clear the search.</span></div>
  {/if}
  {#each filteredGroups as group (group.category)}
    <section class="group" aria-label={group.category}>
      <h3>{group.category}</h3>
      <div class="card-grid">
        {#each group.items as transition (transition.id)}
          <button
            class="transition-card transition-{transition.id}"
            data-transition-id={transition.id}
            draggable="true"
             ondragstart={palette.dragTransition(transition.id)}
             onclick={palette.applyTransition(transition.id)}
            title="{transition.label}: {transition.algorithm} Click with adjacent clips selected or drag onto a junction."
          >
            <span class="transition-preview" aria-hidden="true">
              <span class="frame left"></span>
              <span class="frame right"></span>
              <span class="direction"></span>
            </span>
            <span class="card-label">{transition.label}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</section>

<style>
  .browser { color: var(--foreground); background: var(--surface); border-bottom: 1px solid var(--border); }
  .search-wrap { position: sticky; top: 0; z-index: 5; background: var(--surface); border-bottom: 1px solid var(--border); }
  .no-results { padding: var(--space-16) var(--space-8); color: var(--muted-foreground); font-size: var(--text-xs); text-align: center; line-height: var(--leading-copy); }
  .no-results span { font-size: var(--text-2xs); }
  .group { border-bottom: 1px solid var(--border); }
  .group:last-child { border-bottom: 0; }
   h3 { margin: 0; padding: 17px 14px 9px; color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-semibold); letter-spacing: 0; }
    .card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; padding: 1px 0 12px; background: var(--border); }
   @container tool-sheet (min-width: 530px) {
     .card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
   }
   @container tool-sheet (max-width: 340px) {
     .card-grid { grid-template-columns: minmax(0, 1fr); }
   }
  .transition-card {
     min-width: 0; padding: 10px; border: 1px solid transparent; border-radius: 0;
     color: var(--foreground); background: var(--surface-elevated); cursor: grab; text-align: left;
  }
  .transition-card:hover { border-color: var(--primary-border); background: var(--primary-subtle); }
  .transition-card:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .transition-card:active { cursor: grabbing; }
   .transition-preview { display: block; position: relative; height: 62px; overflow: hidden; border: 0; border-radius: 0; background: #20262e; isolation: isolate; }
  .frame { position: absolute; inset-block: 0; width: 57%; }
  .frame.left { left: 0; background: #536273; }
  .frame.right { right: 0; background: #acbac5; }
  .frame::before { content: ''; position: absolute; inset: 8px; border: 1px solid rgb(255 255 255 / 28%); }
  .direction { position: absolute; z-index: 3; left: 50%; top: 50%; width: 20px; height: 2px; background: #fff; transform: translate(-50%, -50%); }
  .direction::after { content: ''; position: absolute; right: 0; top: -3px; width: 6px; height: 6px; border-top: 2px solid #fff; border-right: 2px solid #fff; transform: rotate(45deg); }
  /* Preview states are intentionally exaggerated so the transition reads at thumbnail size. */
  .transition-cross-dissolve .frame { width: 68%; opacity: .78; mix-blend-mode: screen; }
  .transition-film-dissolve-fast .frame { width: 62%; opacity: .9; }
  .transition-film-dissolve-fast .direction { width: 9px; }
  .transition-film-dissolve-slow .frame { width: 75%; opacity: .72; }
  .transition-film-dissolve-slow .direction { width: 30px; opacity: .7; }
  .transition-fade-black .transition-preview::after,
  .transition-fade-white .transition-preview::after { content: ''; position: absolute; z-index: 2; inset: 0; background: linear-gradient(90deg, transparent, #10141a 50%, transparent); }
  .transition-fade-white .transition-preview::after { background: linear-gradient(90deg, transparent, #fff 50%, transparent); }
  .transition-fade-grayscale .transition-preview { filter: grayscale(1) contrast(1.25); }
  .transition-blur-dissolve .frame { width: 70%; filter: blur(4px); transform: scale(1.12); }
  .transition-noise-dissolve .transition-preview::after { content: ''; position: absolute; z-index: 2; inset: 0; opacity: .75; background: repeating-radial-gradient(circle at 30% 40%, #fff 0 1px, transparent 1px 4px); mix-blend-mode: overlay; }
  .transition-difference-dissolve .frame { filter: contrast(2) saturate(.3); mix-blend-mode: difference; }
  .transition-mosaic-dissolve .transition-preview::after { content: ''; position: absolute; z-index: 2; inset: 0; backdrop-filter: blur(2px); background: linear-gradient(90deg, transparent 88%, rgba(8,10,15,.65) 88%), linear-gradient(transparent 78%, rgba(8,10,15,.65) 78%); background-size: 12px 12px; }

  .transition-wipe-left .frame.left,
  .transition-smooth-left .frame.left,
  .transition-slide-left .frame.left { width: 72%; clip-path: none; }
  .transition-wipe-right .frame.right,
  .transition-smooth-right .frame.right,
  .transition-slide-right .frame.right { width: 72%; clip-path: none; }
  .transition-wipe-left .direction,
  .transition-smooth-left .direction,
  .transition-slide-left .direction { transform: translate(-50%, -50%) scaleX(-1); }
  .transition-wipe-up .frame,
  .transition-wipe-down .frame,
  .transition-smooth-up .frame,
  .transition-smooth-down .frame,
  .transition-slide-up .frame,
  .transition-slide-down .frame { inset-inline: 0; width: 100%; height: 68%; clip-path: none; }
  .transition-wipe-up .frame.left,
  .transition-smooth-up .frame.left,
  .transition-slide-up .frame.left { top: 0; bottom: auto; }
  .transition-wipe-up .frame.right,
  .transition-smooth-up .frame.right,
  .transition-slide-up .frame.right { top: auto; bottom: 0; }
  .transition-wipe-down .frame.left,
  .transition-smooth-down .frame.left,
  .transition-slide-down .frame.left { top: auto; bottom: 0; }
  .transition-wipe-down .frame.right,
  .transition-smooth-down .frame.right,
  .transition-slide-down .frame.right { top: 0; bottom: auto; }
  .transition-wipe-up .direction,
  .transition-smooth-up .direction,
  .transition-slide-up .direction { transform: translate(-50%, -50%) rotate(-90deg); }
  .transition-wipe-down .direction,
  .transition-smooth-down .direction,
  .transition-slide-down .direction { transform: translate(-50%, -50%) rotate(90deg); }
  .transition-smooth-left .direction,
  .transition-smooth-right .direction,
  .transition-smooth-up .direction,
  .transition-smooth-down .direction { width: 8px; }
  .transition-clock-wipe .frame.right { inset: 0; width: 100%; clip-path: polygon(50% 50%, 50% 0, 100% 0, 100% 62%); }
  .transition-clock-wipe .direction { width: 16px; transform-origin: left; transform: translate(0, -50%) rotate(-48deg); }

  .transition-diagonal-tl .frame.right,
  .transition-diagonal-tr .frame.right,
  .transition-diagonal-bl .frame.right,
  .transition-diagonal-br .frame.right { inset: 0; width: 100%; }
  .transition-diagonal-tl .frame.right { clip-path: polygon(0 0, 72% 0, 0 78%); }
  .transition-diagonal-tr .frame.right { clip-path: polygon(28% 0, 100% 0, 100% 78%); }
  .transition-diagonal-bl .frame.right { clip-path: polygon(0 22%, 72% 100%, 0 100%); }
  .transition-diagonal-br .frame.right { clip-path: polygon(100% 22%, 100% 100%, 28% 100%); }
  .transition-diagonal-tl .direction { transform: translate(-50%, -50%) rotate(-135deg); }
  .transition-diagonal-tr .direction { transform: translate(-50%, -50%) rotate(-45deg); }
  .transition-diagonal-bl .direction { transform: translate(-50%, -50%) rotate(135deg); }
  .transition-diagonal-br .direction { transform: translate(-50%, -50%) rotate(45deg); }
  .transition-corner-tl .frame.right,
  .transition-corner-tr .frame.right,
  .transition-corner-bl .frame.right,
  .transition-corner-br .frame.right { width: 58%; height: 62%; clip-path: none; }
  .transition-corner-tl .frame.right { inset: 0 auto auto 0; }
  .transition-corner-tr .frame.right { inset: 0 0 auto auto; }
  .transition-corner-bl .frame.right { inset: auto auto 0 0; }
  .transition-corner-br .frame.right { inset: auto 0 0 auto; }

  .transition-blinds-left .frame.right,
  .transition-blinds-right .frame.right { inset: 0; width: 100%; clip-path: none; mask: repeating-linear-gradient(90deg, #000 0 10px, transparent 10px 18px); }
  .transition-blinds-up .frame.right,
  .transition-blinds-down .frame.right { inset: 0; width: 100%; clip-path: none; mask: repeating-linear-gradient(#000 0 5px, transparent 5px 9px); }
  .transition-blinds-left .direction { transform: translate(-50%, -50%) scaleX(-1); }
  .transition-blinds-up .direction { transform: translate(-50%, -50%) rotate(-90deg); }
  .transition-blinds-down .direction { transform: translate(-50%, -50%) rotate(90deg); }

  .transition-circle .frame.right,
  .transition-circle-close .frame.right,
  .transition-circle-crop .frame.right { clip-path: circle(32% at 50% 50%); inset: 0; width: 100%; }
  .transition-circle-close .frame.left { inset: 0; width: 100%; clip-path: circle(45% at 50% 50%); }
  .transition-circle-crop .transition-preview { box-shadow: inset 0 0 14px 7px #000; }
  .transition-circle .direction,
  .transition-circle-close .direction { width: 19px; height: 19px; border: 1px solid #fff; border-radius: 50%; background: transparent; }
  .transition-circle .direction::after,
  .transition-circle-close .direction::after { display: none; }
  .transition-circle-close .direction { outline: 1px solid rgb(255 255 255 / 45%); outline-offset: 3px; }
  .transition-rectangle-crop .frame.right { inset: 8px 25%; width: 50%; clip-path: none; }
  .transition-rectangle-crop .transition-preview { box-shadow: inset 0 0 0 8px #000; }
  .transition-barn-vertical-open .frame.right,
  .transition-barn-vertical-close .frame.right { inset: 0 auto 0 34%; width: 32%; clip-path: none; }
  .transition-barn-horizontal-open .frame.right,
  .transition-barn-horizontal-close .frame.right { inset: 32% 0 auto; width: 100%; height: 36%; clip-path: none; }
  .transition-barn-vertical-open .direction { width: 28px; }
  .transition-barn-vertical-close .direction { width: 28px; transform: translate(-50%, -50%) scaleX(-1); }
  .transition-barn-horizontal-open .direction { width: 24px; transform: translate(-50%, -50%) rotate(90deg); }
  .transition-barn-horizontal-close .direction { width: 24px; transform: translate(-50%, -50%) rotate(-90deg); }

  .transition-slide-left .frame,
  .transition-slide-right .frame { clip-path: none; box-shadow: 0 0 0 1px rgba(255,255,255,.3); }
  .transition-slide-up .frame,
  .transition-slide-down .frame { box-shadow: 0 0 0 1px rgba(255,255,255,.3); }
  .transition-squeeze-horizontal .frame.left { left: 28%; width: 28%; clip-path: none; }
  .transition-squeeze-horizontal .frame.right { right: 0; width: 54%; clip-path: none; }
  .transition-squeeze-vertical .frame.left { inset: 35% 0 auto; width: 100%; height: 30%; clip-path: none; }
  .transition-squeeze-vertical .frame.right { inset: 0; width: 100%; clip-path: none; opacity: .68; }
  .transition-squeeze-vertical .direction { transform: translate(-50%, -50%) rotate(90deg); }
  .transition-zoom-in .frame.right { inset: 0; width: 100%; clip-path: none; }
  .transition-zoom-in .frame.left { z-index: 2; inset: 8px 28%; width: 44%; clip-path: none; outline: 1px solid #fff; }
  .transition-zoom-in .direction { width: 21px; height: 13px; border: 1px solid #fff; background: transparent; }
   .card-label { display: block; padding: 7px 0 0; color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: var(--leading-ui); overflow-wrap: anywhere; }
  @media (max-width: 340px) {
    .card-grid { grid-template-columns: 1fr; }
  }
</style>
