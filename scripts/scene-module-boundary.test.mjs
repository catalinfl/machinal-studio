import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('the application uses registry dependencies without an embedded engine checkout', async () => {
  await assert.rejects(access(new URL('scene-engine/', root)), { code: 'ENOENT' });
  for (const path of ['client/package.json', 'services/scene-renderer/package.json']) {
    const manifest = JSON.parse(await readFile(new URL(path, root), 'utf8'));
    assert.equal(manifest.dependencies['@machinal/scenes'], '0.1.1');
    assert.ok(Object.values(manifest.dependencies).every(value => !/^(file:|link:|workspace:)/.test(value)));
  }
  const lock = await readFile(new URL('client/pnpm-lock.yaml', root), 'utf8');
  assert.doesNotMatch(lock, /file:.*scene-engine|directory:.*scene-engine/);
  assert.match(lock, /'@machinal\/scenes@0\.1\.1':/);
  const compose = await readFile(new URL('compose.editengine.yaml', root), 'utf8');
  assert.match(compose, /context: services\/scene-renderer/);
  assert.doesNotMatch(compose, /context: scene-engine|D:[\\/]/);
  const dockerfile = await readFile(new URL('services/scene-renderer/Dockerfile', root), 'utf8');
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.doesNotMatch(dockerfile, /FROM golang|COPY renderer|go build|D:[\\/]/);
});
