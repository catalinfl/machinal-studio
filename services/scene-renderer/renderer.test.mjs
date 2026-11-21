import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureRendererReady } from './renderer.mjs';

test('readiness detects EACCES without blaming the component or exposing paths', async () => {
  await assert.rejects(ensureRendererReady(async () => ({ renderer: { available: false, error: 'spawn /private/scene-render EACCES' } }), {}), error => {
    assert.equal(error.code, 'scene_renderer_permission_denied');
    assert.match(error.message, /EACCES.*Rebuild/);
    assert.doesNotMatch(error.message, /\/private/);
    return true;
  });
});

test('readiness checks all tools and retries after an installation repair', async () => {
  const tools = { renderer: { available: true }, browser: { available: false }, ffmpeg: { available: true } };
  await assert.rejects(ensureRendererReady(async () => tools, {}), { code: 'scene_browser_unavailable' });
  tools.browser.available = true;
  await ensureRendererReady(async () => tools, {});
});

test('readiness respects an explicitly configured native binary', async () => {
  const tools = { renderer: { available: false }, browser: { available: true }, ffmpeg: { available: true } };
  let probed = false;
  await ensureRendererReady(async () => ({ ...tools }), { SCENE_RENDER_BIN: 'custom-renderer' }, async (path, args) => {
    assert.equal(path, 'custom-renderer');
    assert.deepEqual(args, ['-version']);
    probed = true;
  });
  assert.equal(probed, true);
});

test('Docker restores native execution and probes tools as the actual non-root user', async () => {
  const dockerfile = await readFile(new URL('./Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /RUN chmod 0755 node_modules\/@machinal\/scenes\/native\/linux-x64\/scene-render/);
  assert.match(dockerfile, /USER scene\s+RUN .*ensureRendererReady/);
});
