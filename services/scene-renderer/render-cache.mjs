import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arch, platform, release } from 'node:os';
import { rendererExecutable } from './renderer.mjs';
import { executableFingerprints, executablePath } from './renderer-fingerprint.mjs';

// Full-length lossless Full HD scenes can exceed 512 MiB; keep the API receiver in sync.
export const maxRenderBytes = 1024 * 1024 * 1024;
const maxManifestBytes = 256 * 1024;
const defaultCacheBytes = 2 * 1024 * 1024 * 1024;
const cacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const identities = new Map();

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function cacheKey(bundle, html, input, identity) {
  return createHash('sha256').update(bundle).update('\0').update(html).update('\0')
    .update(JSON.stringify(canonical({ config: input.config, images: input.images ?? {}, videos: input.videos ?? {}, parameters: input.parameters ?? {}, models: input.models ?? {}, identity }))).digest('hex');
}

export async function rendererIdentity(options, env = process.env) {
  const paths = await Promise.all([rendererExecutable(env).then(name => executablePath(name, env)), executablePath(env.SCENE_BROWSER || 'chrome-headless-shell', env), executablePath(env.SCENE_FFMPEG || 'ffmpeg', env)]);
  const files = await Promise.all(paths.map(async path => { const info = await stat(path); return [path, info.size, info.mtimeMs]; }));
  const key = JSON.stringify([files, options, env.SCENE_CACHE_VERSION ?? '1', env.SCENE_GPU_FINGERPRINT ?? '', platform(), arch(), release()]);
  if (!identities.has(key)) {
    if (identities.size >= 8) identities.delete(identities.keys().next().value);
    const identity = executableFingerprints(paths, env.SCENE_RENDER_MANIFEST).then(async hashes => {
      let systemPackages = '';
      try { systemPackages = await readFile('/opt/scene-render-environment', 'utf8'); } catch { /* Non-container installations use SCENE_CACHE_VERSION for system-library upgrades. */ }
      // Parallelism affects scheduling, not pixels. It must not invalidate cached artwork.
      return { hashes, systemPackages, version: env.SCENE_CACHE_VERSION ?? '1', gpu: options.gpu, device: env.SCENE_GPU_FINGERPRINT ?? '', lossless: options.lossless, preset: options.preset, platform: [platform(), arch(), release()] };
    });
    identities.set(key, identity);
    identity.catch(() => identities.delete(key));
  }
  return identities.get(key);
}

function entryPath(root, key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid scene cache key');
  return join(root, key);
}

export async function readCachedRender(root, key, signal) {
  if (!root) return null;
  signal?.throwIfAborted();
  const entry = entryPath(root, key);
  const discard = async () => {
    await rm(entry, { recursive: true, force: true });
    return null;
  };
  try {
    const info = await stat(join(entry, 'manifest.json'));
    if (info.size > maxManifestBytes || Date.now() - (await stat(entry)).mtimeMs > cacheMaxAgeMs) return await discard();
    const manifest = JSON.parse(await readFile(join(entry, 'manifest.json'), 'utf8'));
    const filename = manifest.transparent ? 'scene.webm' : 'scene.mp4';
    const videoInfo = await stat(join(entry, filename));
    if (videoInfo.size <= 0 || videoInfo.size > maxRenderBytes || videoInfo.size !== manifest.size) return await discard();
    const video = await readFile(join(entry, filename), { signal });
    if (digest(video) !== manifest.sha256) return await discard();
    await utimes(entry, new Date(), new Date());
    return { manifest, video };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code !== 'ENOENT') {
      console.warn('scene_cache read_failed', error.message);
    }
    return await discard();
  }
}

export async function writeCachedRender(root, key, result, maxBytes = defaultCacheBytes) {
  if (!root || result.video.length > maxBytes) return;
  const entry = entryPath(root, key);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, '.pending-'));
  try {
    const manifest = { ...result.manifest, size: result.video.length, sha256: digest(result.video) };
    await writeFile(join(staging, manifest.transparent ? 'scene.webm' : 'scene.mp4'), result.video, { mode: 0o600 });
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    try { await rename(staging, entry); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      // Another process already published this immutable entry.
    }
  } finally { await rm(staging, { recursive: true, force: true }); }
  await pruneRenderCache(root, maxBytes);
}

export async function pruneRenderCache(root, maxBytes = defaultCacheBytes, now = Date.now()) {
  const entries = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.isDirectory() && /^\.pending-[\w-]+$/.test(item.name)) {
      const path = join(root, item.name);
      try {
        if (now - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000) await rm(path, { recursive: true, force: true });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    if (!item.isDirectory() || !/^[a-f0-9]{64}$/.test(item.name)) continue;
    const path = join(root, item.name);
    try {
      const info = await stat(path);
      const files = await readdir(path);
      let size = 0;
      for (const file of files) size += (await stat(join(path, file))).size;
      entries.push({ path, size, modified: info.mtimeMs });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  entries.sort((a, b) => b.modified - a.modified);
  let retained = 0;
  for (const [index, entry] of entries.entries()) {
    if (now - entry.modified > cacheMaxAgeMs || index >= 64 || retained + entry.size > maxBytes) await rm(entry.path, { recursive: true, force: true });
    else retained += entry.size;
  }
}

export function cacheBudget(value) {
  if (value === undefined) return defaultCacheBytes;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('SCENE_CACHE_MAX_BYTES must be a nonnegative integer');
  return Number(value);
}
