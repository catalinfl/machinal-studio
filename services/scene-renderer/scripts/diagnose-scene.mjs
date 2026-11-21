import { readFile } from 'node:fs/promises';
import { renderComponent } from '../render.mjs';
import { reportSceneFailure } from '../diagnostics.mjs';

const [sourceFile] = process.argv.slice(2);
if (!sourceFile || process.argv.length !== 3) {
  console.error('Usage: node scripts/diagnose-scene.mjs /approved/path/scene.scene.json');
  process.exitCode = 1;
} else {
  const started = performance.now();
  let result;
  try {
    const source = JSON.parse(await readFile(sourceFile, 'utf8'));
    result = await renderComponent(source, AbortSignal.timeout(12 * 60 * 1000));
    console.info('scene_diagnostic_completed', JSON.stringify({
      elapsedMs: Math.round(performance.now() - started),
      bytes: result.bytes,
      frames: result.manifest.frames,
      width: result.manifest.width,
      height: result.manifest.height,
      sha256: result.manifest.sha256,
    }));
  } catch (error) {
    reportSceneFailure(error, { route: 'diagnostic', elapsedMs: Math.round(performance.now() - started) });
    process.exitCode = 1;
  } finally { await result?.dispose(); }
}
