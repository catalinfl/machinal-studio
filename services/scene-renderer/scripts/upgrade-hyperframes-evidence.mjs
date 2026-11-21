import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { bundleComponent } from '../bundle.mjs';
import { hyperframesRuntimeVersion, captureBundleVersion } from './hyperframes-runtime-version.mjs';

const root = new URL('../../../packages/mcp-installer/library/', import.meta.url);
const reportURL = new URL('../../../.impeccable/review/native-library/runtime-verification.json', import.meta.url);
const report = JSON.parse(await readFile(reportURL, 'utf8'));
const catalog = JSON.parse(await readFile(new URL('hyperframes-components.json', root), 'utf8'));
const catalogById = new Map(catalog.map(entry => [entry.id, entry]));
const snapshot = await hyperframesRuntimeVersion();
const directory = await mkdtemp(join(tmpdir(), 'hyperframes-evidence-version-'));
let upgraded = 0;
try {
  for (const result of report.results) {
    if (result.dependencySnapshot === snapshot || !result.ok) continue;
    const entry = catalogById.get(result.id);
    const component = await readFile(new URL(`hyperframes-native/${entry.category}/${entry.upstreamName}.svelte`, root), 'utf8');
    if ('sha256:' + createHash('sha256').update(component).digest('hex') !== result.sourceVersion) continue;
    await bundleComponent(component, directory, false, {});
    if (result.runtimeVersion !== await captureBundleVersion(directory)) continue;
    result.dependencySnapshot = snapshot;
    upgraded++;
  }
  if (await hyperframesRuntimeVersion() !== snapshot) throw new Error('Dependencies changed during evidence migration');
  await writeFile(reportURL, JSON.stringify(report, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Pinned existing captures to their exact production bundles:', upgraded);
