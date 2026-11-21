import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reviewFrames, reviewTemplate } from './review-template.mjs';

test('synthetic review samples stay distinct and inside actual frame bounds', () => {
  for (const [duration, fps] of [[1, 1], [7, 30], [60, 60], [1, 29.97]]) {
    const frames = reviewFrames(duration, fps);
    assert.ok(frames.length >= 1 && frames.length <= 6);
    assert.equal(new Set(frames).size, frames.length);
    assert.ok(frames.every(frame => Number.isInteger(frame) && frame >= 0 && frame < Math.round(duration * fps)));
  }
});

test('unknown templates and existing output directories never overwrite or start browser work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machinal-template-review-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sentinel = join(directory, 'keep.txt');
  await writeFile(sentinel, 'user work');
  await assert.rejects(reviewTemplate('../secret', directory), /exact bundled/);
  await assert.rejects(reviewTemplate('piston-cycle', directory), { code: 'EEXIST' });
  assert.equal(await readFile(sentinel, 'utf8'), 'user work');
});
