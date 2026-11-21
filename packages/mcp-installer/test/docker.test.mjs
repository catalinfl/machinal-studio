import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { findCheckout, prepareLocalDocker, runDocker } from '../src/docker.mjs';
import { InstallerError } from '../src/errors.mjs';
import { DEFAULT_LOCAL_URL } from '../src/setup-options.mjs';
import { API_KEY, workspace } from './helpers.mjs';

async function checkout(t, { configured = true } = {}) {
  const root = await workspace(t);
  for (const directory of ['api', 'services/scene-renderer', 'nested/project']) await mkdir(join(root, directory), { recursive: true });
  for (const file of ['.machinal-local.json', 'compose.editengine.yaml', 'api/Dockerfile', 'services/scene-renderer/Dockerfile', ...(configured ? ['api/.env'] : [])]) await writeFile(join(root, file), '# fixture');
  return root;
}

function dockerContext(root, { images = true, host = 'npipe:////./pipe/docker_engine', interactive = true, consent = true, failure } = {}) {
  const calls = [];
  const logs = [];
  const ui = { confirm: async (question) => {
    calls.push({ confirm: question });
    assert.equal(question.default, false);
    return consent;
  } };
  return {
    cwd: root, env: {}, interactive, ui, log: (message) => logs.push(message), calls, logs,
    docker: async (args, options) => {
      calls.push({ args, options });
      if (failure?.(args)) throw new InstallerError('Safe Docker failure', { code: 'docker-failed' });
      if (args[0] === 'context') return host;
      if (args.includes('ps')) return 'api: exited\nscene-renderer: exited';
      if (args.includes('--images')) return 'checkout-api\ncheckout-scene-renderer';
      if (args[0] === 'image' && !images) throw new InstallerError('Missing image', { code: 'docker-failed' });
      return 'ok';
    },
  };
}

test('checkout discovery walks ancestors or uses an explicit checkout, without assuming npm contains Dockerfiles', async (t) => {
  const root = await checkout(t);
  const project = await workspace(t);
  assert.equal(await findCheckout(join(root, 'nested/project')), root);
  assert.equal(await findCheckout(project), null);
  assert.equal(await findCheckout(project, root), root);
  assert.equal(await findCheckout(project, join(root, 'missing')), null);
});

for (const images of [true, false]) {
  test(`local Docker ${images ? 'reuses existing images' : 'builds missing images'} only after approval`, async (t) => {
    const root = await checkout(t);
    const ctx = dockerContext(root, { images });
    await prepareLocalDocker({}, DEFAULT_LOCAL_URL, ctx);
    const consentIndex = ctx.calls.findIndex((call) => call.confirm);
    const startIndex = ctx.calls.findIndex((call) => call.args?.includes('up'));
    assert.ok(startIndex > consentIndex && consentIndex >= 0);
    assert.equal(ctx.calls[startIndex].args.includes('--build'), !images);
    assert.ok(ctx.calls[startIndex].args.includes('--wait'));
    assert.ok(ctx.calls[startIndex].args.includes(join(root, 'compose.editengine.yaml')));
    assert.equal(ctx.calls[startIndex].options.timeout, 15 * 60_000);
    assert.equal(ctx.calls[startIndex].options.discardOutput, true);
    assert.match(ctx.logs.join('\n'), /Docker ready:.*Verifying MCP/);
    assert.ok(ctx.calls.every((call) => !call.args?.includes('down')));
  });
}

test('declining Docker changes preserves all containers and volumes', async (t) => {
  const root = await checkout(t);
  const ctx = dockerContext(root, { consent: false });
  await assert.rejects(prepareLocalDocker({}, DEFAULT_LOCAL_URL, ctx), /Docker was not started/);
  assert.ok(ctx.calls.every((call) => !call.args?.includes('up')));
});

test('--yes is not Docker permission; unattended startup needs --start-docker explicitly', async (t) => {
  const root = await checkout(t);
  const ctx = dockerContext(root, { interactive: false });
  await assert.rejects(prepareLocalDocker({ yes: true }, DEFAULT_LOCAL_URL, ctx), /--yes alone never authorizes/);
  assert.ok(ctx.calls.every((call) => !call.args?.includes('up')));
  await prepareLocalDocker({ yes: true, 'start-docker': true }, DEFAULT_LOCAL_URL, ctx);
  assert.ok(ctx.calls.some((call) => call.args?.includes('up')));
  assert.ok(ctx.calls.every((call) => !call.confirm));
});

for (const host of ['tcp://remote.example:2376', 'ssh://localhost', 'ssh://remote.example', 'garbage']) {
  test(`local mode refuses non-local Docker context: ${host}`, async (t) => {
    const ctx = dockerContext(await checkout(t), { host });
    await assert.rejects(prepareLocalDocker({ 'start-docker': true }, DEFAULT_LOCAL_URL, ctx), /local Docker daemon/);
    assert.ok(ctx.calls.every((call) => !call.args?.includes('up')));
  });
}

test('DOCKER_HOST override is checked rather than trusting only the named context', async (t) => {
  const ctx = dockerContext(await checkout(t));
  ctx.env.DOCKER_HOST = 'tcp://remote.example:2376';
  await assert.rejects(prepareLocalDocker({ 'start-docker': true }, DEFAULT_LOCAL_URL, ctx), /local Docker daemon/);
});

test('DOCKER_CONTEXT takes precedence over DOCKER_HOST just as it does for Docker itself', async (t) => {
  const ctx = dockerContext(await checkout(t), { host: 'ssh://remote.example' });
  ctx.env = { DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'npipe:////./pipe/docker_engine' };
  await assert.rejects(prepareLocalDocker({ 'start-docker': true }, DEFAULT_LOCAL_URL, ctx), /local Docker daemon/);
  assert.ok(ctx.calls.some((call) => call.args?.[0] === 'context' && call.args.includes('remote')));
  assert.ok(ctx.calls.every((call) => !call.args?.includes('up')));
});

test('missing checkout and custom ports explain recovery; standalone Docker needs no .env', async (t) => {
  const ctx = dockerContext(await workspace(t));
  await assert.rejects(prepareLocalDocker({}, DEFAULT_LOCAL_URL, ctx), /--docker-dir PATH/);
  await assert.rejects(prepareLocalDocker({}, 'http://localhost:9999/mcp', ctx), /custom deployment/);
  assert.deepEqual(ctx.calls, []);
  const unconfigured = dockerContext(await checkout(t, { configured: false }));
  await prepareLocalDocker({ 'start-docker': true }, DEFAULT_LOCAL_URL, unconfigured);
  assert.ok(unconfigured.calls.some((call) => call.args?.includes('up')));
});

test('failed Docker startup does not announce readiness or delete containers/volumes', async (t) => {
  const ctx = dockerContext(await checkout(t), { failure: (args) => args.includes('up') });
  await assert.rejects(prepareLocalDocker({ 'start-docker': true }, DEFAULT_LOCAL_URL, ctx), /Safe Docker failure/);
  assert.doesNotMatch(ctx.logs.join('\n'), /Docker ready/);
  assert.ok(ctx.calls.every((call) => !call.args?.includes('down')));
});

test('missing Docker returns an installation link without leaking subprocess diagnostics or the API key', async (t) => {
  const root = await workspace(t);
  for (const discardOutput of [false, true]) await assert.rejects(runDocker(['info'], { cwd: root, env: { PATH: '', MACHINAL_API_KEY: API_KEY }, discardOutput }), (error) => {
    assert.match(error.message, /https:\/\/docs.docker.com\/get-started\/get-docker/);
    assert.ok(!error.message.includes(API_KEY));
    return error.code === 'docker-missing';
  });
});
