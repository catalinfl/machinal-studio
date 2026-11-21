import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresWebGPU, sceneChromiumFlags } from './chromium-flags.mjs';

test('native WebGPU adapters opt into the existing Chromium renderer, not a new engine', () => {
  assert.equal(requiresWebGPU("import { createHyperframeShader } from '@machinal/hyperframes/shaders';"), true);
  assert.equal(requiresWebGPU("import * as THREE from 'three';"), false);
  assert.ok(sceneChromiumFlags.includes('--enable-blink-features=CanvasDrawElement'));
  assert.ok(sceneChromiumFlags.every(flag => !/disable-web-security|no-sandbox/.test(flag)));
});
