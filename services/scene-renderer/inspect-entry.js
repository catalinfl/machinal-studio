import Scene from 'generated-scene';
import { mountSvelteScene } from '@machinal/scenes/svelte';
import { installSceneEnvironment, settleSceneFonts } from './scene-environment.js';
import { inspectSceneLayout } from './layout-check.js';
import { inspectSceneVisibility } from './visibility-check.js';

async function inspect() {
  document.body.dataset.inspectionStage = 'fonts';
  await installSceneEnvironment();
  const target = document.getElementById('scene');
  const request = window.__sceneRequest;
  const config = request.config;
  document.body.dataset.inspectionStage = 'mount';
  const controller = mountSvelteScene(Scene, target, request, {}, { capture: false });
  await controller.ready();
  document.body.dataset.inspectionStage = 'frames';
  const issues = [];
  let visibleFrames = 0;
  for (const progress of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]) {
    const frame = Math.round((config.durationInFrames - 1) * progress);
    await controller.seek(frame);
    await settleSceneFonts(target);
    issues.push(...inspectSceneLayout(target, config).map(issue => ({ ...issue, frame })));
    const visibility = inspectSceneVisibility(target, config);
    if (visibility.hasForeground) visibleFrames++;
    issues.push(...visibility.issues.map(issue => ({ ...issue, frame })));
  }
  if (visibleFrames === 0) issues.push({ frame: 0, code: 'no_visible_foreground', text: 'No visible subject, text, supplied media or nonblank canvas at sampled frames. Fix dimensions, opacity/hold, stacking, SVG bounds or the Three.js camera, lights and geometry; preserve the requested artwork.' });
  await controller.dispose();
  return { issues, visibleFrames };
}

function report(result) {
  const encoded = JSON.stringify(result).replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
  document.body.setAttribute('data-inspection', btoa(encoded));
}

inspect().then(report).catch(error => report({ error: String(error.message).slice(0, 1000) }));
