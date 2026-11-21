import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

const checksumChunkBytes = 256 * 1024;

export async function openRenderFile(path, manifest, { signal, maxBytes, cleanup = async () => {} } = {}) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw new Error('Rendered video exceeds size limits or is empty');
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(checksumChunkBytes);
    let offset = 0;
    while (offset < info.size) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, info.size - offset), offset);
      if (!bytesRead) throw new Error('Rendered video was truncated');
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    signal?.throwIfAborted();
    const sha256 = hash.digest('hex');
    let disposal;
    return {
      path, bytes: info.size, manifest: { ...manifest, size: info.size, sha256 },
      openStream: () => file.createReadStream({ start: 0, end: info.size - 1, autoClose: false, highWaterMark: 64 * 1024 }),
      dispose: () => disposal ??= (async () => { try { await file.close(); } finally { await cleanup(); } })(),
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
