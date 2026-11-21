import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import crossSpawn from 'cross-spawn';
import { VERSION } from '../src/version.mjs';
import { API_KEY, mcpHandler, serve, TOOLS, workspace } from './helpers.mjs';

function command(name, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(name, args, {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the actual npm tarball installs with edition-separated runtime knowledge files', { timeout: 300_000 }, async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const packDirectory = await workspace(t);
  const packed = await command('npm', ['pack', '--json', '--pack-destination', packDirectory], root);
  assert.equal(packed.code, 0, packed.stderr);
  const cwd = await workspace(t);
  const calls = [];
  const endpoint = await serve(t, mcpHandler(calls, { tools: [...TOOLS, { name: 'get_editing_reference', annotations: { readOnlyHint: true } }] }));
  const result = await command('npx', [
    '--prefer-offline', '--yes', '--package', join(packDirectory, `machinal-mcp-${VERSION}.tgz`), 'machinal-mcp',
    'setup', '--client', 'codex', '--url', endpoint, '--style', 'retro', '--yes', '--no-launch',
  ], cwd, { MACHINAL_API_KEY: API_KEY, MACHINAL_API_ORIGIN: '' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /API credits: 900 available/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(API_KEY));
  const skills = join(cwd, '.agents', 'skills');
  assert.match(await readFile(join(skills, 'machinal-editing/references/preferences.md'), 'utf8'), /\*\*retro\*\*/);
  const brief = await readFile(join(skills, 'machinal-editing/references/brief.md'), 'utf8');
  assert.match(brief, /output resolution/);
  assert.match(brief, /Do not automatically add production labels/);
  assert.match(await readFile(join(skills, 'machinal-scenes/SKILL.md'), 'utf8'), /scene.generate/);
  assert.match(await readFile(join(skills, 'machinal-scenes/references/workflow.md'), 'utf8'), /animated Svelte components/);
  assert.match(await readFile(join(skills, 'machinal-cinema/SKILL.md'), 'utf8'), /film-styles/);
  const filmStyles = JSON.parse(await readFile(join(skills, 'machinal-cinema/references/film-styles.json'), 'utf8'));
  assert.equal(filmStyles.length, 66);
  assert.match(await readFile(join(skills, 'machinal-cinema/references/film-library/LICENSE'), 'utf8'), /Copyright \(c\) 2026 LemoLab/);
  assert.match(await readFile(join(skills, 'machinal-cinema/references/film-library/core/lib.js'), 'utf8'), /function monotone/);
  assert.match(await readFile(join(skills, 'machinal-scenes/references/scene-templates/paper-stage-3d.svelte'), 'utf8'), /SceneThree/);
  assert.match(await readFile(join(skills, 'machinal-media/SKILL.md'), 'utf8'), /get_video_result/);
  assert.match(await readFile(join(skills, 'machinal-media/references/workflow.md'), 'utf8'), /S3_INTERNAL_ENDPOINT/);
  assert.match(await readFile(join(skills, 'machinal-support/SKILL.md'), 'utf8'), /Machinal\/mcp\.MACHINAL_API_KEY/);
  assert.match(await readFile(join(skills, 'machinal-review/SKILL.md'), 'utf8'), /Before code/);
  assert.match(await readFile(join(skills, 'machinal-review/references/production.md'), 'utf8'), /editorialReview/);
  assert.match(await readFile(join(skills, 'machinal-recipes/references/examples/scene-generation.yaml'), 'utf8'), /type: scene.generate/);
  const sceneInsert = await readFile(join(skills, 'machinal-recipes/references/examples/scene-image-insert.yaml'), 'utf8');
  assert.match(sceneInsert, /type: scene.generate/);
  assert.match(sceneInsert, /file: supplied-product.png/);
  assert.match(sceneInsert, /start: 4s/);
  const catalog = JSON.parse(await readFile(join(skills, 'machinal-recipes/references/catalog.v1.json'), 'utf8'));
  assert.ok(catalog.effects.some((effect) => effect.id === 'film-grain' && effect.parameters.length > 0));
  assert.ok(calls.every((call) => call.method !== 'tools/call' || call.tool === 'get_credits'));
  const localCalls = [];
  const localEndpoint = await serve(t, mcpHandler(localCalls, { serverName: 'machinal-local', tools: [{ name: 'list_projects' }, { name: 'get_recipe_schema' }] }));
  const localDirectory = await workspace(t);
  const local = await command('npx', [
    '--prefer-offline', '--yes', '--package', join(packDirectory, `machinal-mcp-${VERSION}.tgz`), 'machinal-mcp',
    'setup', '--mode', 'local', '--client', 'codex', '--url', localEndpoint, '--yes', '--no-launch',
  ], localDirectory, { MACHINAL_API_KEY: '', DIRECTION_API_KEY: '', MACHINAL_API_ORIGIN: '', DIRECTION_API_ORIGIN: '' });
  assert.equal(local.code, 0, local.stderr);
  const localConfiguration = await readFile(join(localDirectory, '.codex/config.toml'), 'utf8');
  assert.doesNotMatch(localConfiguration, /bearer_token|Authorization|MACHINAL_API_KEY/);
  const localSkill = await readFile(join(localDirectory, '.agents/skills/machinal-local/SKILL.md'), 'utf8');
  assert.match(localSkill, /No machinal application key/);
  assert.match(await readFile(join(localDirectory, '.agents/skills/machinal-local/references/media.md'), 'utf8'), /storage=volume/);
  assert.ok(localCalls.every(call => !call.headers.authorization));
});
