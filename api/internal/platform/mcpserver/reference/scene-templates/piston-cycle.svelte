<script>
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  const scene = useScene();
  const design = { title: 'Pompare, în două faze', accent: '#6cd2e5', stroke: 125 };
  const progress = $derived(scene.frame.progress);
  const safeHeight = $derived(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0)));
  const intake = $derived(smooth((progress - 0.18) / 0.23));
  const discharge = $derived(smooth((progress - 0.49) / 0.23));
  const pistonY = $derived(295 + design.stroke * (intake - discharge));
  const intakeOpen = $derived(progress >= 0.18 && progress < 0.44);
  const outletOpen = $derived(progress >= 0.49 && progress < 0.75);
  const caption = $derived(progress < 0.46 ? 'Admisie' : 'Evacuare');

  function smooth(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }
</script>

<SceneCanvas background="#172a36">
  <svg width="100%" height={safeHeight} viewBox="0 0 1000 700" aria-label="Schematic piston pump with separate intake and outlet check valves">
    <text x="90" y="112" fill="#f1eee5" font-size="43" font-weight="700">{design.title}</text>
    <path d="M380 225 H620 V520 H380 Z M380 260 H170 V350 M620 260 H830 V350" fill="none" stroke="#b2c9d0" stroke-width="6" />
    <rect x="386" y="231" width="228" height={pistonY - 231} fill={design.accent} opacity="0.22" />
    <g data-scene-object="piston">
      <path d="M500 550 V{pistonY + 15}" stroke="#f1eee5" stroke-width="14" />
      <rect x="388" y={pistonY} width="224" height="23" rx="3" fill="#f1eee5" />
    </g>
    <g data-scene-object="intake-valve" transform="translate(300 260) rotate({intakeOpen ? -38 : 0})">
      <path d="M0 -23 V23" stroke={intakeOpen ? design.accent : '#e5b86e'} stroke-width="9" />
    </g>
    <g data-scene-object="outlet-valve" transform="translate(700 260) rotate({outletOpen ? -38 : 0})">
      <path d="M0 -23 V23" stroke={outletOpen ? design.accent : '#e5b86e'} stroke-width="9" />
    </g>
    {#each [0, 1, 2] as index}
      <circle cx={180 + ((intake * 1.8 + index / 3) % 1) * 190} cy="260" r="6" fill={design.accent} opacity={intakeOpen ? 1 : 0} />
      <circle cx={630 + ((discharge * 1.8 + index / 3) % 1) * 190} cy="260" r="6" fill={design.accent} opacity={outletOpen ? 1 : 0} />
    {/each}
    <g fill="#f1eee5" font-size="30">
      <text x="150" y="410">Intrare</text><text x="740" y="410">Ieșire</text>
      <text x="500" y="640" text-anchor="middle">{caption}</text>
    </g>
  </svg>
</SceneCanvas>

<style>
  svg { display: block; font-family: 'Direction Sans'; }
</style>
