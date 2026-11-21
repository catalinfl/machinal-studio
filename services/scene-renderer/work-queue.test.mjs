import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkQueue, QueueFullError } from './work-queue.mjs';

test('scene work waits in FIFO order and releases slots exactly once', async () => {
  const queue = new WorkQueue(1, 2);
  const first = await queue.acquire();
  const order = [];
  const second = queue.acquire().then(release => { order.push(2); return release; });
  const third = queue.acquire().then(release => { order.push(3); return release; });
  await assert.rejects(queue.acquire(), QueueFullError);
  first(); first();
  const releaseSecond = await second;
  assert.deepEqual(order, [2]);
  releaseSecond();
  const releaseThird = await third;
  assert.deepEqual(order, [2, 3]);
  releaseThird();
  (await queue.acquire())();
});

test('disconnecting a queued scene removes it without occupying a worker', async () => {
  const queue = new WorkQueue(1, 1);
  const first = await queue.acquire();
  const controller = new AbortController();
  const waiting = queue.acquire(controller.signal);
  controller.abort(new Error('disconnected'));
  await assert.rejects(waiting, /disconnected/);
  const next = queue.acquire();
  first();
  (await next)();
});
