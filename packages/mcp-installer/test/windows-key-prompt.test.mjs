import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { promptWindowsKey } from '../src/windows-key-prompt.mjs';
import { API_KEY } from './helpers.mjs';

const options = { endpoint: 'http://127.0.0.1:8080/mcp', apiKeysURL: 'https://direction.al/api-keys', platform: 'win32' };

function dialog(output, inspect = () => {}, code = 0) {
  return (command, args, opts) => {
    inspect(command, args, opts);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.emit('close', 130); };
    child.stdin.once('finish', () => {
      child.stdout.write(output);
      child.emit('close', code);
    });
    return child;
  };
}

test('native key entry captures the masked dialog result privately, never passing a key as a subprocess argument', async () => {
  const answer = { action: 'replace', key: API_KEY, remember: true };
  const result = await promptWindowsKey({ ...options, spawn: dialog(JSON.stringify(answer), (command, args, opts) => {
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-STA'));
    assert.ok(!JSON.stringify(args).includes(API_KEY));
    assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.env.MACHINAL_AUTH_ENDPOINT, options.endpoint);
    assert.equal(opts.env.MACHINAL_AUTH_KEYS_URL, options.apiKeysURL);
  }) });
  assert.deepEqual(result, answer);
});

test('closing the native key dialog cancels without returning a secret', async () => {
  assert.equal(await promptWindowsKey({ ...options, spawn: dialog('null') }), null);
});

test('native dialog failures never expose captured credentials or PowerShell diagnostics', async () => {
  for (const [output, code] of [[API_KEY, 0], [JSON.stringify({ key: API_KEY }), 1]]) {
    await assert.rejects(promptWindowsKey({ ...options, spawn: dialog(output, undefined, code) }), (error) => !error.message.includes(API_KEY));
  }
});

test('unsupported platforms and cancelled operations do not attempt to launch a password prompt', async () => {
  const spawn = () => assert.fail('No dialog should launch');
  await assert.rejects(promptWindowsKey({ ...options, platform: 'linux', spawn }), /available on Windows/);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await promptWindowsKey({ ...options, signal: controller.signal, spawn }), null);
});
