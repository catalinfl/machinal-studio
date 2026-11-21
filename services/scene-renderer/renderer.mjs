import { doctor } from '@machinal/scenes/node';
import { SceneInfrastructureError } from './diagnostics.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let packagedRenderer;
const execute = promisify(execFile);

export async function rendererExecutable(env = process.env) {
  if (env.SCENE_RENDER_BIN) return env.SCENE_RENDER_BIN;
  packagedRenderer ??= locateRenderer().catch(error => {
    packagedRenderer = undefined;
    throw error;
  });
  return packagedRenderer;
}

async function locateRenderer() {
  const { renderer } = await doctor();
  requireTool('renderer', renderer);
  return renderer.path;
}

function requireTool(name, tool) {
  if (tool.available) return;
  if (name === 'renderer' && /EACCES|permission denied/i.test(tool.error ?? '')) {
    throw new SceneInfrastructureError('scene_renderer_permission_denied', 'The scene-render executable lacks execute permission (EACCES). Rebuild the scene-renderer image with executable permissions; changing Svelte source cannot fix this.', tool.error);
  }
  throw new SceneInfrastructureError(`scene_${name}_unavailable`, `The scene ${name} is unavailable. Check the scene-renderer installation and rebuild its image; preserve existing scene sources and media.`, tool.error);
}

export async function ensureRendererReady(probe = doctor, env = process.env, run = execute) {
  const tools = await probe();
  if (env.SCENE_RENDER_BIN) {
    try {
      await run(env.SCENE_RENDER_BIN, ['-version'], { timeout: 15000, maxBuffer: 128 * 1024, windowsHide: true });
      tools.renderer = { available: true };
    } catch (error) { tools.renderer = { available: false, error: `${error.code}: ${error.message}` }; }
  }
  for (const name of ['renderer', 'browser', 'ffmpeg']) requireTool(name, tools[name]);
}
