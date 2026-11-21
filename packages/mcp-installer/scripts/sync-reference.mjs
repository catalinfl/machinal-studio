import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(packageRoot, '../..');
const server = join(repository, 'api/internal/platform/mcpserver');
const localEdition = existsSync(join(repository, '.machinal-local.json'));
const hostedGuideRoot = localEdition ? join(packageRoot, 'server-reference/guides') : join(server, 'guides');
const guideCopies = [
  ['media', 'machinal-media/references/workflow.md'],
  ['reference-overview', 'machinal-editing/references/workflow.md'],
  ['brief', 'machinal-editing/references/brief.md'],
  ['production', 'machinal-review/references/production.md'],
  ['styles', 'machinal-editing/references/styles.md'],
  ['transitions', 'machinal-editing/references/transitions.md'],
  ['effects', 'machinal-editing/references/effects.md'],
  ['looks-motion', 'machinal-editing/references/looks-motion.md'],
  ['yaml', 'machinal-recipes/references/yaml.md'],
  ['text-audio', 'machinal-recipes/references/text-audio.md'],
  ['jobs-scenes', 'machinal-recipes/references/jobs-scenes.md'],
  ['jobs-scenes', 'machinal-scenes/references/workflow.md'],
  ['scene-authoring', 'machinal-scenes/references/authoring.md'],
  ['scene-templates', 'machinal-scenes/references/scene-templates.md'],
  ['film-styles', 'machinal-cinema/references/workflow.md'],
  ['commands', 'machinal-recipes/references/commands.md'],
  ['examples', 'machinal-recipes/references/examples.md'],
];

export async function referenceCopies() {
  const copies = guideCopies.map(([guide, target]) => ({ source: join(hostedGuideRoot, `${guide}.md`), target }));
  copies.push(
    { source: join(repository, 'api/editengine/scenecontract/runtime.md'), target: 'machinal-scenes/references/runtime.md' },
    { source: join(server, 'reference/styles.json'), target: 'machinal-editing/references/styles.json' },
    { source: join(server, 'reference/scene-templates.json'), target: 'machinal-scenes/references/scene-templates.json' },
    { source: join(server, 'reference/film-styles.json'), target: 'machinal-cinema/references/film-styles.json' },
    { source: join(server, 'reference/film-techniques.json'), target: 'machinal-cinema/references/film-techniques.json' },
    { source: join(repository, 'api/editengine/catalog/catalog.v1.json'), target: 'machinal-recipes/references/catalog.v1.json' },
  );
  const examples = (await readdir(join(server, 'reference/examples'))).filter((name) => /^[a-z0-9-]+\.yaml$/.test(name)).sort();
  for (const name of examples) copies.push({ source: join(server, 'reference/examples', name), target: `machinal-recipes/references/examples/${name}` });
  const templates = (await readdir(join(server, 'reference/scene-templates'))).filter((name) => /^[a-z0-9-]+\.svelte$/.test(name)).sort();
  for (const name of templates) copies.push({ source: join(server, 'reference/scene-templates', name), target: `machinal-scenes/references/scene-templates/${name}` });
  const vendorRoot = join(server, 'reference/film-library');
  const manifest = JSON.parse(await readFile(join(vendorRoot, 'manifest.json'), 'utf8'));
  for (const name of ['manifest.json', ...manifest.files.map((file) => file.path)]) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith('/') || name.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe vendored reference path');
    copies.push({ source: join(vendorRoot, name), target: `machinal-cinema/references/film-library/${name}` });
  }
  return copies;
}

async function syncText(destination, content, check) {
  const normalized = content.replaceAll('\r\n', '\n');
  if (check) {
    let current;
    try { current = await readFile(destination, 'utf8'); } catch { current = null; }
    if (current?.replaceAll('\r\n', '\n') !== normalized) {
      throw new Error(`Bundled reference is stale: ${destination}. Run npm run sync:reference from packages/mcp-installer.`);
    }
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, normalized, 'utf8');
}

export async function syncReference({ check = false, installed = false } = {}) {
  const copies = await referenceCopies();
  for (const copy of copies) {
    const content = await readFile(copy.source, 'utf8');
    await syncText(join(packageRoot, 'skills', copy.target), content, check);
    if (installed) await syncText(join(repository, '.opencode/skills', copy.target), content, check);
  }
  const manifest = copies.map((copy) => copy.target).sort();
  await syncText(join(packageRoot, 'src/reference-files.json'), `${JSON.stringify(manifest, null, 2)}\n`, check);
  if (localEdition) {
    const guides = [...new Set([...guideCopies.map(([guide]) => guide), 'editing', 'credits'])].sort();
    const localFiles = [];
    for (const guide of guides) {
      const target = `machinal-local/references/${guide}.md`;
      await syncText(join(packageRoot, 'skills', target), await readFile(join(server, 'guides', `${guide}.md`), 'utf8'), check);
      localFiles.push(target);
    }
    await syncText(join(packageRoot, 'src/local-reference-files.json'), `${JSON.stringify(localFiles, null, 2)}\n`, check);
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await syncReference({ check: process.argv.includes('--check'), installed: process.argv.includes('--installed') });
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Synced'} ${files.length} reference files from the Go API source of truth.`);
}
