import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { renderComponent } from './render.mjs';
import { threeComponent, videoComponent, colorVideoSource } from './multimedia-fixture.mjs';

const native = { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER, timeout:120000 };
const config = {width:320,height:180,fps:10,durationInFrames:10};

function pixel(video, frame, x, y) {
  const result = spawnSync(process.env.SCENE_FFMPEG || 'ffmpeg', ['-v','error','-i','pipe:0','-vf',`select=eq(n\\,${frame}),crop=2:2:${x}:${y},format=rgb24`,'-frames:v','1','-f','rawvideo','pipe:1'], {input:video,windowsHide:true});
  assert.equal(result.status,0,result.stderr.toString());
  assert.ok(result.stdout.length >= 3,'exported frame must exist');
  return [...result.stdout.subarray(0,3)];
}

test('native MP4 contains sought Three.js geometry', native, async () => {
  const output = await renderComponent({component:threeComponent,config},new AbortController().signal);
  assert.equal(output.manifest.frames,10);
  const center = pixel(output.video,7,160,90);
  assert.ok(center[0] > 140 && center[1] < 120 && center[2] > 80,`3D mesh missing from export: ${center}`);
  const corner = pixel(output.video,7,10,10);
  assert.ok(corner.every(channel => channel > 240),`opaque scene background missing: ${corner}`);
});

test('native video export retains source timing, grayscale treatment and contain geometry', native, async () => {
  const output = await renderComponent({component:videoComponent,config,videos:{video_1:colorVideoSource()}},new AbortController().signal);
  assert.equal(output.manifest.scene.props.videos,undefined,'HTTP manifest must not contain embedded footage');
  const early = pixel(output.video,1,80,90);
  const later = pixel(output.video,7,80,90);
  assert.ok(early[0] > later[0] + 30,`export did not seek red then blue footage: ${early}, ${later}`);
  assert.ok(later.every(channel => Math.abs(channel - later[0]) < 3),`noir treatment missing: ${later}`);
  assert.ok(pixel(output.video,7,80,10).every(channel => channel > 240),'contain must preserve letterbox');
});

test('native image frames reuse settled images but await changed sources', native, async () => {
  const svg = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`)}`;
  const component = `<script>import {useScene,SceneCanvas} from '@direction/scene-svelte';const scene=useScene();const red=${JSON.stringify(svg('red'))};const blue=${JSON.stringify(svg('blue'))};</script>
    <SceneCanvas><img alt="fixture" src={scene.frame.frame < 5 ? red : blue} width="320" height="180" /></SceneCanvas>`;
  const output = await renderComponent({ component, config }, new AbortController().signal);
  const early = pixel(output.video, 1, 160, 90);
  const later = pixel(output.video, 7, 160, 90);
  assert.ok(early[0] > 240 && early[2] < 10, `initial image missing: ${early}`);
  assert.ok(later[2] > 240 && later[0] < 10, `changed image missing: ${later}`);
});
