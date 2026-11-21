import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { planSkills } from '../src/skills.mjs';
import { workspace } from './helpers.mjs';

const editingSkills = ['machinal-editing', 'machinal-recipes', 'machinal-scenes'];

test('every MCP client preserves existing captions instead of applying generation defaults', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'cinematic' });
      const content = (...parts) => {
        const plan = bundle.plans.find((plan) => plan.file.endsWith(join(...parts)));
        assert.ok(plan, `Missing ${parts.join('/')}`);
        return plan.content;
      };
      for (const skill of editingSkills) {
        const entry = content(skill, 'SKILL.md');
        for (const guidance of [
          'Existing captions are read-only', 'explicitly requests a caption change',
          'line breaks', 'grouping/order', 'resultTextIds', 'timings', 'positions/fonts',
          'animation/highlighting/effects', 'NEW caption generation', 'complete caption entries',
          'undo unintended changes', 'Validation alone does not prove preservation', 'encoding-only',
        ]) {
          assert.ok(entry.includes(guidance), `${client}/${skill} lacks ${guidance}`);
        }
      }
      const captions = content('machinal-recipes', 'references', 'text-audio.md');
      for (const guidance of [
        'Preserve existing captions', 'texts[].text', 'words[].text', 'trim/collapse whitespace',
        'split/merge/reflow', 'never retroactively', 'not a new YAML lock flag',
        'specific blocker and ask first', 'not permission to redesign',
      ]) {
        assert.ok(captions.includes(guidance), `${client} caption guide lacks ${guidance}`);
      }
      for (const parts of [
        ['machinal-recipes', 'references', 'yaml.md'],
        ['machinal-scenes', 'references', 'authoring.md'],
        ['machinal-review', 'references', 'production.md'],
      ]) {
        assert.ok(content(...parts).includes('read-only unless the user explicitly requests a caption change'));
      }
    });
  }
});

test('active caption preservation skills match the portable installer bundle', { skip: !existsSync(new URL('../../../.opencode/skills', import.meta.url)) }, async () => {
  for (const skill of editingSkills) {
    const bundled = await readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
    const active = await readFile(new URL(`../../../.opencode/skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
    assert.equal(active, bundled, `${skill} is stale`);
  }
});
