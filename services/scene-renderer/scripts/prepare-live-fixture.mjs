import { mkdir, writeFile } from 'node:fs/promises';
import { compileComponent } from '../render.mjs';
import { imageComponent, imageDataURL } from '../image-fixture.mjs';

await mkdir(new URL('../out/', import.meta.url), { recursive: true });

const component = `<script>
import {useScene, SceneCanvas} from '@direction/scene-svelte';
const scene = useScene();
const x = $derived(scene.frame.time * 80);
</script>
<SceneCanvas background="#faf9f6"><h1 style="color:#6245a5;transform:translateX({x}px)">A growing idea</h1><svg width="320" height="70"><circle cx={40+x} cy="32" r="20" fill="#6245a5" /></svg></SceneCanvas>`;
const config = { width:320, height:180, fps:10, durationInFrames:10 };
const { javascript } = await compileComponent({ component, config });
await writeFile(new URL('../out/live-scene-fixture.json',import.meta.url),JSON.stringify({ version:1,component,javascript,config }));
console.log('Prepared live scene fixture without rendering video');

const canvasComponent = `<script>
import {useScene, SceneCanvas} from '@direction/scene-svelte';
const scene = useScene();
let canvas = $state();
$effect(() => {
  const time = scene.frame.time;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#faf9f6'; ctx.fillRect(0,0,320,120);
  ctx.fillStyle = '#6245a5'; ctx.fillRect(20+time*100,20,60,60);
});
</script>
<SceneCanvas background="#faf9f6"><h1>A growing idea</h1><canvas width="320" height="120" bind:this={canvas}></canvas></SceneCanvas>`;
const canvasBundle = await compileComponent({ component:canvasComponent,config });
await writeFile(new URL('../out/live-canvas-fixture.json',import.meta.url),JSON.stringify({version:1,component:canvasComponent,javascript:canvasBundle.javascript,config}));

const imageBundle = await compileComponent({ component:imageComponent,config });
await writeFile(new URL('../out/live-image-fixture.json',import.meta.url),JSON.stringify({version:1,component:imageComponent,javascript:imageBundle.javascript,config,images:{image_1:imageDataURL}}));
