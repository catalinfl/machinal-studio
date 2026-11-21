import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const skills = new URL('../skills/', import.meta.url);

test('public skill names and descriptions use neutral cinema names and lowercase machinal', async () => {
  for (const directory of await readdir(skills, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const source = await readFile(new URL(`${directory.name}/SKILL.md`, skills), 'utf8');
    const metadata = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(metadata, `${directory.name} must declare skill metadata`);
    assert.doesNotMatch(metadata[1], /Machinal/, directory.name);
    assert.match(metadata[1], /^name: machinal-[a-z-]+$/m, directory.name);
  }
});

test('cinema references have a neutral local path while preserving copyright and licence', async () => {
  const reference = new URL('machinal-cinema/references/', skills);
  const entries = await readdir(reference);
  assert.ok(entries.includes('film-library'));
  assert.deepEqual(entries.sort(), ['film-library', 'film-styles.json', 'film-techniques.json', 'workflow.md']);
  const license = await readFile(new URL('film-library/LICENSE', reference), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 LemoLab/);
  const manifest = JSON.parse(await readFile(new URL('film-library/manifest.json', reference), 'utf8'));
  assert.equal(manifest.copyright, 'Copyright (c) 2026 LemoLab');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.adapted, true);
  assert.ok(!('repository' in manifest));
});
