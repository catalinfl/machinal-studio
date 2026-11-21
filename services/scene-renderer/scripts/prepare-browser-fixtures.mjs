import { copyFile, readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import { renderComponent } from '../render.mjs';

process.env.SCENE_BROWSER ??= chromium.executablePath();
process.env.SCENE_FFMPEG ??= ffmpeg;
await import('./prepare-live-fixture.mjs');
const source = JSON.parse(await readFile(new URL('../out/live-scene-fixture.json', import.meta.url), 'utf8'));
const result = await renderComponent(source, AbortSignal.timeout(120_000));
try { await copyFile(result.path, new URL('../out/scene-integration-fixture.mp4', import.meta.url)); }
finally { await result.dispose(); }
console.log('Prepared synthetic browser fixtures using the npm renderer; no provider calls.');
