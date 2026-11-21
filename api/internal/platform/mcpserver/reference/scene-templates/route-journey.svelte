<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  const scene = useScene();
  const design = { labels: ['Pornire', 'Legătură', 'Destinație'], accent: '#f3bd63', title: 'Un traseu schematic' };
  const points = [{ x: 160, y: 450 }, { x: 500, y: 250 }, { x: 840, y: 450 }];
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const travel = $derived(smooth((progress - 0.2) / 0.5) * 2);
  const segment = $derived(Math.min(1, Math.floor(travel)));
  const fraction = $derived(travel - segment);
  const position = $derived({ x: points[segment].x + (points[segment + 1].x - points[segment].x) * fraction, y: points[segment].y + (points[segment + 1].y - points[segment].y) * fraction });

  function smooth(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }
</script>

<SceneCanvas background="#eee8dc">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label="Schematic route between three supplied places, not a geographic map">
    <text x="90" y="120" fill="#243b3d" font-size="44" font-weight="700">{design.title}</text>
    <path d="M160 450 L500 250 L840 450" fill="none" stroke="#a6b4ad" stroke-width="5" stroke-dasharray="5 12" />
    <path d="M160 450 L500 250 L840 450" fill="none" stroke="#243b3d" stroke-width="7" pathLength="2" stroke-dasharray="2" stroke-dashoffset={2 - travel} />
    {#each points as point, index}
      <g data-scene-object={'stop-' + index} opacity={smooth((progress - index * 0.05) / 0.12)}>
        <circle cx={point.x} cy={point.y} r={travel >= index ? 18 : 11} fill={travel >= index ? design.accent : '#eee8dc'} stroke="#243b3d" stroke-width="4" />
        <text x={point.x} y={point.y + 64} fill="#243b3d" font-size="31" text-anchor="middle">{design.labels[index]}</text>
      </g>
    {/each}
    <g data-scene-object="traveler" transform="translate({position.x} {position.y})" opacity={smooth((progress - 0.16) / 0.06)}>
      <circle r="29" fill={design.accent} stroke="#243b3d" stroke-width="3" />
      <path d="M-8 0 H8 M2 -6 L8 0 L2 6" fill="none" stroke="#243b3d" stroke-width="3" />
    </g>
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; }
</style>
