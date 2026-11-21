import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { compileComponent } from './render.mjs';
import { imageDataURL } from './image-fixture.mjs';

const reference = new URL('../../api/internal/platform/mcpserver/reference/', import.meta.url);
const templates = JSON.parse(await readFile(new URL('scene-templates.json', reference), 'utf8'));

async function templateInput(template, width = 1920, height = 1080) {
  const component = await readFile(new URL(`scene-templates/${template.id}.svelte`, reference), 'utf8');
  return {
    component,
    config: { width, height, fps: template.config.fps, durationInFrames: template.config.duration * template.config.fps, visualMode: template.visualMode, captionSafeBottom: 0.24 },
    images: Object.fromEntries(template.requiredImages.map(image => [image.id, imageDataURL])),
  };
}

test('catalog components cover every source and compile with the real sandbox and runtime imports', async () => {
  const files = await readdir(new URL('scene-templates/', reference));
  assert.deepEqual(files.sort(), templates.map(template => `${template.id}.svelte`).sort());
  for (const template of templates) {
    const input = await templateInput(template);
    assert.ok(Buffer.byteLength(input.component) <= 64000);
    assert.doesNotMatch(input.component, /\b(?:setTimeout|setInterval|requestAnimationFrame|fetch|Date)\s*\(|Math\.random\s*\(|@keyframes|animation\s*:/);
    const result = await compileComponent(input);
    assert.ok(result.javascript.length > 100, template.id);
    assert.equal(result.video, undefined);
  }
});

test('effect samples pass actual FHD landscape and portrait layout/caption-band inspection', { timeout: 180000 }, async () => {
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    for (const template of templates) {
      for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
        const input = await templateInput(template, width, height);
        await assert.doesNotReject(compileComponent({ ...input, inspectLayout: true }), `${template.id} ${width}x${height}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
});

async function previewCommand(page, command) {
  return page.evaluate(command => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error(`Template ${command.method} timed out`));
    }, 10000);

    function receive(event) {
      if (event.source !== window || event.data?.type !== 'live-scene:response') return;
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve();
    }

    window.addEventListener('message', receive);
    window.postMessage({ type: 'live-scene:command', channel: 'template-test', id: 1, capture: false, ...command }, '*');
  }), command);
}

async function sceneState(page) {
  return page.locator('#scene').evaluate(root => ({
    markup: root.innerHTML,
    canvases: [...root.querySelectorAll('canvas')].map(canvas => canvas.toDataURL()),
  }));
}

test('effects change over time and restore identical DOM/WebGL states after backward seeks', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.SCENE_BROWSER, args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const template of templates) {
      const input = await templateInput(template, 960, 540);
      const { javascript } = await compileComponent(input);
      const page = await browser.newPage();
      await page.route('**/*', route => /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
      await page.setContent('<style>html,body{margin:0}*{box-sizing:border-box}</style><div id="scene"></div>');
      await page.addScriptTag({ content: javascript });
      await previewCommand(page, { method: 'init', config: input.config, images: input.images });
      const lateFrame = Math.round(input.config.durationInFrames * 0.75);
      await previewCommand(page, { method: 'seek', frame: lateFrame });
      const settled = await sceneState(page);
      await previewCommand(page, { method: 'seek', frame: 0 });
      assert.notDeepEqual(await sceneState(page), settled, `${template.id}: motion must change visible state`);
      await previewCommand(page, { method: 'seek', frame: lateFrame });
      assert.deepEqual(await sceneState(page), settled, `${template.id}: backward seek changed the same frame`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
