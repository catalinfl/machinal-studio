import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, open, stat } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { platform } from 'node:os';

export const maxFingerprintManifestBytes = 1024 * 1024;

export async function executablePath(name, env = process.env) {
  if (name.includes('/') || name.includes('\\')) return resolve(name);
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    const path = join(directory, name + (platform() === 'win32' && !name.endsWith('.exe') ? '.exe' : ''));
    try { await access(path); return path; } catch { /* Continue searching PATH. */ }
  }
  throw new Error(`Executable not found: ${name}`);
}

export async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function readManifest(path) {
  if (!path) return [];
  let file;
  try {
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile() || info.size > maxFingerprintManifestBytes) return [];
    // Only an image-owned, non-writable manifest may replace runtime content hashing.
    if (platform() !== 'win32' && (info.uid !== 0 || (info.mode & 0o022) !== 0)) return [];
    const data = JSON.parse(await file.readFile('utf8'));
    return data.version === 1 && Array.isArray(data.executables) ? data.executables : [];
  } catch {
    // Missing/stale build metadata must not disable cache integrity or custom tools.
    return [];
  } finally { await file?.close(); }
}

export async function executableFingerprints(paths, manifestPath, { hash = fileDigest, read = readManifest, inspect = stat } = {}) {
  const entries = await read(manifestPath);
  return Promise.all(paths.map(async path => {
    const info = await inspect(path);
    const protectedFile = platform() === 'win32' || (info.uid === 0 && (info.mode & 0o022) === 0);
    const pinned = protectedFile && entries.find(entry => entry?.path === path && entry.size === info.size && entry.mtimeMs === info.mtimeMs && /^[a-f0-9]{64}$/.test(entry.sha256));
    return pinned ? pinned.sha256 : hash(path);
  }));
}
