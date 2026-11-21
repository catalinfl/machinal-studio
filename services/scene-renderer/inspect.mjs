import { access, readFile, writeFile } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { bundleComponent } from './bundle.mjs';
import { SceneDiagnosticError } from './diagnostics.mjs';
import { sceneChromiumFlags } from './chromium-flags.mjs';

const browserTimeout = 30000;

export async function browserExecutable() {
  const name = process.env.SCENE_BROWSER || 'chromium';
  if (isAbsolute(name)) return name;
  const filename = process.platform === 'win32' && !extname(name) ? `${name}.exe` : name;
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const path = join(directory, filename);
    try {
      await access(path);
      return path;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error('Scene inspection needs an installed Chromium executable; set SCENE_BROWSER to its path');
}

async function inspectInBrowser(path, config) {
  const browser = await chromium.launch({
    executablePath: await browserExecutable(),
    headless: true,
    chromiumSandbox: process.env.SCENE_NO_SANDBOX !== 'true',
    args: sceneChromiumFlags,
    timeout: browserTimeout,
  });
  try {
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height }, serviceWorkers: 'block' });
    const url = pathToFileURL(path).href;
    await page.route('**/*', route => {
      const target = route.request().url();
      return target === url || /^(data|blob):/.test(target) ? route.continue() : route.abort();
    });
    await page.goto(url, { waitUntil: 'load', timeout: browserTimeout });
    await page.waitForFunction(() => document.body.hasAttribute('data-inspection'), undefined, { timeout: browserTimeout });
    const encoded = await page.locator('body').getAttribute('data-inspection');
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } finally {
    await browser.close();
  }
}

export async function inspectComponent(input, directory) {
  await bundleComponent(input.component, directory, true, { ...input.config, inspectLayout: true });
  const javascript = await readFile(join(directory, 'scene.js'));
  const request = JSON.stringify({ version: 1, sceneId: 'inspection', seed: 'generated', config: input.config, props: { images: input.images ?? {}, videos: input.videos ?? {}, parameters: input.parameters ?? {}, models: input.models ?? {} } }).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; font-src data:; img-src data: blob:; media-src data: blob:; connect-src blob:;"><style>html,body,#scene{margin:0;width:${input.config.width}px;height:${input.config.height}px;overflow:hidden}</style><body><div id="scene"></div><script>window.__sceneRequest=${request};</script><script src="data:application/javascript;base64,${javascript.toString('base64')}"></script></body>`;
  const path = join(directory, 'inspect.html');
  await writeFile(path, html, { mode: 0o600 });
  const result = await inspectInBrowser(path, input.config);
  if (result.error) throw new SceneDiagnosticError(`Scene layout inspection runtime error: ${result.error}`);
  if (result.issues.length) {
    throw new SceneDiagnosticError('Scene layout inspection failed: ' + result.issues.slice(0, 6).map(issue => `frame ${issue.frame}: ${issue.code}: ${issue.text}`).join('; ') + '. Repair visibility, font sizes, wrapping and shared layout bounds without removing requested artwork, motion, media or genuine Three.js. Keep text blocks separated and inside the canvas; remove production labels, not subject copy. Use data-layout-overlap="allow" only for intentional decorative text overlap.');
  }
  return result;
}
