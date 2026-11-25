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

test('rejects Remotion-style timing/canvas props, non-reactive useScene snapshots, timers, and reactive scenes without useScene', () => {
  for (const [source, expected] of [
    [`<script>let { frame = 0, fps = 30, durationInFrames = 180 } = $props(); const t = $derived(frame / fps);</script><div style="opacity:{t}">Hi</div>`, /does not pass `frame, fps, durationInFrames`/],
    [`<script lang="ts">let { frame = 0, width = 1080, height = 1920 } = $props<{ frame?: number }>();</script><div>{frame}</div>`, /does not pass `frame, width, height`/],
    [`<script>export let frame = 0; export let fps = 30;</script><div>{frame}</div>`, /does not pass `frame, fps`/],
    [`<script>const props = $props(); const t = $derived(props.frame / 30);</script><div>{t}</div>`, /does not pass `frame`/],
    [`<script>import { SceneCanvas, useScene } from '@direction/scene-svelte'; const { frame } = useScene(); const t = $derived(frame.time);</script><SceneCanvas>{t}</SceneCanvas>`, /Do not destructure `const \{ frame \} = useScene\(\)`/],
    [`<script>import { SceneCanvas, useScene } from '@direction/scene-svelte'; const scene = useScene(); const t = scene.frame.time;</script><SceneCanvas>{t}</SceneCanvas>`, /Non-reactive top-level read of `scene\.frame`/],
    [`<script>import { SceneCanvas, useScene } from '@direction/scene-svelte'; const scene = useScene(); const p = Math.min(1, scene.frame.time / 0.5);</script><SceneCanvas>{p}</SceneCanvas>`, /Non-reactive top-level read of `scene\.frame`/],
    [`<script>let x = $state(0); const op = $derived(x);</script><div style="opacity:{op}">Hi</div>`, /does not read frame time from `useScene\(\)` or `SceneThree`/],
    [`<script>import { progressAt } from '@direction/scene-runtime'; const p = progressAt(0, 0, 1);</script><div style="opacity:{p}">Hi</div>`, /does not read frame time from `useScene\(\)` or `SceneThree`/],
    [`<script>requestAnimationFrame(() => {});</script><div>Hi</div>`, /requestAnimationFrame\(\)` is non-deterministic/],
  ]) {
    assert.throws(() => validateSceneDesign(parse(source), '2d'), expected, source);
  }

  for (const valid of [
    `<script>import { SceneCanvas, useScene } from '@direction/scene-svelte'; let { images = {}, parameters = {} } = $props(); const scene = useScene(); const { width, height } = scene.frame.config; const t = $derived(scene.frame.time);</script><SceneCanvas><div style="width:{width}px;height:{height}px;opacity:{t}"><img src={images.image_1} alt="" /></div></SceneCanvas>`,
    `<script>import { SceneCanvas, useScene } from '@direction/scene-svelte'; const scene = useScene(); $effect(() => { const t = scene.frame.time; void t; });</script><SceneCanvas><div>ok</div></SceneCanvas>`,
    `<script>import { SceneCanvas } from '@direction/scene-svelte'; let { images = {} } = $props();</script><SceneCanvas><img src={images.image_1} alt="" /></SceneCanvas>`,
  ]) {
    assert.doesNotThrow(() => validateSceneDesign(parse(valid), '2d'), valid);
  }
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
