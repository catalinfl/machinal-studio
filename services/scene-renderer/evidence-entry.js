import Scene from 'generated-scene';
import { mountSvelteScene } from '@machinal/scenes/svelte';
import { installSceneEnvironment, settleSceneFonts } from './scene-environment.js';
import { inspectSceneLayout } from './layout-check.js';
import { inspectSceneVisibility } from './visibility-check.js';

async function start() {
  await installSceneEnvironment();
  const target = document.getElementById('scene');
  const request = window.__sceneRequest;
  const controller = mountSvelteScene(Scene, target, request, {}, { capture: true });
  await controller.ready();
  window.__sceneEvidence = {
    async seek(frame) {
      await controller.seek(frame);
      await settleSceneFonts(target);
      const origin = target.getBoundingClientRect();
      const annotated = target.querySelectorAll('[data-scene-object]');
      const objects = [...annotated].slice(0, 32).map(element => {
        const rect = element.getBoundingClientRect();
        let opacity = 1;
        for (let current = element; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden') opacity = 0;
          opacity *= Number(style.opacity);
          if (current === target) break;
        }
        return { id: element.getAttribute('data-scene-object').slice(0, 80), x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height, opacity };
      });
      const visibility = inspectSceneVisibility(target, request.config);
      return { issues: [...inspectSceneLayout(target, request.config), ...visibility.issues], hasForeground: visibility.hasForeground, objects, totalObjects: annotated.length, objectsTruncated: annotated.length > objects.length, states: controller.snapshotObjects?.() ?? {} };
    },
  };
}

start().catch(error => { window.__sceneError = String(error.message).slice(0, 1000); });
