import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheBudget, cacheKey, maxRenderBytes, pruneRenderCache, readCachedRender, writeCachedRender } from './render-cache.mjs';

test('lossless scene output allows the same one-GiB ceiling as the API receiver', () => {
  assert.equal(maxRenderBytes, 1024 ** 3);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scene-cache-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const video = Buffer.from('lossless-rendered-scene');
  return { root, video, manifest: { file: 'scene.mp4', size: video.length, sha256: createHash('sha256').update(video).digest('hex') } };
}

test('cache key includes artwork, media, timing, dimensions and renderer identity', () => {
  const input = { config: { width: 1920, fps: 30 }, images: { image_2: 'b', image_1: 'a' } };
  const key = cacheKey('bundle', 'html', input, 'renderer1');
  assert.equal(key, cacheKey('bundle', 'html', { ...input, images: { image_1: 'a', image_2: 'b' } }, 'renderer1'));
  for (const other of [
    cacheKey('edited-bundle', 'html', input, 'renderer1'),
    cacheKey('bundle', 'html', { ...input, images: { image_1: 'changed' } }, 'renderer1'),
    cacheKey('bundle', 'html', { ...input, config: { ...input.config, fps: 60 } }, 'renderer1'),
    cacheKey('bundle', 'html', { ...input, parameters: { receiver: { x: 100 } } }, 'renderer1'),
    cacheKey('bundle', 'html', { ...input, models: { model_1: 'original-GLB' } }, 'renderer1'),
    cacheKey('bundle', 'html', input, 'renderer2'),
  ]) assert.notEqual(other, key);
  assert.notEqual(cacheKey('bundle', 'html', { ...input, models: { model_1: 'original-GLB' } }, 'renderer1'),
    cacheKey('bundle', 'html', { ...input, models: { model_1: 'edited-GLB' } }, 'renderer1'));
});

test('complete cache entries survive a fresh reader and preserve exact bytes', async t => {
  const data = await fixture(t);
  const key = 'a'.repeat(64);
  assert.equal(await readCachedRender(data.root, key), null);
  await writeCachedRender(data.root, key, data);
  const hit = await readCachedRender(data.root, key);
  assert.deepEqual(hit.video, data.video);
  assert.equal(hit.manifest.sha256, data.manifest.sha256);
  assert.deepEqual(await readdir(data.root), [key]);
  await assert.rejects(readCachedRender(data.root, '../escape'), /Invalid scene cache key/);
});

test('corrupt or partial entries never return a cached video', async t => {
  const data = await fixture(t);
  const key = 'b'.repeat(64);
  await writeCachedRender(data.root, key, data);
  await writeFile(join(data.root, key, 'scene.mp4'), Buffer.alloc(data.video.length));
  assert.equal(await readCachedRender(data.root, key), null);
  await writeCachedRender(data.root, key, data);
  assert.deepEqual((await readCachedRender(data.root, key)).video, data.video, 'corrupt entries must recover, not miss forever');
  const partial = 'f'.repeat(64);
  await mkdir(join(data.root, partial));
  await writeFile(join(data.root, partial, 'manifest.json'), JSON.stringify(data.manifest));
  assert.equal(await readCachedRender(data.root, partial), null);
  await writeCachedRender(data.root, partial, data);
  assert.deepEqual((await readCachedRender(data.root, partial)).video, data.video);
  assert.equal(await readCachedRender(data.root, 'c'.repeat(64)), null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readCachedRender(data.root, key, controller.signal), { name: 'AbortError' });
});

test('cache eviction is bounded, LRU and does not remove unrelated files', async t => {
  const data = await fixture(t);
  const first = 'd'.repeat(64), second = 'e'.repeat(64);
  await writeCachedRender(data.root, first, data);
  const old = new Date(Date.now() - 10000);
  await utimes(join(data.root, first), old, old);
  await writeCachedRender(data.root, second, data);
  await writeFile(join(data.root, 'keep.txt'), 'unrelated');
  const size = data.video.length + (await readFile(join(data.root, second, 'manifest.json'))).length;
  await pruneRenderCache(data.root, size + 1);
  assert.equal(await readCachedRender(data.root, first), null);
  assert.ok(await readCachedRender(data.root, second));
  assert.equal(await readFile(join(data.root, 'keep.txt'), 'utf8'), 'unrelated');
  await pruneRenderCache(data.root, 0);
  assert.equal(await readCachedRender(data.root, second), null);
  assert.throws(() => cacheBudget('-1'), /SCENE_CACHE_MAX_BYTES/);
  assert.equal(cacheBudget('0'), 0);
});
