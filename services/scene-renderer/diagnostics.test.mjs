import test from 'node:test';
import assert from 'node:assert/strict';
import { filesystemSnapshot, reportSceneFailure, resourceSnapshot } from './diagnostics.mjs';

test('internal diagnostics retain subprocess failure details with bounded output', () => {
  const error = Object.assign(new Error('renderer failed'), {
    code: 1,
    signal: 'SIGTERM',
    killed: true,
    stderr: 'x'.repeat(9000) + '\nNo space left on device',
    stdout: 'private scene manifest',
  });
  const entries = [];
  reportSceneFailure(error, { route: '/render', elapsedMs: 300123 }, (...args) => entries.push(args));

  assert.equal(entries[0][0], 'scene_request_failed');
  const diagnostic = JSON.parse(entries[0][1]);
  assert.equal(diagnostic.route, '/render');
  assert.equal(diagnostic.elapsedMs, 300123);
  assert.equal(diagnostic.code, 1);
  assert.equal(diagnostic.signal, 'SIGTERM');
  assert.equal(diagnostic.killed, true);
  assert.equal(diagnostic.stderrTail.length, 8192);
  assert.ok(diagnostic.stderrTail.endsWith('No space left on device'));
  assert.ok(!entries[0][1].includes('private scene manifest'));
});

test('plain failures without subprocess stderr are supported', () => {
  let diagnostic;
  reportSceneFailure(new Error('x'.repeat(3000)), { route: '/text' }, (_, json) => { diagnostic = JSON.parse(json); });
  assert.equal(diagnostic.message.length, 2000);
  assert.equal(diagnostic.stderrTail, undefined);
});

test('resource diagnostics distinguish PID exhaustion from OOM without reading environment or media', async () => {
  const files = {
    'pids.current': '256\n', 'pids.max': '256\n', 'pids.events': 'max 65\n',
    'memory.current': '800000000\n', 'memory.max': '3221225472\n', 'memory.events': 'oom 0\noom_kill 0\n',
  };
  const snapshot = await resourceSnapshot(async path => {
    assert.ok(path.startsWith('/sys/fs/cgroup/'));
    const name = path.slice('/sys/fs/cgroup/'.length);
    assert.ok(Object.hasOwn(files, name));
    return files[name];
  });
  assert.equal(snapshot['pids.events'], 'max 65');
  assert.equal(snapshot['memory.events'], 'oom 0\noom_kill 0');
});

test('unavailable resource counters never mask the original render error', async () => {
  const snapshot = await resourceSnapshot(async () => { throw new Error('not supported'); });
  assert.ok(Object.values(snapshot).every(value => value === null));
});

test('filesystem diagnostics report available space and inodes on the actual work filesystem', async () => {
  const snapshot = await filesystemSnapshot(['/tmp', '/dev/shm'], async path => {
    assert.ok(['/tmp', '/dev/shm'].includes(path));
    return { type: path === '/tmp' ? 0xef53 : 0x01021994, blocks: 1000, bsize: 4096, bavail: path === '/tmp' ? 0 : 200, ffree: 300 };
  });
  assert.deepEqual(snapshot['/tmp'], { type: 0xef53, totalBytes: 4096000, availableBytes: 0, availableInodes: 300 });
  assert.equal(snapshot['/dev/shm'].availableBytes, 819200);
});

test('unavailable filesystems never mask the original render error', async () => {
  const snapshot = await filesystemSnapshot(['/tmp', '/dev/shm'], async () => { throw new Error('not supported'); });
  assert.deepEqual(snapshot, { '/tmp': null, '/dev/shm': null });
});
