import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { sceneChromiumFlags } from './chromium-flags.mjs';
import { bundleComponent, validateInput } from './bundle.mjs';
import { browserExecutable } from './inspect.mjs';
import { SceneDiagnosticError } from './diagnostics.mjs';

export const maxEvidenceFrames = 6;
const thumbnailEdge = 480;
const maxEvidenceBytes = 768 * 1024;

export function evidenceFrames(input) {
  validateInput(input);
  const frames = input.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > maxEvidenceFrames || frames.some(frame => !Number.isInteger(frame) || frame < 0 || frame >= input.config.durationInFrames) || new Set(frames).size !== frames.length) {
    throw new SceneDiagnosticError(`Choose 1-${maxEvidenceFrames} distinct frame indices inside the scene`);
  }
  return [...frames];
}

async function evidencePage(input, directory) {
  await bundleComponent(input.component, directory, true, { ...input.config, inspectEvidence: true });
  const javascript = await readFile(join(directory, 'scene.js'));
  const request = JSON.stringify({ version: 1, sceneId: 'inspection', seed: 'generated', config: input.config, props: { images: input.images ?? {}, videos: input.videos ?? {}, parameters: input.parameters ?? {}, models: input.models ?? {} } }).replace(/</g, '\\u003c');
  const path = join(directory, 'evidence.html');
  const csp = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; media-src data: blob:; connect-src blob:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
  await writeFile(path, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;overflow:hidden}#scene{width:${input.config.width}px;height:${input.config.height}px;overflow:hidden}*{box-sizing:border-box}</style><div id="scene"></div><script>window.__sceneRequest=${request};</script><script src="data:application/javascript;base64,${javascript.toString('base64')}"></script>`, { mode: 0o600 });
  return { path, bundleVersion: 'sha256:' + createHash('sha256').update(javascript).digest('hex') };
}

export async function inspectEvidence(input, signal) {
  const frames = evidenceFrames(input);
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'direction-scene-evidence-'));
  let browser;
  const abort = () => { void browser?.close().catch(() => {}); };
  try {
    const { path, bundleVersion } = await evidencePage(input, directory);
    signal?.throwIfAborted();
    browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true, chromiumSandbox: process.env.SCENE_NO_SANDBOX !== 'true', args: sceneChromiumFlags, timeout: 30000 });
    signal?.addEventListener('abort', abort, { once: true });
    signal?.throwIfAborted();
    const page = await browser.newPage({ viewport: { width: input.config.width, height: input.config.height }, serviceWorkers: 'block' });
    page.setDefaultTimeout(15000);
    const url = pathToFileURL(path).href;
    await page.route('**/*', route => route.request().url() === url || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__sceneEvidence || window.__sceneError);
    if (await page.evaluate(() => window.__sceneError)) throw new SceneDiagnosticError('Scene evidence runtime failed');
    const scale = Math.min(1, thumbnailEdge / Math.max(input.config.width, input.config.height));
    const width = Math.max(1, Math.round(input.config.width * scale));
    const height = Math.max(1, Math.round(input.config.height * scale));
    const result = [];
    let bytes = 0;
    for (const frame of frames) {
      signal?.throwIfAborted();
      const diagnostics = await page.evaluate(frame => window.__sceneEvidence.seek(frame), frame);
      await page.locator('#scene').evaluate((element, scale) => { element.style.transformOrigin = 'top left'; element.style.transform = `scale(${scale})`; }, scale);
      const image = await page.screenshot({ type: 'jpeg', quality: 75, clip: { x: 0, y: 0, width, height }, timeout: 15000 });
      await page.locator('#scene').evaluate(element => { element.style.transform = ''; });
      bytes += image.length;
      if (bytes > maxEvidenceBytes) throw new SceneDiagnosticError('Evidence exceeds the thumbnail output limit; request fewer frames');
      result.push({ frame, time: frame / input.config.fps, width, height, mimeType: 'image/jpeg', data: image.toString('base64'), ...diagnostics });
    }
    const allSampledFramesIdentical = result.length >= 2 && result.every(item => item.data === result[0].data);
    return {
      frames: result,
      environment: { browserVersion: browser.version(), bundleVersion },
      motionVerified: false,
      audioVerified: false,
      ...(allSampledFramesIdentical ? {
        allSampledFramesIdentical: true,
        staticSceneWarning: `All sampled frames (${frames.join(', ')}) rendered identical pixels. Verify the component derives motion reactively from useScene() ($derived(scene.frame.time)) or SceneThree update(frame) rather than static defaults.`,
      } : {}),
      limitations: 'Sampled scene thumbnails compiled with the reported runtime bundle/browser, not final-composition inspection or aesthetic approval. Object bounds describe annotated DOM elements, not pixel occlusion or internal Three.js meshes. Still frames do not verify motion or audio; JPEG backing does not verify export alpha.',
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    try { await browser?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
