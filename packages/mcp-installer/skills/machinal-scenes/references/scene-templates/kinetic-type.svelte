<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp, easeOutCubic } from '@direction/scene-runtime';

  const scene = useScene();

  const design = {
    words: ['Ideea', 'prinde', 'formă.'],
    accent: '#d5f36b',
    stagger: 0.09,
  };

  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const underline = $derived(easeOutCubic(clamp((progress - 0.16) / 0.25, 0, 1)) * (1 - clamp((progress - 0.9) / 0.1, 0, 1)));

  function entrance(index, time) {
    return easeOutCubic(clamp((time - index * design.stagger) / 0.16, 0, 1));
  }
</script>

<SceneCanvas background="#111a19">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label={design.words.join(' ')}>
    <path d="M100 116 H900 M100 584 H900" stroke="#35423b" stroke-width="2" />
    {#each design.words as word, index}
      {@const enter = entrance(index, progress)}
      <g opacity={enter} transform="translate(100 {210 + index * 128 + (1 - enter) * 40})">
        <text fill={index === design.words.length - 1 ? design.accent : '#f0eee5'} font-size="104" font-weight="700">{word}</text>
      </g>
    {/each}
    <rect x="100" y="510" width={540 * underline} height="8" fill={design.accent} />
    <circle cx={100 + 700 * easeOutCubic(clamp(progress / 0.48, 0, 1))} cy="584" r="7" fill={design.accent} />
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; line-height: 1.1; }
</style>
