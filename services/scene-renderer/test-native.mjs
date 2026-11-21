import { spawnSync } from 'node:child_process';
import { resolve, dirname, delimiter } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { chromium } from '@playwright/test';
import { rendererExecutable } from './renderer.mjs';
import { mkdir } from 'node:fs/promises';
import { doctor } from '@machinal/scenes/node';
import { existsSync } from 'node:fs';

await mkdir(new URL('./out/', import.meta.url), { recursive: true });
const tools = await doctor();
const nativeFFmpeg = process.env.SCENE_FFMPEG || (existsSync(ffmpeg) ? ffmpeg : tools.ffmpeg.path);
const nativeBrowser = process.env.SCENE_BROWSER || (tools.browser.available ? tools.browser.path : chromium.executablePath());

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'bundle.test.mjs', 'client-authoring.test.mjs', 'multimedia-native.test.mjs', 'overlay-native.test.mjs', 'render-cache-native.test.mjs', 'capture-range.test.mjs'], {
  cwd: import.meta.dirname,
  env: { ...process.env, SCENE_RENDER_BIN: await rendererExecutable(), SCENE_BROWSER: nativeBrowser, SCENE_FFMPEG: nativeFFmpeg, SCENE_FIXTURE_OUTPUT: resolve(import.meta.dirname, 'out/scene-integration-fixture.mp4') },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const voice = spawnSync('go', ['-C', resolve(import.meta.dirname, '../../api'), 'test', './internal/core/editor/scenes', '-run', 'TestNativeNarrationMux', '-count=1', '-v'], {
    env: { ...process.env, PATH: `${dirname(nativeFFmpeg)}${delimiter}${process.env.PATH || process.env.Path}`, SCENE_NATIVE_VIDEO: resolve(import.meta.dirname, 'out/scene-integration-fixture.mp4'), SCENE_FFPROBE: process.env.SCENE_FFPROBE || ffprobe.path },
    stdio: 'inherit',
  });
  if (voice.error) throw voice.error;
  process.exitCode = voice.status ?? 1;
}
