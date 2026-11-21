export const overlayComponent = `<script>
import { useScene, SceneCanvas } from '@direction/scene-svelte';
const scene = useScene();
const x = $derived(scene.frame.time * 20);
</script>
<SceneCanvas background="#ffffff">
  <svg width="320" height="180" viewBox="0 0 320 180" aria-label="Animated arrow">
    <g transform="translate({x} 0)">
      <path d="M30 90 H150 M120 60 L150 90 L120 120" fill="none" stroke="#ff0000" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="240" cy="40" r="15" fill="#ff0000" opacity="0.5" />
    </g>
  </svg>
</SceneCanvas>`;

export const overlayConfig = { width: 320, height: 180, fps: 30, durationInFrames: 60, transparent: true };
