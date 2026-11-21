import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { launchClient } from '../src/launch.mjs';
import { API_KEY, workspace } from './helpers.mjs';

test('launch injects the key into the child environment, not its arguments or the parent', async () => {
  const env = { PATH: 'existing-path', OTHER: 'keep' };
  let invocation;
  const spawn = (...args) => {
    invocation = args;
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  };
  assert.equal(await launchClient('opencode', API_KEY, { env, args: ['mini'], spawn }), 0);
  assert.deepEqual(invocation[1], ['--standalone', 'mini']);
  assert.equal(invocation[2].env.MACHINAL_API_KEY, API_KEY);
  assert.equal(invocation[2].env.DIRECTION_API_KEY, API_KEY);
  assert.equal(invocation[2].env.MACHINAL_MCP_USE_ENV_KEY, '1');
  assert.equal(invocation[2].env.OTHER, 'keep');
  assert.equal(invocation[2].stdio, 'inherit');
  assert.equal(env.MACHINAL_API_KEY, undefined);
  assert.equal(env.DIRECTION_API_KEY, undefined);
  assert.ok(!invocation[1].includes(API_KEY));
});

test('Claude/Codex arguments are forwarded unchanged and exit codes propagate', async () => {
  for (const client of ['claude', 'codex']) {
    const spawn = (command, args) => {
      assert.equal(command, client);
      assert.deepEqual(args, ['--help']);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 7, null));
      return child;
    };
    assert.equal(await launchClient(client, API_KEY, { args: ['--help'], spawn }), 7);
  }
});

test('missing client errors are sanitized and invalid launch targets are refused', async () => {
  const spawn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error(API_KEY)));
    return child;
  };
  await assert.rejects(launchClient('codex', API_KEY, { spawn }), (error) => error.message.includes('PATH') && !error.message.includes(API_KEY));
  await assert.rejects(launchClient('arbitrary-command', API_KEY));
  await assert.rejects(launchClient('opencode', API_KEY, { args: ['--server=https://remote.example'] }), /private OpenCode/);
});

test('real client executable/shim receives the key through the environment and preserves spaced arguments', async (t) => {
  const cwd = await workspace(t);
  const resultFile = join(cwd, 'result.json');
  const probe = `const fs = require('node:fs');
fs.writeFileSync(process.env.DIRECTION_TEST_RESULT, JSON.stringify({
  hasKey: process.env.MACHINAL_API_KEY === ${JSON.stringify(API_KEY)},
  args: process.argv.slice(2)
}));\n`;
  if (process.platform === 'win32') {
    await writeFile(join(cwd, 'probe.cjs'), probe);
    await writeFile(join(cwd, 'codex.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0probe.cjs" %*\r\n`);
  } else {
    await writeFile(join(cwd, 'codex'), `#!${process.execPath}\n${probe}`, { mode: 0o755 });
  }
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const env = { ...process.env, [pathKey]: `${cwd}${process.platform === 'win32' ? ';' : ':'}${process.env[pathKey]}`, DIRECTION_TEST_RESULT: resultFile };
  const args = ['argument with spaces', '--help'];
  assert.equal(await launchClient('codex', API_KEY, { cwd, env, args }), 0);
  const output = await readFile(resultFile, 'utf8');
  assert.deepEqual(JSON.parse(output), { hasKey: true, args });
  assert.ok(!output.includes(API_KEY));
});
