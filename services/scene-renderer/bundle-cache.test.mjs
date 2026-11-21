import test from 'node:test';
import assert from 'node:assert/strict';
import { BundleCache } from './bundle-cache.mjs';

test('coalesces repeated scene compilation and bounds retained bundle bytes', async () => {
  const cache = new BundleCache(6);
  let calls = 0;
  const generate = async () => { calls++; return Buffer.from('abc'); };
  await Promise.all([cache.get('a', generate), cache.get('a', generate)]);
  assert.equal(calls, 1);
  await cache.get('b', generate);
  await cache.get('a', generate);
  await cache.get('c', generate);
  await cache.get('b', generate);
  assert.equal(calls, 4);
});

test('failed compilation is not cached and oversized bundles do not displace useful entries', async () => {
  const cache = new BundleCache(3);
  let calls = 0;
  const generate = async () => { if (++calls === 1) throw new Error('bad component'); return Buffer.from('ok'); };
  await assert.rejects(cache.get('a', generate), /bad component/);
  await cache.get('a', generate);
  await cache.get('large', async () => Buffer.from('too large'));
  await cache.get('a', generate);
  assert.equal(calls, 2);
});
