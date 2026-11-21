import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILM_LIBRARY_REVISION = 'bebbbe1aa92a3cb4bb6f83500e61b23a17d1aa00';
export const FILM_LIBRARY_COPYRIGHT = 'Copyright (c) 2026 LemoLab';
const referenceRoot = fileURLToPath(new URL('../../../api/internal/platform/mcpserver/reference/', import.meta.url));
const vendorRoot = join(referenceRoot, 'film-library');
const maxFileBytes = 128 * 1024;
const maxLibraryBytes = 2 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export const techniqueSources = [
  { id: 'director', label: 'Directing: story, staging, rhythm and camera', path: 'DIRECTOR.md', category: 'direction' },
  { id: 'technique', label: 'Production technique (reference only)', path: 'TECHNIQUE.md', category: 'reference' },
  { id: 'my-styles', label: 'Developing a personal visual language', path: 'MY-STYLES.md', category: 'direction' },
  { id: 'upstream-skill', label: 'Film planning guide (reference only; do not install)', path: 'upstream-skill.md', category: 'reference' },
  { id: 'animation-helpers', label: 'Seeded randomness, easing and keyframe interpolation', path: 'core/lib.js', category: 'visual-code' },
  { id: 'crt-post', label: 'Canvas CRT material and display treatment', path: 'core/post/crt.js', category: 'visual-code' },
  { id: 'three-post', label: 'Three.js post-processing reference', path: 'core/three/post.js', category: 'visual-code' },
];

export function vendorPath(sourcePath) {
  if (/^styles\/[a-z0-9]+(?:-[a-z0-9]+)*\/STYLE\.md$/.test(sourcePath)) return sourcePath;
  if (['LICENSE', 'README.md', 'styles/README.md', 'styleboard/catalog.json', ...techniqueSources.map(item => item.path)].includes(sourcePath)) return sourcePath;
  throw new Error(`Unapproved reference path: ${sourcePath}`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function origin() {
  return { copyright: FILM_LIBRARY_COPYRIGHT, revision: FILM_LIBRARY_REVISION, license: 'MIT' };
}

export function styleEntries(catalog, files) {
  const seen = new Set();
  return catalog.map(item => {
    const path = vendorPath(`styles/${item.slug}/STYLE.md`);
    if (seen.has(item.slug) || !item.en || !item.cat_en || !Array.isArray(item.uses)) throw new Error('Invalid style metadata');
    seen.add(item.slug);
    const prompt = decoder.decode(files.get(path));
    const description = prompt.split(/\r?\n/).find(line => /^>\s+/.test(line))?.replace(/^>\s+/, '') || item.en;
    return {
      id: item.slug, label: `${item.en} / ${item.cn}`, category: item.cat_en, description,
      whenToUse: item.uses, sourcePath: path, sha256: digest(files.get(path)),
      origin: origin(), adaptationGuideUri: 'machinal://reference/film-styles', referenceOnly: true,
    };
  });
}

function techniqueEntries(files) {
  return techniqueSources.map(item => ({
    id: item.id, label: item.label, category: item.category,
    description: `${item.label}. Adapt excerpts to the deployed scene-runtime; never execute external setup/render/audio scripts.`,
    sourcePath: vendorPath(item.path), sha256: digest(files.get(item.path)),
    origin: origin(), adaptationGuideUri: 'machinal://reference/film-styles', referenceOnly: true,
  }));
}

export async function importFilmLibrary() {
  const catalogBytes = await readFile(join(vendorRoot, 'styleboard/catalog.json'));
  const catalog = JSON.parse(decoder.decode(catalogBytes));
  if (!Array.isArray(catalog) || catalog.length !== 66) throw new Error('Review the catalog before changing the expected 66 styles.');
  const sources = [...new Set(['LICENSE', 'README.md', 'styles/README.md', 'styleboard/catalog.json', ...techniqueSources.map(item => item.path), ...catalog.map(item => `styles/${item.slug}/STYLE.md`)])].sort();
  const files = new Map();
  for (const source of sources) {
    const path = vendorPath(source);
    const bytes = await readFile(join(vendorRoot, path));
    if (!bytes.length || bytes.length > maxFileBytes) throw new Error(`Reference file exceeds the size bound: ${path}`);
    decoder.decode(bytes);
    files.set(path, bytes);
  }
  if ([...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > maxLibraryBytes) throw new Error('Reference library exceeds the size bound.');
  if (!decoder.decode(files.get('LICENSE')).includes(FILM_LIBRARY_COPYRIGHT)) throw new Error('Reference copyright notice must be preserved.');
  const styles = styleEntries(catalog, files);
  const manifest = {
    ...origin(), adapted: true,
    notice: 'Code and docs: MIT, copyright 2026 LemoLab. References are adapted for machinal. Demo films/stills and third-party assets are not included.',
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) })),
  };
  for (const [path, value] of [
    [join(vendorRoot, 'manifest.json'), manifest],
    [join(referenceRoot, 'film-styles.json'), styles],
    [join(referenceRoot, 'film-techniques.json'), techniqueEntries(files)],
  ]) await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return { styles: styles.length, files: files.size, revision: FILM_LIBRARY_REVISION };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await importFilmLibrary());
}
