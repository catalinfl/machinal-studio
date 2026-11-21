import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdir, realpath, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadResponse, TransferError } from './transfer-http.mjs';

export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export function downloadFilename(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 255 || /^[.]/.test(value)
    || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) {
    throw new TransferError('Choose a plain filename without paths, reserved names or control characters.');
  }
  return value;
}

export async function downloadDirectory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\x00-\x1f]/.test(value)) {
    throw new TransferError('Choose an absolute client-local download directory. Ask the user if it is unset.');
  }
  const missing = [];
  let existing = resolve(value);
  for (;;) {
    try { return join(await realpath(existing), ...missing.reverse()); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.push(parse(existing).base);
      existing = parent;
    }
  }
}

export async function assertNewDownload(path) {
  try { await stat(path); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new TransferError('The destination already exists. Choose another filename; existing files are never overwritten.');
}

export async function saveDownload({ url, directory, filename, signal, progress = async () => {}, request,
  maxBytes = MAX_DOWNLOAD_BYTES }) {
  const path = join(directory, downloadFilename(filename));
  await assertNewDownload(path);
  const response = await downloadResponse(url, { ...request, signal });
  const length = response.headers['content-length'];
  const total = length === undefined ? null : Number(length);
  let temporary;
  let owned = false;
  try {
    if (total !== null && (!Number.isSafeInteger(total) || total < 1 || total > maxBytes)) {
      throw new TransferError('The download is empty or exceeds the 2 GiB size limit.');
    }
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      throw new TransferError('The download server ignored the identity encoding request. No file was saved.');
    }
    await mkdir(directory, { recursive: true });
    temporary = join(directory, `.machinal-${randomUUID()}.part`);
    const hash = createHash('sha256');
    let bytes = 0;
    let lastProgress = Date.now();
    const meter = new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) return done(new TransferError('The download exceeded the 2 GiB size limit.'));
        hash.update(chunk);
        const now = Date.now();
        const update = now - lastProgress >= 1000;
        if (update) lastProgress = now;
        Promise.resolve(update ? progress({ status: 'Downloading', bytes, ...(total === null ? {} : { totalBytes: total }) }) : undefined)
          .then(() => done(null, chunk), done);
      },
    });
    const writer = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    writer.once('open', () => { owned = true; });
    await pipeline(response, meter, writer, { signal });
    if (!bytes || (total !== null && bytes !== total)) throw new TransferError('The download was incomplete. No final file was saved.');
    signal?.throwIfAborted();
    // Linking publishes the complete file atomically and refuses a concurrent destination.
    await link(temporary, path);
    return { path, bytes, sha256: hash.digest('hex') };
  } finally {
    response.destroy();
    if (owned) await unlink(temporary).catch(() => {});
  }
}
