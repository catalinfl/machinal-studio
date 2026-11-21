import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { planSkills, saveSkills, SKILL_FILES, skillsDirectory } from '../src/skills.mjs';
import { workspace } from './helpers.mjs';

test('skills use each client native discovery paths, including current Codex .agents paths', () => {
  const home = join(process.cwd(), 'fake-home');
  const cwd = join(home, 'project');
  assert.equal(skillsDirectory({ client: 'opencode', scope: 'project', cwd }), join(cwd, '.opencode', 'skills'));
  assert.equal(skillsDirectory({ client: 'claude', scope: 'project', cwd }), join(cwd, '.claude', 'skills'));
  assert.equal(skillsDirectory({ client: 'codex', scope: 'project', cwd }), join(cwd, '.agents', 'skills'));
  assert.equal(skillsDirectory({ client: 'codex', scope: 'global', home, env: { CODEX_HOME: 'not-the-skill-path' } }), join(home, '.agents', 'skills'));
  assert.equal(skillsDirectory({ client: 'opencode', scope: 'global', home, env: { XDG_CONFIG_HOME: join(home, 'xdg') } }), join(home, 'xdg', 'opencode', 'skills'));
  assert.equal(skillsDirectory({ client: 'claude', scope: 'global', home, env: {} }), join(home, '.claude', 'skills'));
});

test('the package contains focused portable skills and a schema-grounded example', async (t) => {
  const cwd = await workspace(t);
  const bundle = await planSkills({ client: 'opencode', scope: 'project', cwd, env: {}, style: 'cinematic' });
  assert.equal(bundle.plans.length, SKILL_FILES.length + 1);
  assert.equal(bundle.conflict, false);
  for (const plan of bundle.plans.filter((plan) => plan.file.endsWith('SKILL.md'))) {
    assert.match(plan.content, /^---\nname: machinal-[a-z]+\ndescription: /);
  }
  const saved = await saveSkills(bundle);
  assert.equal(saved.changed, SKILL_FILES.length + 1);
  assert.match(await readFile(join(bundle.root, 'machinal-editing', 'references', 'preferences.md'), 'utf8'), /\*\*cinematic\*\*/);
  assert.match(await readFile(join(bundle.root, 'machinal-recipes', 'references', 'example.edit.yaml'), 'utf8'), /bindings:/);
  assert.match(await readFile(join(bundle.root, 'machinal-media', 'SKILL.md'), 'utf8'), /get_editing_reference\(topic: media\)/);
  const mediaWorkflow = await readFile(join(bundle.root, 'machinal-media', 'references', 'workflow.md'), 'utf8');
  for (const content of ['request_media_access', 'get_upload_target', 'get_asset_metadata', 'get_video_result', 'set_download_preferences', 'S3_INTERNAL_ENDPOINT']) {
    assert.ok(mediaWorkflow.includes(content), `Installed media workflow is missing ${content}`);
  }
  const repeated = await planSkills({ client: 'opencode', scope: 'project', cwd, env: {}, style: 'cinematic' });
  assert.equal(repeated.conflict, false);
  assert.deepEqual(await saveSkills(repeated), { changed: 0, backups: [] });
});

test('customized skill files are detected and backup replacement leaves unrelated files untouched', async (t) => {
  const cwd = await workspace(t);
  const options = { client: 'codex', scope: 'project', cwd, style: 'auto' };
  const initial = await planSkills(options);
  await saveSkills(initial);
  const skill = join(initial.root, 'machinal-editing', 'SKILL.md');
  await writeFile(skill, 'User customized instructions');
  const unrelated = join(initial.root, 'user-only');
  await mkdir(unrelated);
  await writeFile(join(unrelated, 'SKILL.md'), 'Keep me');
  const updated = await planSkills(options);
  assert.equal(updated.conflict, true);
  assert.equal(await readFile(skill, 'utf8'), 'User customized instructions');
  const saved = await saveSkills(updated);
  assert.equal(saved.backups.length, 1);
  assert.equal(await readFile(saved.backups[0], 'utf8'), 'User customized instructions');
  assert.equal(await readFile(join(unrelated, 'SKILL.md'), 'utf8'), 'Keep me');
});

test('all client skill bundles request native forms and immediate authorized execution', async (t) => {
  const cwd = await workspace(t);
  for (const client of ['opencode', 'claude', 'codex']) {
    const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
    const executionSkills = bundle.plans.filter((plan) => plan.file.endsWith('SKILL.md')
      && !['machinal-support', 'machinal-review'].some((name) => plan.file.endsWith(join(name, 'SKILL.md'))));
    for (const plan of executionSkills) {
      for (const guidance of ['native question tool', 'numbered chat questionnaire', 'proceed immediately', 'separate plan confirmation', 'cancelled form']) {
        assert.ok(plan.content.includes(guidance), `${client}: ${plan.file} lacks ${guidance}`);
      }
    }
    const brief = bundle.plans.find((plan) => plan.file.endsWith(join('references', 'brief.md'))).content;
    assert.match(brief, /unnumbered chat fallback/);
    assert.match(brief, /clear refusal option/);
    assert.match(brief, /check live credits before requesting paid-work authorization/);
    assert.match(brief, /Keep host tool-approval controls enabled/);
    assert.doesNotMatch(brief, /^\d+\.\s+„/m);
  }
});

test('all clients receive offline MCP discovery and exact credential recovery guidance', async (t) => {
  const cwd = await workspace(t);
  for (const client of ['opencode', 'claude', 'codex']) {
    const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
    const support = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-support', 'SKILL.md')))?.content;
    assert.ok(support, `Missing ${client} support skill`);
    for (const guidance of ['search the tool catalog', 'immediately call', 'action: reconnect',
      'Machinal/mcp.MACHINAL_API_KEY', 'MACHINAL_API_KEY', 'native credential API',
      'not evidence of an absent key', 'original job/idempotency', 'specific to the installed Windows OpenCode integration']) {
      assert.ok(support.includes(guidance), `${client}: support lacks ${guidance}`);
    }
  }
});

test('the active repository support skill matches the installer bundle', { skip: !existsSync(new URL('../../../.opencode/skills', import.meta.url)) }, async () => {
  const bundled = await readFile(new URL('../skills/machinal-support/SKILL.md', import.meta.url), 'utf8');
  const active = await readFile(new URL('../../../.opencode/skills/machinal-support/SKILL.md', import.meta.url), 'utf8');
  assert.equal(active, bundled);
});

test('all clients receive opt-in no-upload local media guidance without broad filesystem permissions', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    const bundle = await planSkills({ client, scope: 'project', cwd: await workspace(t), style: 'auto' });
    for (const file of [join('machinal-media', 'SKILL.md'), join('machinal-media', 'references', 'workflow.md'), join('machinal-recipes', 'SKILL.md')]) {
      const content = bundle.plans.find((plan) => plan.file.endsWith(file))?.content;
      for (const phrase of ['list_local_media', 'inspect_local_media', 'import_local_media', 'owner-scoped', 'read-only', 'originals', 'sourceVersion']) {
        assert.ok(content?.includes(phrase), `${client}: ${file} missing ${phrase}`);
      }
    }
  }
  if (!existsSync(new URL('../../../.opencode/skills', import.meta.url))) return;
  for (const file of [join('machinal-media', 'SKILL.md'), join('machinal-media', 'references', 'workflow.md'), join('machinal-recipes', 'SKILL.md')]) {
    const bundled = await readFile(new URL(`../skills/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8');
    const active = await readFile(new URL(`../../../.opencode/skills/${file.replaceAll('\\', '/')}`, import.meta.url), 'utf8');
    assert.equal(active.replaceAll('\r\n', '\n'), bundled.replaceAll('\r\n', '\n'));
  }
});

test('all clients receive complex-image and transparent-cutout defaults with consent boundaries', async (t) => {
  const cwd = await workspace(t);
  for (const client of ['opencode', 'claude', 'codex']) {
    const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
    for (const file of ['SKILL.md', join('references', 'workflow.md'), join('references', 'authoring.md')]) {
      const content = bundle.plans.find((plan) => plan.file.endsWith(join('machinal-scenes', file)))?.content;
      assert.ok(content, `${client}: missing scene guidance ${file}`);
      for (const guidance of ['default', 'SVG/CSS', 'without waiting', 'background: transparent',
        'openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare', 'background: opaque',
        'compile_scene.transparent', 'PNG/WebP alpha', 'no-generation', 'procedural-only', 'generation/spending scope']) {
        assert.ok(content.includes(guidance), `${client}: ${file} lacks ${guidance}`);
      }
    }
  }
  if (!existsSync(new URL('../../../.opencode/skills', import.meta.url))) return;
  const bundled = await readFile(new URL('../skills/machinal-scenes/SKILL.md', import.meta.url), 'utf8');
  const active = await readFile(new URL('../../../.opencode/skills/machinal-scenes/SKILL.md', import.meta.url), 'utf8');
  assert.equal(active, bundled);
});

test('the brief example is one valid multi-question OpenCode tool payload, not chat copy', async (t) => {
  const cwd = await workspace(t);
  const bundle = await planSkills({ client: 'opencode', scope: 'project', cwd, style: 'auto' });
  const brief = bundle.plans.find((plan) => plan.file.endsWith(join('references', 'brief.md'))).content;
  const example = brief.match(/^```json\n([\s\S]+?)\n```/m);
  assert.ok(example, 'Missing native question tool example');
  const form = JSON.parse(example[1]);
  assert.deepEqual(Object.keys(form), ['questions']);
  assert.ok(form.questions.length > 1, 'Batch questions into a single tool call');
  for (const question of form.questions) {
    assert.deepEqual(Object.keys(question).sort(), ['header', 'options', 'question']);
    assert.ok(question.header.length > 0 && question.header.length <= 30);
    assert.ok(question.question.trim());
    assert.ok(question.options.length > 1);
    assert.match(question.options[0].label, /Recomandat/);
    for (const option of question.options) {
      assert.deepEqual(Object.keys(option).sort(), ['description', 'label']);
      assert.ok(option.label.trim() && option.label.trim().split(/\s+/).length <= 5);
      assert.ok(option.description.trim());
      assert.doesNotMatch(option.label, /^(other|altul|altceva)$/i);
    }
  }
});

test('planning skill installation does not write anything', async (t) => {
  const cwd = await workspace(t);
  await planSkills({ client: 'claude', scope: 'project', cwd, style: 'social' });
  assert.deepEqual(await readdir(cwd), []);
});

test('symlink/junction skill directories are refused without touching their target', async (t) => {
  const cwd = await workspace(t);
  const external = await workspace(t);
  const root = join(cwd, '.claude', 'skills');
  await mkdir(root, { recursive: true });
  await writeFile(join(external, 'SKILL.md'), 'External user instructions');
  try {
    await symlink(external, join(root, 'machinal-editing'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Creating symlinks is not permitted on this filesystem.'); return; }
    throw error;
  }
  await assert.rejects(planSkills({ client: 'claude', scope: 'project', cwd, style: 'auto' }), /symlinks/);
  assert.equal(await readFile(join(external, 'SKILL.md'), 'utf8'), 'External user instructions');
});
