import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const registry = new URL('../../../packages/mcp-installer/library/hyperframes-library/registry/', import.meta.url);
const output = new URL('../hyperframes/vendor/', import.meta.url);
await mkdir(output, { recursive: true });
const read = path => readFile(new URL(path, registry), 'utf8');
const save = (name, source) => writeFile(new URL(`${name}.mjs`, output), source);

await save('cuboid-motion', await read('blocks/cuboid-carousel/assets/cuboid-motion.js'));
await save('orbit-motion', await read('blocks/orbit-card/assets/orbit-motion.js'));
await save('orbit-scene', (await read('blocks/orbit-card/assets/orbit-scene.js'))
  .replace('"./three.module.min.js"', '"three"').replace('"./orbit-motion.js"', '"./orbit-motion.mjs"'));
const slice = (await read('blocks/code-slice-hero/shadows.js')) + '\n' + (await read('blocks/code-slice-hero/surface.js'));
await save('code-slice', slice.replace(/window\.CodeSlice(Shadows|Surface)\s*=/g, 'export const CodeSlice$1 =')
  .replace(/window\.CodeSlice(Shadows|Surface)/g, 'CodeSlice$1'));
await save('caveat-pen', (await read('blocks/hw-write-title/assets/baked/caveat-pen.js'))
  .replace('window.__hwPenCaveat =', 'export const caveatPen ='));
await save('liquid-glass', (await read('blocks/liquid-glass-notification/lib/liquid-glass.iife.js'))
  .replace('var LiquidGlass =', 'export const LiquidGlass ='));
await save('frost', "import __frostAsset from '../media/blocks-frost-sequence-camera-orbit.mjs';\n"
  + (await read('blocks/frost-sequence-camera-orbit/assets/frost.js'))
    .replace('var Frost=', 'const upstreamFrost=').replace('a2=e=>wde+e', 'a2=e=>__frostAsset(wde+e)')
    .replace('t=fetch(e).then(r=>{if(!r.ok)throw new Error(`typeface:', 't=fetch(__frostAsset(e)).then(r=>{if(!r.ok)throw new Error(`typeface:')
  + '\nexport const Frost={...upstreamFrost,create(options){return upstreamFrost.create({...options,logoUrl:__frostAsset(options.logoUrl),fontUrl:__frostAsset(options.fontUrl)});}};\n');

const glass = await read('blocks/glass-shard-title/assets/glass-main.mjs');
const imports = [...glass.matchAll(/^import .+;$/gm)].map(match => match[0]).join('\n');
await save('glass-shard', "import * as d3 from 'd3-delaunay';\n" + imports + '\nexport async function mountGlassShard() {\n'
  + glass.replace(/^import .+;$/gm, '') + '\nreturn gstDispose;\n}\n');

const pathBase = 'examples/path-traced-3d/assets/';
await save('pathtrace-lib', await read(pathBase + 'vendor/three-path-tracer.min.js'));
await save('pathtrace-scene', (await read(pathBase + 'scene.js'))
  .replaceAll('./vendor/three-path-tracer.min.js', './pathtrace-lib.mjs'));
const pathRenderer = (await read(pathBase + 'render.js'))
  .replaceAll('./vendor/three-path-tracer.min.js', './pathtrace-lib.mjs')
  .replaceAll('./scene.js', './pathtrace-scene.mjs');
const pathImports = [...pathRenderer.matchAll(/^import .+;$/gm)].map(match => match[0]).join('\n');
const eventBoundary = pathRenderer.indexOf('const ready = setup();');
if (eventBoundary < 0) throw new Error('Unknown pathtrace host adapter');
await save('pathtracer', pathImports + '\nexport function mountPathtracer() {\n'
  + pathRenderer.slice(0, eventBoundary).replace(/^import .+;$/gm, '')
  + `\nconst ready=setup();let queue=ready;
return{ready,seek(time){queue=queue.then(()=>draw(time));return queue;},
dispose(){tracer?.dispose();renderer.dispose();}};
}\n`);
console.log('Prepared native imports for the original local Hyperframes libraries.');

const require = createRequire(import.meta.url);
const notices = [
  'Hyperframes upstream reference: https://github.com/heygen-com/hyperframes, revision 8ec98be29a64e88239a0c05f7e5d09f36e181493, Apache-2.0.',
  'Project-authored substitute illustrations, noise, studio lighting, generic models and silent motion sample: CC0-1.0. Original bundled assets keep their upstream licences.',
];
for (const name of ['three', 'd3', 'd3-delaunay', 'topojson-client', 'us-atlas', 'world-atlas', 'es-atlas', 'lottie-web', 'clipper-lib']) {
  let directory;
  try { directory = dirname(require.resolve(`${name}/package.json`)); }
  catch {
    directory = dirname(require.resolve(name));
    while (true) {
      try { await readFile(join(directory, 'package.json')); break; }
      catch { const parent = dirname(directory); if (parent === directory) throw new Error(`Missing licence package: ${name}`); directory = parent; }
    }
  }
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  let licence = '';
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { licence = await readFile(join(directory, file), 'utf8'); break; } catch { /* alternate licence filename */ }
  }
  if (!licence && name === 'clipper-lib') licence = (await readFile(require.resolve(name), 'utf8')).slice(0, 16000);
  notices.push(`${name}@${metadata.version} — ${metadata.license}\n${licence}`);
  if (name === 'es-atlas') notices.push(await readFile(join(directory, 'README.md'), 'utf8'));
}
await writeFile(new URL('../THIRD-PARTY-NOTICES.txt', output), notices.join('\n\n'));
