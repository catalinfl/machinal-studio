import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createCredentialStore } from '../src/credential-store.mjs';
import { InstallerError } from '../src/errors.mjs';
import { API_KEY } from './helpers.mjs';

test('the Windows adapter loads lazily and delegates read, overwrite and delete to the native API', async () => {
  let loads = 0;
  let saved = null;
  const calls = [];
  class AsyncEntry {
    constructor(service, account) { calls.push([service, account]); }
    async getPassword() { return saved; }
    async setPassword(value) { saved = value; }
    async deleteCredential() { const existed = saved !== null; saved = null; return existed; }
  }
  const store = createCredentialStore({ platform: 'win32', load: async () => { loads++; return { AsyncEntry }; } });
  assert.equal(loads, 0);
  assert.equal(await store.read(), null);
  await store.write(API_KEY);
  assert.equal(await store.read(), API_KEY);
  await store.write('replacement');
  assert.equal(await store.read(), 'replacement');
  assert.equal(await store.delete(), true);
  assert.equal(await store.delete(), false);
  assert.equal(loads, 1);
  assert.deepEqual(calls, [['Machinal/mcp', 'MACHINAL_API_KEY'], ['direction.al/mcp', 'DIRECTION_API_KEY']]);
});

test('saved legacy credentials are read as fallback and removed on explicit delete', async () => {
  const values = new Map([['direction.al/mcp|DIRECTION_API_KEY', API_KEY]]);
  class AsyncEntry {
    constructor(service, account) { this.key = `${service}|${account}`; }
    async getPassword() { return values.get(this.key) ?? null; }
    async setPassword(value) { values.set(this.key, value); }
    async deleteCredential() { return values.delete(this.key); }
  }
  const store = createCredentialStore({ platform: 'win32', load: async () => ({ AsyncEntry }) });
  assert.equal(await store.read(), API_KEY);
  await store.write(`mach_${'b'.repeat(64)}`);
  assert.equal(await store.read(), `mach_${'b'.repeat(64)}`);
  assert.equal(await store.delete(), true);
  assert.equal(values.has('direction.al/mcp|DIRECTION_API_KEY'), false);
});

test('unsupported platforms do not load a native module or fall back to plaintext storage', () => {
  assert.equal(createCredentialStore({ platform: 'linux', load: () => assert.fail('Must not load') }), null);
});

test('native module and credential access failures are sanitized, including deletion failures', async () => {
  for (const method of ['read', 'write', 'delete']) {
    const store = createCredentialStore({ platform: 'win32', load: async () => { throw new Error(API_KEY); } });
    await assert.rejects(store[method](API_KEY), (error) => error instanceof InstallerError && !error.message.includes(API_KEY));
  }
  const fail = async () => { throw new Error(API_KEY); };
  class AsyncEntry {
    getPassword = fail;
    setPassword = fail;
    deleteCredential = fail;
  }
  const store = createCredentialStore({ platform: 'win32', load: async () => ({ AsyncEntry }) });
  for (const method of ['read', 'write', 'delete']) {
    await assert.rejects(store[method](API_KEY), (error) => error instanceof InstallerError && !error.message.includes(API_KEY));
  }
});

test('real Windows Credential Manager round-trips, replaces and deletes an isolated fake credential', {
  skip: process.platform !== 'win32' || process.env.MACHINAL_TEST_CREDENTIAL_MANAGER !== '1',
}, async (t) => {
  const store = createCredentialStore({ service: `Machinal/mcp-test/${randomUUID()}` });
  t.after(() => store.delete());
  assert.equal(await store.read(), null);
  await store.write(API_KEY);
  assert.equal(await store.read(), API_KEY);
  const replacement = `mach_${'b'.repeat(64)}`;
  await store.write(replacement);
  assert.equal(await store.read(), replacement);
  assert.equal(await store.delete(), true);
  assert.equal(await store.read(), null);
  assert.equal(await store.delete(), false);
});
