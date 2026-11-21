import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'svelte/compiler';
import { validateSceneDesign } from './contract.mjs';
import { embeddedSceneFonts, selectedSceneFonts } from './fonts.mjs';
import { readFile } from 'node:fs/promises';
import { compileComponent } from './render.mjs';
import { imageDataURL } from './image-fixture.mjs';
import { modelFixture } from './fixtures/model-fixture.mjs';

test('explicit 3D rejects SVG substitutes and unused imports, but accepts an imported alias', () => {
  for (const source of [
    '<svg><circle r="40" /></svg>',
    '<script>import {SceneThree} from "@direction/scene-svelte";</script><div>SceneThree</div>',
  ]) assert.throws(() => validateSceneDesign(parse(source), '3d'), /imported and rendered SceneThree/);
  const source = '<script>import {SceneThree as World} from "@direction/scene-svelte"; const setup = () => ({update(){}});</script><World {setup} />';
  assert.doesNotThrow(() => validateSceneDesign(parse(source), '3d'));
  assert.doesNotThrow(() => validateSceneDesign(parse('<p>2D</p>'), '2d'));
});

test('scene fonts embed every documented family and extended Latin glyph ranges', async () => {
  const css = await embeddedSceneFonts();
  for (const family of ['Direction Sans', 'Direction Serif', 'Direction Mono', 'Montserrat', 'Open Sans', 'Oswald', 'Playfair Display', 'IBM Plex Sans', 'Lato']) {
    assert.ok(css.includes(`font-family:'${family}'`), `missing ${family}`);
  }
  assert.match(css, /data:font\/woff2;base64,/);
  assert.match(css, /font-style: italic/);
});

test('font selection preserves requested families and aliases without bloating geometry-only scenes', () => {
  const selected = source => selectedSceneFonts(source).map(([, family]) => family);
  assert.deepEqual(selected('<SceneThree {setup} />'), ['Direction Sans']);
  assert.deepEqual(selected('font-family:Montserrat,sans-serif'), ['Direction Sans', 'Montserrat']);
  assert.deepEqual(selected('font-family:Georgia,serif'), ['Direction Sans', 'Direction Serif']);
  assert.deepEqual(selected('font-family:Consolas,monospace'), ['Direction Sans', 'Direction Mono']);
});

test('the exact image, procedural Three.js and approved-model starters compile against the real engine', async () => {
  const guide = await readFile(new URL('../../api/editengine/scenecontract/runtime.md', import.meta.url), 'utf8');
  const examples = [...guide.matchAll(/```svelte\n([\s\S]*?)\n```/g)].map(match => match[1]);
  assert.equal(examples.length, 3);
  for (const component of examples) {
    const result = await compileComponent({ component, images: { image_1: imageDataURL }, models: { model_1: modelFixture().source }, config: {width: 600, height: 400, fps: 30, durationInFrames: 90, visualMode: component.includes('<SceneThree') ? '3d' : '2d'} });
    assert.ok(result.javascript.length > 0);
    assert.ok(Buffer.byteLength(result.javascript) <= 2 * 1024 * 1024, 'runtime starter exceeds the preview transport limit');
  }
});
