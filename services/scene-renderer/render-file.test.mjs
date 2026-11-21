import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openRenderFile } from './render-file.mjs';
import { cacheKey, readCachedRender, writeCachedRender } from './render-cache.mjs';

test('large results and cache hits stay file-backed with bounded checksum/stream buffers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scene-stream-test-'));
  const handles = [];
  t.after(async () => { await Promise.all(handles.map(result => result.dispose())); await rm(root, { recursive: true, force: true }); });
  const path = join(root, 'source.mp4');
  const source = await open(path, 'wx');
  await source.truncate(16 * 1024 * 1024);
  await source.close();
  let cleaned = 0;
  const result = await openRenderFile(path, {}, { maxBytes: 32 * 1024 * 1024, cleanup: async () => { cleaned++; } });
  handles.push(result);
  assert.equal(result.video, undefined);
  assert.equal(result.bytes, 16 * 1024 * 1024);
  const stream = result.openStream();
  assert.equal(stream.readableHighWaterMark, 64 * 1024);
  let bytes = 0;
  const digest = createHash('sha256');
  for await (const chunk of stream) { assert.ok(chunk.length <= 64 * 1024); bytes += chunk.length; digest.update(chunk); }
  assert.equal(bytes, result.bytes);
  assert.equal(digest.digest('hex'), result.manifest.sha256);
  const cache = join(root, 'cache');
  const key = 'a'.repeat(64);
  await writeCachedRender(cache, key, result, 32 * 1024 * 1024);
  const hit = await readCachedRender(cache, key);
  handles.push(hit);
  assert.equal(hit.video, undefined);
  assert.equal(hit.manifest.sha256, result.manifest.sha256);
  await result.dispose();
  await result.dispose();
  assert.equal(cleaned, 1);
  await hit.dispose();
  assert.equal((await stat(join(cache, key, 'scene.mp4'))).size, result.bytes);
});

test('range capture invalidates cache and preserves authored timing as an identity input', () => {
  const source = { config: { durationInFrames: 300, fps: 30 }, range: { startFrame: 60, endFrame: 90 } };
  const key = cacheKey('bundle', 'html', source, 'renderer');
  assert.notEqual(key, cacheKey('bundle', 'html', { ...source, range: { startFrame: 90, endFrame: 120 } }, 'renderer'));
  assert.notEqual(key, cacheKey('bundle', 'html', { ...source, config: { ...source.config, durationInFrames: 600 } }, 'renderer'));
});

test('file limits and cancellation fail before publishing or returning a video', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scene-stream-reject-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source.mp4');
  await writeFile(path, 'too large');
  await assert.rejects(openRenderFile(path, {}, { maxBytes: 1 }), /size limits/);
  await assert.rejects(openRenderFile(path, {}, { maxBytes: 100, signal: AbortSignal.abort() }), { name: 'AbortError' });
});
