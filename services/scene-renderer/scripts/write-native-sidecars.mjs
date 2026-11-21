/**
 * Writes the `.port.json` sidecar for every mass-ported HyperFrames scene.
 *
 * The sidecar is the provenance and configuration record the MCP installer
 * reads: which upstream files a port came from, its artboard and duration, the
 * editable design parameters declared by the upstream page, and the exact list
 * of mechanical adaptations made to the verbatim copy.
 *
 * Durations are read from the upstream declaration. When a page declares none
 * the value starts at the ledger default and is replaced by the duration
 * measured during verification (`comparison.json`).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hyperframesRuntimeVersion } from './hyperframes-runtime-version.mjs';

const reference = new URL('../../../packages/mcp-installer/library/', import.meta.url);
const registry = 'hyperframes-library/registry/';
const nativeRoot = 'hyperframes-native/';
const reportRoot = new URL('../../../.impeccable/review/native-library/', import.meta.url);
const compileReportName = process.argv.find(argument => argument.startsWith('--compile-report='))
  ?.slice('--compile-report='.length) ?? 'compile-report.json';

const manifest = JSON.parse(await readFile(new URL('manifest.json', reportRoot), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('hyperframes-components.json', reference), 'utf8'));
const byId = new Map(catalog.map(entry => [entry.id, entry]));
const dependencySnapshot = await hyperframesRuntimeVersion();
const explicitlyDeferred = new Set([
  'blocks-frost-sequence-camera-orbit',
  'blocks-ui-3d-reveal',
]);

let measured = new Map();
let compileEvidence = new Map();
let runtimeEvidence = new Map();
try {
  const report = JSON.parse(await readFile(new URL('runtime-verification.json', reportRoot), 'utf8'));
  runtimeEvidence = new Map(report.results.map(result => [result.id, result]));
} catch { /* runtime verification has not run yet */ }
try {
  const comparison = JSON.parse(await readFile(new URL('comparison.json', reportRoot), 'utf8'));
  for (const result of comparison.results) measured.set(result.id, result);
} catch { /* verification has not run yet */ }
try {
  const report = JSON.parse(await readFile(new URL(compileReportName, reportRoot), 'utf8'));
  for (const result of report.results) compileEvidence.set(result.id, result);
} catch { /* compilation has not run yet */ }

let written = 0;
let pending = 0;
for (const port of manifest.ports) {
  const entry = byId.get(port.id);
  if (!entry) throw new Error(`catalog entry missing for ${port.id}`);

  const source = await readFile(new URL(`${registry}${port.category}/${port.upstreamName}/${port.sourceFile}`, reference), 'utf8');
  const component = await readFile(new URL(`${nativeRoot}${port.category}/${port.upstreamName}.svelte`, reference));
  const sourceVersion = `sha256:${createHash('sha256').update(component).digest('hex')}`;
  const duration = readDuration(source);
  const parameters = readParameters(entry, source);
  const verification = measured.get(port.id);
  const compiled = compileEvidence.get(port.id);
  const runtime = runtimeEvidence.get(port.id);
  let runtimeMatches = false;
  if (!explicitlyDeferred.has(port.id) && runtime?.sourceVersion === sourceVersion && runtime.ok
    && runtime.dependencySnapshot === dependencySnapshot) runtimeMatches = true;
  const originalMatches = !explicitlyDeferred.has(port.id) && verification?.ok
    && (!port.reviewVersion || verification.sourceVersion === sourceVersion);
  let previous = {};
  try {
    previous = JSON.parse(await readFile(new URL(`${nativeRoot}${port.category}/${port.upstreamName}.port.json`, reference), 'utf8'));
  } catch { /* first sidecar for this port */ }
  const previousMatches = previous.sourceVersion === sourceVersion;
  const compilationMatches = compiled?.sourceVersion === sourceVersion;
  const compiledChecks = runtimeMatches ? runtime.checks : compilationMatches && compiled.compiled
    ? compiled.checks
    : previousMatches && previous.verification?.compiled
      ? previous.verification.checks
      : undefined;

  const metadata = {
    id: port.id,
    nativePath: `${port.category}/${port.upstreamName}.svelte`,
    sourceVersion,
    status: originalMatches || runtimeMatches ? 'ported' : 'pending',
    sourcePaths: entry.files.map(file => file.path).filter(path => path.startsWith(`registry/${port.category}/${port.upstreamName}/`)),
    visualMode: '2d',
    requiredImages: [],
    requiredVideos: [],
    parameters,
    adaptations: [
      port.runtime === 'webgpu'
        ? 'Original MIT WebGPU shader is bundled locally; initialization, seeking, GPU completion and cleanup use the existing scene resource scope.'
        : 'Upstream markup and animation are adapted to the native frame clock; demo pages supply functional markup for paste-in primitives.',
      ...(port.bundledFonts?.length ? ['OFL font files are installed from pinned local Fontsource packages; no font CDN is required.'] : []),
      ...(port.mediaReplacements?.length ? ['Missing media is replaced by explicitly authorized, locally authored sample artwork/video; it is not the original subject imagery.'] : []),
      ...(port.timeline === 'documented-recipe'
        ? ['The upstream primitive documents its entrance as a "Timeline integration" recipe; that recipe is used verbatim as the paused timeline with startTime = 0.']
        : []),
      ...(/window\.__timelines/.test(source) ? ['The upstream window.__timelines publication is handed to a component-owned slot so the scene controller can seek it.'] : []),
      ...(/__hyperframes|__hfVariables/.test(source) ? ['Host variable lookups read the approved design prop through a small host shim.'] : []),
      ...(/document\.currentScript\.closest/.test(source)
        ? ['The upstream currentScript lookup resolves through the Svelte component root because the initializer is no longer executing inside a script element.']
        : []),
      ...(/\binnerHTML\b/.test(source) ? ['Markup built by the upstream script with innerHTML is reproduced by the same script, so the DOM is identical.'] : []),
      'CSS indentation is normalized without changing declarations; document-level selectors (html/body/:root/*) are retargeted to the port root so a mounted port cannot restyle the host page.',
    ],
    limitations: [
      'Uses the original system-font fallbacks; installed operating-system fonts can differ between machines.',
      ...(explicitlyDeferred.has(port.id) ? ['Explicitly deferred at the user’s request; excluded from published native ports.'] : []),
      ...(!originalMatches ? [runtimeMatches
        ? 'Verified by actual production-bundle frame capture in landscape and portrait; not claimed pixel-identical to the upstream page.'
        : 'Awaiting production runtime capture or source-vs-port equivalence review; not published as ported.'] : []),
      ...(port.runtime === 'webgpu' ? ['Requires a working Chromium WebGPU adapter and Dawn shader compiler; fails explicitly rather than rendering a blank fallback.'] : []),
      ...(parameters.length ? [] : ['The upstream page declares no editable variables; this scene is a fixed composition.']),
      ...(port.timeline === 'documented-recipe'
        ? ['The upstream file ships no timeline of its own; the port applies its documented recipe unchanged.']
        : []),
    ],
    verification: {
      compiled: Boolean(compiledChecks),
      // Automated DOM/pixel equivalence is not a human visual inspection.
      visualInspection: false,
      motionVerified: Boolean(originalMatches || runtimeMatches),
      ...(runtimeMatches ? { runtimeCapture: {
        rendered: true, sourceVersion, runtimeVersion: runtime.runtimeVersion,
        dependencySnapshot: runtime.dependencySnapshot, checks: runtime.checks,
      } } : {}),
      ...(originalMatches ? {
        originalComparison: {
          frames: verification.frames?.length ?? 0,
          sampledPixelsIdentical: (verification.pixels ?? []).every(pixel => pixel.identical),
          snapshotDifferences: verification.differences?.length ?? 0,
        },
      } : {}),
      ...(compiledChecks ? { checks: compiledChecks } : {}),
    },
    animationRuntime: port.runtime ?? 'gsap',
    mediaReplacements: port.mediaReplacements ?? [],
    config: {
      width: port.artboard[0],
      height: port.artboard[1],
      fps: 30,
      duration: measured.get(port.id)?.duration ?? duration,
      captionSafeArea: false,
    },
  };

  await writeFile(new URL(`${nativeRoot}${port.category}/${port.upstreamName}.port.json`, reference), `${JSON.stringify(metadata, null, 1)}\n`);
  written += 1;
  if (metadata.status === 'pending') pending += 1;
}

// A skipped upstream page is a documented blocked entry, not a missing one:
// the reason travels with the ledger so the limitation is visible to clients.
let blocked = 0;
for (const skip of [...(manifest.skipped ?? []), ...(manifest.failed ?? [])]) {
  const entry = byId.get(skip.id);
  if (!entry) throw new Error(`catalog entry missing for ${skip.id}`);
  const metadata = {
    id: skip.id,
    nativePath: `${entry.category}/${entry.upstreamName}.svelte`,
    status: 'blocked',
    sourcePaths: entry.files.map(file => file.path).filter(path => path.startsWith(`registry/${entry.category}/${entry.upstreamName}/`)),
    visualMode: '2d',
    requiredImages: [],
    requiredVideos: [],
    parameters: [],
    adaptations: [],
    limitations: [skip.reason],
    verification: { compiled: false, visualInspection: false, motionVerified: false },
  };
  await writeFile(new URL(`${nativeRoot}${entry.category}/${entry.upstreamName}.port.json`, reference), `${JSON.stringify(metadata, null, 1)}\n`);
  blocked += 1;
}

console.log(`sidecars written: ${written - pending} ported, ${pending} pending, ${blocked} blocked; measured durations: ${measured.size}`);

function readDuration(source) {
  for (const match of source.matchAll(/data-(?:composition-)?duration\s*=\s*["']([0-9.]+)["']/gi)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 5;
}

/**
 * Editable parameters come from the catalogue entry when the registry item
 * declares them, and from the page's own `data-composition-variables`
 * declaration otherwise; both describe the same upstream contract.
 */
function readParameters(entry, source) {
  const ids = new Set((entry.variables ?? []).map(variable => variable.id));
  for (const match of source.matchAll(/data-composition-variables\s*=\s*'([\s\S]*?)'/g)) {
    try {
      for (const variable of JSON.parse(match[1])) if (variable?.id) ids.add(variable.id);
    } catch { /* the page declares no parseable variables */ }
  }
  return [...ids].filter(id => /^[a-zA-Z]\w*$/.test(id)).sort().map(id => `design.${id}`);
}
