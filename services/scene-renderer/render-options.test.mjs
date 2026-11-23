import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderOptions, rendererArgs, renderConcurrency, sharedRenderResources } from './render-options.mjs';

const GiB = 1024 ** 3;
const config = { width: 1920, height: 1080, durationInFrames: 300 };

test('parallel scenes share CPU/memory and stay serial on small servers', () => {
  assert.equal(renderConcurrency({ cpus: 2, memory: 4 * GiB }), 1);
  assert.equal(renderConcurrency({ cpus: 8, memory: GiB }), 1);
  assert.equal(renderConcurrency({ cpus: 4, memory: 3 * GiB }), 2);
  assert.equal(renderConcurrency({ cpus: 4, memory: 3 * GiB, pidsAvailable: 128 }), 1);
  assert.equal(renderConcurrency({ cpus: 4, memory: 3 * GiB, pidsAvailable: 512 }), 2);
  assert.equal(renderConcurrency({ cpus: 4, memory: 3 * GiB }, '1'), 1);
  assert.equal(renderConcurrency({ cpus: 1, memory: GiB }, '2'), 1);
  assert.throws(() => renderConcurrency({ cpus: 4, memory: 3 * GiB }, '4'), /SCENE_RENDER_CONCURRENCY/);
  assert.deepEqual(sharedRenderResources({ cpus: 4, memory: 3 * GiB }, 2), { cpus: 2, memory: 1.5 * GiB });
});

test('automatic workers honor CPU, memory and frame count without changing quality', () => {
  const options = renderOptions(config, {}, { cpus: 4, memory: 3 * GiB });
  assert.equal(options.workers, 4);
  assert.equal(options.lossless, true);
  assert.equal(options.preset, 'ultrafast');
  assert.equal(renderOptions(config, {}, { cpus: 2, memory: 3 * GiB }).workers, 2);
  assert.equal(renderOptions(config, {}, { cpus: 16, memory: GiB }).workers, 1);
  assert.equal(renderOptions(config, {}, { cpus: 4, memory: 3 * GiB, pidsAvailable: 224 }).workers, 2);
  assert.equal(renderOptions(config, {}, { cpus: 4, memory: 3 * GiB, pidsAvailable: 120 }).workers, 1);
  assert.deepEqual(sharedRenderResources({ cpus: 4, memory: 3 * GiB, pidsAvailable: 448 }, 2), { cpus: 2, memory: 1.5 * GiB, pidsAvailable: 224 });
  assert.equal(renderOptions({ ...config, durationInFrames: 1 }, {}, { cpus: 4, memory: 3 * GiB }).workers, 1);
});

test('explicit worker count is bounded by memory and invalid options fail closed', () => {
  assert.equal(renderOptions(config, { SCENE_WORKERS: '8' }, { cpus: 8, memory: GiB }).workers, 1);
  for (const value of ['0', '17', '2foo', '-1', '1.5']) {
    assert.throws(() => renderOptions(config, { SCENE_WORKERS: value }), /SCENE_WORKERS/);
  }
  assert.throws(() => renderOptions(config, { SCENE_X264_PRESET: '-crf 30' }), /SCENE_X264_PRESET/);
  assert.throws(() => renderOptions(config, { SCENE_ENABLE_GPU: 'yes' }), /SCENE_ENABLE_GPU/);
});

test('renderer flags preserve resolution, cadence and lossless capture', () => {
  const args = rendererArgs('/tmp/scene', 'scene.mp4', { workers: 4, threads: 2, preset: 'ultrafast', gpu: false });
  assert.ok(args.includes('-lossless'));
  assert.ok(!args.includes('-gpu'));
  assert.deepEqual(args.slice(args.indexOf('-workers'), args.indexOf('-workers') + 2), ['-workers', '4']);
  assert.ok(!args.includes('-crf'));
});

test('compose.editengine.yaml allocates enough PIDs for parallel scene rendering', async () => {
  const compose = await readFile(new URL('../../compose.editengine.yaml', import.meta.url), 'utf8');
  const match = compose.match(/^\s*pids_limit:\s*(\d+)/m);
  assert.ok(match, 'compose.editengine.yaml must declare pids_limit');
  const pidsLimit = Number(match[1]);
  assert.ok(pidsLimit >= 512, `pids_limit=${pidsLimit} should allow parallel scene rendering`);
  assert.equal(renderConcurrency({ cpus: 4, memory: 3 * GiB, pidsAvailable: pidsLimit - 64 }), 2);
});
