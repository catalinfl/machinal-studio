// Client-only builds use checked snapshots; edit these catalogs in the API.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalogs = [
  ['../../api/editengine/catalog/catalog.v1.json', '../src/lib/catalog.v1.json'],
  ['../../api/internal/core/editor/speech/catalog.json', '../src/lib/speech-catalog.json'],
];
const check = process.argv.includes('--check');

for (const [source, destination] of catalogs) {
  const src = resolve(here, source);
  const dest = resolve(here, destination);
  if (!existsSync(src)) {
    console.error(`[sync:catalog] source not found: ${src}`);
    console.error('[sync:catalog] run from the full repository, not a client-only checkout.');
    process.exit(1);
  }
  if (check) {
    const normalize = (text) => text.replaceAll('\r\n', '\n');
    if (!existsSync(dest) || normalize(readFileSync(src, 'utf8')) !== normalize(readFileSync(dest, 'utf8'))) {
      console.error(`[sync:catalog] stale snapshot: ${dest}. Run pnpm sync:catalog.`);
      process.exit(1);
    }
    console.log(`[sync:catalog] verified ${dest}`);
  } else {
    copyFileSync(src, dest);
    console.log(`[sync:catalog] ${src} -> ${dest}`);
  }
}
