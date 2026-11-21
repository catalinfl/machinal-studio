import test from 'node:test';
import assert from 'node:assert/strict';
import { isProductionNotice } from './visibility-check.js';
import { compileComponent } from './render.mjs';

test('production notices are rejected without banning a story about artificial intelligence', () => {
  for (const copy of ['AI-generated', 'Generated with AI', 'Ilustrație AI', 'Ilustrație artistică AI', 'Generat cu AI', 'Narațiune sintetică', 'AI illustration']) {
    assert.equal(isProductionNotice(copy), true, copy);
  }
  for (const copy of ['Cum funcționează inteligența artificială', 'AI în medicină', 'Mihai Eminescu', 'Aici ai o idee']) {
    assert.equal(isProductionNotice(copy), false, copy);
  }
});

const native = { skip: !process.env.SCENE_BROWSER, timeout: 120000 };
const config = { width: 640, height: 360, fps: 30, durationInFrames: 90 };
const scene = content => `<script>import {SceneCanvas} from '@direction/scene-svelte';</script><SceneCanvas background="#151A20">${content}</SceneCanvas>`;

test('native inspection rejects blank, offscreen and fully invisible scenes', native, async () => {
  for (const component of [
    scene(''),
    scene('<div style="opacity:0;width:120px;height:120px;background:red"></div>'),
    scene('<div style="position:absolute;left:900px;width:120px;height:120px;background:red"></div>'),
    `<script>import {SceneCanvas,SceneThree} from '@direction/scene-svelte';function setup(){return {update(){}}}</script><SceneCanvas background="#151A20"><SceneThree {setup} /></SceneCanvas>`,
  ]) await assert.rejects(compileComponent({ inspectLayout: true, config, component }), /no_visible_foreground/);
});

test('native inspection rejects visible production labels but accepts subject-specific artwork', native, async () => {
  await assert.rejects(compileComponent({ inspectLayout: true, config, component: scene('<p style="font-size:32px;color:white">Ilustrație AI</p>') }), /production_label_on_screen/);
  await assert.rejects(compileComponent({ inspectLayout: true, config, component: scene('<div class="badge"></div><style>.badge{width:300px;height:100px;color:white;font-size:32px}.badge::before{content:"AI-generated"}</style>') }), /production_label_on_screen/);
  const result = await compileComponent({ inspectLayout: true, config, component: scene('<div style="position:absolute;left:150px;top:80px;width:180px;height:180px;border-radius:50%;background:#EBC36B"></div>') });
  assert.ok(result.javascript.length > 0);
});
