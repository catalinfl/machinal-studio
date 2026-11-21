import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { compileComponent } from './render.mjs';
import { rendererExecutable } from './renderer.mjs';

test('the service installs the versioned registry library, not a local workspace', async () => {
  const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('./package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies['@machinal/scenes'], '0.1.1');
  assert.deepEqual(Object.keys(manifest.dependencies).filter(name => name.startsWith('@direction/')), []);
  assert.match(lock.packages['node_modules/@machinal/scenes'].resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.ok(lock.packages['node_modules/@machinal/scenes'].integrity);
  const renderer = await rendererExecutable({});
  assert.ok(renderer.startsWith(fileURLToPath(new URL('./node_modules/@machinal/scenes/', import.meta.url))));
  assert.equal(await rendererExecutable({ SCENE_RENDER_BIN: 'custom-renderer' }), 'custom-renderer');
});

for (const library of ['@machinal/scenes', '@machinal/scenes/svelte', '@direction/scene-svelte']) {
  test(`saved and new scenes compile through ${library}`, async () => {
    const component = `<script>import { SceneCanvas, useScene } from '${library}'; const scene = useScene();</script><SceneCanvas><h1>{scene.frame.frame}</h1></SceneCanvas>`;
    const result = await compileComponent({ component, config: { width: 320, height: 180, fps: 10, durationInFrames: 10 } });
    assert.match(result.javascript, /live-scene:command/);
    assert.doesNotMatch(result.javascript, /from\s+["']/);
  });
}

test('legacy aliases use the service dependency even when called from the client directory', async () => {
  const input = {
    component: `<script>import { SceneCanvas, useScene } from '@direction/scene-svelte'; import { clamp } from '@direction/scene-runtime'; const scene = useScene();</script><SceneCanvas><h1>{clamp(scene.frame.frame)}</h1></SceneCanvas>`,
    config: { width: 320, height: 180, fps: 10, durationInFrames: 10 },
  };
  const expected = await compileComponent(input);
  const script = `import { compileComponent } from ${JSON.stringify(new URL('./render.mjs', import.meta.url).href)}; process.stdout.write(JSON.stringify(await compileComponent(${JSON.stringify(input)})));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../../client/', import.meta.url)),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const runtimeCopies = javascript => (javascript.match(/https:\/\/svelte\.dev\/e\/lifecycle_outside_component/g) ?? []).length;
  assert.ok(runtimeCopies(expected.javascript) > 0);
  assert.equal(runtimeCopies(JSON.parse(result.stdout).javascript), runtimeCopies(expected.javascript), 'Changing the caller directory must not bundle a second Svelte runtime.');
});

test('public library imports support the genuine Three.js contract', async () => {
  for (const library of ['@machinal/scenes', '@machinal/scenes/svelte']) {
    const component = `<script>import { SceneCanvas, SceneThree } from '${library}'; function setup({THREE, world, camera}) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()); world.add(mesh); camera.position.z = 4; return {update(frame) {mesh.rotation.y = frame.time;}}; }</script><SceneCanvas><SceneThree {setup} /></SceneCanvas>`;
    const result = await compileComponent({ component, config: { width: 320, height: 180, fps: 10, durationInFrames: 10, visualMode: '3d' } });
    assert.match(result.javascript, /live-scene:command/);
    await assert.rejects(compileComponent({
      component: `<script>import { SceneCanvas } from '${library}';</script><SceneCanvas><p>Flat artwork</p></SceneCanvas>`,
      config: { width: 320, height: 180, fps: 10, durationInFrames: 10, visualMode: '3d' },
    }), /requires an imported and rendered SceneThree/);
  }
});

test('generated scenes cannot import the library Node API or private paths', async () => {
  for (const library of ['@machinal/scenes/node', '@machinal/scenes/node/toolchain.mjs']) {
    await assert.rejects(compileComponent({
      component: `<script>import * as tools from '${library}';</script><p>{Object.keys(tools)}</p>`,
      config: { width: 320, height: 180, fps: 10, durationInFrames: 10 },
    }), /Unsupported scene import/);
  }
});
