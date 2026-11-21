import { readFile } from 'node:fs/promises';
import { renderComponent as renderFile } from './render.mjs';

// Only small native test fixtures buffer video for pixel assertions.
export async function renderComponent(...args) {
  const result = await renderFile(...args);
  try { return { manifest: result.manifest, video: await readFile(result.path), bytes: result.bytes }; }
  finally { await result.dispose(); }
}
