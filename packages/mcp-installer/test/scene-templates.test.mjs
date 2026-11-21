import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { planSkills } from '../src/skills.mjs';
import { workspace } from './helpers.mjs';

const source = new URL('../../../api/internal/platform/mcpserver/reference/', import.meta.url);
const templates = JSON.parse(await readFile(new URL('scene-templates.json', source), 'utf8'));

test('all clients receive the exact effect sources, metadata and selection workflow offline', async (t) => {
  const cwd = await workspace(t);
  for (const client of ['opencode', 'claude', 'codex']) {
    const bundle = await planSkills({ client, scope: 'project', cwd, style: 'auto' });
    const content = (...path) => {
      const plan = bundle.plans.find(plan => plan.file.endsWith(join('machinal-scenes', ...path)));
      assert.ok(plan, `${client}: missing ${path.join('/')}`);
      return plan.content;
    };

    assert.deepEqual(JSON.parse(content('references', 'scene-templates.json')), templates);
    assert.match(content('SKILL.md'), /get_editing_reference\(topic: scene-templates\)/);
    const guide = content('references', 'scene-templates.md');
    for (const guidance of ['not model training', 'metadata only', 'source-level parameters', 'not tool arguments', 'source-use approval', 'compile_scene', 'server scene-frame rendering and final encoding remain billed']) {
      assert.ok(guide.includes(guidance), `${client}: lacks ${guidance}`);
    }
    for (const template of templates) {
      const expected = await readFile(new URL(`scene-templates/${template.id}.svelte`, source), 'utf8');
      assert.equal(content('references', 'scene-templates', `${template.id}.svelte`), expected);
    }
  }
});
