import { spawnSync } from 'node:child_process';
import { resolve, dirname, delimiter } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { chromium } from '@playwright/test';
import { rendererExecutable } from './renderer.mjs';
import { mkdir } from 'node:fs/promises';

await mkdir(new URL('./out/', import.meta.url), { recursive: true });

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'bundle.test.mjs', 'client-authoring.test.mjs', 'multimedia-native.test.mjs', 'overlay-native.test.mjs', 'render-cache-native.test.mjs'], {
  cwd: import.meta.dirname,
  env: { ...process.env, SCENE_RENDER_BIN: await rendererExecutable(), SCENE_BROWSER: process.env.SCENE_BROWSER || chromium.executablePath(), SCENE_FFMPEG: process.env.SCENE_FFMPEG || ffmpeg, SCENE_FIXTURE_OUTPUT: resolve(import.meta.dirname, 'out/scene-integration-fixture.mp4') },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const voice = spawnSync('go', ['-C', resolve(import.meta.dirname, '../../api'), 'test', './internal/core/editor/scenes', '-run', 'TestNativeNarrationMux', '-count=1', '-v'], {
    env: { ...process.env, PATH: `${dirname(process.env.SCENE_FFMPEG || ffmpeg)}${delimiter}${process.env.PATH || process.env.Path}`, SCENE_NATIVE_VIDEO: resolve(import.meta.dirname, 'out/scene-integration-fixture.mp4'), SCENE_FFPROBE: process.env.SCENE_FFPROBE || ffprobe.path },
    stdio: 'inherit',
  });
  if (voice.error) throw voice.error;
  process.exitCode = voice.status ?? 1;
}
