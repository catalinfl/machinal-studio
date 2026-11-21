import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md', 'PRODUCT.md', 'DESIGN.md', 'client/README.md', 'client/PRODUCT.md', 'api/editengine/README.md', 'services/scene-renderer/README.md'];
for (const entry of await readdir(resolve(root, 'docs'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) files.push(`docs/${entry.name}`);
}

for (const file of files) {
  test(`${file} has valid local Markdown links`, async () => {
    const markdown = await readFile(resolve(root, file), 'utf8');
    const failures = [];
    for (const [, target] of markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) continue;
      const path = decodeURIComponent(target.split('#')[0]);
      if (!path) continue;
      try {
        await stat(resolve(root, dirname(file), path));
      } catch {
        failures.push(target);
      }
    }
    assert.deepEqual(failures, [], `Broken links in ${file}: ${failures.join(', ')}`);
  });
}
