import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { evidenceFrames, inspectEvidence } from './evidence.mjs';

const config = { width: 960, height: 540, fps: 30, durationInFrames: 60 };
const component = `<script>
  import {SceneCanvas, useScene} from '@direction/scene-svelte';
  import {createChoreography, easing} from '@direction/scene-runtime';
  const scene = useScene();
  const cues = createChoreography([{id:'engage', start:0, duration:1}]);
  const x = $derived(100 + 300*cues.at('engage', scene.frame.time, easing.smooth).progress);
</script>
<SceneCanvas background="#102030">
  <div data-scene-object="signal" style="position:absolute;left:{x}px;top:180px;width:100px;height:100px;background:#f8c94e"></div>
  <h1 style="position:absolute;left:80px;top:40px;font-size:40px;color:white">Signal transfer</h1>
</SceneCanvas>`;

test('evidence rejects unbounded, duplicate and out-of-scene requests before Chromium', () => {
  for (const frames of [[], [0, 0], [-1], [60], [1.5], [0, 1, 2, 3, 4, 5, 6]]) assert.throws(() => evidenceFrames({ component, config, frames }));
  assert.deepEqual(evidenceFrames({ component, config, frames: [45, 0, 15] }), [45, 0, 15]);
});

test('real sampled thumbnails retain authored viewport, timing, object bounds and out-of-order determinism', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const result = await inspectEvidence({ component, config, frames: [45, 0, 15] });
    assert.equal(result.frames.length, 3);
    assert.equal(result.motionVerified, false);
    assert.equal(result.audioVerified, false);
    assert.match(result.environment.bundleVersion, /^sha256:[a-f0-9]{64}$/);
    assert.equal(typeof result.environment.browserVersion, 'string');
    const [end, start, middle] = result.frames;
    for (const sample of result.frames) {
      assert.equal(sample.width, 480);
      assert.equal(sample.height, 270);
      assert.equal(sample.mimeType, 'image/jpeg');
      assert.equal(Buffer.from(sample.data, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
      assert.equal(sample.issues.length, 0);
      assert.equal(sample.objects[0].id, 'signal');
      assert.equal(sample.objects[0].width, 100);
    }
    assert.equal(start.objects[0].x, 100);
    assert.equal(end.objects[0].x, 400);
    assert.equal(middle.objects[0].x, 250);
    assert.equal(middle.time, 0.5);
    const again = await inspectEvidence({ component, config, frames: [15] });
    assert.equal(again.frames[0].data, middle.data);
    assert.notEqual(start.data, end.data);
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

test('cancelled evidence never launches a browser or encodes video', async () => {
  await assert.rejects(inspectEvidence({ component, config, frames: [0] }, AbortSignal.abort(new Error('cancelled'))), /cancelled/);
});

test('inspected parameters use the same explicit object overrides as preview and rendering', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const component = `<script>import {SceneCanvas} from '@direction/scene-svelte'; import {resolveSceneObject} from '@direction/scene-runtime'; let {parameters = {}} = $props(); const actor = $derived(resolveSceneObject(parameters,'receiver',{x:10,y:40}));</script><SceneCanvas background="#102030"><div data-scene-object="receiver" style="position:absolute;left:{actor.x}px;top:{actor.y}px;width:40px;height:40px;background:{actor.color}"></div></SceneCanvas>`;
    const result = await inspectEvidence({component,config,parameters:{receiver:{x:220,y:140,color:'#ff9900'}},frames:[15]});
    assert.equal(result.frames[0].objects[0].x,220);
    assert.equal(result.frames[0].objects[0].y,140);
    await assert.rejects(inspectEvidence({component,config,parameters:{receiver:{opacity:4}},frames:[15]}),/parameter/);
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

test('a subject-specific Three.js fixture uses shared choreography, lighting and an absolute camera rig', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const component = await readFile(new URL('./fixtures/coupling.svelte', import.meta.url), 'utf8');
    const result = await inspectEvidence({ component, config: { width: 1280, height: 720, fps: 30, durationInFrames: 360, visualMode: '3d' }, frames: [30, 150, 300] });
    assert.equal(result.frames.length, 3);
    assert.ok(result.frames.every(frame => frame.hasForeground && frame.issues.length === 0));
    assert.notEqual(result.frames[0].data, result.frames[1].data);
    assert.equal(result.frames[0].objects[0].id, 'coupling');
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});
