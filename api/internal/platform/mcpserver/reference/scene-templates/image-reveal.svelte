<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp, easeOutCubic } from '@direction/scene-runtime';

  let { images = {} } = $props();
  const scene = useScene();
  const design = { label: 'O nouă perspectivă', accent: '#e3bb72', push: 0.045 };
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const opening = $derived(easeOutCubic(clamp(progress / 0.3, 0, 1)));
  const focus = $derived(easeOutCubic(clamp((progress - 0.15) / 0.47, 0, 1)));
  const scale = $derived(1 + design.push * focus);
  const line = $derived(1 - clamp((progress - 0.92) / 0.08, 0, 1));
</script>

<SceneCanvas background="#151c24">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label={design.label}>
    <svg x="120" y="80" width="760" height="470" viewBox="0 0 760 470">
      <g transform="translate(380 235) scale({scale}) translate(-380 -235)">
        <image href={images.image_1} width="760" height="470" preserveAspectRatio="xMidYMid meet" />
      </g>
      <rect width={380 * (1 - opening)} height="470" fill="#151c24" />
      <rect x={760 - 380 * (1 - opening)} width={380 * (1 - opening)} height="470" fill="#151c24" />
    </svg>
    <rect x={110 - 14 * focus} y={70 - 14 * focus} width={780 + 28 * focus} height={490 + 28 * focus} fill="none" stroke={design.accent} stroke-width="2" opacity={opening} />
    <path d="M100 610 H900" pathLength="1" stroke={design.accent} stroke-width="3" stroke-dasharray="1" stroke-dashoffset={1 - line} />
    <text x="120" y="660" fill="#eee9df" font-size="36" opacity={focus}>{design.label}</text>
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; line-height: 1.2; }
</style>
