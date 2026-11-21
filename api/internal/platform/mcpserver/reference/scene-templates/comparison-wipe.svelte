<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  let { images = {} } = $props();
  const scene = useScene();
  const design = { before: 'Înainte', after: 'După', accent: '#d6f575', split: 0.5 };
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const reveal = $derived(smooth((progress - 0.2) / 0.45));
  const split = $derived(850 - (850 - 800 * design.split) * reveal);
  const marker = $derived(1 - smooth((progress - 0.92) / 0.08));

  function smooth(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }
</script>

<SceneCanvas background="#182125">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label="Aligned supplied states with a moving comparison boundary">
    <defs><clipPath id="comparison-after"><rect x={100 + split} y="110" width={Math.max(0, 800 - split)} height="440" /></clipPath></defs>
    <rect x="100" y="110" width="800" height="440" fill="#26363a" />
    <image data-scene-object="before" href={images.image_1} x="100" y="110" width="800" height="440" preserveAspectRatio="xMidYMid meet" />
    <image data-scene-object="after" href={images.image_2} x="100" y="110" width="800" height="440" preserveAspectRatio="xMidYMid meet" clip-path="url(#comparison-after)" />
    <g data-scene-object="comparison" opacity={reveal * marker}>
      <path d="M{100 + split} 100 V560" stroke={design.accent} stroke-width="4" />
      <circle cx={100 + split} cy="330" r="18" fill={design.accent} />
      <path d="M{93 + split} 330 H{107 + split}" stroke="#182125" stroke-width="3" />
    </g>
    <g fill="#eef2e8" font-size="38" font-weight="700">
      <text x="100" y="640">{design.before}</text>
      <text x="900" y="640" text-anchor="end" opacity={reveal}>{design.after}</text>
    </g>
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; }
</style>
