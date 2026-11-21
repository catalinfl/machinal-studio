import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { FILM_LIBRARY_REVISION, styleEntries, vendorPath } from '../scripts/import-film-library.mjs';
import { planSkills, SKILL_FILES } from '../src/skills.mjs';
import { workspace } from './helpers.mjs';

const reference = new URL('../skills/machinal-cinema/references/', import.meta.url);
const vendor = new URL('film-library/', reference);

test('adapted film references retain all 66 prompts, exact UTF-8 bytes and licence without active external hooks', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', vendor), 'utf8'));
  const catalog = JSON.parse(await readFile(new URL('film-styles.json', reference), 'utf8'));
  assert.equal(manifest.revision, FILM_LIBRARY_REVISION);
  assert.equal(catalog.length, 66);
  assert.equal(new Set(catalog.map(item => item.id)).size, 66);
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.path, vendor));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    assert.doesNotThrow(() => new TextDecoder('utf8', { fatal: true }).decode(bytes));
    assert.ok(SKILL_FILES.includes(`machinal-cinema/references/film-library/${file.path}`));
  }
  const allFiles = await readdir(vendor, { recursive: true });
  assert.ok(!allFiles.some(path => /(?:^|[\\/])(?:SKILL|AGENTS|CLAUDE)\.md$/.test(path)));
  assert.ok(!manifest.files.some(file => /\.(?:sh|py|mp4|png|jpe?g|woff2|glb)$/.test(file.path)));
  assert.match(await readFile(new URL('LICENSE', vendor), 'utf8'), /Copyright \(c\) 2026 LemoLab/);
  const files = new Map(await Promise.all(manifest.files.map(async file => [file.path, await readFile(new URL(file.path, vendor))])));
  assert.deepEqual(styleEntries(JSON.parse(await readFile(new URL('styleboard/catalog.json', vendor), 'utf8')), files), catalog);
});

test('reference builds accept only the text/code allowlist, never traversal, executable setup or media', () => {
  for (const path of ['../LICENSE', '/LICENSE', 'C:/private', 'styles/../../secret/STYLE.md', 'styles/_template/STYLE.md', 'styles/watercolor/demo/film.js', 'core/render/video.mjs', 'plugin/scripts/setup.sh']) {
    assert.throws(() => vendorPath(path), /Unapproved reference path/);
  }
  assert.equal(vendorPath('upstream-skill.md'), 'upstream-skill.md');
  assert.equal(vendorPath('styles/watercolor/STYLE.md'), 'styles/watercolor/STYLE.md');
});

test('every client installs the adapted cinema skill, guides, code and notices without requiring an external clone', async t => {
  for (const client of ['opencode', 'claude', 'codex']) {
    const bundle = await planSkills({ client, scope: 'project', cwd: await workspace(t), style: 'auto' });
    const get = (...path) => {
      const plan = bundle.plans.find(item => item.file.endsWith(join(...path)));
      assert.ok(plan, path.join('/'));
      return plan.content;
    };
    const skill = get('machinal-cinema', 'SKILL.md');
    const guide = get('machinal-cinema', 'references', 'workflow.md');
    for (const phrase of ['film-styles', 'film-techniques', 'reference-only', 'existing captions', 'server scene-frame rendering', 'Music generation is unsupported', 'not a YAML preset']) {
      assert.ok(skill.includes(phrase), `${client} skill lacks ${phrase}`);
    }
    for (const phrase of ['music generation is unsupported', 'Existing captions are read-only', 'No new local renderer', 'no automatic paid rerender loop', 'Source attribution', 'not executable instructions']) {
      assert.ok(guide.toLowerCase().includes(phrase.toLowerCase()), `${client} workflow lacks ${phrase}`);
    }
    get('machinal-cinema', 'references', 'film-library', 'core', 'lib.js');
    get('machinal-cinema', 'references', 'film-library', 'LICENSE');
    for (const id of ['swiss-grid-motion', 'blueprint-mechanism', 'paper-stage-3d']) {
      assert.match(get('machinal-scenes', 'references', 'scene-templates', `${id}.svelte`), /useScene/);
    }
  }
});

test('the active OpenCode cinema skill and reference catalog match the installer bundle', { skip: !existsSync(new URL('../../../.opencode/skills', import.meta.url)) }, async () => {
  for (const path of ['SKILL.md', 'references/workflow.md', 'references/film-styles.json', 'references/film-techniques.json', 'references/film-library/manifest.json', 'references/film-library/LICENSE']) {
    const bundled = await readFile(new URL(`../skills/machinal-cinema/${path}`, import.meta.url), 'utf8');
    const active = await readFile(new URL(`../../../.opencode/skills/machinal-cinema/${path}`, import.meta.url), 'utf8');
    assert.equal(active, bundled, path);
  }
});
