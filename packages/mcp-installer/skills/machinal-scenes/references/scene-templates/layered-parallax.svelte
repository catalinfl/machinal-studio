<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp, easeOutCubic } from '@direction/scene-runtime';

  let { images = {} } = $props();
  const scene = useScene();
  const design = { depth: 38, label: 'Planuri în mișcare', accent: '#b1d8cb' };
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const camera = $derived(easeOutCubic(clamp((progress - 0.1) / 0.62, 0, 1)));
  const enter = $derived(easeOutCubic(clamp(progress / 0.2, 0, 1)));
  const travel = $derived((camera - 0.5) * design.depth);
</script>

<SceneCanvas background="#10232b">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label={design.label}>
    <svg x="80" y="70" width="840" height="500" viewBox="0 0 840 500">
      <image href={images.image_1} x={-60 - travel * 0.3} y="-25" width="960" height="550" preserveAspectRatio="xMidYMid slice" />
      <path d="M60 400 Q420 80 780 400" fill="none" stroke={design.accent} stroke-width="2" opacity="0.45" />
      <image href={images.image_2} x={60 + travel} y={35 + (1 - enter) * 40} width="720" height="440" preserveAspectRatio="xMidYMid meet" opacity={enter} />
      <circle cx={110 + 620 * camera} cy={370 - 140 * Math.sin(camera * Math.PI)} r="7" fill={design.accent} />
      <circle cx={730 - 620 * camera} cy={430 + 25 * Math.sin(camera * Math.PI)} r="4" fill="#f1c983" />
    </svg>
    <path d="M80 600 H920" stroke={design.accent} stroke-width="2" />
    <text x="80" y="655" fill="#eef3ea" font-size="38">{design.label}</text>
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; line-height: 1.2; }
</style>
