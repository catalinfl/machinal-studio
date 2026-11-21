import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkConnection } from '../src/connection.mjs';
import { serverEntry, updateTOML } from '../src/formats.mjs';
import { setup } from '../src/setup.mjs';
import localReferenceFiles from '../src/local-reference-files.json' with { type: 'json' };

test('all local client formats contain no application credential', () => {
  for (const client of ['opencode', 'claude', 'codex']) {
    const entry = serverEntry(client, 'http://127.0.0.1:8080/mcp', true);
    assert.doesNotMatch(JSON.stringify(entry), /Authorization|MACHINAL_API_KEY|bearer_token/);
  }
  const codex = updateTOML('', 'machinal-local', serverEntry('codex', 'http://127.0.0.1:8080/mcp', true));
  assert.doesNotMatch(codex.content, /bearer_token/);
});

test('local offline references use the user volume/provider and never require hosted render billing', async () => {
  assert.ok(localReferenceFiles.length >= 15);
  const media = await readFile(new URL('../skills/machinal-local/references/media.md', import.meta.url), 'utf8');
  assert.match(media, /storage=volume/);
  assert.match(media, /user's own OpenRouter key/);
  assert.doesNotMatch(media, /normal API key\/Premium checks/);
  for (const file of localReferenceFiles) {
    const source = await readFile(new URL(`../skills/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /live credits|remain(?:s)? billed|keep their normal charges|Cloud links redirect directly to S3/, file);
  }
});

test('local handshake never sends a hosted key and rejects a hosted server', async () => {
  let name = 'machinal-local';
  const fetchImpl = async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    const message = JSON.parse(options.body);
    if (!message.id) return new Response(null, { status: 202 });
    const result = message.method === 'initialize'
      ? { serverInfo: { name }, protocolVersion: '2025-11-25' }
      : { tools: [{ name: 'list_projects' }, { name: 'get_recipe_schema' }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  };
  const result = await checkConnection('http://127.0.0.1:8080/mcp', 'never-forward-this', { local: true, fetchImpl });
  assert.equal(result.mode, 'local');
  name = 'machinal';
  await assert.rejects(checkConnection('http://127.0.0.1:8080/mcp', undefined, { local: true, fetchImpl }), /not a supported/);
});

test('local setup never reads credentials or installs hosted authentication', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'machinal-local-test-'));
  try {
    await setup({ client: 'opencode', mode: 'local', 'no-skills': true, 'no-launch': true }, {
      cwd, home: cwd, env: { MACHINAL_API_KEY: 'must-not-be-used' }, interactive: false,
      log() {}, credentialStore: { read() { throw new Error('hosted vault accessed'); } },
      checkConnection: async (_url, key, options) => {
        assert.equal(key, undefined);
        assert.equal(options.local, true);
        return { mode: 'local', toolCount: 30 };
      },
    });
    const config = await readFile(join(cwd, 'opencode.jsonc'), 'utf8');
    assert.match(config, /machinal-local/);
    assert.doesNotMatch(config, /Authorization|MACHINAL_API_KEY|plugin|credential|must-not-be-used/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
