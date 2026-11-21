import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, dirname, delimiter } from 'node:path';
import { once } from 'node:events';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { chromium } from '@playwright/test';
import { rendererExecutable } from '../renderer.mjs';

const root = resolve(import.meta.dirname, '..');

const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const token = 'live-export-test-worker';
const env = {
  ...process.env,
  PORT:String(port), SCENE_SERVICE_HOST:'127.0.0.1', SCENE_SERVICE_TOKEN:token,
  SCENE_RENDER_BIN:await rendererExecutable(),
  SCENE_BROWSER:process.env.SCENE_BROWSER || chromium.executablePath(),
  SCENE_FFMPEG:process.env.SCENE_FFMPEG || ffmpeg,
};
const service = spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','inherit']});
try {
  await Promise.race([
    new Promise((resolve,reject) => {
      service.stdout.on('data',data => { if (data.toString().includes('service ready')) resolve() });
      service.once('error',reject);
      service.once('exit',code => reject(new Error(`Scene service exited: ${code}`)));
    }),
    new Promise((_,reject) => setTimeout(()=>reject(new Error('Scene service startup timed out')),10000).unref()),
  ]);
  const test = spawn('go',['test','./internal/core/editor/render','-run','TestNativeLiveSceneCompositionExport','-count=1','-v'],{
    cwd:resolve(root,'../../api'),
    env:{...env,PATH:`${dirname(ffmpeg)}${delimiter}${dirname(ffprobe.path)}${delimiter}${process.env.PATH || process.env.Path}`,
      SCENE_LIVE_FIXTURE:resolve(root,'out/live-scene-fixture.json'),SCENE_SERVICE_URL:`http://127.0.0.1:${port}`},
    stdio:'inherit',
  });
  const [code] = await once(test,'exit');
  process.exitCode = code ?? 1;
} finally { service.kill(); }
