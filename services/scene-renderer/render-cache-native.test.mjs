import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderComponent } from './render.mjs';

test('native scene cache reuses exact video and invalidates edited artwork', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER, timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'scene-cache-native-'));
  const previous = process.env.SCENE_CACHE_DIR;
  const results = [];
  process.env.SCENE_CACHE_DIR = root;
  t.after(async () => {
    await Promise.all(results.map(result => result.dispose()));
    if (previous === undefined) delete process.env.SCENE_CACHE_DIR;
    else process.env.SCENE_CACHE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const input = { component: '<script>import {SceneCanvas} from "@direction/scene-svelte";</script><SceneCanvas background="#2266cc"><p>Cache integrity</p></SceneCanvas>', config: { width: 320, height: 180, fps: 5, durationInFrames: 2 } };
  const first = await renderComponent(input, new AbortController().signal);
  results.push(first);
  const second = await renderComponent(input, new AbortController().signal);
  results.push(second);
  assert.equal(second.manifest.sha256, first.manifest.sha256);
  assert.equal(second.manifest.elapsedNanoseconds, first.manifest.elapsedNanoseconds, 'cache hit must not invoke another native render');
  const edited = await renderComponent({ ...input, component: input.component.replace('#2266cc', '#cc6622') }, new AbortController().signal);
  results.push(edited);
  assert.notEqual(edited.manifest.sha256, first.manifest.sha256);
});
