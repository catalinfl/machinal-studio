import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const output = new URL('../hyperframes/', import.meta.url);
const upstream = new URL('../../../packages/mcp-installer/library/hyperframes-library/registry/blocks/aurora/lib/', import.meta.url);
await mkdir(output, { recursive: true });
const original = await readFile(new URL('shaders.iife.js', upstream), 'utf8');
const expectedHash = 'sha256:' + createHash('sha256').update(original).digest('hex');
const boundary = 'var o1=document.querySelector("canvas[data-shader]")';
const start = original.indexOf('(()=>{');
const end = original.lastIndexOf(boundary);
if (start < 0 || end < 0) throw new Error('Unknown upstream shader bundle structure');
const capabilityProbe = 'var gU=(()=>{try{return new Function("return true"),!0}catch{return!1}})()';
const shaderLibrary = original.slice(start + '(()=>{'.length, end);
if (!shaderLibrary.includes(capabilityProbe)) throw new Error('Unknown shader writer capability probe');
// Select the upstream library's CSP-safe uniform writer without executing its eval probe.
// This changes buffer serialization only; the original WGSL shaders and WebGPU renderer are unchanged.
const cspSafeLibrary = shaderLibrary.replace(capabilityProbe, 'var gU=!1');
const runtime = `${original.slice(0, start)}
// Generated from the vendored MIT runtime (${expectedHash}); native host adapter and CSP-safe writer selection.
export function createHyperframeShader(canvas) {
${cspSafeLibrary}
  const definition = WE[canvas.dataset.shader];
  if (!definition) throw new Error('Unknown Hyperframes shader: ' + canvas.dataset.shader);
  const renderer = YE();
  let disposed = false;
  let pending = Promise.resolve();
  const ready = (async () => {
    await renderer.initialize({ canvas, observeElement: false, colorSpace: 'srgb' });
    renderer.stopAnimation();
    if (disposed) { renderer.cleanup(); return; }
    const failure = renderer.getFailureReason();
    if (failure) throw new Error('Hyperframes WebGPU: ' + failure);
    renderer.registerNode('root', Fm.fragment, null, null, {}, Fm);
    const overrides = JSON.parse(canvas.dataset.shaderProps || '{}');
    const props = Object.fromEntries(Object.entries(definition.props).map(([key, value]) =>
      [key, key in overrides ? overrides[key] : value.default]));
    renderer.registerNode('fx', definition.fragment, 'root',
      { blendMode: 'normal', renderOrder: 1, id: 'fx', boundingBox: xy(undefined) },
      Zy(definition, props, 'fx'), definition);
  })();
  return {
    ready,
    seek(time) {
      pending = pending.then(async () => {
        await ready;
        if (!disposed) await renderer.renderSyntheticFrame(
          time - renderer.__testing.getFrameDiagnostics().globalElapsedTime);
      });
      return pending;
    },
    dispose() { disposed = true; renderer.cleanup(); },
  };
}
`;
await writeFile(new URL('shaders.mjs', output), runtime);
await writeFile(new URL('shaders.THIRD-PARTY-LICENSES.txt', output),
  await readFile(new URL('shaders.THIRD-PARTY-LICENSES.txt', upstream)));

const fontSpecs = [
  ['Caveat-700-latin.woff2', '@fontsource/caveat', 'caveat-latin-700-normal.woff2'],
  ['inter-latin-400-normal.woff2', '@fontsource/inter', 'inter-latin-400-normal.woff2'],
  ['inter-latin-500-normal.woff2', '@fontsource/inter', 'inter-latin-500-normal.woff2'],
  ['inter-latin-600-normal.woff2', '@fontsource/inter', 'inter-latin-600-normal.woff2'],
  ['eb-garamond-latin-400-normal.woff2', '@fontsource/eb-garamond', 'eb-garamond-latin-400-normal.woff2'],
  ['eb-garamond-latin-700-normal.woff2', '@fontsource/eb-garamond', 'eb-garamond-latin-700-normal.woff2'],
  ['BarlowCondensed-Bold.woff2', '@fontsource/barlow-condensed', 'barlow-condensed-latin-700-normal.woff2'],
  ['BarlowCondensed-ExtraBold.woff2', '@fontsource/barlow-condensed', 'barlow-condensed-latin-800-normal.woff2'],
  ['permanent-marker-400.woff2', '@fontsource/permanent-marker', 'permanent-marker-latin-400-normal.woff2'],
  ['Recursive-wght-slnt-latin.woff2', '@fontsource-variable/recursive', 'recursive-latin-full-normal.woff2'],
  ['Geist-Latin.woff2', '@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'],
  ['Geist-Bold.ttf', '@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'],
  ['Geist-Regular.ttf', '@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'],
  ['Geist-SemiBold.ttf', '@fontsource-variable/geist', 'geist-latin-wght-normal.woff2'],
  ['courier-prime-400.woff2', '@fontsource/courier-prime', 'courier-prime-latin-400-normal.woff2'],
  ['courier-prime-700.woff2', '@fontsource/courier-prime', 'courier-prime-latin-700-normal.woff2'],
  ['archivo-regular.ttf', '@fontsource/archivo', 'archivo-latin-400-normal.woff2'],
  ['archivo-semibold.ttf', '@fontsource/archivo', 'archivo-latin-600-normal.woff2'],
];
const fonts = {};
const notices = [];
const families = {};
for (const [key, packageName, filename] of fontSpecs) {
  const directory = dirname(require.resolve(`${packageName}/package.json`));
  const bytes = await readFile(join(directory, 'files', filename));
  fonts[key] = `data:font/woff2;base64,${bytes.toString('base64')}`;
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  notices.push(`${packageName}@${metadata.version}\n${await readFile(join(directory, 'LICENSE'), 'utf8')}`);
}
const packages = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const name of Object.keys(packages.dependencies).filter(name => name.startsWith('@fontsource/'))) {
  const directory = dirname(require.resolve(`${name}/package.json`));
  const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
  const definitions = [];
  for (const filename of await readdir(join(directory, 'files'))) {
    const match = filename.match(/-latin-(\d+)-(normal|italic)\.woff2$/);
    if (!match) continue;
    fonts[filename] = `data:font/woff2;base64,${(await readFile(join(directory, 'files', filename))).toString('base64')}`;
    definitions.push({ path: filename, weight: match[1], style: match[2] });
  }
  families[metadata.family] = definitions;
  notices.push(`${name}\n${await readFile(join(directory, 'LICENSE'), 'utf8')}`);
}
families.Geist = [{ path: 'Geist-Latin.woff2', weight: '100 900', style: 'normal' }];
families.Recursive = [{ path: 'Recursive-wght-slnt-latin.woff2', weight: '300 1000', style: 'normal' }];
const flexDirectory = dirname(require.resolve('@fontsource-variable/roboto-flex/package.json'));
const flexName = (await readdir(join(flexDirectory, 'files'))).find(name => /-latin-(?:full|wght)-normal\.woff2$/.test(name));
fonts[flexName] = `data:font/woff2;base64,${(await readFile(join(flexDirectory, 'files', flexName))).toString('base64')}`;
families['Roboto Flex'] = [{ path: flexName, weight: '100 1000', style: 'normal' }];
await writeFile(new URL('fonts.json', output), JSON.stringify(fonts));
await writeFile(new URL('font-families.json', output), JSON.stringify(families));
await writeFile(new URL('fonts.LICENSES.txt', output), notices.join('\n\n'));
console.log('Built original WebGPU runtime and', Object.keys(fonts).length, 'locally embedded OFL fonts.');
