<script lang="ts">
  import LandingIcon from './LandingIcon.svelte'
  import SvelteSceneExample from './SvelteSceneExample.svelte'

  const capabilities = [
    { title: 'Your media, part of the scene.', copy: 'Bring images and video. Keep exact on-screen words separate from your visual directions.' },
    { title: 'A full scene. Or a transparent overlay.', copy: 'Add a complete scene to your video, or place an animated overlay above the footage you already have.' },
    { title: 'Preview it. Ask for changes. Keep editing.', copy: 'Review the live result, revise it and add it to your timeline. The scene stays editable; video rendering happens at export.' },
  ]
</script>

<section class="scene-showcase" id="scenes" aria-labelledby="scenes-heading">
  <div class="scene-intro">
    <h2 class="section-title" id="scenes-heading">Create scenes. <br /><span>Built with Svelte.</span></h2>
    <p class="section-copy">Turn a prompt or your narration into an animated Svelte component. Create 2D motion graphics or real 3D with Three.js — not just another finished clip.</p>
    <div class="scene-capabilities">
      {#each capabilities as capability}
        <div><h3>{capability.title}</h3><p>{capability.copy}</p></div>
      {/each}
    </div>
    <div class="scene-actions">
      <a class="button button-solid" href="/editor?ai=scenes">Create a scene <LandingIcon name="arrow" size={18} /></a>
      <a class="text-link" href="/docs#ai-guide">How scenes work <LandingIcon name="direction" size={16} /></a>
    </div>
    <p class="scene-access">Hosted scene generation requires a paid account.</p>
  </div>
  <SvelteSceneExample />
</section>

<style>
  .scene-showcase { display: grid; grid-template-columns: 1fr 1.15fr; gap: 8%; align-items: center; padding: 90px 8%; border-top: 1px solid var(--home-rule); }
  .scene-intro { min-width: 0; }
  .scene-intro .section-title { font-size: clamp(34px, 4vw, 56px); }
  .scene-intro .section-copy { margin-block: 24px 28px; font-size: 15px; }
  .scene-capabilities > div { padding: 17px 0; border-top: 1px solid var(--home-rule); }
  h3 { margin: 0 0 7px; font-size: 18px; line-height: 1.3; font-weight: 500; letter-spacing: -.02em; }
  .scene-capabilities p { margin: 0; color: var(--home-muted); font-size: 13px; line-height: 1.75; }
  .scene-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 20px 25px; margin-top: 24px; }
  .scene-actions .text-link { font-size: 12px; }
  .scene-access { margin: 15px 0 0; color: var(--home-muted); font-size: 11px; line-height: 1.6; }
  @media (max-width: 1100px) { .scene-showcase { padding-inline: 5%; gap: 5%; } }
  @media (max-width: 800px) { .scene-showcase { grid-template-columns: 1fr; gap: 36px; } .scene-intro .section-copy { max-width: 65ch; } }
  @media (max-width: 640px) { .scene-showcase { padding-block: 65px; } .scene-actions { gap: 20px; } }
</style>
