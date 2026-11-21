import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileComponent } from '../render.mjs';
import { imageDataURL } from '../image-fixture.mjs';

const reference = new URL('../../../packages/mcp-installer/library/', import.meta.url);

export async function compileHyperframesNative(output, { only = [] } = {}) {
  const ports = JSON.parse(await readFile(new URL('hyperframes-native.json', reference), 'utf8'));
  const results = [];
  for (const port of ports.filter(port => port.status === 'ported' && (!only.length || only.includes(port.id)))) {
    const component = await readFile(new URL(`hyperframes-native/${port.nativePath}`, reference), 'utf8');
    const sourceVersion = `sha256:${createHash('sha256').update(component).digest('hex')}`;
    const checks = [];
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      try {
        const compiled = await compileComponent({
          component,
          config: { width, height, fps: 30, durationInFrames: 150, captionSafeBottom: 0.24, visualMode: port.visualMode },
          images: Object.fromEntries(['image_1', 'image_2', 'image_3', 'image_4'].map(id => [id, imageDataURL])),
          // Compile-only fixture. Video attachment bytes are validated, never decoded or fetched here.
          videos: Object.fromEntries((port.requiredVideos || []).map(video => [video.id, 'data:video/mp4;base64,AAAA'])),
          inspectLayout: false,
        });
        checks.push({ width, height, compiled: Boolean(compiled.javascript) });
      } catch (error) {
        checks.push({ width, height, compiled: false, error: error.message });
      }
    }
    results.push({ id: port.id, sourceVersion, compiled: checks.every(check => check.compiled), visualInspection: false, motionVerified: false, checks });
    console.log(`${results.at(-1).compiled ? 'PASS' : 'FAIL'} ${port.id}`);
  }
  const report = { total: ports.length, checked: results.length, passed: results.filter(result => result.compiled).length, visualInspection: false, results };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await recordCompilationResults(results);
  return report;
}

async function recordCompilationResults(results) {
  const ledgerURL = new URL('hyperframes-native.json', reference);
  const componentURL = new URL('hyperframes-components.json', reference);
  const ledger = JSON.parse(await readFile(ledgerURL, 'utf8'));
  const components = JSON.parse(await readFile(componentURL, 'utf8'));
  const byID = new Map(results.map(result => [result.id, result]));
  const ports = new Map(ledger.map(port => [port.id, port]));
  for (const component of components) {
    const result = byID.get(component.id);
    const port = ports.get(component.id);
    if (!result || !port || port.sourceVersion !== result.sourceVersion) continue;
    port.verification = {
      ...(port.verification || {}),
      compiled: result.compiled,
      visualInspection: false,
      checks: result.checks,
    };
    component.nativeVerifiedCompiled = result.compiled;
    component.nativeSourceVersion = result.sourceVersion;
    const sidecarURL = new URL(`hyperframes-native/${port.nativePath.replace(/\.svelte$/, '.port.json')}`, reference);
    const sidecar = JSON.parse(await readFile(sidecarURL, 'utf8'));
    if (sidecar.status !== 'ported' || sidecar.nativePath !== port.nativePath) {
      throw new Error(`Native sidecar changed during compilation: ${port.id}`);
    }
    sidecar.verification = {
      ...(sidecar.verification || {}),
      compiled: result.compiled,
      visualInspection: false,
      checks: result.checks,
    };
    await writeFile(sidecarURL, `${JSON.stringify(sidecar, null, 2)}\n`);
  }
  await writeFile(ledgerURL, `${JSON.stringify(ledger, null, 2)}\n`);
  await writeFile(componentURL, `${JSON.stringify(components, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass a NEW compile-report JSON path.');
  const report = await compileHyperframesNative(resolve(process.argv[2]), { only: process.argv.slice(3) });
  console.log(`Compiled ${report.passed}/${report.checked} native ports; this is not visual inspection.`);
  if (report.passed !== report.checked) process.exitCode = 1;
}
