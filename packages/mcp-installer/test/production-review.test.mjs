import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { planSkills } from '../src/skills.mjs';
import { workspace } from './helpers.mjs';

test('OpenCode, Claude and Codex receive the production critic and evidence contract', async (t) => {
  for (const client of ['opencode', 'claude', 'codex']) {
    await t.test(client, async (t) => {
      const cwd = await workspace(t);
      const bundle = await planSkills({ client, scope: 'project', cwd, style: 'cinematic' });
      const content = (...parts) => {
        const plan = bundle.plans.find((plan) => plan.file.endsWith(join(...parts)));
        assert.ok(plan, `Missing ${parts.join('/')}`);
        return plan.content;
      };
      const review = content('machinal-review', 'SKILL.md');
      for (const text of ['Before code', 'production contract', 'Before render', 'editorialReview',
        'not an independent model', 'unapproved paid', 'Keep the existing scene-engine', 'source/plan reviewed; visual result unverified']) {
        assert.ok(review.includes(text), `${client} critic lacks ${text}`);
      }
      const production = content('machinal-review', 'references', 'production.md');
      for (const text of ['before authoring', 'Motion ownership', 'Handoff', 'Subject specificity',
        'Calibrated examples', 'implicit cross-dissolve', 'origin: look:', 'visualInspection: false',
        'not a render authorization token', 'paid preview/re-render', 'productionContract', 'render_preview',
        'COMPLETE composition duration', 'expectedCompositionVersion', 'processedDuration']) {
        assert.ok(production.includes(text), `${client} production contract lacks ${text}`);
      }
      const authoring = content('machinal-scenes', 'references', 'authoring.md');
      for (const text of ['edit_scene_parameters', 'resolveSceneObject', 'sourceVersion', 'NEW immutable scene asset', 'No caption entry is edited']) {
        assert.ok(authoring.includes(text), `${client} parameter authoring lacks ${text}`);
      }
      for (const text of ['handoff_scene', 'scene.objects.register', 'OUTGOING registered IDs', 'delay/duration remain', 'both exact source versions', 'not arbitrary code rewriting']) {
        assert.ok(authoring.includes(text), `${client} semantic handoff lacks ${text}`);
      }
      const runtime = content('machinal-scenes', 'references', 'runtime.md');
      for (const text of ['loadSceneModel', 'loadSceneTexture', 'may be synchronous or async', 'placeAnchoredLabel', 'fits:false', 'External URIs', '4 MiB', '500000', 'animated PNG']) {
        assert.ok(runtime.includes(text), `${client} controlled runtime lacks ${text}`);
      }
      const scenes = content('machinal-scenes', 'SKILL.md');
      for (const text of ['check deployed capabilities first', 'both named scenes/versions', 'no external URIs', 'rendering is still billed', 'do not prove visual continuity']) {
        assert.ok(scenes.includes(text), `${client} controlled scene skill lacks ${text}`);
      }
      for (const skill of ['machinal-editing', 'machinal-scenes', 'machinal-recipes']) {
        const entry = content(skill, 'SKILL.md');
        for (const text of ['machinal-review', 'topic: production', 'editorialReview']) {
          assert.ok(entry.includes(text), `${client}/${skill} lacks ${text}`);
        }
      }
    });
  }
});

test('the active critic skill matches the portable installer bundle', { skip: !existsSync(new URL('../../../.opencode/skills', import.meta.url)) }, async () => {
  const bundled = await readFile(new URL('../skills/machinal-review/SKILL.md', import.meta.url), 'utf8');
  const active = await readFile(new URL('../../../.opencode/skills/machinal-review/SKILL.md', import.meta.url), 'utf8');
  assert.equal(active, bundled);
});

test('the active controlled-scene skill matches the portable installer bundle', { skip: !existsSync(new URL('../../../.opencode/skills', import.meta.url)) }, async () => {
  const bundled = await readFile(new URL('../skills/machinal-scenes/SKILL.md', import.meta.url), 'utf8');
  const active = await readFile(new URL('../../../.opencode/skills/machinal-scenes/SKILL.md', import.meta.url), 'utf8');
  assert.equal(active.replaceAll('\r\n','\n'), bundled.replaceAll('\r\n','\n'));
});
