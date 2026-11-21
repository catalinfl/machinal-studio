import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { parse } from 'jsonc-parser';
import { configureOpenCodeAuth, OPENCODE_AUTH_PLUGIN } from '../src/opencode-configuration.mjs';
import { installOpenCodeAuth } from '../src/opencode-auth.mjs';
import { InstallerError } from '../src/errors.mjs';
import { API_KEY, memoryCredentialStore } from './helpers.mjs';

const ENDPOINT = 'http://127.0.0.1:8080/mcp';
const REPLACEMENT = `mach_${'b'.repeat(64)}`;

function host(endpoint = ENDPOINT) {
  const original = new Map([
    ['machinal', { type: 'remote', url: endpoint, oauth: false, headers: { Authorization: 'Bearer {env:MACHINAL_API_KEY}', 'X-Keep': 'yes' } }],
    ['other', { type: 'remote', url: 'https://other.example/mcp', headers: { Authorization: 'keep' } }],
  ]);
  const transforms = [];
  const hooks = [];
  const events = new EventEmitter();
  let current;
  const tools = new Map();
  const apply = () => {
    current = structuredClone(original);
    const editor = { get: (name) => current.get(name), update: (name, fn) => fn(current.get(name)), remove: name => current.delete(name) };
    for (const transform of transforms) transform(editor);
  };
  const ctx = {
    options: { servers: { machinal: ENDPOINT } },
    mcp: {
      transform: async (fn) => { transforms.push(fn); apply(); },
      reload: async () => { apply(); events.emit('reload'); },
      list: async () => ({ data: [...current].map(([name, config]) => ({ name, status: { status: config.disabled ? 'disabled' : 'connected' } })) }),
    },
    tool: { transform: async (fn) => fn({
      add: (definition) => { tools.set(definition.name, definition); },
      update: () => {},
    }) },
    session: { hook: async (_, fn) => { hooks.push(fn); } },
  };
  return {
    ctx, original, events, current: () => current,
    execute: async (action, server) => JSON.parse((await tools.get('machinal_connection').execute({ action, ...(server ? { server } : {}) }, { signal: new AbortController().signal, progress: async () => {} })).content),
    system: async () => {
      const event = { system: [] };
      for (const hook of hooks) await hook(event);
      return event.system.map((part) => part.text).join('\n');
    },
  };
}

test('OpenCode gets the one saved key in memory without a launcher, an environment variable or a plaintext config write', async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: store, env: { MACHINAL_API_KEY: REPLACEMENT } }));
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(h.current().get('machinal').headers['X-Keep'], 'yes');
  assert.equal(h.original.get('machinal').headers.Authorization, 'Bearer {env:MACHINAL_API_KEY}');
  assert.deepEqual(h.current().get('other'), h.original.get('other'));
  const result = await h.execute('status');
  assert.equal(result.source, 'saved');
  assert.deepEqual(result.credentialStore, {
    name: 'Windows Credential Manager', service: 'Machinal/mcp', account: 'MACHINAL_API_KEY',
    target: 'Machinal/mcp.MACHINAL_API_KEY', supported: true, status: 'found',
  });
  assert.deepEqual(result.registrations, [{ name: 'machinal', endpoint: ENDPOINT, configuration: 'matched' }]);
  assert.deepEqual(result.servers, [{ name: 'machinal', status: 'connected' }]);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.deepEqual(store.calls, ['read']);
});

test('canonical machinal suppresses a duplicate legacy MCP endpoint without touching other servers', async t => {
  const h = host();
  h.original.set('directional', structuredClone(h.original.get('machinal')));
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: memoryCredentialStore(API_KEY), env: {} }));
  assert.equal(h.current().has('directional'), false);
  assert.equal(h.current().has('machinal'), true);
  assert.deepEqual(h.current().get('other'), h.original.get('other'));
});

test('authentication configuration drops only the matching legacy plugin registration', () => {
  const content = JSON.stringify({ plugins: [{ package: OPENCODE_AUTH_PLUGIN, options: { servers: { directional: ENDPOINT, other: 'https://other.example/mcp' } } }] });
  const config = parse(configureOpenCodeAuth(content, 'machinal', ENDPOINT));
  assert.deepEqual(config.plugins[0].options.servers, { machinal: ENDPOINT, other: 'https://other.example/mcp' });
});

test('a project cannot redirect the saved key to a different MCP endpoint', async (t) => {
  const h = host('https://untrusted.example/mcp');
  t.after(await installOpenCodeAuth(h.ctx, {
    credentialStore: memoryCredentialStore(API_KEY), env: {}, verify: async () => assert.fail('Must not send a key'),
  }));
  assert.equal(h.current().get('machinal').headers.Authorization, 'Bearer {env:MACHINAL_API_KEY}');
  const result = await h.execute('reconnect');
  assert.equal(result.code, 'server-configuration');
  assert.equal(result.nextAction, 'check-setup');
  assert.equal(result.registrations[0].configuration, 'mismatch');
});

test('disconnected MCP discovery and exact vault instructions remain available under a custom server name', async (t) => {
  const h = host();
  h.original.set('video-tools', h.original.get('machinal'));
  h.original.delete('machinal');
  h.ctx.options.servers = { 'video-tools': ENDPOINT };
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: memoryCredentialStore(API_KEY), env: {} }));
  h.ctx.mcp.list = async () => ({ data: [{ name: 'video-tools', status: { status: 'failed' } }] });
  const result = await h.execute('status');
  assert.deepEqual(result.servers, [{ name: 'video-tools', status: 'failed' }]);
  assert.equal(result.registrations[0].name, 'video-tools');
  const instructions = await h.system();
  for (const text of ['search the tool catalog', 'video-tools', ENDPOINT, 'immediately call machinal_connection',
    'Machinal/mcp.MACHINAL_API_KEY', 'account MACHINAL_API_KEY', 'not the model or shell',
    'An unreadable vault is not an absent key', 'ambiguous paid submissions', 'code/nextAction']) {
    assert.ok(instructions.includes(text), `Missing support guidance: ${text}`);
  }
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.ok(!instructions.includes(API_KEY));
});

test('status works without registrations and does not mistake a missing MCP for a missing key', async (t) => {
  const h = host();
  h.ctx.options.servers = {};
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: memoryCredentialStore(API_KEY), env: {} }));
  const result = await h.execute('status');
  assert.deepEqual(result.registrations, []);
  assert.deepEqual(result.servers, []);
  assert.equal(result.hasKey, true);
  assert.equal((await h.execute('reconnect')).code, 'server-not-registered');
});

test('missing MCP definitions and incompatible authentication are diagnosed before sending a key', async (t) => {
  for (const config of [null, { type: 'remote', url: ENDPOINT, oauth: true }]) {
    const h = host();
    if (config) h.original.set('machinal', config);
    else h.original.delete('machinal');
    t.after(await installOpenCodeAuth(h.ctx, {
      credentialStore: memoryCredentialStore(API_KEY), env: {}, verify: async () => assert.fail('Must not send a key'),
    }));
    const result = await h.execute('reconnect');
    assert.equal(result.code, 'server-configuration');
    assert.equal(result.registrations[0].configuration, config ? 'mismatch' : 'missing');
  }
});

test('multiple approved registrations require an explicit server instead of guessing which endpoint should receive the key', async (t) => {
  const h = host();
  h.ctx.options.servers.team = 'https://team.example/mcp';
  h.original.set('team', { type: 'remote', url: 'https://team.example/mcp', oauth: false });
  let verifiedEndpoint;
  t.after(await installOpenCodeAuth(h.ctx, {
    credentialStore: memoryCredentialStore(API_KEY), env: {}, verify: async (endpoint) => { verifiedEndpoint = endpoint; },
  }));
  const result = await h.execute('reconnect');
  assert.equal(result.code, 'server-required');
  assert.equal(result.nextAction, 'select-server');
  assert.equal(verifiedEndpoint, undefined);
  await h.execute('reconnect', 'team');
  assert.equal(verifiedEndpoint, 'https://team.example/mcp');
});

test('the compatibility launcher can deliberately choose an environment/session key without reading the vault', async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: store, env: { MACHINAL_API_KEY: REPLACEMENT, MACHINAL_MCP_USE_ENV_KEY: '1' } }));
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${REPLACEMENT}`);
  assert.deepEqual(store.calls, []);
});

test('changing the saved credential automatically updates MCP headers in an already running OpenCode', { timeout: 3000 }, async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: store, env: {}, intervalMs: 10 }));
  const reloaded = new Promise((resolve) => h.events.once('reload', resolve));
  await store.write(REPLACEMENT);
  await reloaded;
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${REPLACEMENT}`);
});

test('reconnect reads the vault and reconnects the existing MCP without launching or restarting OpenCode', async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  let verified = false;
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: store, env: {}, verify: async (url, key) => {
    assert.equal(url, ENDPOINT);
    assert.equal(key, API_KEY);
    verified = true;
  } }));
  const result = await h.execute('reconnect');
  assert.ok(verified);
  assert.deepEqual(result.servers, [{ name: 'machinal', status: 'connected' }]);
  assert.deepEqual(store.calls, ['read', 'read']);
});

test('reconnect immediately reloads a changed saved key before verifying, instead of retrying a stale key', async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  t.after(await installOpenCodeAuth(h.ctx, {
    credentialStore: store, env: {}, verify: async (_, key) => assert.equal(key, REPLACEMENT),
  }));
  await store.write(REPLACEMENT);
  const result = await h.execute('reconnect');
  assert.equal(result.source, 'saved');
  assert.deepEqual(store.calls, ['read', 'write', 'read']);
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${REPLACEMENT}`);
});

test('missing or malformed credentials request secure entry only after reading the vault again', async (t) => {
  for (const value of [null, 'invalid']) {
    const h = host();
    const store = memoryCredentialStore(value);
    t.after(await installOpenCodeAuth(h.ctx, {
      credentialStore: store, env: {}, verify: async () => assert.fail('No usable key'),
      prompt: async () => assert.fail('Do not automatically open secure entry'),
    }));
    const result = await h.execute('reconnect');
    assert.equal(result.code, 'no-usable-key');
    assert.equal(result.nextAction, 'replace');
    assert.deepEqual(store.calls, ['read', 'read']);
    assert.equal(store.peek(), value);
  }
});

test('an unreadable vault is not diagnosed as an absent key and does not open replacement', async (t) => {
  const h = host();
  t.after(await installOpenCodeAuth(h.ctx, {
    credentialStore: { read: async () => { throw new Error(API_KEY); } }, env: {},
    prompt: async () => assert.fail('Do not replace on vault failure'),
  }));
  const result = await h.execute('reconnect');
  assert.equal(result.code, 'credential-store-unavailable');
  assert.equal(result.nextAction, 'retry-credential-store');
  assert.equal(result.credentialStore.status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes(API_KEY));
});

test('MCP state lookup failures return sanitized diagnostics rather than exposing an exception or claiming success', async (t) => {
  const h = host();
  t.after(await installOpenCodeAuth(h.ctx, { credentialStore: memoryCredentialStore(API_KEY), env: {} }));
  h.ctx.mcp.list = async () => { throw new Error(API_KEY); };
  const result = await h.execute('status');
  assert.deepEqual(result.servers, []);
  assert.match(result.connectionWarning, /No connection success was assumed/);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.equal((await h.execute('reconnect')).nextAction, 'check-endpoint');
});

test('secure replacement verifies before writing, connects automatically and never returns the key', async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  let verified = false;
  t.after(await installOpenCodeAuth(h.ctx, {
    credentialStore: store, env: {},
    prompt: async (options) => { assert.match(options.apiKeysURL, /machinal\.app\/api-keys/); return { action: 'replace', key: REPLACEMENT, remember: true }; },
    verify: async (_, key) => { assert.equal(key, REPLACEMENT); assert.equal(store.peek(), API_KEY); verified = true; },
  }));
  const result = await h.execute('replace');
  assert.ok(verified);
  assert.equal(store.peek(), REPLACEMENT);
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${REPLACEMENT}`);
  assert.deepEqual(result.servers, [{ name: 'machinal', status: 'connected' }]);
  assert.ok(!JSON.stringify(result).includes(API_KEY) && !JSON.stringify(result).includes(REPLACEMENT));
});

test('cancelled or rejected replacement preserves the one saved key and the working connection', async (t) => {
  for (const cancelled of [true, false]) {
    const h = host();
    const store = memoryCredentialStore(API_KEY);
    t.after(await installOpenCodeAuth(h.ctx, {
      credentialStore: store, env: {}, prompt: async () => cancelled ? null : { action: 'replace', key: REPLACEMENT, remember: true },
      verify: async () => { throw new InstallerError('Authentication failed', { status: 401 }); },
    }));
    const result = await h.execute('replace');
    assert.equal(store.peek(), API_KEY);
    assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(store.calls, ['read']);
    if (cancelled) assert.equal(result.cancelled, true);
    else {
      assert.match(result.error, /rejected/);
      assert.equal(result.code, 'key-rejected');
      assert.equal(result.nextAction, 'replace');
    }
  }
});

test('network and membership failures do not delete a key or demand repeated key creation', async (t) => {
  for (const status of [undefined, 402, 403, 429]) {
    const h = host();
    const store = memoryCredentialStore(API_KEY);
    t.after(await installOpenCodeAuth(h.ctx, {
      credentialStore: store, env: {}, verify: async () => { throw new InstallerError(API_KEY, { status }); },
    }));
    const result = await h.execute('reconnect');
    assert.equal(store.peek(), API_KEY);
    assert.ok(!JSON.stringify(result).includes(API_KEY));
    assert.match(result.error, status === 429 ? /rate limited/ : status ? /do not generate more API keys/ : /network failures/);
    assert.equal(result.nextAction, status === 429 ? 'retry-later' : status ? 'check-account' : 'check-endpoint');
    assert.deepEqual(store.calls, ['read', 'read']);
  }
});

test('a session-only replacement remains active without overwriting the stored key', { timeout: 3000 }, async (t) => {
  const h = host();
  const store = memoryCredentialStore(API_KEY);
  t.after(await installOpenCodeAuth(h.ctx, {
    credentialStore: store, env: {}, intervalMs: 10,
    prompt: async () => ({ action: 'replace', key: REPLACEMENT, remember: false }), verify: async () => {},
  }));
  const result = await h.execute('replace');
  assert.equal(result.source, 'session');
  assert.equal(store.peek(), API_KEY);
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${REPLACEMENT}`);
  const reconnected = await h.execute('reconnect');
  assert.equal(reconnected.source, 'session');
  assert.equal(h.current().get('machinal').headers.Authorization, `Bearer ${REPLACEMENT}`);
  assert.deepEqual(store.calls, ['read']);
});

test('automatic authentication configuration preserves other plugins and merges server registrations idempotently', () => {
  const before = '{\r\n  // Keep me\r\n  "plugins": ["other-plugin"],\r\n  "model": "keep"\r\n}\r\n';
  const first = configureOpenCodeAuth(before, 'machinal', ENDPOINT);
  const second = configureOpenCodeAuth(first, 'custom-team', 'https://api.example.com/mcp');
  const config = parse(second);
  assert.equal(config.plugins[0], 'other-plugin');
  assert.equal(config.plugins[1].package, OPENCODE_AUTH_PLUGIN);
  assert.deepEqual(config.plugins[1].options.servers, { machinal: ENDPOINT, 'custom-team': 'https://api.example.com/mcp' });
  assert.equal(config.model, 'keep');
  assert.ok(second.includes('// Keep me\r\n'));
  assert.equal(configureOpenCodeAuth(second, 'custom-team', 'https://api.example.com/mcp'), second);
});
