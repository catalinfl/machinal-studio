import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { renderComponent } from './test-render.mjs';
import { overlayComponent, overlayConfig } from './overlay-fixture.mjs';

test('Go composition export blends native overlay alpha over unchanged footage', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER, timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-overlay-native-'));
  const config = { ...overlayConfig, fps: 10, durationInFrames: 10 };
  const fixture = join(directory, 'overlay.scene.json');
  await writeFile(fixture, JSON.stringify({ version: 1, component: overlayComponent, javascript: 'native export recompiles this source', config }));
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { manifest, video } = await renderComponent(JSON.parse(Buffer.concat(chunks).toString()), new AbortController().signal);
      response.writeHead(200, { 'Content-Type': 'video/webm', 'X-Scene-Manifest': Buffer.from(JSON.stringify(manifest)).toString('base64') }).end(video);
    } catch (error) { response.writeHead(422).end(error.message); }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { stdout } = await promisify(execFile)('go', ['test', './internal/core/editor/render', '-run', '^TestNativeTransparentOverlayCompositionExport$', '-count=1', '-v'], {
      cwd: resolve(import.meta.dirname, '../../api'), timeout: 110000, windowsHide: true,
      env: { ...process.env, SCENE_OVERLAY_FIXTURE: fixture, SCENE_SERVICE_URL: `http://127.0.0.1:${server.address().port}`, PATH: `${dirname(process.env.SCENE_FFMPEG || ffmpeg)}${delimiter}${dirname(ffprobe.path)}${delimiter}${process.env.PATH || process.env.Path}` },
    });
    console.info(stdout);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
