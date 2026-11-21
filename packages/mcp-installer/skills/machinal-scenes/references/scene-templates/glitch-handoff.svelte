<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  const scene = useScene();
  const design = { before: 'Semnal primit', after: 'Conexiune stabilă', amount: 24, accent: '#79d5ce' };
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const pulse = $derived(Math.sin(clamp((progress - 0.32) / 0.3, 0, 1) * Math.PI) ** 2);
  const shift = $derived(design.amount * pulse * Math.sin(progress * Math.PI * 6));
  const incoming = $derived(progress >= 0.48);
</script>

<SceneCanvas background="#101c26">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label={incoming ? design.after : design.before}>
    <path d="M90 170 H910 M90 530 H910" stroke="#34505a" stroke-width="2" />
    <g transform="translate({shift} 0)">
      <text x="100" y="360" fill="#edf2ed" font-size="72" font-weight="700">{incoming ? design.after : design.before}</text>
      <rect x="100" y="405" width={incoming ? 800 : 300} height="5" fill={design.accent} />
    </g>
    {#each [0, 1, 2, 3, 4] as band}
      <rect x={90 + (band % 2 === 0 ? shift * 3 : -shift * 2)} y={220 + band * 51} width={180 + band * 120} height={4 + band * 2} fill={design.accent} opacity={pulse * 0.45} />
    {/each}
    <circle cx="900" cy="530" r={6 + pulse * 8} fill={design.accent} />
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; line-height: 1.15; }
</style>
