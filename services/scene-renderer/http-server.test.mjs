import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSceneServer } from './http-server.mjs';
import { SceneInfrastructureError } from './diagnostics.mjs';

async function fixture(t, render = async () => ({ manifest: {}, video: Buffer.from('video') }), ready) {
  const failures = [];
  const server = createSceneServer({ token: 'test-token', render, ready, compile: async () => ({ javascript: 'compiled' }), text: async () => ({ prepared: true }), reportError: (error, context) => failures.push({ error, context }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = '{}') => fetch(origin + path, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body });
  return { server, origin, post, failures };
}

test('requires a private-service token and rejects unauthenticated requests', async t => {
  assert.throws(() => createSceneServer({ token: '' }), /TOKEN is required/);
  const { origin } = await fixture(t);
  assert.equal((await fetch(origin + '/health')).status, 401);
  assert.equal((await fetch(origin + '/health', { headers: { Authorization: 'Bearer test-token' } })).status, 200);
});

test('native infrastructure failure blocks health and encoding with actionable diagnostics', async t => {
  let renders = 0;
  const { origin, post } = await fixture(t, async () => { renders++; }, async () => {
    throw new SceneInfrastructureError('scene_renderer_permission_denied', 'Native renderer EACCES. Rebuild the scene-renderer image.');
  });
  const health = await fetch(origin + '/health', { headers: { Authorization: 'Bearer test-token' } });
  assert.equal(health.status, 503);
  assert.equal(health.headers.get('X-Scene-Error-Code'), 'scene_renderer_permission_denied');
  assert.match(await health.text(), /EACCES/);
  const rendered = await post('/render');
  assert.equal(rendered.status, 503);
  assert.equal(rendered.headers.get('X-Scene-Error-Code'), 'scene_renderer_permission_denied');
  assert.match(await rendered.text(), /Rebuild/);
  assert.equal(renders, 0);
  assert.equal((await post('/compile')).status, 200);
});

test('long operations have a bounded request deadline without an idle response timeout', async t => {
  const { server } = await fixture(t);
  assert.equal(server.requestTimeout, 30 * 60 * 1000);
  assert.equal(server.timeout, 0);
});

test('render diagnostics correlate with the API job without logging arbitrary header content', async t => {
  const contexts = [];
  const { origin } = await fixture(t, async (_, __, context) => {
    contexts.push(context);
    return { manifest: {}, video: Buffer.from('video') };
  });
  const send = id => fetch(origin + '/render', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'X-Scene-Request-Id': id }, body: '{}' });
  const jobId = 'a'.repeat(32);
  const response = await send(jobId);
  assert.equal(response.headers.get('X-Scene-Request-Id'), jobId);
  assert.equal(contexts[0].requestId, jobId);
  const untrusted = await send('private-arbitrary-header');
  assert.match(untrusted.headers.get('X-Scene-Request-Id'), /^[a-f0-9-]{36}$/);
  assert.notEqual(contexts[1].requestId, 'private-arbitrary-header');
});

test('a second render waits instead of failing busy, while compilation stays available', async t => {
  const started = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  let renders = 0;
  const { post } = await fixture(t, async () => {
    if (++renders === 1) { started.resolve(); await unblock.promise; }
    return { manifest: {}, video: Buffer.from('video') };
  });
  const first = post('/render');
  await started.promise;
  const second = post('/render');
  const compilation = await post('/compile');
  assert.equal(compilation.status, 200);
  assert.equal(renders, 1);
  unblock.resolve();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal(renders, 2);
});

test('frame progress is authenticated, invocation-scoped, bounded and discarded after completion', async t => {
  const started = Promise.withResolvers();
  const unblock = Promise.withResolvers();
  const { origin } = await fixture(t, async (_, __, { onProgress }) => {
    onProgress({ stage: 'capture', writtenFrames: 15, totalFrames: 60, elapsedMs: 1000, source: 'private source must not escape' });
    onProgress({ stage: 'capture', writtenFrames: 100, totalFrames: 60, elapsedMs: 1000 });
    started.resolve();
    await unblock.promise;
    return { manifest: {}, video: Buffer.from('video') };
  });
  t.after(() => unblock.resolve());
  const id = 'b'.repeat(32);
  const rendering = fetch(origin + '/render', { method: 'POST', headers: { Authorization: 'Bearer test-token', 'X-Scene-Progress-Id': id }, body: '{}' });
  await started.promise;
  const url = origin + '/render-progress/' + id;
  assert.equal((await fetch(url)).status, 401);
  const headers = { Authorization: 'Bearer test-token' };
  const progress = await fetch(url, { headers });
  assert.equal(progress.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await progress.json(), { stage: 'capture', writtenFrames: 15, totalFrames: 60, elapsedMs: 1000 });
  assert.equal((await fetch(origin + '/render-progress/' + 'c'.repeat(32), { headers })).status, 404);
  unblock.resolve();
  const response = await rendering;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'video');
  assert.equal((await fetch(url, { headers })).status, 404);
});

test('invalid JSON is a client error and internal stderr is never exposed', async t => {
  const { post, failures } = await fixture(t, async () => { throw Object.assign(new Error('private /tmp/path'), { stderr: 'private secret' }); });
  assert.equal((await post('/compile', '{')).status, 400);
  const failure = await post('/render');
  assert.equal(failure.status, 422);
  assert.doesNotMatch(await failure.text(), /private|secret|\/tmp/);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error.stderr, 'private secret');
  assert.equal(failures[0].context.route, '/render');
  assert.equal(failures[0].context.aborted, false);
});

for (const stage of ['cache-miss', 'cache-disabled', 'cache-hit']) {
  test(`cache progress distinguishes ${stage} without exposing source data`, async t => {
    const started = Promise.withResolvers();
    const unblock = Promise.withResolvers();
    const { origin } = await fixture(t, async (_, __, { onProgress }) => {
      onProgress({ stage, totalFrames: 60, private: 'must not escape' });
      started.resolve();
      await unblock.promise;
      return { manifest: {}, video: Buffer.from('video') };
    });
    t.after(() => unblock.resolve());
    const id = 'd'.repeat(32);
    const headers = { Authorization: 'Bearer test-token' };
    const rendering = fetch(origin + '/render', { method: 'POST', headers: { ...headers, 'X-Scene-Progress-Id': id }, body: '{}' });
    await started.promise;
    const response = await fetch(origin + '/render-progress/' + id, { headers });
    assert.deepEqual(await response.json(), { stage, writtenFrames: 0, totalFrames: 60, elapsedMs: 0 });
    unblock.resolve();
    assert.equal((await rendering).status, 200);
  });
}

test('an internal manifest parse failure is logged instead of blaming request JSON', async t => {
  const { post, failures } = await fixture(t, async () => { throw new SyntaxError('Invalid renderer manifest'); });
  const response = await post('/render');
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /Invalid scene JSON/);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error.message, 'Invalid renderer manifest');
});

test('diagnostic inspection is authenticated and cannot dispatch encoding or provider work', async t => {
  let inspected = 0;
  const forbidden = async () => { assert.fail('inspection dispatched another operation'); };
  const server = createSceneServer({ token: 'test-token', compile: forbidden, render: forbidden, text: forbidden,
    inspect: async (input, signal) => { inspected++; assert.deepEqual(input.frames, [15]); assert.equal(signal.aborted, false); return { frames: [], motionVerified: false }; },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/inspect`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  assert.equal(inspected, 0);
  const result = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: '{"frames":[15]}' });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).motionVerified, false);
  assert.equal(inspected, 1);
});
