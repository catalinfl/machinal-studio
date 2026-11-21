import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sceneHTML } from '../bundle.mjs';
import { sceneChromiumFlags } from '../chromium-flags.mjs';

export async function captureBundleVersion(directory) {
  const javascript = await readFile(join(directory, 'scene.js'));
  return 'sha256:' + createHash('sha256').update(javascript).update(sceneHTML)
    .update(JSON.stringify(sceneChromiumFlags)).digest('hex');
}

export async function hyperframesRuntimeVersion() {
  const base = new URL('../', import.meta.url);
  const hash = createHash('sha256');
  for (const name of [
    'bundle.mjs', 'fonts.mjs', 'scene-environment.js', 'chromium-flags.mjs',
    'render.mjs', 'inspect.mjs', 'renderer.mjs', 'evidence.mjs', 'Dockerfile',
    'scripts/scene-chromium.sh', 'package-lock.json',
  ]) {
    hash.update(name).update(await readFile(new URL(name, base)));
  }
  const visit = async directory => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await visit(url);
      else hash.update(url.pathname).update(await readFile(url));
    }
  };
  await visit(new URL('hyperframes/', base));
  return `sha256:${hash.digest('hex')}`;
}
