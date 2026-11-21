import { execFile } from 'node:child_process';
import { open, readdir, realpath, stat, utimes } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { rendererExecutable } from '../renderer.mjs';
import { executablePath, fileDigest, maxFingerprintManifestBytes } from '../renderer-fingerprint.mjs';

const execute = promisify(execFile);
const minResourceBytes = 64 * 1024;
const maxReclaimFiles = 8192;

async function largeResources(root, files) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await largeResources(path, files);
    else if (entry.isFile() && (await stat(path)).size >= minResourceBytes) files.add(path);
    if (files.size > maxReclaimFiles) throw new Error('Renderer reclaim manifest has too many files');
  }
}

async function sharedLibraries(binary) {
  const { stdout } = await execute('ldd', [binary], { timeout: 15000, maxBuffer: 1024 * 1024 });
  if (stdout.includes('not found')) throw new Error('Renderer shared library is missing');
  return Promise.all([...stdout.matchAll(/\/[^\s()]+/g)].map(match => realpath(match[0])));
}

export async function buildRendererManifest(paths, resources, libraries = []) {
  const executables = await Promise.all(paths.map(async path => {
    const info = await stat(path);
    return { path, size: info.size, mtimeMs: info.mtimeMs, sha256: await fileDigest(path) };
  }));
  const files = new Set([...paths, ...libraries]);
  const priority = [...files];
  for (const root of resources) await largeResources(root, files);
  if (files.size > maxReclaimFiles) throw new Error('Renderer reclaim manifest has too many files');
  return { version: 1, executables, reclaimFiles: [...priority, ...[...files].filter(path => !priority.includes(path)).sort()] };
}

export async function normalizeExecutableTimes(paths) {
  for (const path of paths) {
    const info = await stat(path);
    // OCI layer archives may discard fractional mtimes; pin the same value at build and runtime.
    if (info.mtimeMs % 1000 !== 0) await utimes(path, info.atime, Math.floor(info.mtimeMs / 1000));
  }
}

async function main(destination) {
  if (!destination) throw new Error('Provide the renderer manifest destination');
  const browser = await executablePath(process.env.SCENE_BROWSER || 'chrome-headless-shell');
  const ffmpeg = await executablePath(process.env.SCENE_FFMPEG || 'ffmpeg');
  const renderer = await executablePath(await rendererExecutable());
  await normalizeExecutableTimes([renderer, browser, ffmpeg]);
  const libraries = (await Promise.all([process.execPath, browser, ffmpeg].map(sharedLibraries))).flat();
  const manifest = await buildRendererManifest([renderer, browser, ffmpeg], [dirname(browser), resolve(import.meta.dirname, '../node_modules')], [process.execPath, ...libraries]);
  const data = JSON.stringify(manifest);
  if (Buffer.byteLength(data) > maxFingerprintManifestBytes) throw new Error('Renderer manifest is too large');
  const file = await open(destination, 'wx', 0o644);
  try { await file.writeFile(data); } finally { await file.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
