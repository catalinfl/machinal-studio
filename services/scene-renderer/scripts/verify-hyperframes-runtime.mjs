import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundleComponent, sceneHTML, validateInput } from '../bundle.mjs';
import { chromium, nativeBrowserOptions } from '../../../client/scripts/native-browser.mjs';
import { hyperframesRuntimeVersion, captureBundleVersion } from './hyperframes-runtime-version.mjs';

const root = new URL('../../../packages/mcp-installer/library/', import.meta.url);
const reports = new URL('../../../.impeccable/review/native-library/', import.meta.url);
const args = process.argv.slice(2);
const ids = args.filter(arg => !arg.startsWith('--'));
const ledger = JSON.parse(await readFile(new URL('hyperframes-native.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('manifest.json', reports), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('hyperframes-components.json', root), 'utf8'));
const candidates = [...manifest.ports];
if (args.includes('--all')) {
  for (const entry of catalog) if (!candidates.some(port => port.id === entry.id)) {
    candidates.push({ id: entry.id, category: entry.category, upstreamName: entry.upstreamName,
      sourceFile: `${entry.upstreamName}.html` });
  }
}
const ports = candidates.filter(port => ids.length ? ids.includes(port.id)
  : args.includes('--all') || ledger.find(entry => entry.id === port.id)?.status !== 'ported');
const directory = await mkdtemp(join(tmpdir(), 'hyperframes-runtime-'));
const browser = await chromium.launch(nativeBrowserOptions);
const server = createServer(async (request, response) => {
  const name = request.url?.split('?')[0];
  if (!['/scene.html', '/scene.js'].includes(name)) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(name === '/scene.html' ? sceneHTML : await readFile(join(directory, 'scene.js')));
  } catch { response.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
let baseline = { results: [] };
const reportURL = new URL('runtime-verification.json', reports);
try { baseline = JSON.parse(await readFile(reportURL, 'utf8')); } catch { /* first run */ }
const baselineById = new Map(baseline.results.map(result => [result.id, result]));
const dependencySnapshot = await hyperframesRuntimeVersion();

try {
  for (const port of ports) {
    const component = await readFile(new URL(`hyperframes-native/${port.category}/${port.upstreamName}.svelte`, root), 'utf8');
    const sourceVersion = `sha256:${createHash('sha256').update(component).digest('hex')}`;
    const errors = [];
    const checks = [];
    let duration = 2;
    let runtimeVersion;
    try {
      const original = await readFile(new URL(`hyperframes-library/registry/${port.category}/${port.upstreamName}/${port.sourceFile}`, root), 'utf8');
      duration = Math.min(26, Number(original.match(/data-(?:composition-)?duration=["']([.\d]+)/)?.[1]) || 4);
      const config = { width: 1920, height: 1080, fps: 30, durationInFrames: Math.round(duration * 30) };
      validateInput({ component, config });
      await bundleComponent(component, directory, false, config);
      runtimeVersion = await captureBundleVersion(directory);
      if (!ids.length && baselineById.get(port.id)?.ok && baselineById.get(port.id)?.sourceVersion === sourceVersion
        && baselineById.get(port.id)?.runtimeVersion === runtimeVersion) continue;
      for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
        const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' });
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
        const external = [];
        await page.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(base + '/') || /^(data|blob):/.test(url)) return route.continue();
          external.push(url);
          return route.abort();
        });
        try {
          await page.addInitScript(request => { window.__sceneRequest = request; }, {
            version: 1, sceneId: port.id, seed: port.id, config: { ...config, width, height },
            props: { images: {}, videos: {} },
          });
          await page.goto(`${base}/scene.html`);
          await page.waitForFunction(() => window.__scene || window.__sceneError, undefined, { timeout: 45000 });
          const startup = await page.evaluate(() => window.__sceneError);
          if (startup) throw new Error(startup);
          await page.evaluate(async () => { await Promise.race([
            window.__scene.ready(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Scene readiness timed out')), 45000)),
          ]); });
          const samples = [];
          for (const fraction of [0, 0.4, 0.8]) {
            const frame = Math.floor(config.durationInFrames * fraction);
            await page.evaluate(async frame => { await Promise.race([
              window.__scene.seek(frame),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Scene frame timed out')), 45000)),
            ]); }, frame);
            const png = await page.screenshot();
            samples.push({ frame, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
            if (width === 1920 && fraction === 0.4) {
              await writeFile(new URL(`${port.id}-runtime.png`, reports), png);
            }
          }
          const content = await page.evaluate(() => ({
            elements: document.querySelectorAll('#scene *').length,
            images: [...document.querySelectorAll('#scene img')].every(image => image.complete && image.naturalWidth > 0),
          }));
          if (!content.elements || !content.images) throw new Error('Empty scene or undecoded image');
          if (pageErrors.length || external.length) throw new Error([...pageErrors, ...external.map(url => `External dependency: ${url}`)].join('\n'));
          checks.push({ width, height, compiled: true, rendered: true, samples, animated: new Set(samples.map(x => x.sha256)).size > 1 });
        } catch (error) {
          const diagnostics = await page.evaluate(() => ({
            frostLog: window.__frostLog,
            sceneError: window.__sceneError,
            stage: document.querySelector('[data-state]')?.getAttribute('data-state'),
          })).catch(() => null);
          throw new Error([error.message, ...pageErrors, ...external.map(url => `External dependency: ${url}`),
            ...(diagnostics?.frostLog ? [JSON.stringify(diagnostics)] : [])].join('\n'));
        } finally { await page.close(); }
      }
    } catch (error) { errors.push(error.message); }
    const ok = checks.length === 2 && errors.length === 0;
    results.push({ id: port.id, sourceVersion, runtimeVersion, dependencySnapshot, ok, duration, checks, errors, visualInspection: false });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${port.id}${errors.length ? ': ' + errors.join('\n').slice(0, 700) : ''}`);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}

const byId = new Map(baseline.results.map(result => [result.id, result]));
if (await hyperframesRuntimeVersion() !== dependencySnapshot) throw new Error('Runtime dependencies changed during capture; evidence was not promoted.');
for (const result of results) byId.set(result.id, result);
const all = [...byId.values()];
await writeFile(reportURL, JSON.stringify({
  total: all.length, passed: all.filter(result => result.ok).length,
  visualInspection: false, sourceEquivalence: false, results: all,
}, null, 2));
console.log('Production bundle runtime checks:', results.filter(result => result.ok).length, '/', results.length);
if (results.some(result => !result.ok)) process.exitCode = 1;
