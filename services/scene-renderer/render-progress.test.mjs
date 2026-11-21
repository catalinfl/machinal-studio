import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { observeRendererProgress } from './render-progress.mjs';

test('live frame progress survives chunk boundaries, is throttled and reports completion', () => {
  const stderr = new PassThrough();
  let clock = 0;
  const updates = [];
  const stop = observeRendererProgress({ stderr }, update => updates.push(update), () => clock);
  stderr.write('fra');
  stderr.write('mes 1/90 · 200ms\n');
  clock = 1000;
  stderr.write('frames 30/90 · 1s\n');
  clock = 6000;
  stderr.write('frames 60/90 · 6s\n');
  clock = 6100;
  stderr.write('frames 90/90 · 6.1s');
  stop();

  assert.deepEqual(updates.map(update => update.writtenFrames), [1, 60, 90]);
  assert.equal(updates[1].elapsedMs, 6000);
  assert.equal(updates[2].progress, 1);
  assert.equal(stderr.listenerCount('data'), 0);
});

test('stderr diagnostics and malformed or regressive progress are never emitted as progress', () => {
  const stderr = new PassThrough();
  const updates = [];
  const stop = observeRendererProgress({ stderr }, update => updates.push(update), () => 0);
  stderr.write('private /tmp/path and token\nframes 0/10\nframes 11/10\nframes 1/0\n');
  stderr.write('frames 1/10\nframes 1/10\n');
  stderr.write('x'.repeat(10000));
  stderr.write('\nframes 10/10\n');
  stop();
  assert.deepEqual(updates.map(update => update.writtenFrames), [1, 10]);
  assert.doesNotMatch(JSON.stringify(updates), /private|token|\/tmp/);
});
