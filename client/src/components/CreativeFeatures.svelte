<script lang="ts">
  import { CATALOG_EFFECTS, CATALOG_LOOKS, CATALOG_MOTIONS, CATALOG_TEXT_PRESETS, CATALOG_TRANSITIONS } from '../lib/edit-catalog'
  import LandingIcon from './home/LandingIcon.svelte'

  const collections = [
    { count: CATALOG_LOOKS.length, label: 'reusable styles', text: 'A complete visual identity in one click. Apply a look, then make it your own.', examples: 'Warm Memory · Silver Contrast · Neon Night' },
    { count: CATALOG_EFFECTS.length, label: 'effects', text: 'Layer treatments, tune their parameters and shape their intensity over time.', examples: 'Blur · Gaussian Blur · Soft Focus' },
    { count: CATALOG_TRANSITIONS.length, label: 'transitions', text: 'Make the cut part of the story. Connect clips and choose how long the change lasts.', examples: 'Cross Dissolve · Fade Through Black · Film Dissolve Fast' },
  ]

  const features = [
    { title: 'A timeline that follows your thinking.', text: 'Layer video, images and sound. Trim, split, snap and rearrange clips. Keep linked audio in sync, and undo your way back.', detail: 'Multitrack editing · linked audio · undo / redo' },
    { title: 'Movement, words and sound.', text: 'Shape position, scale and rotation with keyframes. Layer titles and captions, arrange music and voice, and adjust volume or playback speed.', detail: `${CATALOG_MOTIONS.length} motion presets · ${CATALOG_TEXT_PRESETS.length} text presets · audio layers` },
    { title: 'Made for the final frame.', text: 'Work in 16:9, 9:16 or 4:3. Export MP4 or AVI video, or audio-only MP3, with quality presets and browser-local or server rendering.', detail: 'Aspect ratios · quality presets · flexible export' },
  ]
</script>

<section class="creative" id="features" aria-labelledby="features-heading">
  <div class="feature-heading"><h2 class="section-title" id="features-heading">The tools are real.<br /><span>The possibilities are yours.</span></h2><a class="text-link" href="/toolkit">Explore the full toolkit <LandingIcon name="direction" size={17} /></a></div>
  <div class="catalog-inventory">
    {#each collections as collection}
      <article class="catalog-entry">
        <h3><span class="catalog-count">{collection.count}</span> <span class="catalog-label">{collection.label}</span></h3>
        <p>{collection.text}</p>
        <span class="catalog-examples">{collection.examples}</span>
      </article>
    {/each}
  </div>
  <div class="feature-list">{#each features as feature}<article><h3>{feature.title}</h3><div><p>{feature.text}</p><small>{feature.detail}</small></div></article>{/each}</div>
</section>

<style>
  .creative { padding: 85px 8% 100px; border-top: 1px solid var(--home-rule); }
  .feature-heading { display: flex; align-items: end; justify-content: space-between; gap: 40px; margin-bottom: 44px; }
  .feature-heading .text-link { flex-shrink: 0; }
  .catalog-inventory { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: var(--home-tint); border-block: 1px solid var(--home-rule); margin-bottom: 42px; }
  .catalog-entry { min-width: 0; padding: 30px; }
  .catalog-entry + .catalog-entry { border-left: 1px solid var(--home-rule); }
  .catalog-entry h3 { margin: 0 0 21px; max-width: none; }
  .catalog-count { display: block; color: var(--home-accent); font-size: clamp(72px, 7vw, 96px); line-height: 1; letter-spacing: -.04em; font-weight: 500; font-variant-numeric: tabular-nums; }
  .catalog-label { display: block; margin-top: 10px; font-size: 27px; line-height: 1.15; }
  .catalog-entry p { font-size: 14px; line-height: 1.7; margin-bottom: 18px; }
  .catalog-examples { display: block; color: var(--home-accent); font-size: 11px; line-height: 1.7; }
  .feature-list article { display: grid; grid-template-columns: 1fr 1.1fr; gap: 8%; padding: 29px 0; border-top: 1px solid var(--home-rule); }
  h3 { margin: 3px 0 0; font-size: 27px; line-height: 1.2; font-weight: 500; letter-spacing: -.025em; max-width: 23ch; }
  p { color: var(--home-muted); font-size: 15px; line-height: 1.75; max-width: 55ch; margin: 0 0 12px; }
  small { color: var(--home-accent); font-size: 11px; line-height: 1.5; }
  @media (max-width: 900px) { .creative { padding-inline: 5%; } .feature-heading { flex-direction: column; align-items: start; gap: 26px; } .catalog-entry { padding: 24px 20px; } .catalog-label { font-size: 23px; } }
  @media (max-width: 640px) { .creative { padding-block: 65px; } .catalog-inventory { grid-template-columns: 1fr; margin-bottom: 30px; } .catalog-entry { padding: 24px; } .catalog-entry + .catalog-entry { border-left: 0; border-top: 1px solid var(--home-rule); } .catalog-entry h3 { display: flex; align-items: center; gap: 22px; margin-bottom: 16px; } .catalog-count { min-width: 88px; font-size: 72px; } .catalog-label { font-size: 25px; margin: 0; max-width: 9ch; } .catalog-entry p { margin-bottom: 12px; } .feature-list article { grid-template-columns: 1fr; gap: 13px; } h3 { font-size: 25px; } }
</style>
