import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { installOpenCodeMedia } from '../src/opencode-media.mjs';
import { API_KEY, requestBody, serve, workspace } from './helpers.mjs';

const JOB_ID = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);

async function host(options = {}) {
  const permissions = [];
  const progress = [];
  let tool;
  const ctx = {
    tool: { transform: async (fn) => fn({ add: (definition) => { tool = definition; } }) },
    permission: { assert: async (input) => { permissions.push(input); await options.permission?.(input); } },
  };
  await installOpenCodeMedia(ctx, options);
  return { permissions, progress, tool,
    execute: async (input) => JSON.parse((await tool.execute(input, {
      signal: new AbortController().signal, progress: async (update) => { progress.push(update); },
      sessionID: 'ses_test', agent: 'build', messageID: 'msg_test', id: 'call_test',
    })).content),
  };
}

async function api(t, directory, { status = 'completed', kind = 'automation-render', redirect = false } = {}) {
  const calls = [];
  let endpoint;
  endpoint = await serve(t, async (req, res) => {
    calls.push({ path: req.url, authorization: req.headers.authorization });
    const send = (data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url.startsWith('/deliveries/')) {
      res.writeHead(302, { Location: '/bytes' }); res.end();
    } else if (req.url === '/bytes') {
      res.writeHead(200, { 'Content-Length': 4 }); res.end('file');
    } else {
      assert.equal(req.headers.authorization, `Bearer ${API_KEY}`);
      if (req.url.includes('/jobs/')) send({ status, kind, filename: 'video.mp4' });
      else if (req.url === '/v1/preferences/downloads') send({ directory });
      else if (req.url.endsWith('/media/delivery-links')) {
        calls.at(-1).body = await requestBody(req);
        if (redirect) { res.writeHead(302, { Location: 'https://example.com' }); res.end(); }
        else send({ url: `${new URL(endpoint).origin}/deliveries/${TOKEN}`, filename: 'video.mp4' });
      } else res.writeHead(404).end();
    }
  });
  return { endpoint, calls };
}

test('project downloads use the saved destination, reuse in-memory credentials and keep bearer links out of tool output', async (t) => {
  const directory = await workspace(t);
  const server = await api(t, directory);
  const h = await host({ getConnection: async () => ({ endpoint: server.endpoint, key: API_KEY }) });
  assert.equal(h.tool.options.codemode, false);
  const result = await h.execute({ projectId: 'owned', jobId: JOB_ID, userApproved: true });
  assert.equal(result.status, 'completed');
  assert.equal(await readFile(result.path, 'utf8'), 'file');
  assert.equal(result.bytes, 4);
  assert.match(result.sha256, /^[a-f\d]{64}$/);
  const serialized = JSON.stringify({ result, progress: h.progress, permissions: h.permissions });
  assert.ok(!serialized.includes(API_KEY));
  assert.ok(!serialized.includes(TOKEN));
  assert.deepEqual(server.calls.filter(({ path }) => path === '/bytes' || path.startsWith('/deliveries/')).map(({ authorization }) => authorization), [undefined, undefined]);
  assert.deepEqual(server.calls.find(({ body }) => body).body, { file: 'video.mp4', storage: 's3' });
  assert.deepEqual(h.permissions.map(({ action }) => action), ['machinal_download', 'edit']);
  assert.deepEqual(h.permissions[1].resources, [join(directory, 'video.mp4')]);
});

test('named media respects volume selection, a custom directory and a new local filename', async (t) => {
  const directory = await workspace(t);
  const server = await api(t, 'not used');
  const h = await host({ getConnection: async () => ({ endpoint: server.endpoint, key: API_KEY }) });
  const result = await h.execute({ projectId: 'owned', file: 'photo.png', storage: 'volume', directory, filename: 'saved.png', userApproved: true });
  assert.equal(result.status, 'completed');
  assert.equal(result.path, join(directory, 'saved.png'));
  assert.deepEqual(server.calls.find(({ body }) => body).body, { file: 'photo.png', storage: 'volume' });
  assert.ok(!server.calls.some(({ path }) => path.includes('/jobs/') || path.includes('/preferences/')));
});

test('unfinished and non-render jobs cannot be downloaded and do not issue delivery links', async (t) => {
  for (const configuration of [{ status: 'running' }, { status: 'failed' }, { kind: 'asset-generation' }]) {
    const directory = await workspace(t);
    const server = await api(t, directory, configuration);
    const h = await host({ getConnection: async () => ({ endpoint: server.endpoint, key: API_KEY }) });
    assert.equal((await h.execute({ projectId: 'owned', jobId: JOB_ID, userApproved: true })).status, 'failed');
    assert.equal(server.calls.length, 1);
    assert.deepEqual(await readdir(directory), []);
  }
});

test('missing approval and ambiguous sources perform no credential, API or file access', async () => {
  const h = await host({ getConnection: () => { throw new Error('must not be called'); } });
  for (const input of [
    { projectId: 'owned', jobId: JOB_ID },
    { projectId: 'owned', jobId: JOB_ID, file: 'a.mp4', userApproved: true },
    { projectId: '../other', file: 'a.mp4', userApproved: true },
    { projectId: 'owned', file: '../a.mp4', userApproved: true },
    { url: 'https://example.com/a', directory: 'somewhere', filename: 'x', projectId: 'owned', userApproved: true },
    { url: 'https://example.com/a', userApproved: true },
  ]) assert.equal((await h.execute(input)).status, 'failed');
  assert.deepEqual(h.permissions, []);
});

test('native permission denials propagate and prevent descriptor creation or filesystem changes', async (t) => {
  const directory = await workspace(t);
  const server = await api(t, directory);
  const rejection = new Error('permission denied');
  const h = await host({ getConnection: async () => ({ endpoint: server.endpoint, key: API_KEY }),
    permission: ({ action }) => { if (action === 'edit') throw rejection; } });
  await assert.rejects(h.execute({ projectId: 'owned', file: 'photo.png', directory, userApproved: true }), rejection);
  assert.equal(server.calls.length, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('API redirects are refused without leaking credentials to the target', async (t) => {
  const directory = await workspace(t);
  const server = await api(t, directory, { redirect: true });
  const h = await host({ getConnection: async () => ({ endpoint: server.endpoint, key: API_KEY }) });
  const result = await h.execute({ projectId: 'owned', file: 'photo.png', directory, userApproved: true });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Redirects are refused/);
  assert.equal(server.calls.length, 1);
  assert.deepEqual(await readdir(directory), []);
});

test('public internet downloads need no machinal connection, keep progress compact and never send credentials', async (t) => {
  const directory = await workspace(t);
  const calls = [];
  const h = await host({
    getConnection: () => assert.fail('Public downloads must not resolve API credentials'),
    request: async (url, options) => {
      calls.push({ url: url.href, headers: options.headers });
      return Object.assign(Readable.from([Buffer.from('public image')]), {
        statusCode: 200, headers: { 'content-length': '12' },
      });
    },
  });
  const result = await h.execute({ url: 'https://example.org/image.png', directory, filename: 'internet.png', userApproved: true });
  assert.equal(result.status, 'completed');
  assert.equal(await readFile(result.path, 'utf8'), 'public image');
  assert.deepEqual(calls, [{ url: 'https://example.org/image.png', headers: { 'Accept-Encoding': 'identity' } }]);
  assert.deepEqual(h.progress, [{ status: 'Downloading', filename: 'internet.png' }]);
});

test('missing saved directory stops before issuing a bearer link, without choosing a fallback', async (t) => {
  const directory = await workspace(t);
  const server = await api(t, '');
  const h = await host({ getConnection: async () => ({ endpoint: server.endpoint, key: API_KEY }) });
  const result = await h.execute({ projectId: 'owned', file: 'photo.png', userApproved: true });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /Ask the user/);
  assert.deepEqual(server.calls.map(({ path }) => path), ['/v1/preferences/downloads']);
  assert.deepEqual(await readdir(directory), []);
});

test('untrusted descriptors and error payloads never leak URLs, credentials or server contents', async (t) => {
  const directory = await workspace(t);
  const h = await host({
    getConnection: async () => ({ endpoint: 'https://approved.example/mcp', key: API_KEY }),
    request: async () => Object.assign(Readable.from([Buffer.from(JSON.stringify({
      url: `https://untrusted.example/deliveries/${TOKEN}`, detail: API_KEY,
    }))]), { statusCode: 200, headers: { 'content-type': 'application/json' } }),
  });
  const result = await h.execute({ projectId: 'owned', file: 'photo.png', directory, userApproved: true });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /invalid delivery descriptor/);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  assert.deepEqual(await readdir(directory), []);
});
