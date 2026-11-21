import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { compileComponent } from './render.mjs';
import { imageDataURL } from './image-fixture.mjs';
import { threeComponent, videoComponent, colorVideoSource } from './multimedia-fixture.mjs';
import { modelFixture, modelComponent } from './fixtures/model-fixture.mjs';

const config = { width:320, height:180, fps:10, durationInFrames:10 };

async function openPreview(page, component, images = {}, videos = {}, parameters = {}, models = {}) {
  const { javascript } = await compileComponent({ component, config, images, videos, parameters, models });
  await page.setContent('<html><body></body></html>');
  await page.evaluate(async ({ javascript, config }) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.cssText = `position:absolute;left:-10000px;width:${config.width}px;height:${config.height}px;border:0`;
    const script = `data:application/javascript;base64,${btoa(Array.from(new TextEncoder().encode(javascript), byte => String.fromCharCode(byte)).join(''))}`;
    iframe.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src blob:"></head><body><div id="scene"></div><script src="${script}"><\/script></body></html>`;
    const loaded = new Promise(resolve => { iframe.onload = resolve; });
    document.body.appendChild(iframe);
    await loaded;
  }, { javascript, config });
  await command(page, 'init', 0, false, images, videos, { parameters, models });
}

async function command(page, method, frame = 0, capture = false, images = {}, videos = {}, renderOptions = {}) {
  return page.evaluate(({ method, frame, capture, config, images, videos, renderOptions }) => new Promise((resolve, reject) => {
    const iframe = document.querySelector('iframe');
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error(`Scene ${method} timed out`));
    }, 10000);

    const receive = event => {
      if (event.source !== iframe.contentWindow || event.data?.type !== 'live-scene:response') return;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (event.data.error) { reject(new Error(event.data.error)); return; }
      const bitmap = event.data.bitmap;
      if (!bitmap) { resolve(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      resolve(canvas.toDataURL());
    };

    window.addEventListener('message', receive);
    iframe.contentWindow.postMessage({ type:'live-scene:command',channel:'test',id:1,method,frame,capture,config,images,videos,...renderOptions }, '*');
  }), { method, frame, capture, config, images, videos, renderOptions });
}

test('sandboxed preview captures SVG, canvas and stable frame randomness at arbitrary frames', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    const component = `<script>
import { useScene, SceneCanvas } from '@direction/scene-svelte';
const scene = useScene();
const x = $derived(20 + scene.frame.time * 100);
const random = scene.frame.random('particle');
let canvas = $state();
$effect(() => {
  const position = x;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 320, 80);
  context.fillStyle = '#ff0000'; context.fillRect(position, 0, 30, 30);
});
</script>
<SceneCanvas background="#ffffff">
  <svg width="320" height="80"><circle cx={x} cy="40" r="15" fill="#0000ff" /></svg>
  <canvas width="320" height="80" bind:this={canvas}></canvas>
  <span>{random}</span>
</SceneCanvas>`;
    await openPreview(page, component);
    const first = await command(page, 'seek', 7, true);
    assert.match(first, /^data:image\/png;base64,/);
    const earlier = await command(page, 'seek', 1, true);
    assert.notEqual(earlier, first);
    assert.equal(await command(page, 'seek', 7, true), first);
  } finally { await browser.close(); }
});

test('saved AI components can read reactive time and stable randomness directly from useScene', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    await openPreview(page, `<script>
import { useScene, SceneCanvas } from '@direction/scene-svelte';
const scene = useScene();
const random = scene.random('particle');
const x = $derived(scene.time * 100);
</script>
<SceneCanvas background="#ffffff"><span>{scene.time}|{scene.progress}|{scene.config.width}|{random === scene.frame.random('particle')}</span><div style="width:20px;height:20px;background:red;transform:translateX({x}px)"></div></SceneCanvas>`);
    await command(page, 'seek', 7, true);
    const frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.locator('span').textContent(), '0.7|0.7777777777777778|320|true');
    const first = await command(page, 'seek', 7, true);
    assert.notEqual(await command(page, 'seek', 1, true), first);
    assert.equal(await command(page, 'seek', 7, true), first);
  } finally { await browser.close(); }
});

test('parameter props survive the sandbox bridge and affect actual object geometry', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    const component = `<script>
import {SceneCanvas} from '@direction/scene-svelte';
import {resolveSceneObject} from '@direction/scene-runtime';
let {parameters = {}} = $props();
const actor = $derived(resolveSceneObject(parameters, 'receiver', {x:10,y:40,color:'#ff9900'}));
</script><SceneCanvas background="#102030"><div data-scene-object="receiver" style="position:absolute;left:{actor.x}px;top:{actor.y}px;width:30px;height:30px;background:{actor.color}"></div></SceneCanvas>`;
    await openPreview(page,component,{}, {}, { receiver: { x:120,y:60,color:'#00ff00' } });
    const frame = page.frames().find(frame => frame.parentFrame());
    const values = await frame.locator('[data-scene-object]').evaluate(element => ({ left:element.style.left, top:element.style.top, color:element.style.backgroundColor }));
    assert.deepEqual(values,{left:'120px',top:'60px',color:'rgb(0, 255, 0)'});
    assert.match(await command(page,'seek',5,true), /^data:image\/png;base64,/);
  } finally { await browser.close(); }
});

test('approved GLB bytes pass through the opaque sandbox and capture on the first frame', {timeout:30000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.SCENE_BROWSER});
  try {
    const page = await browser.newPage();
    await openPreview(page,modelComponent,{}, {}, {}, {model_1:modelFixture().source});
    const first = await command(page,'seek',0,true);
    const later = await command(page,'seek',8,true);
    assert.match(first,/^data:image\/png;base64,/);
    assert.notEqual(first,later);
    assert.equal(await command(page,'seek',0,true),first);
  } finally { await browser.close(); }
});

test('documented scene font families remain embedded instead of being silently replaced', { timeout:30000 }, async () => {
  const families = ['Direction Sans', 'Direction Serif', 'Direction Mono', 'Montserrat', 'Open Sans', 'Oswald', 'Playfair Display', 'IBM Plex Sans'];
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    const component = `<script>import {SceneCanvas} from '@direction/scene-svelte';</script><SceneCanvas background="#ffffff">${families.map((family, index) => `<span data-font="${index}" style="position:absolute;left:10px;top:${index * 20}px;font-family:'${family}';font-size:16px">Știință, ăâîșț</span>`).join('')}</SceneCanvas>`;
    await openPreview(page, component);
    await command(page, 'seek', 7, true);
    const frame = page.frames().find(frame => frame.parentFrame());
    const actual = await frame.locator('[data-font]').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontFamily.replace(/["']/g, '')));
    assert.deepEqual(actual, families);
    const loaded = await frame.evaluate(() => [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replace(/["']/g, '')));
    for (const family of families) assert.ok(loaded.includes(family), `font was not loaded: ${family}`);
  } finally { await browser.close(); }
});

test('HTML images authored inside SVG groups mount and capture without illegal native invocations', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    await openPreview(page, `<script>
import { useScene, SceneCanvas } from '@direction/scene-svelte';
let { images = {} } = $props();
const scene = useScene();
const x = $derived(scene.frame.time * 100);
</script>
<SceneCanvas background="#ffffff"><svg width="320" height="180"><g transform="translate({x} 0)"><g><img src={images.image_1} alt="Subject" width="80" height="80" style="object-fit:contain" /></g></g><g><rect x="160" y="40" width="20" height="20" fill="blue" /></g></svg></SceneCanvas>`, { image_1:imageDataURL });
    const frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.locator('svg image').count(), 1);
    assert.equal(await frame.locator('svg image').getAttribute('href'), imageDataURL);
    assert.equal(await frame.locator('svg rect').count(), 1);
    const first = await command(page, 'seek', 7, true);
    assert.notEqual(await command(page, 'seek', 1, true), first);
    assert.equal(await command(page, 'seek', 7, true), first);
  } finally { await browser.close(); }
});

test('Three.js renders real geometry and deterministically seeks backwards in an off-screen sandbox', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    await openPreview(page, threeComponent);
    const later = await command(page, 'seek', 7, true);
    const earlier = await command(page, 'seek', 1, true);
    assert.notEqual(earlier, later);
    assert.equal(await command(page, 'seek', 7, true), later);
    const frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.locator('canvas').count(), 1, 'seeking must reuse a single renderer');
    assert.ok(await frame.locator('canvas').evaluate(canvas => canvas.getContext('webgl2').getParameter(WebGL2RenderingContext.CURRENT_PROGRAM)));
  } finally { await browser.close(); }
});

test('Three.js preview scales the GPU buffer and only waits for the GPU during capture', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    const component = threeComponent.replace('function setup({world, camera}) {', `function setup({world, camera, renderer}) {
      const gl = renderer.getContext();
      const finish = gl.finish.bind(gl);
      window.finishCalls = 0;
      gl.finish = () => { window.finishCalls++; finish(); };`);
    await openPreview(page, component);
    const frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.evaluate(() => window.finishCalls), 0);
    await command(page, 'seek', 7, false, {}, {}, { playing:true, renderScale:0.5 });
    assert.deepEqual(await frame.locator('canvas').evaluate(canvas => [canvas.width,canvas.height]), [160,90]);
    assert.equal(await frame.evaluate(() => window.finishCalls), 0);
    await command(page, 'seek', 7, true, {}, {}, { renderScale:1 });
    assert.deepEqual(await frame.locator('canvas').evaluate(canvas => [canvas.width,canvas.height]), [320,180]);
    assert.ok(await frame.evaluate(() => window.finishCalls > 0));
    await command(page, 'seek', 1, false, {}, {}, { renderScale:0.5 });
    assert.deepEqual(await frame.locator('canvas').evaluate(canvas => [canvas.width,canvas.height]), [160,90]);
  } finally { await browser.close(); }
});

test('silent video seeks exact source times, retains fit and captures treatments', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    await openPreview(page, videoComponent, {}, {video_1:colorVideoSource()});
    const later = await command(page, 'seek', 7, true);
    const earlier = await command(page, 'seek', 1, true);
    assert.notEqual(later, earlier);
    assert.equal(await command(page, 'seek', 7, true), later);
    const frame = page.frames().find(frame => frame.parentFrame());
    assert.equal(await frame.locator('video').evaluate(video => video.paused && video.muted && Math.abs(video.currentTime - 0.7) < 0.001), true);
    const pixels = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d'); context.drawImage(image,0,0);
      return [context.getImageData(80,10,1,1).data,context.getImageData(80,90,1,1).data].map(pixel => [...pixel]);
    }, later);
    assert.deepEqual(pixels[0], [255,255,255,255], 'contain must preserve letterboxing in captures');
    assert.ok(pixels[1][0] < 100 && Math.abs(pixels[1][0] - pixels[1][1]) < 2 && Math.abs(pixels[1][1] - pixels[1][2]) < 2, `noir must be grayscale: ${pixels[1]}`);
  } finally { await browser.close(); }
});

test('fast snapshots preserve CSS selectors, pseudo-elements, source viewport and alpha when resized', { timeout:30000 }, async () => {
  const browser = await chromium.launch({ executablePath:process.env.SCENE_BROWSER });
  try {
    const page = await browser.newPage();
    await openPreview(page, `<script>
import {useScene, SceneCanvas} from '@direction/scene-svelte';
const scene = useScene();
</script>
<SceneCanvas>
  <div class="panel" style="--offset:{scene.time * 100}px"></div>
  <p style="position:absolute;left:0;top:110px;font-style:italic;color:white">Știință, déjà vu.</p>
</SceneCanvas>
<style>
.panel {position:absolute;left:0;top:0;width:320px;height:100px;background:blue;}
@media (min-width:300px) {.panel {background:green;}}
.panel::before {content:'';position:absolute;left:var(--offset);top:0;width:20px;height:20px;background:red;}
</style>`);
    for (const scale of [1, 0.5]) {
      const image = await command(page, 'seek', 7, true, {}, {}, {renderScale:scale});
      const result = await page.evaluate(async ({image, scale}) => {
        const bitmap = await createImageBitmap(await (await fetch(image)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d'); context.drawImage(bitmap,0,0); bitmap.close();
        return {width:canvas.width,height:canvas.height,pixels:[[75,10],[200,40],[300,175]].map(([x,y]) => [...context.getImageData(Math.floor(x*scale),Math.floor(y*scale),1,1).data])};
      }, {image,scale});
      assert.deepEqual([result.width,result.height], [320*scale,180*scale]);
      assert.deepEqual(result.pixels[0], [255,0,0,255]);
      assert.deepEqual(result.pixels[1], [0,128,0,255], 'media queries must use the authored viewport, not the proxy size');
      assert.equal(result.pixels[2][3], 0, 'an empty region must remain transparent');
    }
  } finally { await browser.close(); }
});
