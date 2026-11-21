<script lang="ts">
  import { generationRecipe } from '../../lib/landing'
  import LandingIcon from './LandingIcon.svelte'
</script>

<section class="recipe-workflow" aria-labelledby="recipe-heading">
  <div><h2 class="section-title" id="recipe-heading">Creative decisions.<br /><span>Worth keeping.</span></h2><p class="section-copy">Your edit can become a reusable recipe. Capture your timeline, stage image and voice actions, and save the instructions as YAML. Bring fresh media. Keep your creative language.</p><div class="recipe-points"><p><strong>Shape it visually.</strong> Start with the timeline or approachable action forms.</p><p><strong>Keep it as YAML.</strong> Save your .edit.yaml, or work directly in Code DSL.</p><p><strong>Apply with intention.</strong> Generation runs when you apply. The recipe becomes one undoable edit.</p></div><a class="text-link" href="/docs">Get to know recipes <LandingIcon name="direction" size={17} /></a></div>
  <div class="recipe-sheet"><div class="sheet-header"><LandingIcon name="file" size={18} /><span>your-next-idea.edit.yaml</span><span class="measurement">YAML</span></div><pre><code>{generationRecipe}</code></pre><p>Example recipe · images, voice and captions in one workflow</p></div>
</section>

<style>
  .recipe-workflow { display: grid; grid-template-columns: 1.05fr 1fr; gap: 9%; padding: 95px 8%; }
  .recipe-workflow .section-copy { margin-block: 23px; }
  .recipe-points { margin-bottom: 27px; }
  .recipe-points p { padding: 15px 0; border-top: 1px solid var(--home-rule); color: var(--home-muted); font-size: 13px; line-height: 1.75; margin: 0; }
  .recipe-points strong { display: block; color: var(--home-ink); font-size: 17px; font-weight: 500; margin-bottom: 3px; }
  .recipe-sheet { min-width: 0; border: 1px solid var(--home-rule); background: var(--home-surface); }
  .sheet-header { display: flex; align-items: center; gap: 10px; padding: 17px 20px; border-bottom: 1px solid var(--home-rule); font-size: 12px; }
  .sheet-header :global(svg) { color: var(--home-accent); }
  .sheet-header .measurement { margin-left: auto; color: var(--home-muted); font-size: 10px; }
  pre { background: var(--home-code); color: var(--home-code-ink); margin: 0; padding: 25px; font-size: 11px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
  .recipe-sheet > p { padding: 0 20px; color: var(--home-muted); font-size: 10px; line-height: 1.6; }
  @media (max-width: 900px) { .recipe-workflow { padding-inline: 5%; gap: 5%; } }
  @media (max-width: 640px) { .recipe-workflow { grid-template-columns: 1fr; gap: 35px; padding-block: 65px; } pre { padding: 20px; font-size: 10px; } }
</style>
