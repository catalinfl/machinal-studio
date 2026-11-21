import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { modelFixture, modelComponent } from './fixtures/model-fixture.mjs';
import { inspectEvidence } from './evidence.mjs';
import { compileComponent, renderComponent } from './render.mjs';
import { imageDataURL } from './image-fixture.mjs';

const config = {width:320,height:180,fps:10,durationInFrames:10,visualMode:'3d'};

test('textured embedded GLB waits for async setup and seeks backwards deterministically', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const input = {component:modelComponent,config,models:{model_1:modelFixture().source}};
    await compileComponent({...input,inspectLayout:true});
    const result = await inspectEvidence({...input,frames:[8,0,4]});
    assert.ok(result.frames.every(frame => frame.hasForeground));
    assert.notEqual(result.frames[0].data,result.frames[1].data);
    const repeat = await inspectEvidence({...input,frames:[8]});
    assert.equal(result.frames[0].data,repeat.frames[0].data);
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

test('unsupported external GLB resources fail before browser/provider work', async () => {
  const fixture = modelFixture(doc => {doc.buffers[0].uri = 'https://example.invalid/private.bin';});
  await assert.rejects(compileComponent({component:modelComponent,config,models:{model_1:fixture.source}}),/URI/);
});

test('approved PNG color maps finish decoding before async Three.js first-frame evidence', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const component = `<script>
import {SceneCanvas,SceneThree,loadSceneTexture} from '@direction/scene-svelte';
let {images = {}} = $props();
async function setup({THREE,world,camera,resources}) {
  const map = await loadSceneTexture(images.image_1,resources);
  const subject = new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map,transparent:true,side:THREE.DoubleSide}));
  world.add(subject);camera.position.set(0,0,4);
  return {update(frame) {subject.rotation.y = frame.time;}};
}
</script><SceneCanvas background="#142030"><SceneThree {setup}/></SceneCanvas>`;
    const result = await inspectEvidence({component,config,images:{image_1:imageDataURL},frames:[0,8]});
    assert.ok(result.frames.every(frame => frame.hasForeground));
    assert.notEqual(result.frames[0].data,result.frames[1].data);
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

test('semantic snapshots use registered frame state, not inferred DOM positions', async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    const component = `<script>
import {SceneCanvas,useScene} from '@direction/scene-svelte';
const scene = useScene();
const stateAt = frame => ({x:40+frame.time*80,y:60,opacity:1,color:'#ff9900'});
scene.objects.register('signal',stateAt);
const actor = $derived(stateAt(scene.frame));
</script><SceneCanvas background="#142030"><div data-scene-object="signal" style="position:absolute;left:{actor.x}px;top:{actor.y}px;width:30px;height:30px;background:{actor.color}"></div></SceneCanvas>`;
    const result = await inspectEvidence({component,config:{...config,visualMode:'2d'},frames:[8,0,4]});
    assert.deepEqual(result.frames.map(frame => frame.states.signal.x),[104,40,72]);
    assert.deepEqual(result.frames.map(frame => frame.objects[0].x),[104,40,72]);
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

test('native export contains loaded textured GLB on the first frame and omits embedded model bytes from manifest', {skip:!process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER,timeout:120000}, async () => {
  const result = await renderComponent({component:modelComponent,config,models:{model_1:modelFixture().source}},new AbortController().signal);
  assert.equal(result.manifest.frames,10);
  assert.equal(result.manifest.scene.props.models,undefined);
  const decoded = spawnSync(process.env.SCENE_FFMPEG || 'ffmpeg',['-v','error','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{input:result.video,windowsHide:true});
  assert.equal(decoded.status,0,decoded.stderr.toString());
  let redPixels = 0;
  for (let i = 0; i < decoded.stdout.length; i += 3) {
    const [r,g,b] = decoded.stdout.subarray(i,i+3);
    if (r > 50 && r > g*1.5 && r > b*1.5) redPixels++;
  }
  assert.ok(redPixels > 50,`model texture missing on first native frame: ${redPixels} red pixels`);
});
