import assert from 'node:assert/strict';
import test from 'node:test';
import { manageKey, offerKeyStorage, readKey } from '../src/keys.mjs';
import { API_KEY, memoryCredentialStore } from './helpers.mjs';

function context(overrides = {}) {
  return {
    env: {}, interactive: true, log: () => {}, credentialStore: memoryCredentialStore(),
    ui: { password: async () => API_KEY, confirm: async () => false, select: async () => 'reuse' },
    ...overrides,
  };
}

test('keeping an environment key does not read saved credentials', async () => {
  const ctx = context({ env: { MACHINAL_API_KEY: API_KEY } });
  assert.deepEqual(await readKey(ctx), { key: API_KEY, source: 'environment' });
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('the old environment variable remains a supported migration alias', async () => {
  const ctx = context({ env: { DIRECTION_API_KEY: API_KEY } });
  assert.deepEqual(await readKey(ctx), { key: API_KEY, source: 'environment' });
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('saved keys work without a terminal or password prompt', async () => {
  const ctx = context({ credentialStore: memoryCredentialStore(API_KEY), interactive: false, ui: {} });
  assert.deepEqual(await readKey(ctx), { key: API_KEY, source: 'saved' });
});

test('missing saved keys fall back to hidden entry, or fail without an interactive terminal', async () => {
  const ctx = context();
  assert.deepEqual(await readKey(ctx), { key: API_KEY, source: 'prompt' });
  assert.equal(ctx.credentialStore.peek(), null);
  await assert.rejects(readKey(context({ interactive: false, ui: {} })), /No API key is available/);
});

test('--session-key bypasses saved credentials and disables the storage offer', async () => {
  const ctx = context({ credentialStore: memoryCredentialStore(`mach_${'b'.repeat(64)}`) });
  const credentials = await readKey(ctx, { sessionOnly: true });
  assert.deepEqual(credentials, { key: API_KEY, source: 'prompt' });
  await offerKeyStorage(credentials, ctx, { sessionOnly: true });
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('invalid saved keys provide recovery instructions without leaking their contents', async () => {
  const invalid = 'sensitive-corrupt-credential';
  const ctx = context({ credentialStore: memoryCredentialStore(invalid), interactive: false });
  await assert.rejects(readKey(ctx), (error) => /key set.*key delete.*--session-key/.test(error.message) && !error.message.includes(invalid));
  assert.equal(ctx.credentialStore.peek(), invalid);
});

for (const source of ['saved', 'environment']) {
  for (const action of ['key', 'create']) {
    test(`an interactive ${source} key can be replaced via ${action} without changing the saved key or environment`, async () => {
      const replacement = `mach_${'b'.repeat(64)}`;
      const logs = [];
      const env = source === 'environment' ? { MACHINAL_API_KEY: API_KEY } : {};
      const ctx = context({ env, credentialStore: memoryCredentialStore(API_KEY), log: (message) => logs.push(message), ui: {
        select: async (question) => {
          assert.equal(question.default, 'reuse');
          assert.deepEqual(question.choices.map((choice) => choice.value), ['reuse', 'key', 'create', 'cancel']);
          assert.ok(!JSON.stringify(question).includes(API_KEY));
          assert.equal(question.choices.find((choice) => choice.value === 'create').description, 'https://machinal.app/api-keys');
          return action;
        },
        password: async (question) => { assert.equal(question.mask, '*'); return replacement; },
      } });
      assert.deepEqual(await readKey(ctx), { key: replacement, source: 'prompt' });
      assert.equal(ctx.credentialStore.peek(), API_KEY);
      assert.deepEqual(ctx.credentialStore.calls, source === 'saved' ? ['read'] : []);
      assert.deepEqual(env, source === 'environment' ? { MACHINAL_API_KEY: API_KEY } : {});
      assert.match(logs.join('\n'), /open https:\/\/machinal\.app\/api-keys/);
      assert.ok(!logs.join('\n').includes(API_KEY) && !logs.join('\n').includes(replacement));
    });
  }
}

test('malformed saved and environment keys offer hidden replacement instead of blocking interactive recovery', async () => {
  const invalid = 'sensitive-corrupt-credential';
  for (const source of ['saved', 'environment']) {
    const logs = [];
    const ctx = context({
      env: source === 'environment' ? { MACHINAL_API_KEY: invalid } : {},
      credentialStore: memoryCredentialStore(invalid), log: (message) => logs.push(message),
    });
    ctx.ui.select = async (question) => {
      assert.equal(question.default, 'key');
      assert.ok(!question.choices.some((choice) => choice.value === 'reuse'));
      assert.ok(!JSON.stringify(question).includes(invalid));
      return 'key';
    };
    assert.deepEqual(await readKey(ctx), { key: API_KEY, source: 'prompt' });
    assert.equal(ctx.credentialStore.peek(), invalid);
    assert.match(logs.join('\n'), /invalid format/);
    assert.ok(!logs.join('\n').includes(invalid));
  }
});

test('cancelling key selection or hidden replacement preserves credentials', async () => {
  for (const key of [API_KEY, 'sensitive-corrupt-credential']) {
    const ctx = context({ credentialStore: memoryCredentialStore(key) });
    ctx.ui.select = async () => 'cancel';
    ctx.ui.password = async () => assert.fail('Cancellation must not prompt for a key');
    await assert.rejects(readKey(ctx), /Cancelled.*not changed/);
    assert.equal(ctx.credentialStore.peek(), key);
    assert.deepEqual(ctx.credentialStore.calls, ['read']);
  }
  const ctx = context({ credentialStore: memoryCredentialStore(API_KEY) });
  ctx.ui.select = async () => 'key';
  ctx.ui.password = async () => { throw new Error('User cancelled hidden entry'); };
  await assert.rejects(readKey(ctx), /cancelled hidden entry/);
  assert.equal(ctx.credentialStore.peek(), API_KEY);
  assert.deepEqual(ctx.credentialStore.calls, ['read']);
});

test('remembering a key requires opt-in with a default-no prompt', async () => {
  for (const consent of [false, true]) {
    const ctx = context({ ui: { confirm: async (question) => {
      assert.match(question.message, /Remember/);
      assert.equal(question.default, false);
      return consent;
    } } });
    await offerKeyStorage({ key: API_KEY, source: 'prompt' }, ctx);
    assert.equal(ctx.credentialStore.peek(), consent ? API_KEY : null);
  }
});

test('a different environment key needs explicit replacement consent; an identical saved key does not prompt', async () => {
  const replacement = `mach_${'b'.repeat(64)}`;
  const ctx = context({ credentialStore: memoryCredentialStore(API_KEY), ui: { confirm: async (question) => {
    assert.match(question.message, /Replace/);
    assert.equal(question.default, false);
    return false;
  } } });
  await offerKeyStorage({ key: replacement, source: 'environment' }, ctx);
  assert.equal(ctx.credentialStore.peek(), API_KEY);
  ctx.ui = {};
  await offerKeyStorage({ key: API_KEY, source: 'environment' }, ctx);
});

test('unattended, already-saved, and unsupported-platform sessions never offer storage', async () => {
  const ctx = context({ ui: {} });
  await offerKeyStorage({ key: API_KEY, source: 'saved' }, ctx);
  await offerKeyStorage({ key: API_KEY, source: 'environment' }, { ...ctx, interactive: false });
  await offerKeyStorage({ key: API_KEY, source: 'prompt' }, { ...ctx, credentialStore: null });
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('a failed storage offer reports a sanitized warning and still permits session-only use', async () => {
  for (const operation of ['read', 'write']) {
    const logs = [];
    const credentialStore = memoryCredentialStore();
    credentialStore[operation] = async () => { throw new Error(API_KEY); };
    const ctx = context({ credentialStore, log: (message) => logs.push(message), ui: { confirm: async () => true } });
    await offerKeyStorage({ key: API_KEY, source: 'prompt' }, ctx);
    assert.equal(credentialStore.peek(), null);
    assert.match(logs.join('\n'), /Warning/);
    assert.ok(!logs.join('\n').includes(API_KEY));
  }
});

test('saving a replacement warns when a stale environment key will still take precedence', async () => {
  const replacement = `mach_${'b'.repeat(64)}`;
  const logs = [];
  const ctx = context({ env: { MACHINAL_API_KEY: API_KEY }, log: (message) => logs.push(message), ui: { confirm: async () => true } });
  await offerKeyStorage({ key: replacement, source: 'prompt' }, ctx);
  assert.equal(ctx.credentialStore.peek(), replacement);
  assert.equal(ctx.env.MACHINAL_API_KEY, API_KEY);
  assert.match(logs.join('\n'), /different key and takes precedence/);
  assert.ok(!logs.join('\n').includes(API_KEY) && !logs.join('\n').includes(replacement));
});

test('declining replacement/deletion or entering an invalid new key preserves the old key', async () => {
  const ctx = context({ credentialStore: memoryCredentialStore(API_KEY) });
  assert.equal(await manageKey('set', {}, ctx), 0);
  assert.equal(await manageKey('delete', {}, ctx), 0);
  ctx.ui.password = async () => 'invalid';
  await assert.rejects(manageKey('set', {}, ctx), /complete machinal application key/);
  assert.equal(ctx.credentialStore.peek(), API_KEY);
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('key management refuses unsupported platforms and never silently deletes after an unknown action', async () => {
  await assert.rejects(manageKey('set', {}, context({ credentialStore: null })), /only on Windows/);
  const ctx = context({ credentialStore: memoryCredentialStore(API_KEY) });
  await assert.rejects(manageKey('invalid', { yes: true }, ctx), /Use key set or key delete/);
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('key set with an endpoint verifies the new key before confirmation or writing', async () => {
  const replacement = `mach_${'b'.repeat(64)}`;
  const events = [];
  const logs = [];
  const ctx = context({ credentialStore: memoryCredentialStore(API_KEY), log: (message) => logs.push(message) });
  ctx.ui.password = async () => { events.push('prompt'); return replacement; };
  ctx.checkConnection = async (url, key) => {
    events.push('verify');
    assert.equal(url, 'http://localhost:8080/mcp');
    assert.equal(key, replacement);
    assert.equal(ctx.credentialStore.peek(), API_KEY);
    assert.deepEqual(ctx.credentialStore.calls, []);
    return { toolCount: 3 };
  };
  ctx.ui.confirm = async (question) => {
    events.push('confirm');
    assert.equal(question.default, false);
    assert.equal(ctx.credentialStore.peek(), API_KEY);
    return true;
  };
  assert.equal(await manageKey('set', { url: 'http://localhost:8080' }, ctx), 0);
  assert.deepEqual(events, ['prompt', 'verify', 'confirm']);
  assert.deepEqual(ctx.credentialStore.calls, ['write']);
  assert.equal(ctx.credentialStore.peek(), replacement);
  assert.match(logs.join('\n'), /after successful MCP verification/);
  assert.match(logs.join('\n'), /without restarting OpenCode.*launch opencode/);
  assert.ok(!logs.join('\n').includes(API_KEY) && !logs.join('\n').includes(replacement));
});

test('failed replacement verification or declined saving never writes or deletes the existing key', async () => {
  for (const failure of [true, false]) {
    const ctx = context({ credentialStore: memoryCredentialStore(API_KEY) });
    ctx.ui.confirm = async () => {
      assert.ok(!failure, 'Failed verification must not offer saving');
      return false;
    };
    ctx.checkConnection = async () => { if (failure) throw new Error('Authentication failed (401)'); };
    if (failure) await assert.rejects(manageKey('set', { url: 'http://localhost:8080' }, ctx), /401/);
    else assert.equal(await manageKey('set', { url: 'http://localhost:8080' }, ctx), 0);
    assert.equal(ctx.credentialStore.peek(), API_KEY);
    assert.deepEqual(ctx.credentialStore.calls, []);
  }
});

test('key set rejects an unsafe endpoint before prompting or accessing credentials', async () => {
  const ctx = context({ ui: { password: async () => assert.fail('Must validate URL first') } });
  for (const url of [`https://${API_KEY}@example.com`, '']) {
    await assert.rejects(manageKey('set', { url }, ctx), (error) => !error.message.includes(API_KEY));
  }
  assert.deepEqual(ctx.credentialStore.calls, []);
});

test('interactive key entry validates inline and never returns entered credentials in errors', async () => {
  const logs = [];
  const ctx = context({ log: (message) => logs.push(message), ui: { password: async (question) => {
    assert.equal(question.validate(API_KEY), true);
    const invalid = question.validate('secret-invalid');
    assert.match(invalid, /https:\/\/machinal\.app\/api-keys/);
    assert.ok(!invalid.includes('secret-invalid'));
    return API_KEY;
  } } });
  assert.equal((await readKey(ctx)).key, API_KEY);
  assert.match(logs.join('\n'), /https:\/\/machinal\.app\/api-keys/);
});

test('an interactive vault outage falls back to hidden entry without exposing the vault error or mutating it', async () => {
  const logs = [];
  const ctx = context({ log: (message) => logs.push(message) });
  ctx.credentialStore.read = async () => { throw new Error('sensitive-vault-details'); };
  assert.deepEqual(await readKey(ctx), { key: API_KEY, source: 'prompt' });
  assert.match(logs.join('\n'), /Credential Manager is unavailable/);
  assert.ok(!logs.join('\n').includes('sensitive-vault-details'));
  assert.equal(ctx.credentialStore.peek(), null);
});
