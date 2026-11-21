<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  const scene = useScene();
  const design = {
    title: 'Din rotație, mișcare',
    accent: '#f4d278',
    crankRadius: 68,
    turns: 2,
  };
  const rodLength = 190;
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const reveal = $derived(smooth(progress / 0.26));
  const drive = $derived(smooth((progress - 0.26) / 0.5));
  const angle = $derived(drive * Math.PI * 2 * design.turns);
  const crank = $derived({ x: 300 + Math.cos(angle) * design.crankRadius, y: 390 + Math.sin(angle) * design.crankRadius });
  const slider = $derived(crank.x + Math.sqrt(rodLength ** 2 - (crank.y - 390) ** 2));

  function smooth(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function flow(index) {
    const travel = ((drive * 2 + index / 4) % 1) * 380;
    return travel < 160 ? { x: 650 + travel, y: 390 } : { x: 810, y: 390 - (travel - 160) };
  }
</script>

<SceneCanvas background="#12344a">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label="Schematic crank turns a connecting rod and sliding piston; signal travels through the outlet">
    <defs><pattern id="blueprint-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 H0 V40" fill="none" stroke="#25536a" stroke-width="1" /></pattern></defs>
    <rect width="1000" height="700" fill="url(#blueprint-grid)" />
    <text x="90" y="126" fill="#e2f1ef" font-size="48" font-weight="700">{design.title}</text>
    <g fill="none" stroke="#d2e8e7" stroke-width="3" stroke-linejoin="round" pathLength="1">
      <path d="M160 490 H680 M300 280 V500 M190 390 H680" stroke="#467187" stroke-dasharray="8 9" />
      <circle cx="300" cy="390" r="96" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - reveal} />
      <path d="M430 338 H650 V442 H430 M650 390 H810 V170" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - reveal} />
    </g>
    <g opacity={smooth((progress - 0.15) / 0.15)}>
      <rect x={slider - 12} y="350" width="24" height="80" fill={design.accent} />
      <path d="M300 390 L{crank.x} {crank.y} L{slider} 390" fill="none" stroke={design.accent} stroke-width="9" stroke-linecap="round" />
      <circle cx="300" cy="390" r="12" fill="#e2f1ef" />
      <circle cx={crank.x} cy={crank.y} r="11" fill="#12344a" stroke="#e2f1ef" stroke-width="4" />
      <circle cx={slider} cy="390" r="7" fill="#12344a" />
    </g>
    {#each [0, 1, 2, 3] as index}
      {@const point = flow(index)}
      <circle cx={point.x} cy={point.y} r="5" fill={design.accent} opacity={smooth((progress - 0.32) / 0.12)} />
    {/each}
    <g fill="#d2e8e7" font-size="25">
      <text x="190" y="555">Manivelă</text><text x="450" y="555">Piston</text><text x="730" y="126">Ieșire</text>
    </g>
    <path d="M90 610 H910" stroke={design.accent} stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - smooth((progress - 0.8) / 0.12)} />
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; }
</style>
