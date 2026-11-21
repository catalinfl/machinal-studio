import Scene from 'generated-scene';
import { mountSvelteScene } from '@machinal/scenes/svelte';
import { installSceneEnvironment, settleSceneFonts } from './scene-environment.js';
import { PreviewSnapshot } from './preview-snapshot.js';
import { PreviewEffects } from './preview-effects.js';

const environmentReady = installSceneEnvironment();
const snapshot = new PreviewSnapshot();
const effects = new PreviewEffects();

let controller;
let config;
let channel;
let queue = Promise.resolve();
const target = document.getElementById('scene');

async function handle(command) {
  if (command.method === 'init') {
    await environmentReady;
    config = command.config;
    target.style.width = `${config.width}px`;
    target.style.height = `${config.height}px`;
    controller = mountSvelteScene(Scene, target, {
      version: 1, sceneId: 'generated', seed: 'generated', config, props: { images: command.images ?? {}, videos: command.videos ?? {}, parameters: command.parameters ?? {}, models: command.models ?? {} },
    }, {}, { renderScale: command.renderScale ?? 1, capture: !!command.capture });
    await controller.ready();
    await settleSceneFonts(target);
  } else {
    if (!controller) throw new Error('Scene is not initialized');
    await controller.seek(command.frame, {
      realtime: !command.capture && command.playing,
      playbackRate: command.playbackRate ?? 1,
      renderScale: command.renderScale ?? 1,
      capture: !!command.capture,
    });
  }
  effects.apply(target, command.matrices);
  if (command.capture) await settleSceneFonts(target);
  const response = { type: 'live-scene:response', channel, id: command.id };
  if (command.capture) {
    const scale = command.fullResolution ? 1 : Math.min(1, command.renderScale ?? 1, 1280 / Math.max(config.width, config.height));
    response.bitmap = await snapshot.capture(target, config, scale);
    parent.postMessage(response, '*', [response.bitmap]);
  } else parent.postMessage(response, '*');
}

window.addEventListener('message', event => {
  const command = event.data;
  if (event.source !== parent || command?.type !== 'live-scene:command') return;
  if (!channel && command.method === 'init') channel = command.channel;
  if (command.channel !== channel) return;
  queue = queue.then(() => handle(command)).catch(error => {
    parent.postMessage({ type: 'live-scene:response', channel, id: command.id, error: error.message }, '*');
  });
});
