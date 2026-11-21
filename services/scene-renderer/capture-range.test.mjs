import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureConfig, renderComponent } from './render.mjs';

test('capture windows retain full authored config and reject invalid frames', () => {
  const config = { width: 320, height: 180, fps: 10, durationInFrames: 30 };
  const original = structuredClone(config);
  assert.deepEqual(captureConfig(config, { startFrame: 10, endFrame: 15 }), { ...config, durationInFrames: 5 });
  assert.deepEqual(config, original);
  for (const range of [null, {}, { startFrame: -1, endFrame: 2 }, { startFrame: 5, endFrame: 5 }, { startFrame: 0, endFrame: 31 }, { startFrame: 0.5, endFrame: 2 }]) {
    assert.throws(() => captureConfig(config, range), /capture frame range/);
  }
});

test('native partial captures match original absolute frames, progress and configuration', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER, timeout: 120000 }, async t => {
  const input = {
    component: `<script>import {SceneCanvas,useScene} from '@machinal/scenes';const scene=useScene();const x=$derived(scene.frame.frame*10);const width=$derived(scene.frame.progress*200);</script><SceneCanvas background="#102030"><div style:left="{x}px" style:width="{width}px" style="position:absolute;top:40px;height:70px;background:#ff5522"></div></SceneCanvas>`,
    config: { width: 320, height: 180, fps: 10, durationInFrames: 20 },
  };
  const results = [];
  t.after(async () => Promise.all(results.map(result => result.dispose())));
  const whole = await renderComponent(input, new AbortController().signal);
  results.push(whole);
  const partial = await renderComponent({ ...input, range: { startFrame: 8, endFrame: 12 } }, new AbortController().signal);
  results.push(partial);
  assert.equal(partial.manifest.frames, 4);
  assert.equal(partial.manifest.scene.props.__capture, undefined);
  const execute = promisify(execFile);
  const digest = async (file, filter) => (await execute(process.env.SCENE_FFMPEG || 'ffmpeg', ['-v', 'error', '-i', file, '-vf', filter, '-pix_fmt', 'rgb24', '-f', 'hash', '-hash', 'sha256', '-'], { windowsHide: true })).stdout;
  assert.equal(await digest(partial.path, 'setpts=PTS-STARTPTS'), await digest(whole.path, 'trim=start_frame=8:end_frame=12,setpts=PTS-STARTPTS'));
});
