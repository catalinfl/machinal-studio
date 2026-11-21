import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import test from 'node:test';
import { configurationPath, ensureParentDirectory, planConfiguration, saveConfiguration } from '../src/configuration.mjs';
import { InstallerError } from '../src/errors.mjs';
import { API_KEY, workspace } from './helpers.mjs';

const connection = { client: 'opencode', scope: 'project', url: 'https://api.example.com/mcp', name: 'machinal', env: {} };

test('config paths honor scope, XDG_CONFIG_HOME, and CODEX_HOME', async (t) => {
  const home = await workspace(t);
  const cwd = join(home, 'project');
  assert.equal(await configurationPath({ client: 'opencode', scope: 'project', cwd }), join(cwd, 'opencode.jsonc'));
  assert.equal(await configurationPath({ client: 'opencode', scope: 'global', home, env: {} }), join(home, '.config', 'opencode', 'opencode.jsonc'));
  assert.equal(await configurationPath({ client: 'opencode', scope: 'global', home, env: { XDG_CONFIG_HOME: join(home, 'custom') } }), join(home, 'custom', 'opencode', 'opencode.jsonc'));
  assert.equal(await configurationPath({ client: 'claude', scope: 'global', home, env: {} }), join(home, '.claude.json'));
  assert.equal(await configurationPath({ client: 'claude', scope: 'project', cwd }), join(cwd, '.mcp.json'));
  assert.equal(await configurationPath({ client: 'codex', scope: 'global', home, env: { CODEX_HOME: join(home, 'codex') } }), join(home, 'codex', 'config.toml'));
  assert.equal(await configurationPath({ client: 'codex', scope: 'project', cwd }), join(cwd, '.codex', 'config.toml'));
});

test('the higher precedence existing .opencode config is edited instead of creating an ignored root entry', async (t) => {
  const cwd = await workspace(t);
  await mkdir(join(cwd, '.opencode'));
  await writeFile(join(cwd, '.opencode', 'opencode.json'), '{}');
  assert.equal(await configurationPath({ ...connection, cwd }), join(cwd, '.opencode', 'opencode.json'));
});

test('ambiguous OpenCode files and unsupported client/scope combinations fail safely', async (t) => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'opencode.json'), '{}');
  await writeFile(join(cwd, 'opencode.jsonc'), '{}');
  await assert.rejects(configurationPath({ ...connection, cwd }), /Both/);
  await assert.rejects(configurationPath({ client: 'other', scope: 'project', cwd }));
  await assert.rejects(configurationPath({ client: 'codex', scope: 'other', cwd }));
  await assert.rejects(configurationPath({ client: 'claude', scope: 'global', env: { CLAUDE_CONFIG_DIR: 'custom' } }));
});

test('new config is atomic, private on POSIX, and a repeated save is a no-op', async (t) => {
  const cwd = await workspace(t);
  const plan = await planConfiguration({ ...connection, cwd });
  assert.equal(plan.original, null);
  assert.deepEqual(await saveConfiguration(plan), { changed: true, backup: undefined });
  assert.equal(await readFile(plan.file, 'utf8'), plan.content);
  if (process.platform !== 'win32') assert.equal((await stat(plan.file)).mode & 0o777, 0o600);
  const repeated = await planConfiguration({ ...connection, cwd });
  assert.deepEqual(await saveConfiguration(repeated), { changed: false });
  assert.deepEqual(await readdir(cwd), ['opencode.jsonc']);
});

test('saving a configuration at a filesystem root does not attempt mkdir on the root (Windows EPERM regression)', async () => {
  const root = parse(resolve('.')).root;
  await ensureParentDirectory(join(root, 'opencode.jsonc'), { mkdirImpl: async () => assert.fail('mkdir(root) fails with EPERM on Windows') });
});

test('nested configuration directories are still created recursively', async () => {
  const directory = resolve('project', '.codex');
  const calls = [];
  await ensureParentDirectory(join(directory, 'config.toml'), { mkdirImpl: async (...args) => calls.push(args) });
  assert.deepEqual(calls, [[directory, { recursive: true }]]);
});

test('filesystem failures have a configuration-specific diagnostic without leaking file contents or paths', async (t) => {
  const cwd = await workspace(t);
  const blockingFile = join(cwd, API_KEY);
  await writeFile(blockingFile, 'keep');
  await assert.rejects(saveConfiguration({
    file: join(blockingFile, 'opencode.jsonc'), original: null, content: API_KEY, mode: 0o600,
  }), (error) => error instanceof InstallerError && /Could not save the client configuration/.test(error.message) && !error.message.includes(API_KEY));
  assert.equal(await readFile(blockingFile, 'utf8'), 'keep');
});

test('existing configs get exact backups and keep their permissions', async (t) => {
  const cwd = await workspace(t);
  const file = join(cwd, 'opencode.jsonc');
  const original = '{\n  // User preference\n  "model": "example"\n}\n';
  await writeFile(file, original, { mode: 0o640 });
  const oldMode = (await stat(file)).mode;
  const plan = await planConfiguration({ ...connection, cwd });
  const saved = await saveConfiguration(plan);
  assert.equal(await readFile(saved.backup, 'utf8'), original);
  assert.equal((await stat(file)).mode, oldMode);
  assert.equal((await readdir(cwd)).length, 2);
});

test('concurrent user changes are not overwritten', async (t) => {
  const cwd = await workspace(t);
  const plan = await planConfiguration({ ...connection, cwd });
  const userContent = '{"model":"user-change"}';
  await writeFile(plan.file, userContent);
  await assert.rejects(saveConfiguration(plan), /changed during setup/);
  assert.equal(await readFile(plan.file, 'utf8'), userContent);
  assert.deepEqual(await readdir(cwd), ['opencode.jsonc']);
});

test('another installer lock prevents writing', async (t) => {
  const cwd = await workspace(t);
  const plan = await planConfiguration({ ...connection, cwd });
  await writeFile(`${plan.file}.machinal-lock`, '');
  await assert.rejects(saveConfiguration(plan), /Another setup/);
});

test('non-regular files, oversized configs, and invalid server names are refused', async (t) => {
  const cwd = await workspace(t);
  await mkdir(join(cwd, 'opencode.jsonc'));
  await assert.rejects(planConfiguration({ ...connection, cwd }), /regular file/);
  const large = await workspace(t);
  await writeFile(join(large, 'opencode.jsonc'), ' '.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(planConfiguration({ ...connection, cwd: large }), /safety limit/);
  for (const name of ['bad.name', '../file', 'a\n', '__proto__', 'a'.repeat(65)]) {
    await assert.rejects(planConfiguration({ ...connection, cwd, name }), /Server names/);
  }
});

test('symlink configurations are not replaced', { skip: process.platform === 'win32' }, async (t) => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, 'real.json'), '{}');
  await symlink(join(cwd, 'real.json'), join(cwd, 'opencode.jsonc'));
  await assert.rejects(planConfiguration({ ...connection, cwd }), /regular file/);
});
