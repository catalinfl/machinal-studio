import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import test from 'node:test';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { VERSION } from '../src/version.mjs';
import { run } from '../src/cli.mjs';
import { parseCreditSummary } from '../src/credits.mjs';
import { InstallerError } from '../src/errors.mjs';
import { API_KEY, CREDIT_SUMMARY, mcpHandler, memoryCredentialStore, runCLI, serve, workspace } from './helpers.mjs';

test('help and version work without a key or network', async (t) => {
  const cwd = await workspace(t);
  const help = await runCLI(['--help'], { cwd });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /npx @machinal\/mcp setup/);
  const version = await runCLI(['--version'], { cwd });
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), VERSION);
  assert.deepEqual(await readdir(cwd), []);
});

for (const client of ['opencode', 'claude', 'codex']) {
  test(`noninteractive ${client} setup validates and writes only environment references`, async (t) => {
    const cwd = await workspace(t);
    const calls = [];
    const endpoint = await serve(t, mcpHandler(calls));
    const args = ['setup', '--client', client, '--url', endpoint, '--yes', '--no-launch'];
    const result = await runCLI(args, { cwd, env: { MACHINAL_API_KEY: API_KEY } });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Configured: 3 API tools verified/);
    assert.doesNotMatch(result.stdout, /Connected:/);
    assert.match(result.stdout, /no client was started or connected/);
    assert.match(result.stdout, /MCP verified: 3 tools\. Saving client configuration/);
    assert.match(result.stdout, /API credits: 900 available/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(API_KEY));
    const file = client === 'opencode' ? join(cwd, 'opencode.jsonc') : client === 'claude' ? join(cwd, '.mcp.json') : join(cwd, '.codex', 'config.toml');
    const content = await readFile(file, 'utf8');
    assert.ok(!content.includes(API_KEY));
    assert.ok(content.includes('MACHINAL_API_KEY'));
    const skillRoot = join(cwd, client === 'opencode' ? '.opencode' : client === 'claude' ? '.claude' : '.agents', 'skills');
    assert.match(await readFile(join(skillRoot, 'machinal-credits', 'SKILL.md'), 'utf8'), /get_credits/);
    if (client === 'codex') assert.equal(getStaticTOMLValue(parseTOML(content)).mcp_servers.machinal.url, endpoint);
    const repeated = await runCLI(args, { cwd, env: { MACHINAL_API_KEY: API_KEY } });
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.match(repeated.stdout, /already up to date/);
    assert.ok(calls.every((call) => call.method !== 'tools/call' || call.tool === 'get_credits'));
  });
}

test('failed authentication never writes or backs up configuration and never logs the key', async (t) => {
  const cwd = await workspace(t);
  const original = '{"model":"keep"}';
  const file = join(cwd, 'opencode.jsonc');
  await writeFile(file, original);
  const endpoint = await serve(t, (_request, response) => { response.writeHead(401).end(API_KEY); });
  const result = await runCLI(['setup', '--client', 'opencode', '--url', endpoint, '--yes'], { cwd, env: { MACHINAL_API_KEY: API_KEY } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /401/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(API_KEY));
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(await readdir(cwd), ['opencode.jsonc']);
});

test('--yes does not silently authorize replacing a server, while --replace preserves other settings and backs up', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, mcpHandler());
  const original = JSON.stringify({ mcpServers: { machinal: { type: 'http', url: 'https://old.example/mcp' }, docs: { command: 'keep' } } });
  const file = join(cwd, '.mcp.json');
  await writeFile(file, original);
  const args = ['setup', '--client', 'claude', '--url', endpoint, '--yes'];
  const result = await runCLI(args, { cwd, env: { MACHINAL_API_KEY: API_KEY } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--replace/);
  assert.equal(await readFile(file, 'utf8'), original);
  const replaced = await runCLI([...args, '--replace'], { cwd, env: { MACHINAL_API_KEY: API_KEY } });
  assert.equal(replaced.code, 0, replaced.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).mcpServers.docs, { command: 'keep' });
  const backup = (await readdir(cwd)).find((name) => name.includes('machinal-backup'));
  assert.equal(await readFile(join(cwd, backup), 'utf8'), original);
});

test('missing input fails without prompting forever or writing files', async (t) => {
  const cwd = await workspace(t);
  for (const args of [[], ['setup', '--client', 'opencode'], ['setup', '--client', 'opencode', '--url', 'http://127.0.0.1:8080', '--yes', '--session-key']]) {
    const result = await runCLI(args, { cwd });
    assert.equal(result.code, 1);
    assert.ok(result.stderr.length > 0);
  }
  assert.deepEqual(await readdir(cwd), []);
});

test('unknown options, malformed config, and unsafe URLs never echo secrets from input', async (t) => {
  const cwd = await workspace(t);
  const attempts = [
    ['setup', `--api-key=${API_KEY}`],
    ['setup', '--client', 'opencode', '--url', `https://${API_KEY}@example.com`],
    ['setup', '--client', 'opencode', '--url', 'http://example.com/mcp'],
    ['launch', 'opencode', '--url', 'https://example.com'],
  ];
  for (const args of attempts) {
    const result = await runCLI(args, { cwd });
    assert.equal(result.code, 1);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(API_KEY));
  }
  await writeFile(join(cwd, 'opencode.jsonc'), `{${API_KEY}`);
  const result = await runCLI(['setup', '--client', 'opencode', '--url', 'http://localhost:8080'], { cwd });
  assert.equal(result.code, 1);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(API_KEY));
});

test('interactive local setup installs its own skill and launches without keys or credits', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, mcpHandler());
  const logs = [];
  let sawMode = false;
  let enteredKey = false;
  let launched = false;
  const ui = {
    select: async (question) => {
      const choices = question.choices.map((choice) => choice.value);
      if (choices.includes('opencode')) return 'opencode';
      if (choices.includes('project')) return 'project';
      if (choices.includes('local')) { sawMode = true; return 'local'; }
      return 'cinematic';
    },
    input: async () => endpoint,
    confirm: async () => true,
    password: async (question) => { assert.equal(question.mask, '*'); enteredKey = true; return API_KEY; },
  };
  const code = await run(['setup'], {
    cwd, env: {}, interactive: true, ui, log: (message) => logs.push(message), credentialStore: null,
    checkConnection: async (_url, key, options) => { assert.equal(key, undefined); assert.equal(options.local, true); return { mode: 'local', toolCount: 39 }; },
    launch: async (client, key) => {
      assert.equal(client, 'opencode');
      assert.equal(key, null);
      launched = true;
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.ok(sawMode && !enteredKey && launched);
  assert.doesNotMatch(logs.join('\n'), /API credits: 900 available/);
  assert.match(logs.join('\n'), /no machinal account/);
  assert.ok(!logs.join('\n').includes(API_KEY));
  const preferences = await readFile(join(cwd, '.opencode', 'skills', 'machinal-local', 'SKILL.md'), 'utf8');
  assert.match(preferences, /cinematic/);
  assert.ok(!preferences.includes(API_KEY));
});

test('interactive setup has one compact success summary; --verbose restores full details', async (t) => {
  const cwd = await workspace(t);
  const args = ['setup', '--client', 'codex', '--scope', 'global', '--url', 'https://api.example/mcp', '--no-skills', '--no-launch'];
  const summaries = [];
  for (const verbose of [false, true]) {
    const logs = [];
    const code = await run([...args, ...(verbose ? ['--verbose'] : [])], {
      cwd, home: cwd, env: { MACHINAL_API_KEY: API_KEY }, interactive: true, credentialStore: null,
      ui: { select: async () => 'reuse' }, log: (message) => logs.push(message),
      checkConnection: async () => ({ toolCount: 31, credits: parseCreditSummary(CREDIT_SUMMARY) }),
      launch: () => assert.fail('Configure-only must not start a client'),
    });
    assert.equal(code, 0);
    const text = logs.join('\n');
    assert.ok(!text.includes(API_KEY));
    assert.equal(text.includes('Next monthly reset'), verbose);
    assert.equal(text.includes('USD 0.01/credit'), verbose);
    if (!verbose) {
      assert.equal(logs.filter((line) => line === 'Setup ready').length, 1);
      assert.match(text, /Client connection not checked/);
      assert.match(text, /Client not started/);
      assert.match(text, /API credits: 900 available/);
      assert.doesNotMatch(text, /Saving client configuration|Configured:|Warning: no client/);
    }
    summaries.push(logs);
  }
  assert.ok(summaries[0].length < summaries[1].length);
});

test('changed skills need separate explicit approval; --replace server permission is not enough', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, mcpHandler());
  const args = ['setup', '--client', 'claude', '--url', endpoint, '--yes', '--no-launch'];
  const options = { cwd, env: { MACHINAL_API_KEY: API_KEY } };
  assert.equal((await runCLI(args, options)).code, 0);
  const skill = join(cwd, '.claude', 'skills', 'machinal-editing', 'SKILL.md');
  await writeFile(skill, 'User editing rules');
  const refused = await runCLI([...args, '--replace'], options);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--replace-skills/);
  assert.equal(await readFile(skill, 'utf8'), 'User editing rules');
  const skipped = await runCLI([...args, '--no-skills'], options);
  assert.equal(skipped.code, 0);
  assert.equal(await readFile(skill, 'utf8'), 'User editing rules');
  const replaced = await runCLI([...args, '--replace-skills'], options);
  assert.equal(replaced.code, 0, replaced.stderr);
  const backup = (await readdir(join(cwd, '.claude', 'skills', 'machinal-editing'))).find((name) => name.includes('machinal-backup'));
  assert.equal(await readFile(join(cwd, '.claude', 'skills', 'machinal-editing', backup), 'utf8'), 'User editing rules');
});

test('--no-skills leaves client skill directories absent', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, mcpHandler());
  const result = await runCLI(['setup', '--client', 'claude', '--url', endpoint, '--yes', '--no-skills'], { cwd, env: { MACHINAL_API_KEY: API_KEY } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readdir(cwd), ['.mcp.json']);
});

test('launch offers to reuse a saved key without hidden entry, configuration changes or parent environment mutation', async () => {
  const credentialStore = memoryCredentialStore(API_KEY);
  const env = {};
  const logs = [];
  let launched = false;
  assert.equal(await run(['launch', 'opencode', '--', 'mini'], {
    env, credentialStore, interactive: true, log: (message) => logs.push(message),
    ui: { select: async (question) => {
      assert.deepEqual(question.choices.map((choice) => choice.value), ['reuse', 'key', 'create', 'cancel']);
      return 'reuse';
    } },
    launch: async (client, key, options) => {
      assert.equal(client, 'opencode');
      assert.equal(key, API_KEY);
      assert.deepEqual(options.args, ['mini']);
      launched = true;
      return 0;
    },
  }), 0);
  assert.ok(launched);
  assert.deepEqual(credentialStore.calls, ['read']);
  assert.deepEqual(env, {});
  assert.ok(!logs.join('\n').includes(API_KEY));
});

test('key set replaces the saved key through hidden entry, ignoring a stale environment key', async () => {
  const replacement = `mach_${'b'.repeat(64)}`;
  const credentialStore = memoryCredentialStore(API_KEY);
  const env = { MACHINAL_API_KEY: API_KEY };
  const logs = [];
  assert.equal(await run(['key', 'set'], {
    env, credentialStore, interactive: true, log: (message) => logs.push(message),
    ui: {
      password: async (question) => { assert.equal(question.mask, '*'); return replacement; },
      confirm: async (question) => { assert.equal(question.default, false); return true; },
    },
  }), 0);
  assert.equal(credentialStore.peek(), replacement);
  assert.deepEqual(credentialStore.calls, ['write']);
  assert.equal(env.MACHINAL_API_KEY, API_KEY);
  assert.match(logs.join('\n'), /still takes precedence/);
  assert.ok(!logs.join('\n').includes(API_KEY));
  assert.ok(!logs.join('\n').includes(replacement));
});

test('key set --url verifies hidden replacement against MCP before saving it, without launching clients', async (t) => {
  const replacement = `mach_${'b'.repeat(64)}`;
  const calls = [];
  const endpoint = await serve(t, mcpHandler(calls));
  const credentialStore = memoryCredentialStore(API_KEY);
  const logs = [];
  assert.equal(await run(['key', 'set', '--url', endpoint], {
    env: {}, credentialStore, interactive: true, log: (message) => logs.push(message),
    launch: async () => assert.fail('Key replacement must not restart clients automatically'),
    ui: {
      password: async (question) => { assert.equal(question.mask, '*'); return replacement; },
      confirm: async (question) => {
        assert.equal(question.default, false);
        assert.ok(calls.some((call) => call.tool === 'get_credits'));
        assert.equal(credentialStore.peek(), API_KEY);
        return true;
      },
    },
  }), 0);
  assert.equal(credentialStore.peek(), replacement);
  assert.deepEqual(credentialStore.calls, ['write']);
  assert.ok(calls.every((call) => call.headers.authorization === `Bearer ${replacement}`));
  assert.ok(calls.every((call) => call.method !== 'tools/call' || call.tool === 'get_credits'));
  assert.ok(!logs.join('\n').includes(API_KEY) && !logs.join('\n').includes(replacement));
});

test('key set --url preserves the old credential when the replacement is rejected', async (t) => {
  const endpoint = await serve(t, (_request, response) => response.writeHead(401).end(API_KEY));
  const credentialStore = memoryCredentialStore(API_KEY);
  const logs = [];
  await assert.rejects(run(['key', 'set', '--url', endpoint], {
    env: {}, credentialStore, interactive: true, log: (message) => logs.push(message),
    ui: {
      password: async () => `mach_${'b'.repeat(64)}`,
      confirm: async () => assert.fail('Rejected replacements must not be saved'),
    },
  }), (error) => /401/.test(error.message) && !error.message.includes(API_KEY));
  assert.equal(credentialStore.peek(), API_KEY);
  assert.deepEqual(credentialStore.calls, []);
  assert.ok(!logs.join('\n').includes(API_KEY));
});

test('key delete requires explicit consent, is idempotent and does not read or log the saved secret', async () => {
  const credentialStore = memoryCredentialStore(API_KEY);
  const logs = [];
  const context = { env: {}, credentialStore, interactive: false, ui: {}, log: (message) => logs.push(message) };
  await assert.rejects(run(['key', 'delete'], context), /explicitly confirm/);
  assert.equal(credentialStore.peek(), API_KEY);
  assert.equal(await run(['key', 'delete', '--yes'], context), 0);
  assert.equal(credentialStore.peek(), null);
  assert.equal(await run(['key', 'delete', '--yes'], context), 0);
  assert.deepEqual(credentialStore.calls, ['delete', 'delete']);
  assert.match(logs.join('\n'), /does not revoke/);
  assert.match(logs.join('\n'), /No API key was saved/);
  assert.ok(!logs.join('\n').includes(API_KEY));
});

test('key commands reject unsupported flags and secret arguments before accessing credentials', async () => {
  const credentialStore = memoryCredentialStore(API_KEY);
  for (const args of [
    ['key', 'set', '--yes'], ['key', 'set', '--session-key'], ['key', 'delete', '--url', 'https://example.com'],
    ['key', 'set', API_KEY], ['key', 'delete', '--', '--yes'], ['key', 'unknown'],
  ]) {
    await assert.rejects(run(args, { credentialStore, env: {}, interactive: false }), (error) => !error.message.includes(API_KEY));
  }
  assert.deepEqual(credentialStore.calls, []);
});

test('setup offers to save a hidden key only after verification and a keyed launch decision', async (t) => {
  const cwd = await workspace(t);
  const credentialStore = memoryCredentialStore();
  let verified = false;
  const endpoint = await serve(t, (request, response) => {
    verified = true;
    return mcpHandler()(request, response);
  });
  let launched = false;
  const code = await run(['setup', '--client', 'opencode', '--url', endpoint, '--no-skills'], {
    cwd, env: {}, interactive: true, credentialStore, log: () => {},
    launch: async (client, key) => {
      assert.equal(client, 'opencode');
      assert.equal(key, API_KEY);
      launched = true;
      return 0;
    },
    ui: {
      select: async () => 'project',
      password: async () => API_KEY,
      confirm: async (question) => {
        assert.ok(verified);
        if (question.message.startsWith('Start ')) {
          assert.equal(question.default, true);
          return true;
        }
        assert.match(question.message, /Remember/);
        assert.equal(question.default, false);
        return true;
      },
    },
  });
  assert.equal(code, 0);
  assert.ok(launched);
  assert.equal(credentialStore.peek(), API_KEY);
  assert.ok(!(await readFile(join(cwd, 'opencode.jsonc'), 'utf8')).includes(API_KEY));
});

test('failed authentication does not save a prompted key or replace an existing saved key', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, (_request, response) => response.writeHead(401).end());
  for (const saved of [null, `mach_${'b'.repeat(64)}`]) {
    const credentialStore = memoryCredentialStore(saved);
    await assert.rejects(run(['setup', '--client', 'opencode', '--scope', 'project', '--url', endpoint, '--no-skills'], {
      cwd, env: saved === null ? {} : { MACHINAL_API_KEY: API_KEY }, interactive: true, credentialStore, log: () => {},
      ui: { select: async (question) => question.default === 'reuse' ? 'reuse' : 'cancel', password: async () => API_KEY, confirm: async () => assert.fail('Must not offer storage on authentication failure') },
    }), /401/);
    assert.equal(credentialStore.peek(), saved);
    assert.deepEqual(credentialStore.calls, saved === null ? ['read'] : []);
  }
  assert.deepEqual(await readdir(cwd), []);
});

test('unattended setup refuses a vault-only key instead of saving an unusable environment reference', async (t) => {
  const cwd = await workspace(t);
  const credentialStore = memoryCredentialStore(API_KEY);
  const calls = [];
  const endpoint = await serve(t, mcpHandler(calls));
  await assert.rejects(run(['setup', '--client', 'codex', '--url', endpoint, '--no-skills', '--yes'], {
    cwd, env: {}, credentialStore, ui: {}, log: () => {},
  }), /not available in the client environment/);
  assert.deepEqual(credentialStore.calls, ['read']);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.headers.authorization === `Bearer ${API_KEY}`));
  assert.deepEqual(await readdir(cwd), []);
  assert.equal(credentialStore.peek(), API_KEY);
});

test('OpenCode Windows setup can use the one saved key without an environment variable or immediate launch', { skip: process.platform !== 'win32' }, async (t) => {
  const cwd = await workspace(t);
  const credentialStore = memoryCredentialStore(API_KEY);
  const code = await run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills', '--no-launch', '--yes'], {
    cwd, env: {}, credentialStore, log: () => {},
    checkConnection: async (_, key) => { assert.equal(key, API_KEY); return { toolCount: 3 }; },
    launch: async () => assert.fail('Automatic key loading must not require a separate launcher'),
  });
  assert.equal(code, 0);
  const content = await readFile(join(cwd, 'opencode.jsonc'), 'utf8');
  assert.match(content, /opencode-plugin/);
  assert.ok(!content.includes(API_KEY));
  assert.equal(credentialStore.peek(), API_KEY);
  assert.deepEqual(credentialStore.calls, ['read']);
});

for (const client of ['opencode', 'claude', 'codex']) {
  test(`${client} setup refuses --no-launch with a prompt-only key before any writes`, async (t) => {
    const cwd = await workspace(t);
    const credentialStore = memoryCredentialStore();
    const logs = [];
    await assert.rejects(run(['setup', '--client', client, '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills', '--no-launch'], {
      cwd, env: {}, credentialStore, interactive: true, log: (message) => logs.push(message),
      ui: {
        password: async () => API_KEY,
        confirm: async () => assert.fail('Must not save a key or launch with --no-launch'),
      },
      checkConnection: async (_, key) => {
        assert.equal(key, API_KEY);
        return { toolCount: 3, creditsWarning: 'Live credits unavailable: fixture' };
      },
      launch: async () => assert.fail('Must not launch with --no-launch'),
    }), (error) => /not available in the client environment/.test(error.message) && !error.message.includes(API_KEY));
    assert.deepEqual(await readdir(cwd), []);
    assert.deepEqual(credentialStore.calls, ['read']);
    assert.equal(credentialStore.peek(), null);
    assert.doesNotMatch(logs.join('\n'), /Connected:|Configured:|Configuration saved/);
    assert.ok(!logs.join('\n').includes(API_KEY));
  });
}

test('declining keyed startup with an unsaved prompt key preserves configuration and credentials without backups', async (t) => {
  const cwd = await workspace(t);
  const original = '{"model":"keep-existing-model"}';
  const file = join(cwd, 'opencode.jsonc');
  await writeFile(file, original);
  const credentialStore = memoryCredentialStore();
  await assert.rejects(run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills'], {
    cwd, env: {}, credentialStore, interactive: true, log: () => {},
    ui: { password: async () => API_KEY, confirm: async (question) => {
      assert.match(question.message, /^Start opencode now with the verified API key/);
      assert.equal(await readFile(file, 'utf8'), original);
      assert.deepEqual(await readdir(cwd), ['opencode.jsonc']);
      return false;
    } },
    checkConnection: async () => ({ toolCount: 3, creditsWarning: 'Live credits unavailable: fixture' }),
    launch: async () => assert.fail('Declined startup must not run'),
  }), /No configuration, skills, or saved credentials were changed/);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(await readdir(cwd), ['opencode.jsonc']);
  assert.deepEqual(credentialStore.calls, ['read']);
  assert.equal(credentialStore.peek(), null);
});

test('a replacement key verified in setup cannot silently leave the stale environment key configured', async (t) => {
  const cwd = await workspace(t);
  const replacement = `mach_${'b'.repeat(64)}`;
  const env = { MACHINAL_API_KEY: API_KEY };
  const credentialStore = memoryCredentialStore(API_KEY);
  await assert.rejects(run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills', '--no-launch'], {
    cwd, env, credentialStore, interactive: true, log: () => {},
    ui: {
      select: async (question) => question.default === 'reuse' ? 'reuse' : 'key',
      password: async () => replacement,
      confirm: async () => assert.fail('Must not offer storage or launch with --no-launch'),
    },
    checkConnection: async (_, key) => {
      if (key === API_KEY) throw new InstallerError('Authentication failed (401)', { status: 401 });
      assert.equal(key, replacement);
      return { toolCount: 3, creditsWarning: 'Live credits unavailable: fixture' };
    },
  }), (error) => /not available in the client environment/.test(error.message)
    && !error.message.includes(API_KEY) && !error.message.includes(replacement));
  assert.deepEqual(await readdir(cwd), []);
  assert.equal(env.MACHINAL_API_KEY, API_KEY);
  assert.equal(credentialStore.peek(), API_KEY);
  assert.deepEqual(credentialStore.calls, []);
});

test('setup rechecks environment availability after verification, not just the original key source', async (t) => {
  const cwd = await workspace(t);
  const env = { MACHINAL_API_KEY: API_KEY };
  await assert.rejects(run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills', '--yes'], {
    cwd, env, credentialStore: null, log: () => {},
    checkConnection: async () => {
      delete env.MACHINAL_API_KEY;
      return { toolCount: 3, creditsWarning: 'Live credits unavailable: fixture' };
    },
  }), /not available in the client environment/);
  assert.deepEqual(await readdir(cwd), []);
});

test('project scope at a filesystem root warns about descendant projects before any key or network access', async () => {
  const logs = [];
  const credentialStore = memoryCredentialStore();
  await assert.rejects(run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://unsafe.example', '--yes'], {
    cwd: parse(process.cwd()).root, env: {}, credentialStore, log: (message) => logs.push(message), ui: {},
  }), /HTTPS is required/);
  assert.match(logs.join('\n'), /drive\/filesystem root.*all descendant projects/);
  assert.deepEqual(credentialStore.calls, []);
});

test('multiple skill backups and a configuration backup produce exactly one backup summary', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, mcpHandler());
  const args = ['setup', '--client', 'opencode', '--url', endpoint, '--yes', '--no-launch'];
  const options = { cwd, env: { MACHINAL_API_KEY: API_KEY } };
  assert.equal((await runCLI(args, options)).code, 0);
  await writeFile(join(cwd, '.opencode/skills/machinal-editing/SKILL.md'), 'custom editing');
  await writeFile(join(cwd, '.opencode/skills/machinal-scenes/SKILL.md'), 'custom scenes');
  await writeFile(join(cwd, 'opencode.jsonc'), '{"model":"keep"}');
  const result = await runCLI([...args, '--replace-skills'], options);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.split('\n').filter((line) => /[Bb]ackup/.test(line)).length, 1);
  assert.match(result.stdout, /Backups: 3 original files/);
  assert.doesNotMatch(result.stdout, /Skill backup:/);
  assert.doesNotMatch(result.stdout, /\x1b/);
  const repeated = await runCLI(args, options);
  assert.equal(repeated.code, 0);
  assert.doesNotMatch(repeated.stdout, /Backups:/);
});

test('a missing key includes a direct key-creation link and leaves the project untouched', async (t) => {
  const cwd = await workspace(t);
  const result = await runCLI(['setup', '--client', 'opencode', '--mode', 'server', '--url', 'http://localhost:8080', '--yes', '--session-key'], { cwd });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /https:\/\/machinal\.app\/api-keys/);
  assert.deepEqual(await readdir(cwd), []);
});

for (const action of ['key', 'create']) {
  test(`interactive authentication recovery supports ${action} without restarting setup`, async (t) => {
    const cwd = await workspace(t);
    const replacement = `mach_${'b'.repeat(64)}`;
    const handler = mcpHandler();
    const endpoint = await serve(t, (request, response) => {
      if (request.headers.authorization !== `Bearer ${replacement}`) return response.writeHead(401).end(API_KEY);
      return handler(request, response);
    });
    const logs = [];
    const credentialStore = memoryCredentialStore(API_KEY);
    let launched = false;
    const result = await run(['setup', '--client', 'opencode', '--scope', 'project', '--url', endpoint, '--no-skills'], {
      cwd, env: {}, interactive: true, credentialStore, log: (message) => logs.push(message),
      launch: async (_, key) => { assert.equal(key, replacement); launched = true; return 0; },
      ui: {
        select: async (question) => {
          if (question.default === 'reuse') return 'reuse';
          assert.deepEqual(question.choices.map((choice) => choice.value), ['key', 'create', 'retry', 'cancel']);
          return action;
        },
        password: async () => replacement,
        confirm: async (question) => question.message.startsWith('Start '),
      },
      docker: async () => assert.fail('Server mode must never inspect Docker'),
    });
    assert.equal(result, 0);
    assert.ok(launched);
    assert.equal(credentialStore.peek(), API_KEY);
    assert.match(logs.join('\n'), /https:\/\/machinal\.app\/api-keys/);
    assert.ok(!logs.join('\n').includes(API_KEY) && !logs.join('\n').includes(replacement));
  });
}

test('interactive setup recovers from a malformed saved key and saves its replacement only after verification', async (t) => {
  const cwd = await workspace(t);
  const credentialStore = memoryCredentialStore('sensitive-corrupt-credential');
  let verified = false;
  assert.equal(await run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills'], {
    cwd, env: {}, credentialStore, interactive: true, log: () => {},
    checkConnection: async (_, key) => { assert.equal(key, API_KEY); verified = true; return { toolCount: 3 }; },
    ui: {
      select: async (question) => {
        assert.ok(!question.choices.some((choice) => choice.value === 'reuse'));
        return 'create';
      },
      password: async () => API_KEY,
      confirm: async () => { assert.ok(verified); return true; },
    },
    launch: async (_, key) => { assert.equal(key, API_KEY); return 0; },
  }), 0);
  assert.equal(credentialStore.peek(), API_KEY);
  assert.deepEqual(credentialStore.calls, ['read', 'read', 'write']);
  assert.ok(!(await readFile(join(cwd, 'opencode.jsonc'), 'utf8')).includes(API_KEY));
});

test('authentication recovery can reconnect with the same key without replacing the saved credential', async (t) => {
  const cwd = await workspace(t);
  const credentialStore = memoryCredentialStore(API_KEY);
  let attempts = 0;
  assert.equal(await run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills'], {
    cwd, env: {}, credentialStore, interactive: true, log: () => {},
    checkConnection: async (_, key) => {
      assert.equal(key, API_KEY);
      if (++attempts === 1) throw new InstallerError('Authentication failed (401)', { status: 401 });
      return { toolCount: 3 };
    },
    ui: {
      select: async (question) => question.default === 'reuse' ? 'reuse' : 'retry',
      confirm: async () => true,
      password: async () => assert.fail('Retrying the current key must not request a replacement'),
    },
    launch: async (_, key) => { assert.equal(key, API_KEY); return 0; },
  }), 0);
  assert.equal(attempts, 2);
  assert.equal(credentialStore.peek(), API_KEY);
  assert.deepEqual(credentialStore.calls, ['read']);
});

test('local mode rejects an authenticated API without inspecting Docker', async (t) => {
  const cwd = await workspace(t);
  const endpoint = await serve(t, mcpHandler());
  await assert.rejects(run(['setup', '--client', 'opencode', '--mode', 'local', '--url', endpoint, '--no-skills', '--yes'], {
    cwd, env: { MACHINAL_API_KEY: API_KEY }, credentialStore: null, log: () => {},
    docker: async () => assert.fail('No Docker inspection needed for a running API'),
  }), /not the local edition|not a supported/);
});

test('server mode never tries Docker when the endpoint is down, and refuses Docker flags before credentials', async (t) => {
  const cwd = await workspace(t);
  const ctx = {
    cwd, env: { MACHINAL_API_KEY: API_KEY }, interactive: false, credentialStore: null, log: () => {},
    docker: async () => assert.fail('Server must not manage Docker'),
    checkConnection: async () => { throw new InstallerError('Unavailable', { code: 'network', retryable: true }); },
  };
  const args = ['setup', '--client', 'opencode', '--mode', 'server', '--url', 'http://localhost:8080', '--no-skills', '--yes'];
  await assert.rejects(run(args, ctx), /Unavailable/);
  await assert.rejects(run([...args, '--start-docker'], ctx), /require --mode local/);
  assert.deepEqual(await readdir(cwd), []);
});

test('interactive retry is bounded and never saves an unverified configuration', async (t) => {
  const cwd = await workspace(t);
  let attempts = 0;
  let prompts = 0;
  await assert.rejects(run(['setup', '--client', 'opencode', '--scope', 'project', '--url', 'http://localhost:8080', '--no-skills'], {
    cwd, env: { MACHINAL_API_KEY: API_KEY }, credentialStore: null, interactive: true, log: () => {},
    ui: { select: async (question) => { if (question.default === 'reuse') return 'reuse'; prompts++; return 'retry'; } },
    checkConnection: async () => { attempts++; throw new InstallerError('Unavailable', { retryable: true, status: 503 }); },
  }), /Unavailable/);
  assert.equal(attempts, 3);
  assert.equal(prompts, 2);
  assert.deepEqual(await readdir(cwd), []);
});

test('local recovery starts the approved checkout and verifies again before writing configuration', async (t) => {
  const cwd = await workspace(t);
  for (const directory of ['api', 'services/scene-renderer']) await mkdir(join(cwd, directory), { recursive: true });
  for (const file of ['.machinal-local.json', 'compose.editengine.yaml', 'api/Dockerfile', 'services/scene-renderer/Dockerfile']) await writeFile(join(cwd, file), '# fixture');
  const events = [];
  const logs = [];
  const result = await run(['setup', '--client', 'opencode', '--mode', 'local', '--start-docker', '--no-skills', '--yes'], {
    cwd, env: { MACHINAL_API_KEY: API_KEY }, credentialStore: null, log: (message) => logs.push(message),
    docker: async (args) => {
      assert.ok(!(await readdir(cwd)).includes('opencode.jsonc'));
      if (args[0] === 'context') return 'unix:///var/run/docker.sock';
      if (args.includes('--images')) return 'fixture-api\nfixture-scene';
      if (args.includes('up')) events.push('start');
      return '';
    },
    checkConnection: async () => {
      events.push('verify');
      if (events.length === 1) throw new InstallerError('Offline', { code: 'network', retryable: true });
      return { mode: 'local', toolCount: 3 };
    },
  });
  assert.equal(result, 0);
  assert.deepEqual(events, ['verify', 'start', 'verify']);
  assert.match(await readFile(join(cwd, 'opencode.jsonc'), 'utf8'), /127.0.0.1:8080/);
  assert.ok(!logs.join('\n').includes(API_KEY));
});
