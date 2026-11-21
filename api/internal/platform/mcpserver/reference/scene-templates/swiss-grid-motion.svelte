<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  const scene = useScene();
  const design = {
    title: 'Ritmul formei',
    accent: '#e74423',
    paper: '#eeece5',
    displacement: 68,
  };
  const modules = [
    { x: 120, y: 240, width: 440 },
    { x: 340, y: 310, width: 440 },
    { x: 120, y: 380, width: 220 },
    { x: 560, y: 380, width: 220 },
    { x: 340, y: 450, width: 440 },
  ];
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const exception = $derived(snap((progress - 0.45) / 0.23));

  function snap(value) {
    const t = clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
</script>

<SceneCanvas background={design.paper}>
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label="Grid modules assemble; one signal tile breaks the alignment">
    <defs>
      <clipPath id="swiss-title"><rect x="100" y="75" width="800" height="100" /></clipPath>
    </defs>
    <g stroke="#d2d0c9" stroke-width="1">
      {#each [120, 230, 340, 450, 560, 670, 780] as x}<path d="M{x} 212 V545" />{/each}
      {#each [240, 310, 380, 450, 520] as y}<path d="M100 {y} H900" />{/each}
    </g>
    <g clip-path="url(#swiss-title)">
      <text x="100" y={145 + 100 * (1 - snap(progress / 0.18))} fill="#141414" font-size="60" font-weight="700">{design.title}</text>
    </g>
    {#each modules as module, index}
      {@const arrival = snap((progress - 0.08 - index * 0.045) / 0.18)}
      <rect x={module.x} y={module.y} width={module.width * arrival} height="48" fill="#141414" />
    {/each}
    <rect x={120 + design.displacement * exception} y={450 - design.displacement * exception} width={110 * snap((progress - 0.3) / 0.12)} height="48" fill={design.accent} />
    <path d="M100 586 H900" stroke="#141414" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - snap((progress - 0.16) / 0.3)} />
    <text x="100" y="635" fill="#42423d" font-size="24">Cadru / contrast / o singură excepție</text>
    <rect x="100" y="665" width={800 * snap((progress - 0.9) / 0.1)} height="6" fill={design.accent} />
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; }
</style>
