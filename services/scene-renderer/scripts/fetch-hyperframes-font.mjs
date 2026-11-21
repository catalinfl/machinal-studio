import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const output = new URL('../hyperframes/source-data/', import.meta.url);
await mkdir(output, { recursive: true });
const files = [
  ['Geist.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/geist/Geist%5Bwght%5D.ttf'],
  ['Geist.OFL.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/geist/OFL.txt'],
];
const receipts = [];
for (const [name, url] of files) {
  let bytes;
  try { bytes = await readFile(new URL(name, output)); }
  catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Font dependency: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Unexpected font dependency size');
    if (name.endsWith('.ttf') && bytes.readUInt32BE(0) !== 0x00010000) throw new Error('Invalid TrueType signature');
    await writeFile(new URL(name, output), bytes, { flag: 'wx' });
  }
  receipts.push({ name, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(new URL('sources.json', output), JSON.stringify(receipts, null, 2));
console.log(receipts);
