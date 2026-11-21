import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parse } from 'parse5';

const fonts = JSON.parse(await readFile(new URL('../hyperframes/fonts.json', import.meta.url), 'utf8'));
const families = JSON.parse(await readFile(new URL('../hyperframes/font-families.json', import.meta.url), 'utf8'));

export const isBundledFontReference = path => Boolean(fonts[path.split('/').pop()]);

export function sourceElements(source, tagName) {
  const nodes = [];
  const visit = node => {
    if (node.tagName === tagName && node.sourceCodeLocation?.startTag) {
      const location = node.sourceCodeLocation;
      nodes.push({
        start: location.startOffset, end: location.endOffset,
        content: source.slice(location.startTag.endOffset, location.endTag?.startOffset ?? location.endOffset),
        attributes: Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value])),
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(source, { sourceCodeLocationInfo: true }));
  return nodes;
}

export function stripSourceElements(source, tagNames = ['script', 'style', 'link']) {
  const ranges = tagNames.flatMap(name => sourceElements(source, name))
    .sort((a, b) => b.start - a.start);
  let text = source;
  for (const range of ranges) text = text.slice(0, range.start) + text.slice(range.end);
  return text;
}

export function localizeFontFaces(source) {
  const definitions = [];
  let html = source.replace(/@font-face\s*\{[^}]+\}/gi, rule => {
    const path = rule.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i)?.[1];
    const family = rule.match(/font-family\s*:\s*["']?([^;"']+)/i)?.[1]?.trim();
    if (!path && /\bsrc\s*:\s*local\(/i.test(rule)) return '';
    if (!path || !family) return rule;
    const weight = rule.match(/font-weight\s*:\s*([^;}\n]+)/i)?.[1]?.trim() ?? '400';
    const remoteName = path.match(/\/fonts\/([a-z-]+)@/i)?.[1]?.replace(/-/g, ' ');
    const remoteFamily = Object.keys(families).find(name => family.toLowerCase().includes(name.toLowerCase())
      || remoteName === name.toLowerCase());
    const bundled = fonts[path.split('/').pop()] ? path
      : families[remoteFamily]?.find(definition => definition.weight === weight)?.path
        ?? families[remoteFamily]?.[0]?.path;
    if (!bundled) return rule;
    definitions.push({
      path: bundled, family,
      weight,
      style: rule.match(/font-style\s*:\s*([^;}\n]+)/i)?.[1]?.trim() ?? 'normal',
    });
    return '';
  });
  for (const match of source.matchAll(/family=([^&"')<>]+)/gi)) {
    const family = decodeURIComponent(match[1].split(':')[0]).replace(/\+/g, ' ');
    for (const definition of families[family] ?? []) definitions.push({ family, ...definition });
  }
  html = html.replace(/(["'])url\(https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/([a-z-]+)@[^/]+\/latin-(\d+)-(normal|italic)\.woff2\)\1/g,
    (match, _quote, name, weight, style) => {
      const path = `${name}-latin-${weight}-${style}.woff2`;
      if (!fonts[path]) return match;
      const family = Object.keys(families).find(family => family.toLowerCase().replace(/ /g, '-') === name);
      definitions.push({ family: family ?? name, path, weight, style });
      return `hyperframeFontSource(__hfFonts, ${JSON.stringify(path)})`;
    });
  html = html.replace(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi, '')
    .replace(/@import\s+url\(\s*(["'])https:\/\/fonts\.googleapis\.com[\s\S]*?\1\s*\)\s*;?/gi, '');
  return { html, definitions };
}

export async function writeFontPack(id, definitions) {
  const directory = new URL('../hyperframes/fonts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const values = definitions.map(definition => ({
    ...definition, src: fonts[definition.path.split('/').pop()],
  }));
  await writeFile(new URL(`${id}.mjs`, directory), `// Pinned OFL fonts; see ../fonts.LICENSES.txt.\nexport default ${JSON.stringify(values)};\n`);
}

export function shaderComponent(entry, markup, css, artboard, runtime = 'webgpu') {
  const escaped = markup.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  return `<!-- Modified native adapter of Hyperframes ${entry.id}; upstream 8ec98be29a64e88239a0c05f7e5d09f36e181493, Apache-2.0.
Original shader runtime is vendored separately under MIT; see shaders.THIRD-PARTY-LICENSES.txt. -->
<script>
  import { untrack } from 'svelte';
  import { SceneCanvas, useScene } from '@machinal/scenes/svelte';
  ${runtime === 'webgpu'
    ? "import { createHyperframeShader } from '@machinal/hyperframes/shaders';"
    : "import { mountPathtracer } from '@machinal/hyperframes/vendor/pathtracer';"}
  const scene = useScene();
  let root = $state();
  let shader = $state.raw();

  $effect(() => {
    if (!root) return;
    const runtime = ${runtime === 'webgpu' ? "createHyperframeShader(root.querySelector('canvas[data-shader]'))" : 'mountPathtracer()'};
    shader = runtime;
    scene.resources.track(runtime.ready);
    return () => { runtime.dispose(); shader = undefined; };
  });

  $effect(() => {
    const runtime = shader;
    const time = scene.frame.time;
    if (runtime) untrack(() => scene.resources.track(runtime.seek(time)));
  });
</script>
<SceneCanvas background="#000">
  <div class="hf-port" bind:this={root}>${escaped}</div>
</SceneCanvas>
<style>
  :global(.hf-port) { position:relative; width:${artboard.width}px; height:${artboard.height}px; overflow:hidden; }
  :global { ${css} }
</style>
`;
}
