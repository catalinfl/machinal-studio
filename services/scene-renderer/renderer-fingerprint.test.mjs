import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executableFingerprints, fileDigest, maxFingerprintManifestBytes } from './renderer-fingerprint.mjs';
import { buildRendererManifest, normalizeExecutableTimes } from './scripts/build-renderer-manifest.mjs';
import { cacheKey } from './render-cache.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'renderer-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, 'renderer');
  await writeFile(binary, 'synthetic-native-binary');
  const manifest = await buildRendererManifest([binary], []);
  return { root, binary, manifest };
}

test('fresh fingerprint readers reuse build hashes without reading executable contents', async t => {
  const { binary, manifest } = await fixture(t);
  const expected = await fileDigest(binary);
  for (let worker = 0; worker < 2; worker++) {
    const hashes = await executableFingerprints([binary], 'image-manifest', {
      read: async () => manifest.executables,
      inspect: async path => ({ ...(await stat(path)), uid: 0, mode: 0o100755 }),
      hash: () => assert.fail('matching immutable executable was rehashed'),
    });
    assert.deepEqual(hashes, [expected]);
    assert.equal(cacheKey('bundle', 'html', {}, { hashes }), cacheKey('bundle', 'html', {}, { hashes: [expected] }));
  }
});

test('changed metadata, custom paths and invalid digests fall back to content hashing', async t => {
  const { binary, manifest } = await fixture(t);
  for (const change of [{ size: -1 }, { mtimeMs: -1 }, { path: join('custom', 'renderer') }, { sha256: 'invalid' }]) {
    let reads = 0;
    const hashes = await executableFingerprints([binary], '', {
      read: async () => [{ ...manifest.executables[0], ...change }],
      inspect: async path => ({ ...(await stat(path)), uid: 0, mode: 0o100755 }),
      hash: async path => { reads++; return fileDigest(path); },
    });
    assert.equal(reads, 1);
    assert.deepEqual(hashes, [await fileDigest(binary)]);
  }
});

test('absent, malformed, oversized and incomplete manifests preserve real hashing', async t => {
  const { root, binary } = await fixture(t);
  const path = join(root, 'manifest.json');
  for (const data of [null, '{', JSON.stringify({ version: 2, executables: [] }), JSON.stringify({ version: 1, executables: [null] }), ' '.repeat(maxFingerprintManifestBytes + 1)]) {
    if (data !== null) await writeFile(path, data);
    assert.deepEqual(await executableFingerprints([binary], path), [await fileDigest(binary)]);
  }
});

test('changed executable bytes invalidate the resulting render cache key', async t => {
  const { binary, manifest } = await fixture(t);
  const original = manifest.executables[0].sha256;
  await writeFile(binary, 'changed-native-binary-content');
  const hashes = await executableFingerprints([binary], '', { read: async () => manifest.executables });
  assert.notEqual(hashes[0], original);
  assert.notEqual(cacheKey('bundle', 'html', {}, { hashes }), cacheKey('bundle', 'html', {}, { hashes: [original] }));
});

test('runtime manifest reuse preserves the exact build digest', async t => {
  if (process.platform !== 'win32' && process.getuid() !== 0) {
    t.skip('only root can create an image-owned manifest; reader matching is covered with injected metadata');
    return;
  }
  const { root, binary, manifest } = await fixture(t);
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest), { mode: 0o644 });
  assert.deepEqual(await executableFingerprints([binary], path, { hash: () => assert.fail('pinned binary read') }), [await fileDigest(binary)]);
});

test('a writable manifest cannot replace executable content hashing on Linux', async t => {
  if (process.platform === 'win32') { t.skip('POSIX ownership/permission contract'); return; }
  const { root, binary, manifest } = await fixture(t);
  const path = join(root, 'manifest.json');
  manifest.executables[0].sha256 = 'f'.repeat(64);
  await writeFile(path, JSON.stringify(manifest));
  await chmod(path, 0o666);
  assert.deepEqual(await executableFingerprints([binary], path), [await fileDigest(binary)]);
});

test('build reclaim inventory is deduplicated, bounded to selected resources and skips small files', async t => {
  const { root, binary } = await fixture(t);
  const resources = join(root, 'resources');
  await mkdir(resources);
  const large = join(resources, 'font.woff2');
  await writeFile(large, Buffer.alloc(64 * 1024));
  await writeFile(join(resources, 'tiny.css'), 'style');
  const unrelated = join(root, 'credits.db');
  await writeFile(unrelated, Buffer.alloc(128 * 1024));
  const manifest = await buildRendererManifest([binary], [resources], [binary]);
  assert.deepEqual(manifest.reclaimFiles, [binary, large].sort());
  assert.equal((await readFile(unrelated)).length, 128 * 1024);
});

test('build rejects oversized inventories and prioritizes binaries before resources', async t => {
  await assert.rejects(buildRendererManifest([], [], Array.from({ length: 8193 }, (_, i) => `/library/${i}`)), /too many files/);
  const { root, binary } = await fixture(t);
  const resources = join(root, 'a-resources');
  await mkdir(resources);
  await writeFile(join(resources, 'large'), Buffer.alloc(64 * 1024));
  const manifest = await buildRendererManifest([binary], [resources], ['node-binary']);
  assert.deepEqual(manifest.reclaimFiles.slice(0, 2), [binary, 'node-binary']);
});

test('build fingerprints survive OCI whole-second timestamp serialization without weakening matching', async t => {
  const { binary } = await fixture(t);
  const expected = await fileDigest(binary);
  await utimes(binary, new Date(), 1700000000.456);
  await normalizeExecutableTimes([binary]);
  const manifest = await buildRendererManifest([binary], []);
  const timestamp = manifest.executables[0].mtimeMs;
  assert.equal(timestamp % 1000, 0);
  assert.equal(manifest.executables[0].sha256, expected);
  await utimes(binary, new Date(), Math.floor(timestamp / 1000));
  assert.deepEqual(await executableFingerprints([binary], '', {
    read: async () => manifest.executables,
    inspect: async path => ({ ...(await stat(path)), uid: 0, mode: 0o100755 }),
    hash: () => assert.fail('image timestamp truncation caused a runtime rehash'),
  }), [expected]);
});
