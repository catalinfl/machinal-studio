import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { compileComponent } from './render.mjs';

const config = { width: 640, height: 360, fps: 30, durationInFrames: 60 };

const diagram = `<script>
  import {useScene, SceneCanvas} from '@direction/scene-svelte';
  const scene = useScene();
  const x = $derived(140 + Math.min(1, scene.frame.time) * 160);
</script>
<SceneCanvas background="#101d2f">
  <svg width="640" height="360" viewBox="0 0 640 360">
    <path d="M140 210 H460" stroke="#70859e" stroke-width="6" />
    <circle cx={x} cy="210" r="38" fill="#ebc36b" />
    <circle cx="460" cy="210" r="38" fill="#75bfc3" />
  </svg>
  <div style="position:absolute;left:60px;top:40px;font-family:'Direction Sans';font-size:32px;line-height:1.3;color:white">A connected process</div>
</SceneCanvas>`;

const spatial = `<script>
  import {SceneCanvas, SceneThree} from '@direction/scene-svelte';
  function setup({THREE, world, camera}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({color: '#ebc36b'}));
    world.add(mesh);
    world.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 4, 5);
    world.add(light);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);
    return {update(frame) { mesh.rotation.y = frame.time * 0.4; }};
  }
</script>
<SceneCanvas background="#101d2f"><SceneThree {setup} width={640} height={360} /></SceneCanvas>`;

test('client-authored 2D and genuine 3D source pass the real compiler and browser layout checks', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    for (const [component, visualMode] of [[diagram, '2d'], [spatial, '3d']]) {
      const result = await compileComponent({ component, config: { ...config, visualMode }, inspectLayout: true });
      assert.equal(typeof result.javascript, 'string');
      assert.ok(result.javascript.length > 100);
      assert.equal(result.video, undefined, 'compilation must not encode a video');
    }
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

test('client source cannot import server files or replace required genuine Three.js with flat artwork', async () => {
  await assert.rejects(compileComponent({ component: '<script>import fs from "node:fs";</script><p>Blocked</p>', config }), /Unsupported scene import/);
  await assert.rejects(compileComponent({ component: diagram, config: { ...config, visualMode: '3d' } }), /requires an imported and rendered SceneThree/);
});
