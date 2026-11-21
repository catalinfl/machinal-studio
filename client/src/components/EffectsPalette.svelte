<script lang="ts">
  import { useEffectsPalette } from '../composables/usePalette.svelte'
  import PaletteSearch from './PaletteSearch.svelte'
  import { filterPaletteGroups } from '../lib/palette-search'

  interface Props {
    targetChannelId: string
  }

  let { targetChannelId }: Props = $props()
  const palette = useEffectsPalette(() => targetChannelId)
  let query = $state('')

  const filteredGroups = $derived(filterPaletteGroups(palette.effectGroups, query,
    (effect) => [effect.label, effect.summary, effect.category, effect.id]))
</script>

<section class="browser" aria-label="Available effects">
  <div class="search-wrap">
    <PaletteSearch label="effects" count={palette.effectGroups.reduce((n, g) => n + g.items.length, 0)} bind:query />
  </div>
  {#if filteredGroups.length === 0}
    <div class="no-results" role="status">No matching effects.<br /><span>Try another name or clear the search.</span></div>
  {/if}
  {#each filteredGroups as group (group.category)}
    <section class="group" aria-label={group.category}>
      <h3>{group.category}</h3>
      <div class="card-grid">
        {#each group.items as effect (effect.id)}
          {@const controlCount = effect.parameters?.length ?? 0}
          {@const duration = effect.defaultDuration ?? 2}
          <button
            class="effect-card"
            data-effect-id={effect.id}
            draggable="true"
             ondragstart={palette.dragEffect(effect)}
             onclick={palette.addEffect(effect)}
            aria-label={`${effect.label}. ${effect.summary} Click to add at the playhead or drag onto a video track.`}
            title={`${effect.summary} Click to add at the playhead or drag onto a video track. How it works: ${effect.algorithm}`}
          >
            <span class="effect-preview effect-{effect.id}" aria-hidden="true">
              <span class="scene">
                <span class="sky"></span>
                <span class="sun"></span>
                <span class="ridge back"></span>
                <span class="ridge front"></span>
                <span class="subject"></span>
              </span>
            </span>
            <span class="card-copy">
              <strong>{effect.label}</strong>
              <small>{effect.summary}</small>
              <span class="card-meta">
                <span>{controlCount === 0 ? 'Fixed result' : `${controlCount} ${controlCount === 1 ? 'control' : 'controls'}`}</span>
                <span>{duration} s default</span>
              </span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</section>

<style>
   .browser { color: var(--foreground); background: var(--surface); border-bottom: 1px solid var(--border); }
  .search-wrap { position: sticky; top: 0; z-index: 2; background: var(--surface); border-bottom: 1px solid var(--border); }
  .no-results { padding: var(--space-16) var(--space-8); color: var(--muted-foreground); font-size: var(--text-xs); text-align: center; line-height: var(--leading-copy); }
  .no-results span { font-size: var(--text-2xs); }
  .group { border-bottom: 1px solid var(--border); }
  .group:last-child { border-bottom: 0; }
   h3 { margin: 0; padding: 17px 14px 8px; color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-semibold); letter-spacing: 0; }
   .card-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; padding: 1px 0 12px; background: var(--border); }
  .effect-card {
     display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; gap: 12px;
     min-width: 0; padding: 9px 14px; border: 1px solid transparent; border-radius: 0;
     color: var(--foreground); background: var(--surface-elevated); cursor: grab; text-align: left;
  }
  .effect-card:hover { border-color: var(--primary-border); background: var(--primary-subtle); }
  .effect-card:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .effect-card:active { cursor: grabbing; }
   .effect-preview { display: block; position: relative; height: 60px; overflow: hidden; border: 0; border-radius: 0; background: #20262e; }
  .scene { display: block; position: relative; width: 100%; height: 100%; overflow: hidden; background: #303e4d; }
  .sky { position: absolute; inset: 0; background: linear-gradient(110deg, #303e4d, #8299a6); }
  .sun { position: absolute; width: 26px; height: 26px; right: 12%; top: 16%; border-radius: 50%; background: #e9c79d; }
  .ridge { position: absolute; transform-origin: center; }
  .ridge.back { width: 38px; height: 38px; left: 12%; bottom: 10%; border: 1px solid #e4e9ed; }
  .ridge.front { width: 100%; height: 12px; left: 0; bottom: 0; background: linear-gradient(90deg, #263544 0 25%, #617d8c 25% 50%, #b1bdbe 50% 75%, #e9c79d 75%); }
  .subject { position: absolute; left: 28%; bottom: 24%; width: 10px; height: 28px; background: #e4e9ed; }
  /* Preview values are intentionally stronger than the defaults so each effect reads at thumbnail size. */
  .effect-blur .scene { filter: blur(3px); transform: scale(1.1); }
  .effect-gaussian-blur .scene { filter: blur(5px); transform: scale(1.16); }
  .effect-directional-blur .scene { filter: blur(.7px); transform: scale(1.08) translateX(2px); }
  .effect-directional-blur .ridge,
  .effect-directional-blur .sun,
  .effect-directional-blur .subject { filter: drop-shadow(-5px 3px 2px rgba(30, 43, 59, .75)) drop-shadow(5px -3px 2px rgba(227, 165, 101, .55)); }
  .effect-mosaic-blur::after {
    content: ''; position: absolute; inset: 0; backdrop-filter: blur(3px) saturate(1.3);
    background: linear-gradient(90deg, transparent 92%, rgba(10,13,18,.38) 92%), linear-gradient(transparent 82%, rgba(10,13,18,.38) 82%);
    background-size: 14px 14px;
  }
  .effect-soft-focus .scene { filter: blur(1.8px) brightness(1.28) saturate(1.2); transform: scale(1.08); }
  .effect-soft-focus::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle, rgba(255,242,199,.32), transparent 72%); }

  .effect-grayscale .scene { filter: grayscale(1) contrast(1.12); }
  .effect-brightness .scene { filter: brightness(1.55) saturate(1.35); }
  .effect-contrast-pop .scene { filter: contrast(1.75) brightness(.95) saturate(1.18); }
  .effect-color-boost .scene { filter: saturate(2.35) contrast(1.12); }
  .effect-hue-shift .scene { filter: hue-rotate(85deg) saturate(1.55); }
  .effect-warm-grade .scene { filter: sepia(.35) saturate(1.55) hue-rotate(-12deg) brightness(1.08); }
  .effect-cool-grade .scene { filter: saturate(1.25) hue-rotate(22deg); }
  .effect-day-for-night .scene { filter: brightness(.52) saturate(.72) hue-rotate(24deg); }
  .effect-vintage .scene { filter: sepia(.48) contrast(.88) saturate(.72); }
  .effect-vintage::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 18px rgba(55,28,12,.72); }
  .effect-bleach-bypass .scene { filter: grayscale(.7) contrast(1.75) brightness(.9); }
  .effect-sepia .scene,
  .effect-sepia-dream .scene { filter: sepia(1) saturate(1.45) contrast(.9); }
  .effect-sepia-dream .scene { filter: sepia(1) saturate(1.25) blur(1px) brightness(1.12); transform: scale(1.05); }
  .effect-negate .scene,
  .effect-negative-strobe .scene { filter: invert(1) hue-rotate(180deg); }

  .effect-flash-hit .scene { filter: brightness(1.65) contrast(1.08) saturate(.45); }
  .effect-flash-hit::after { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,.38); }
  .effect-rgb-punch .scene { filter: contrast(1.4) saturate(1.45) drop-shadow(-5px 0 rgba(255,24,89,.78)) drop-shadow(5px 0 rgba(24,220,255,.72)); }
  .effect-analog-flicker .scene { filter: contrast(1.16) saturate(.88); }
  .effect-analog-flicker::after { content: ''; position: absolute; inset: 0; opacity: .32; background: repeating-radial-gradient(circle at 23% 37%, #fff 0 1px, transparent 1px 4px); mix-blend-mode: overlay; }
  .effect-card:hover .effect-flash-hit::after, .effect-card:focus-visible .effect-flash-hit::after { animation: flash-preview 480ms ease-out; }
  .effect-card:hover .effect-rgb-punch .scene, .effect-card:focus-visible .effect-rgb-punch .scene { animation: rgb-preview 360ms cubic-bezier(.16,1,.3,1); }
  .effect-card:hover .effect-analog-flicker .scene, .effect-card:focus-visible .effect-analog-flicker .scene { animation: flicker-preview 520ms steps(4, end); }
  @keyframes flash-preview { 0% { opacity: .9; } 100% { opacity: .18; } }
  @keyframes rgb-preview { 0% { transform: translateX(-4px) scale(1.06); } 55% { transform: translateX(2px) scale(1.03); } 100% { transform: none; } }
  @keyframes flicker-preview { 0%, 100% { filter: brightness(.88) contrast(1.16); } 50% { filter: brightness(1.18) contrast(1.16); } }

  .effect-film-grain::after,
  .effect-analog-damage::after { content: ''; position: absolute; inset: 0; opacity: .52; background: repeating-radial-gradient(circle at 17% 31%, #fff 0 1px, transparent 1px 3px); mix-blend-mode: overlay; }
  .effect-analog-damage .scene { filter: contrast(1.35) saturate(.55) sepia(.25); transform: translateX(1px); }
  .effect-scanlines::after { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(transparent 0 3px, rgba(0,0,0,.72) 3px 5px); }
  .effect-block-damage::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 8%, rgba(255,79,79,.65) 8% 24%, transparent 24% 62%, rgba(40,220,255,.55) 62% 79%, transparent 79%) 0 9px / 100% 8px no-repeat, linear-gradient(90deg, rgba(20,28,40,.75) 0 19%, transparent 19% 71%, rgba(255,197,89,.6) 71%) 0 30px / 100% 7px no-repeat; }
  .effect-vignette::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 24px 10px rgba(0,0,0,.88); }

  .effect-global-beauty .scene { filter: brightness(1.15) saturate(1.08) blur(.45px); transform: scale(1.02); }
  .effect-global-beauty::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 30% 48%, rgba(255,224,203,.24), transparent 30%); }
  .effect-deband .sky { background: linear-gradient(#5d8fc8, #7198c8 55%, #e3a565 56%, #e7b87d); }
  .effect-deflicker .scene { filter: brightness(1.2) contrast(.9); }
  .effect-denoise .scene { filter: blur(.7px) saturate(.88); transform: scale(1.03); }
  .effect-dust-reduction .scene { filter: brightness(1.1) contrast(.95); }
  .effect-chromatic-correction .scene { filter: contrast(1.25) saturate(1.3); }
  .effect-deinterlace::after { content: ''; position: absolute; inset: 0; opacity: .22; background: repeating-linear-gradient(transparent 0 2px, #fff 2px 3px); }
  .effect-sharpen .scene,
  .effect-sharpen-edges .scene { filter: contrast(1.6) saturate(1.3); }
  .effect-sharpen,
  .effect-sharpen-edges { box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
  .effect-soften .scene { filter: blur(1.5px) contrast(.9); transform: scale(1.05); }

  .effect-edge-detect .scene { filter: grayscale(.8) contrast(2.6) brightness(.72); }
  .effect-emboss .scene { filter: grayscale(1) contrast(2) brightness(1.15) drop-shadow(2px 2px 0 #fff); }
  .effect-pencil-sketch .scene { filter: grayscale(1) contrast(3.5) brightness(1.8); }
  .effect-posterize .scene { filter: contrast(2.2) saturate(1.8); }
  .effect-posterize::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,.08) 50%, rgba(0,0,0,.12) 50%); background-size: 18px 100%; mix-blend-mode: hard-light; }
  .effect-prism .scene { filter: saturate(1.04); }
  .effect-prism .ridge,
  .effect-prism .sun,
  .effect-prism .subject { filter: drop-shadow(-2px 0 rgb(0 210 255 / 68%)) drop-shadow(2px 0 rgb(255 0 70 / 68%)); }
  .effect-watercolor .scene { filter: saturate(1.45) contrast(.78) blur(.8px); transform: scale(1.04); }
  .effect-mirror .scene { transform: scaleX(-1); }
  .effect-flip-v .scene { transform: scaleY(-1); }

  .effect-motion-trails .scene,
  .effect-frame-echo .scene { filter: opacity(.72) drop-shadow(-8px 0 rgba(90,170,255,.7)) drop-shadow(8px 0 rgba(255,111,78,.65)); transform: scale(.9); }
  .effect-stop-motion .scene { transform: translateX(5px) scale(1.04); }
  .effect-stop-motion::after { content: ''; position: absolute; inset: 0; border: 2px dashed rgba(255,255,255,.58); }

  .effect-rotate .scene { transform: rotate(8deg) scale(.92); }
  .effect-lens-distortion .scene { transform: scaleX(.86) scaleY(1.12); border-radius: 35%; }
  .effect-fisheye .scene { transform: scaleX(1.15) scaleY(.86); border-radius: 48%; }
  .effect-shear .scene { transform: skewX(-13deg) scale(.92); }
  .effect-waviness .ridge.back { transform: rotate(-5deg) skewX(16deg); }
  .effect-waviness .ridge.front { transform: rotate(-5deg) skewX(-14deg); }
  .effect-waviness .subject { transform: skewX(14deg); }
  .effect-camera-shake .scene { transform: translate(5px, -3px) scale(1.12) rotate(-1deg); }
  .card-copy { display: flex; min-width: 0; flex-direction: column; gap: var(--space-2); }
  .card-copy strong { overflow: hidden; color: var(--foreground); font-size: var(--text-xs); font-weight: var(--weight-semibold); white-space: nowrap; text-overflow: ellipsis; }
  .card-copy small {
    display: -webkit-box; min-height: 28px; overflow: hidden; color: var(--muted-foreground);
    font-size: var(--text-2xs); line-height: var(--leading-ui); -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
  }
  .card-meta { display: flex; min-width: 0; align-items: center; gap: var(--space-3); color: var(--muted-foreground); font-size: var(--text-2xs); }
  .card-meta span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .card-meta span + span::before { content: '/'; margin-right: var(--space-3); color: var(--border-strong); }
  @media (max-width: 380px) {
    .effect-card { grid-template-columns: 56px minmax(0, 1fr); }
    .effect-preview { height: 56px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .effect-card:hover .effect-preview::after,
    .effect-card:focus-visible .effect-preview::after,
    .effect-card:hover .effect-preview .scene,
    .effect-card:focus-visible .effect-preview .scene { animation: none; }
  }
</style>
