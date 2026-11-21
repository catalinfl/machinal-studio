import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOptions, rendererArgs } from './render-options.mjs';

const GiB = 1024 ** 3;
const config = { width: 1920, height: 1080, durationInFrames: 300 };

test('automatic workers honor CPU, memory and frame count without changing quality', () => {
  const options = renderOptions(config, {}, { cpus: 4, memory: 3 * GiB });
  assert.equal(options.workers, 4);
  assert.equal(options.lossless, true);
  assert.equal(options.preset, 'ultrafast');
  assert.equal(renderOptions(config, {}, { cpus: 2, memory: 3 * GiB }).workers, 2);
  assert.equal(renderOptions(config, {}, { cpus: 16, memory: GiB }).workers, 1);
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
