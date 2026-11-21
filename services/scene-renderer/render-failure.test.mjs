import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderComponent } from './render.mjs';

test('failed native startup logs correlated resource evidence and preserves the original error', async () => {
  const previous = { binary: process.env.SCENE_RENDER_BIN, cache: process.env.SCENE_CACHE_MAX_BYTES, info: console.info, error: console.error };
  const failures = [];
  process.env.SCENE_RENDER_BIN = join(tmpdir(), `missing-scene-render-${randomUUID()}`);
  process.env.SCENE_CACHE_MAX_BYTES = '0';
  console.info = () => {};
  console.error = (event, json) => failures.push({ event, data: JSON.parse(json) });
  try {
    const input = { component: '<div>fixture</div>', config: { width: 320, height: 180, fps: 10, durationInFrames: 1 } };
    await assert.rejects(renderComponent(input, new AbortController().signal, { requestId: 'test-job' }), { code: 'ENOENT' });
    assert.equal(failures.length, 1);
    const { event, data } = failures[0];
    assert.equal(event, 'scene_render_failed');
    assert.equal(data.requestId, 'test-job');
    assert.match(data.renderId, /^[a-f0-9-]{36}$/);
    assert.ok(data.elapsedMs >= 0);
    assert.ok(Object.hasOwn(data.resourcesBefore, 'pids.events'));
    assert.ok(Object.hasOwn(data.resourcesAfter, 'memory.events'));
    assert.ok(!JSON.stringify(data).includes('fixture'));
  } finally {
    if (previous.binary === undefined) delete process.env.SCENE_RENDER_BIN;
    else process.env.SCENE_RENDER_BIN = previous.binary;
    if (previous.cache === undefined) delete process.env.SCENE_CACHE_MAX_BYTES;
    else process.env.SCENE_CACHE_MAX_BYTES = previous.cache;
    console.info = previous.info;
    console.error = previous.error;
  }
});
