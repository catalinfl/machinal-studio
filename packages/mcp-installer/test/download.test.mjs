import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { downloadDirectory, downloadFilename, saveDownload } from '../src/download.mjs';
import { downloadResponse, isPublicAddress, publicLookup, requestTransfer, transferURL } from '../src/transfer-http.mjs';
import { serve, workspace } from './helpers.mjs';

function response(chunks, { status = 200, headers = {} } = {}) {
  return Object.assign(Readable.from(chunks), { statusCode: status, headers });
}

test('native download streams bytes, verifies length/hash and leaves only the complete file', async (t) => {
  const directory = await workspace(t);
  const bytes = Buffer.alloc(256 * 1024, 42);
  const endpoint = await serve(t, (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['accept-encoding'], 'identity');
    res.writeHead(200, { 'Content-Length': bytes.length });
    res.end(bytes);
  });
  const result = await saveDownload({ url: endpoint, directory, filename: 'video.mp4',
    request: { trustedOrigin: new URL(endpoint).origin } });
  assert.deepEqual(result, { path: join(directory, 'video.mp4'), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.deepEqual(await readFile(result.path), bytes);
  assert.deepEqual(await readdir(directory), ['video.mp4']);
});

test('existing destinations are never overwritten and do not start network work', async (t) => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'keep.png'), 'original');
  await assert.rejects(saveDownload({ directory, filename: 'keep.png', url: 'https://example.com/a',
    request: { request: () => { throw new Error('network should not run'); } } }), /already exists/);
  assert.equal(await readFile(join(directory, 'keep.png'), 'utf8'), 'original');
});

test('a competing download cannot overwrite a destination created while bytes are in flight', async (t) => {
  const directory = await workspace(t);
  const stream = response((async function* () {
    yield Buffer.from('new');
    await writeFile(join(directory, 'race.png'), 'other');
  })());
  await assert.rejects(saveDownload({ directory, filename: 'race.png', url: 'https://example.com/a',
    request: { request: async () => stream } }), { code: 'EEXIST' });
  assert.equal(await readFile(join(directory, 'race.png'), 'utf8'), 'other');
  assert.deepEqual(await readdir(directory), ['race.png']);
});

test('interrupted, oversized, empty and incorrectly sized downloads clean up partial files', async (t) => {
  for (const makeResponse of [
    () => response([Buffer.from('short')], { headers: { 'content-length': '10' } }),
    () => response([Buffer.alloc(20)]),
    () => response([]),
    () => response([Buffer.from('data')], { headers: { 'content-length': '100' } }),
    () => response((async function* () { yield Buffer.from('x'); throw new Error('interrupted'); })()),
    () => response([Buffer.from('x')], { headers: { 'content-encoding': 'gzip' } }),
  ]) {
    const directory = await workspace(t);
    await assert.rejects(saveDownload({ directory, filename: 'bad.mp4', url: 'https://example.com/a', maxBytes: 16,
      request: { request: async () => makeResponse() } }));
    assert.deepEqual(await readdir(directory), []);
  }
});

test('cancellation destroys the network stream and removes the partial file', async (t) => {
  const directory = await workspace(t);
  const controller = new AbortController();
  const stream = response((async function* () { yield Buffer.from('some'); controller.abort(); })());
  await assert.rejects(saveDownload({ directory, filename: 'cancel.mp4', url: 'https://example.com/a', signal: controller.signal,
    request: { request: async () => stream } }));
  assert.ok(stream.destroyed);
  assert.deepEqual(await readdir(directory), []);
});

test('filenames reject traversal, alternate streams, Windows device names and control characters', () => {
  for (const name of ['', '..', '.hidden', '../a', 'a/b', 'a\\b', 'C:\\x', 'video.mp4:stream', 'nul.png', 'LPT1', 'x.', 'x ', 'a\nb', 'a\x00b']) {
    assert.throws(() => downloadFilename(name), /plain filename/);
  }
  assert.equal(downloadFilename('documentar român (final).mp4'), 'documentar român (final).mp4');
});

test('only absolute approved directories are accepted, including paths that need creation', async (t) => {
  const directory = await workspace(t);
  await assert.rejects(downloadDirectory('relative/path'), /absolute/);
  const nested = await downloadDirectory(join(directory, 'new', 'subdirectory'));
  assert.equal(nested, join(await downloadDirectory(directory), 'new', 'subdirectory'));
  assert.deepEqual(await readdir(directory), []);
});

test('public URL policy blocks private networks, alternative IP spellings, credentials and insecure protocols', () => {
  for (const url of ['file:///etc/passwd', 'http://example.com/a', 'https://user:pass@example.com/a',
    'https://localhost/a', 'https://localhost./a', 'https://127.1/a', 'https://2130706433/a',
    'https://10.0.0.1/a', 'https://169.254.169.254/a', 'https://[::1]/a',
    'https://[::ffff:127.0.0.1]/a', 'https://[fc00::1]/a', 'https://example.com/a#fragment']) {
    assert.throws(() => transferURL(url));
  }
  assert.equal(transferURL('https://example.com/photo.png?size=large').hostname, 'example.com');
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(isPublicAddress(address), address);
  for (const address of ['0.0.0.0', '100.64.1.1', '192.168.0.1', '198.18.0.1', '224.0.0.1', '::1', 'fe80::1', '::ffff:8.8.8.8', '2001:db8::1', '2002:7f00:1::']) {
    assert.ok(!isPublicAddress(address), address);
  }
});

test('DNS answers are validated at connection time and the checked addresses are used by the socket', async () => {
  const run = (answers, options = { all: true }) => new Promise((resolve, reject) => {
    publicLookup(async () => answers)('example.com', options, (error, ...result) => error ? reject(error) : resolve(result));
  });
  const publicAnswer = [{ address: '8.8.8.8', family: 4 }];
  assert.deepEqual(await run(publicAnswer), [publicAnswer]);
  assert.deepEqual(await run(publicAnswer, { family: 4 }), ['8.8.8.8', 4]);
  await assert.rejects(run([...publicAnswer, { address: '127.0.0.1', family: 4 }]), /private or reserved/);
});

test('redirects are bounded, validated on every hop, and carry no application credentials', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url: url.href, options });
    return calls.length === 1 ? response([], { status: 302, headers: { location: 'https://cdn.example.com/video' } }) : response([Buffer.from('ok')]);
  };
  const stream = await downloadResponse('https://example.com/start', { request });
  stream.destroy();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.headers.Authorization === undefined));
  for (const target of ['http://example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a']) {
    await assert.rejects(downloadResponse('https://example.com/a', {
      request: async () => response([], { status: 302, headers: { location: target } }),
    }));
  }
  let redirects = 0;
  await assert.rejects(downloadResponse('https://example.com/a', {
    request: async () => { redirects++; return response([], { status: 302, headers: { location: '/again' } }); },
  }), /too many redirects/);
  assert.equal(redirects, 6);
});

test('the configured loopback API is allowed, but a redirect to a different private service is not', async (t) => {
  const endpoint = await serve(t, (_req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }); res.end(); });
  await assert.rejects(downloadResponse(endpoint, { trustedOrigin: new URL(endpoint).origin }), /HTTPS/);
  assert.throws(() => requestTransfer('https://127.0.0.1/'), /private/);
});
