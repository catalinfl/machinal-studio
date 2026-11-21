<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp, easeOutCubic } from '@direction/scene-runtime';

  const scene = useScene();

  const design = {
    title: 'De la sursă la rezultat',
    labels: ['Sursă', 'Proces', 'Rezultat'],
    accent: '#b6dd80',
  };

  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const flow = $derived(clamp((progress - 0.22) / 0.48, 0, 1));

  function entrance(index, time) {
    return easeOutCubic(clamp((time - index * 0.045) / 0.13, 0, 1));
  }
</script>

<SceneCanvas background="#182521">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label={design.title}>
    <text x="100" y="140" fill="#f2f1e7" font-size="48" font-weight="700">{design.title}</text>
    <path d="M180 360 H820" stroke="#476151" stroke-width="4" />
    <path d="M180 360 H820" pathLength="1" stroke={design.accent} stroke-width="5" stroke-dasharray="1" stroke-dashoffset={1 - flow} />
    {#each design.labels as label, index}
      {@const enter = entrance(index, progress)}
      {@const active = flow >= index / 2}
      <g transform="translate({180 + index * 320} 360) scale({0.8 + enter * 0.2})" opacity={enter}>
        <circle r="78" fill="#243a2d" stroke={active ? design.accent : '#476151'} stroke-width="3" />
        <circle r="51" fill={active ? design.accent : '#476151'} opacity="0.18" />
        <text text-anchor="middle" y="12" fill="#f2f1e7" font-size="32">{index + 1}</text>
        <text text-anchor="middle" y="145" fill="#f2f1e7" font-size="34">{label}</text>
      </g>
    {/each}
    <circle cx={180 + flow * 640} cy="360" r="11" fill="#f3cb83" />
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; line-height: 1.2; }
</style>
