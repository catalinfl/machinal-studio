import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { chromium } from '@playwright/test';
import { renderComponent } from '../render.mjs';
import { rendererExecutable } from '../renderer.mjs';

process.env.SCENE_RENDER_BIN ??= await rendererExecutable();
process.env.SCENE_BROWSER ??= chromium.executablePath();
process.env.SCENE_FFMPEG ??= ffmpeg;
const directory = await mkdtemp(join(tmpdir(), 'direction-render-benchmark-'));
const execute = promisify(execFile);
const input = {
  component: `<script>import {SceneCanvas,useScene} from '@direction/scene-svelte';const scene=useScene();const x=$derived(80+scene.frame.time*200);</script>
<SceneCanvas background="#101c31"><div style="position:absolute;left:80px;top:80px;font:64px 'Direction Sans';color:#fff">Detaliu, mișcare, calitate</div><div style:left="{x}px" style="position:absolute;top:300px;width:240px;height:240px;background:linear-gradient(120deg,#ff8855,#5533ff);border-radius:24px"></div></SceneCanvas>`,
  config: { width: Number(process.env.BENCHMARK_WIDTH ?? 1920), height: Number(process.env.BENCHMARK_HEIGHT ?? 1080), fps: 30, durationInFrames: Number(process.env.BENCHMARK_FRAMES ?? 60) },
};
if (process.env.BENCHMARK_TRANSPARENT === 'true') {
  input.config.transparent = true;
  input.component = input.component.replace('background="#101c31"', '');
}

async function measure(label) {
  const started = performance.now();
  const result = await renderComponent(input, new AbortController().signal);
  const seconds = (performance.now() - started) / 1000;
  const metrics = result.manifest.metrics;
  return { label, seconds: Number(seconds.toFixed(3)), fps: Number((input.config.durationInFrames / seconds).toFixed(2)),
    loadMs: Math.round(metrics.loadNanoseconds / 1e6), captureMs: Math.round(metrics.captureAndEncodeNanoseconds / 1e6), bytes: result.video.length, result };
}

try {
  const rows = [];
  let pixels;
  process.env.SCENE_CACHE_MAX_BYTES = '0';
  const workerCounts = (process.env.BENCHMARK_WORKERS ?? '1,2,4').split(',').map(Number);
  const currentBinary = process.env.SCENE_RENDER_BIN;
  const binaries = process.env.BENCHMARK_BASELINE_BIN ? [['baseline', process.env.BENCHMARK_BASELINE_BIN], ['optimized', currentBinary]] : [['current', currentBinary]];
  for (const workers of workerCounts) for (const [version, binary] of binaries) {
    process.env.SCENE_RENDER_BIN = binary;
    process.env.SCENE_WORKERS = String(workers);
    const row = await measure(`${version}, ${workers} workers`);
    const video = join(directory, `workers-${workers}-${version}.${input.config.transparent ? 'webm' : 'mp4'}`);
    await writeFile(video, row.result.video);
    const decoder = input.config.transparent ? ['-c:v', 'libvpx-vp9'] : [];
    const { stdout } = await execute(process.env.SCENE_FFMPEG, ['-v', 'error', ...decoder, '-i', video, '-pix_fmt', input.config.transparent ? 'rgba' : 'rgb24', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8', windowsHide: true });
    if (pixels) assert.equal(stdout, pixels, 'renderer binary or worker count changed decoded frame pixels');
    pixels = stdout;
    rows.push({ ...row, result: undefined });
  }
  process.env.SCENE_RENDER_BIN = currentBinary;
  process.env.SCENE_CACHE_MAX_BYTES = String(2 * 1024 ** 3);
  process.env.SCENE_CACHE_DIR = join(directory, 'cache');
  const cold = await measure('cache cold');
  const warm = await measure('cache warm');
  assert.equal(createHash('sha256').update(cold.result.video).digest('hex'), createHash('sha256').update(warm.result.video).digest('hex'));
  rows.push({ ...cold, result: undefined }, { ...warm, result: undefined });
  console.table(rows);
  console.info(`Decoded ${input.config.transparent ? 'RGBA' : 'RGB'} frames identical across binaries/worker counts; warm cache video byte-identical. Synthetic fixture only; no provider calls.`);
} finally { await rm(directory, { recursive: true, force: true }); }
