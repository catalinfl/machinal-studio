import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileComponent } from './render.mjs';
import { imageDataURL } from './image-fixture.mjs';
import { validateNativePort } from '../../packages/mcp-installer/scripts/build-hyperframes-native.mjs';

const reference = new URL('../../packages/mcp-installer/library/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('scene-templates.json', reference), 'utf8'));
const components = JSON.parse(await readFile(new URL('hyperframes-components.json', reference), 'utf8'));
const ledger = JSON.parse(await readFile(new URL('hyperframes-native.json', reference), 'utf8'));

test('native Hyperframes ports compile through the real Svelte scene compiler without provider or renderer calls', async () => {
  const templates = catalog.filter(template => template.category.startsWith('hyperframes-'));
  assert.ok(templates.length >= 3);
  for (const template of templates) {
    const component = await readFile(new URL(`scene-templates/${template.id}.svelte`, reference), 'utf8');
    assert.match(component, /Apache-2.0/);
    const id = template.id.slice('hyperframes-'.length);
    validateNativePort(components.find(entry => entry.id === id), ledger.find(entry => entry.id === id), Buffer.from(component));
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const compiled = await compileComponent({
        component,
        config: { width, height, fps: 30, durationInFrames: 150, captionSafeBottom: 0.24, visualMode: template.visualMode },
        images: Object.fromEntries(['image_1', 'image_2', 'image_3', 'image_4'].map(id => [id, imageDataURL])),
        videos: Object.fromEntries((template.requiredVideos || []).map(video => [video.id, 'data:video/mp4;base64,AAAA'])),
        inspectLayout: false,
      });
      assert.ok(compiled.javascript.length > 0, template.id);
    }
  }
});
