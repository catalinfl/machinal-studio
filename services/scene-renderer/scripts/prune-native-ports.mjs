/**
 * Removes port files that the current manifest no longer claims.
 *
 * The manifest is authoritative for the mass-ported library; the ten
 * hand-verified ports keep their own generator and are always preserved.
 */

import { readFile, readdir, unlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const nativeRoot = new URL('../../../packages/mcp-installer/library/hyperframes-native/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../../../.impeccable/review/native-library/manifest.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('../../../packages/mcp-installer/library/hyperframes-components.json', import.meta.url), 'utf8'));
const byId = new Map(catalog.map(entry => [entry.id, entry]));

const handVerified = [
  'blocks/transitions-3d', 'blocks/ui-3d-reveal', 'components/agent-cursor',
  'blocks/ai-answer-rank', 'blocks/ai-chat-reveal', 'blocks/vfx-anamorphic-flare',
  'components/animated-bar-chart', 'components/cursor-annotate',
  'blocks/app-showcase', 'blocks/apple-money-count',
];

const keep = new Set(manifest.ports.map(port => `${port.category}/${port.upstreamName}`));
// Blocked entries keep their sidecar: that file is where the reason lives.
for (const skip of [...(manifest.skipped ?? []), ...(manifest.failed ?? [])]) {
  const entry = byId.get(skip.id);
  if (entry) keep.add(`${entry.category}/${entry.upstreamName}`);
}
for (const path of handVerified) keep.add(path);

const removed = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) { await walk(absolute); continue; }
    const match = /\.(svelte|port\.json)$/.exec(entry.name);
    if (!match) continue;
    const stem = relative(new URL('.', nativeRoot).pathname.replace(/^\/([A-Za-z]:)/, '$1'), absolute)
      .split(sep).join('/')
      .replace(/\.(svelte|port\.json)$/, '');
    if (keep.has(stem)) continue;
    await unlink(absolute);
    removed.push(`${stem}${match[0]}`);
  }
}

await walk(new URL('.', nativeRoot).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log(`removed ${removed.length} stale files, kept ${keep.size} ports`);
if (removed.length) console.log(removed.slice(0, 12).join('\n'));
