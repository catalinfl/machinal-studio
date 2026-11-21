import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleComponent, validateInput } from './bundle.mjs';
import { compileComponent, renderComponent } from './render.mjs';
import { imageComponent, imageDataURL } from './image-fixture.mjs';
import { overlayComponent, overlayConfig } from './overlay-fixture.mjs';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const component = `<script>
import {useScene, SceneCanvas} from '@direction/scene-svelte';
const scene = useScene();
const x = $derived(scene.frame.time * 30);
</script>
<SceneCanvas background="#faf9f6"><h1 style:transform="translateX({x}px)">A growing idea</h1></SceneCanvas>`;

test('bundles a real reactive component and rejects filesystem imports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-bundle-test-'));
  try {
    await bundleComponent(component, directory);
    const output = await readFile(join(directory, 'scene.js'), 'utf8');
    assert.match(output, /__sceneRequest/);
    await assert.rejects(bundleComponent('<script>import fs from "node:fs";</script><p>{fs}</p>', directory), /Unsupported scene import/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rejects excessive configuration and unsupported module scripts', async () => {
  assert.throws(() => validateInput({ component, config: { width:1280, height:720, fps:30, durationInFrames:1801 } }), /limits/);
  assert.throws(() => validateInput({ component, config: { width:1279, height:720, fps:30, durationInFrames:30 } }), /limits/);
  await assert.rejects(bundleComponent('<script module>export const x=1;</script><p>scene</p>', tmpdir()), /Module scripts/);
});

test('preserves transparent output configuration and rejects non-boolean transparency', () => {
  assert.deepEqual(validateInput({ component: overlayComponent, config: overlayConfig }), overlayConfig);
  assert.throws(() => validateInput({ component: overlayComponent, config: { ...overlayConfig, transparent: 'true' } }), /transparency/);
});

test('native overlay export keeps empty and partially transparent pixels', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER }, async () => {
  const config = { ...overlayConfig, fps: 5, durationInFrames: 5 };
  const output = await renderComponent({ component: overlayComponent, config }, new AbortController().signal);
  assert.equal(output.manifest.transparent, true);
  assert.equal(output.manifest.codec, 'vp9');
  assert.equal(output.manifest.file, 'scene.webm');
  const decoded = spawnSync(process.env.SCENE_FFMPEG || 'ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', 'pipe:0', '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { input: output.video, windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  const pixel = (x, y) => [...decoded.stdout.subarray((y * config.width + x) * 4, (y * config.width + x) * 4 + 4)];
  assert.equal(pixel(300, 150)[3], 0);
  assert.ok(pixel(80, 90)[0] > 230 && pixel(80, 90)[3] > 245, `opaque arrow: ${pixel(80, 90)}`);
  assert.ok(Math.abs(pixel(240, 40)[3] - 128) < 5, `soft alpha: ${pixel(240, 40)}`);
});

test('compiles a self-contained live preview without invoking the native renderer', async () => {
  const result = await compileComponent({ component, config:{ width:320, height:180, fps:10, durationInFrames:10 } });
  assert.match(result.javascript, /live-scene:command/);
  assert.match(result.javascript, /live-scene:response/);
  assert.match(result.javascript, /createImageBitmap/);
  assert.ok(Buffer.byteLength(result.javascript) < 2 * 1024 * 1024, 'preview must fit the API bundle limit');
  assert.doesNotMatch(result.javascript, /from\s+["']/);
});

test('Full HD landscape and portrait exports preserve preview text widths and wrapping', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER, timeout: 120000 }, async () => {
  const textComponent = `<script>import { SceneCanvas } from '@direction/scene-svelte';</script>
<SceneCanvas background="#ffffff">
  <p style="position:absolute;left:80px;top:80px;width:720px;margin:0;font:52px Arial,sans-serif;color:#000000">Preview and export have the same width and wrapping.</p>
  <p style="position:absolute;left:80px;top:320px;margin:0;font:48px Georgia,serif;color:#000000">Same serif: Știință, déjà vu.</p>
  <p style="position:absolute;left:80px;top:440px;margin:0;font:40px 'Courier New',monospace;color:#000000">Same monospace 0123456789</p>
</SceneCanvas>`;
  const browser = await chromium.launch({ executablePath: process.env.SCENE_BROWSER });
  try {
    for (const config of [{ width:1920,height:1080,fps:1,durationInFrames:1 }, { width:1080,height:1920,fps:1,durationInFrames:1 }]) {
      const page = await browser.newPage({ viewport:{ width:config.width,height:config.height } });
      try {
        const { javascript } = await compileComponent({ component:textComponent, config });
        await page.setContent('<html><body></body></html>');
        const preview = await page.evaluate(async ({ javascript, config }) => {
          const iframe = document.createElement('iframe');
          iframe.width = String(config.width);
          iframe.height = String(config.height);
          iframe.srcdoc = `<html><body><div id="scene"></div><script>${javascript}<\/script></body></html>`;
          const loaded = new Promise(resolve => { iframe.onload = resolve; });
          document.body.appendChild(iframe);
          await loaded;
          const command = (method, capture = false) => new Promise((resolve, reject) => {
            const receive = event => {
              if (event.source !== iframe.contentWindow || event.data?.type !== 'live-scene:response') return;
              window.removeEventListener('message', receive);
              event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.bitmap);
            };
            window.addEventListener('message', receive);
            iframe.contentWindow.postMessage({ type:'live-scene:command',channel:'parity',id:1,method,frame:0,config,capture,fullResolution:true }, '*');
          });
          await command('init');
          const bitmap = await command('seek', true);
          const canvas = document.createElement('canvas');
          canvas.width = config.width;
          canvas.height = config.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          return canvas.toDataURL();
        }, { javascript, config });
        const output = await renderComponent({ component:textComponent, config }, new AbortController().signal);
        assert.equal(output.manifest.width, config.width);
        assert.equal(output.manifest.height, config.height);
        const decoded = spawnSync(process.env.SCENE_FFMPEG || 'ffmpeg', ['-v','error','-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'], { input:output.video,windowsHide:true,maxBuffer:16 * 1024 * 1024 });
        assert.equal(decoded.status, 0, decoded.stderr.toString());
        const bounds = await page.evaluate(async sources => {
          const results = [];
          for (const src of sources) {
            const image = new Image();
            image.src = src;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height).data;
            results.push([[80,300], [320,420], [440,540]].map(([top,bottom]) => {
              let left = image.width, right = -1, first = bottom, last = -1;
              for (let y = top; y < bottom; y++) for (let x = 0; x < image.width; x++) {
                const offset = (y * image.width + x) * 4;
                if (pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100 && pixels[offset + 3] > 200) {
                  left = Math.min(left, x); right = Math.max(right, x); first = Math.min(first, y); last = Math.max(last, y);
                }
              }
              return [left,right,first,last];
            }));
          }
          return results;
        }, [preview, `data:image/png;base64,${decoded.stdout.toString('base64')}`]);
        for (let line = 0; line < bounds[0].length; line++) {
          assert.ok(bounds[0][line][1] > bounds[0][line][0], 'preview text must be visible');
          for (let edge = 0; edge < 4; edge++) assert.ok(Math.abs(bounds[0][line][edge] - bounds[1][line][edge]) <= 2,
            `${config.width}×${config.height} text ${line}: preview ${bounds[0][line]}, export ${bounds[1][line]}`);
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test('materializes a compiled component through native scene-engine', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER }, async () => {
  const output = await renderComponent({ component, config: { width:320, height:180, fps:10, durationInFrames:10 } }, new AbortController().signal);
  assert.equal(output.manifest.frames, 10);
  assert.equal(output.manifest.duration, 1);
  assert.equal(output.manifest.width, 320);
  assert.equal(output.video.subarray(4, 8).toString(), 'ftyp');
  if (process.env.SCENE_FIXTURE_OUTPUT) await writeFile(process.env.SCENE_FIXTURE_OUTPUT, output.video);
});

test('rejects external or oversized media while accepting embedded raster props', () => {
  const input = { component:imageComponent,config:{width:320,height:180,fps:10,durationInFrames:10} };
  assert.doesNotThrow(() => validateInput({ ...input,images:{image_1:imageDataURL} }));
  for (const images of [{image_1:'https://example.test/photo.png'}, {image_1:'data:image/svg+xml;base64,AA=='}, {image_9:imageDataURL}]) {
    assert.throws(() => validateInput({...input,images}), /embedded images/);
  }
});

test('native export displays attached images and preserves their alpha', { skip: !process.env.SCENE_RENDER_BIN || !process.env.SCENE_BROWSER }, async () => {
  const legacySvgComponent = `<script>
import {useScene, SceneCanvas} from '@direction/scene-svelte';
let { images = {} } = $props();
const scene = useScene();
const random = scene.random('subject');
const x = $derived(scene.time * 20);
</script>
<SceneCanvas background="#25f4ee"><svg width="320" height="180"><g transform="translate({x} 0)" data-random={random}><g><img src={images.image_1} width="320" height="180" style="image-rendering:pixelated" /></g></g></svg></SceneCanvas>`;
  for (const component of [imageComponent, legacySvgComponent]) {
    const output = await renderComponent({ component,config:{width:320,height:180,fps:10,durationInFrames:10},images:{image_1:imageDataURL} }, new AbortController().signal);
    assert.equal(output.manifest.scene.props.images, undefined);
    assert.ok(JSON.stringify(output.manifest).length < 4096, 'media must not expand the HTTP manifest header');
    for (const [x, expected] of [[80, [37,244,238]], [240, [255,0,0]]]) {
      const frame = spawnSync(process.env.SCENE_FFMPEG || 'ffmpeg', ['-v','error','-i','pipe:0','-vf',`crop=2:2:${x}:120,format=rgb24`,'-frames:v','1','-f','rawvideo','pipe:1'], {input:output.video,windowsHide:true});
      assert.equal(frame.status, 0, frame.stderr.toString());
      for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(frame.stdout[channel] - expected[channel]) < 20, `pixel at ${x}: ${[...frame.stdout.subarray(0,3)]}`);
    }
  }
});
