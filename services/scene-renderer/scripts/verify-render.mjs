import { spawnSync } from 'node:child_process';
import { dirname, delimiter, resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const root = resolve(import.meta.dirname, '..');
const api = resolve(root, '../../api');
const mediaEnv = { ...process.env, PATH: [dirname(process.env.SCENE_FFMPEG ?? ffmpeg), dirname(process.env.SCENE_FFPROBE ?? ffprobe.path), process.env.PATH ?? process.env.Path].join(delimiter), FFMPEG_INTEGRATION: '1' };

function run(command, args, cwd = root, env = process.env) {
  console.info(`\nVerification: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['--test', '--test-concurrency=1', '*.test.mjs']);
run(process.execPath, ['--test', 'scripts/evaluate-production.test.mjs']);
run(process.execPath, ['test-native.mjs']);
run(process.execPath, ['scripts/prepare-live-fixture.mjs']);
run(process.execPath, ['scripts/test-live-export.mjs']);
run('go', ['test', '-p', '2', './...'], api, mediaEnv);
run('go', ['vet', './...'], api, mediaEnv);
console.info('\nRender verification complete. Only synthetic fixtures/mocked providers were used.');
