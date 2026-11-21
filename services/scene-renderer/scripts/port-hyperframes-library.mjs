/**
 * Ports every HyperFrames reference page to a native Svelte scene.
 *
 * Same policy as port-hyperframes-native.mjs: the upstream markup, stylesheet
 * and GSAP timeline are copied verbatim. Only these mechanical adaptations are
 * allowed:
 *
 *   1. `window.__timelines[...] = tl` is handed to a component-owned timeline slot.
 *   2. Host variable lookups (`window.__hyperframes`) become the component's
 *      `design` prop through a tiny host shim.
 *   3. Document-level CSS selectors (`html`, `body`, `:root`, `*`) are
 *      retargeted to the port root so a mounted port cannot restyle the host
 *      page; every artboard rule is left untouched.
 *   4. The copy is wrapped in one root element that mirrors the source
 *      artboard box, and `<template>`-mounted components keep their mount
 *      contract by moving the `<html>` variable attributes onto `#root`.
 *   5. `{` and `}` inside the markup are escaped as character references
 *      because Svelte would otherwise parse them as expressions.
 *   6. Components whose upstream file documents its timeline in a commented
 *      "Timeline integration" recipe get that recipe verbatim as their
 *      timeline (the primitive itself ships no script by design).
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { localizeFontFaces, shaderComponent, sourceElements, stripSourceElements, writeFontPack, isBundledFontReference } from './hyperframes-port-support.mjs';
import { prepareMedia, resolveScriptMedia, normalizeReservedIdentifiers, modernizeCanvasCapture } from './hyperframes-media.mjs';
import { transform } from 'esbuild';

const reference = new URL('../../../packages/mcp-installer/library/', import.meta.url);
const registry = 'hyperframes-library/registry/';

const args = process.argv.slice(2);
const only = args.filter(arg => !arg.startsWith('--'));
const dry = args.includes('--dry');
const includeRisky = args.includes('--include-risky');

const catalog = JSON.parse(await readFile(new URL('hyperframes-components.json', reference), 'utf8'));

// The first ten ports were hand-verified pixel-for-pixel against their source
// pages; they keep their dedicated generator and are not rewritten here.
const verified = new Set([
  'blocks-transitions-3d', 'blocks-ui-3d-reveal', 'components-agent-cursor',
  'blocks-ai-answer-rank', 'blocks-ai-chat-reveal', 'blocks-vfx-anamorphic-flare',
  'components-animated-bar-chart', 'components-cursor-annotate',
  'blocks-app-showcase', 'blocks-apple-money-count',
]);

const skipped = [];
const failed = [];
const written = [];

for (const entry of catalog) {
  if (only.length && !only.includes(entry.id)) continue;
  if (verified.has(entry.id) && !args.includes('--include-verified')) continue;
  try {
    const result = await portEntry(entry);
    if (!result) continue;
    if (!dry) await writeFile(new URL(`hyperframes-native/${result.out}`, reference), result.component);
    written.push(result);
  } catch (error) {
    if (error.code === 'SKIP') skipped.push({ id: entry.id, reason: error.message });
    else failed.push({ id: entry.id, reason: error.message });
  }
}

console.log(`\nported ${written.length}, skipped ${skipped.length}, failed ${failed.length}`);
  if (written.length && !dry) {
    const manifestURL = new URL('../../../.impeccable/review/native-library/manifest.json', import.meta.url);
    let manifest = { ports: [] };
    try { manifest = JSON.parse(await readFile(manifestURL, 'utf8')); } catch { /* first run */ }
  // A full run is authoritative: anything it no longer produces is gone. A
  // targeted run merges with the ports it did not touch.
    const previous = only.length ? manifest.ports.filter(port => !only.includes(port.id)) : [];
    const byId = new Map(previous.map(item => [item.id, item]));
    for (const item of written) byId.set(item.id, item.manifest);
    const touched = new Set(only);
    const previousSkipped = only.length
      ? (manifest.skipped ?? []).filter(item => !touched.has(item.id))
      : [];
    const previousFailed = only.length
      ? (manifest.failed ?? []).filter(item => !touched.has(item.id))
      : [];
    await mkdir(new URL('.', manifestURL), { recursive: true });
    await writeFile(manifestURL, `${JSON.stringify({
      generated: new Date().toISOString(),
      ports: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
      skipped: [...previousSkipped, ...skipped].sort((a, b) => a.id.localeCompare(b.id)),
      failed: [...previousFailed, ...failed].sort((a, b) => a.id.localeCompare(b.id)),
    }, null, 1)}\n`);
  console.log('manifest: .impeccable/review/native-library/manifest.json');
}
if (skipped.length) console.log(`\nskipped:\n${group(skipped).map(([reason, ids]) => `  ${reason}: ${ids.length} (${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ' …' : ''})`).join('\n')}`);
if (failed.length) {
  console.log(`\nfailed:`);
  for (const item of failed) console.log(`  ${item.id}: ${item.reason}`);
  process.exitCode = 1;
}

function group(items) {
  const map = new Map();
  for (const item of items) map.set(item.reason, [...(map.get(item.reason) ?? []), item.id]);
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

async function portEntry(entry) {
  const dir = new URL(`${registry}${entry.category}/${entry.upstreamName}/`, reference);
  let files;
  try { files = await readdir(dir); } catch { skip('source page missing'); }
  let sourceFile = files.includes(`${entry.upstreamName}.html`)
    ? `${entry.upstreamName}.html`
    : files.includes('demo.html') ? 'demo.html' : files.includes('index.html') ? 'index.html' : null;
  if (!sourceFile) skip('source page missing');

  let original = (await readFile(new URL(sourceFile, dir), 'utf8')).replace(/\r\n/g, '\n');
  if (files.includes('demo.html') && sourceFile !== 'demo.html'
    && (!pageFragment(original).trim() || !/\.timeline\s*\(/.test(original))) {
    sourceFile = 'demo.html';
    original = (await readFile(new URL(sourceFile, dir), 'utf8')).replace(/\r\n/g, '\n');
  }
  if (entry.id === 'components-bottom-up-letters') {
    original = original.replace(/<style>\s*element below;[\s\S]*?<\/style>/, '');
  }
  const localized = localizeFontFaces(original);
  const media = await prepareMedia(localized.html, entry, dir);
  const source = media.source;
  const fontDefinitions = localized.definitions;
  if (/src=["']lib\/shaders\.iife\.js["']/.test(source) || entry.id === 'examples-path-traced-3d') {
    const artboard = readArtboard(source);
    const runtime = entry.id === 'examples-path-traced-3d' ? 'pathtracer' : 'webgpu';
    const component = shaderComponent(entry, extractMarkup(source), extractStyles(source), artboard, runtime);
    return {
      id: entry.id, out: `${entry.category}/${entry.upstreamName}.svelte`, component,
      manifest: {
        id: entry.id, category: entry.category, upstreamName: entry.upstreamName,
        sourceFile, artboard: [artboard.width, artboard.height], mount: 'body',
        timeline: runtime, runtime, bytes: component.length,
        reviewVersion: 2,
      },
    };
  }
  const scriptElements = sourceElements(source, 'script')
    .filter(script => !script.attributes.type || /^(?:module|text\/javascript|application\/javascript)$/.test(script.attributes.type));
  const inlineScripts = scriptElements.filter(script => !script.attributes.src).map(script => script.content);
  const externalScripts = scriptElements.map(script => script.attributes.src).filter(Boolean);
  const runtimeImports = readRuntimeImports(externalScripts, inlineScripts);
  const adaptedInlineScripts = inlineScripts.map(stripRuntimeModuleImports);
  const js = adaptedInlineScripts.join('\n');
  // A module script can also pull its runtime through a bare import statement;
  // that is still an external runtime, not part of the composition source.
  const moduleImports = [...inlineScripts.join('\n').matchAll(/^\s*import\s[^;\n]*from\s*["']([^"']+)["']/gm)].map(match => match[1]);
  const nonGsapExternal = [...externalScripts, ...moduleImports]
    .filter(src => !/gsap/i.test(src) && !isSupportedThreeRuntime(src)
      && !supportedLibraryImport(src) && !normalizeThreeSpecifier(src));
  if (nonGsapExternal.length) skip(`external runtime: ${nonGsapExternal[0]}`);

  const hasTimeline = /\.timeline\s*\(/.test(js) || /window\.__timelines\s*\[/.test(js);
  const recipe = hasTimeline ? null : readCommentedRecipe(source);
  if (!hasTimeline && !recipe) skip('no GSAP timeline or documented recipe');

  // Upstream files come in two shapes: complete pages with <html>/<body>, and
  // paste-in fragments that are only markup + <style> + <script>.
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? pageFragment(source);
  if (!body.trim()) skip('no markup found');
  // A port must be self-contained: the single-file contract cannot ship the
  // upstream's own font, image, video or JSON files, so any local reference is
  // a source dependency rather than a port the library can mount on its own.
  const localAsset = findLocalAssetReference(source, js);
  let bundledFont;
  if (localAsset && !/\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|mp3|wav|ogg|m4a|json|ttf|glb|hdr)(?:[?#]|$)/i.test(localAsset)) {
    if (entry.id !== 'blocks-extruded-logo' || localAsset !== 'assets/fonts/Geist-Bold.typeface.json') {
      skip(`requires source asset file: ${localAsset}`);
    }
    bundledFont = JSON.parse(await readFile(new URL(localAsset, dir), 'utf8'));
  }

  const executableJS = stripJavaScriptComments(js);
  const risky = [
    /requestAnimationFrame/.test(executableJS) && 'requestAnimationFrame clock',
    /Math\s*\.\s*random/.test(executableJS) && 'Math.random entropy',
    /set(?:Timeout|Interval)\s*\(/.test(executableJS) && 'timer scheduling',
    /(?:new\s+Date|Date\.now|performance\.now)/.test(executableJS) && 'wall clock',
    /\binnerHTML\b/.test(executableJS) && 'innerHTML construction',
  ].filter(Boolean);
  // innerHTML is DOM construction, not a determinism problem: a faithful port
  // may assemble its own markup exactly as the upstream script does.
  const supportedTimerAdaptation = supportsTimerAdaptation(entry.id, js);
  const blockers = risky.filter(reason => reason !== 'innerHTML construction'
    && !(reason === 'timer scheduling' && supportedTimerAdaptation));
  if (blockers.length) skip(`needs deterministic adaptation: ${blockers.join(', ')}`);

  const variablesHost = readVariablesHost(source, js);
  const artboard = readArtboard(source);
  const css = extractStyles(source);
  const mount = templateMount(source);
  const markup = prepareMarkup(extractMarkup(source, mount), mount, source);
  const preparedScript = prepareScript({
    entry,
    media: templateMountMedia(source),
    recipe,
    variablesHost,
    js,
    source,
    inlineScripts: adaptedInlineScripts.map(body => adaptTimerScript(entry.id, body)),
  });
  let script = adaptThreeScript(runtimeImports, adaptBundledFont(entry.id, bundledFont,
    adaptTimerScript(entry.id, preparedScript)));
  if (fontDefinitions.length) {
    await writeFontPack(entry.id, fontDefinitions);
    script = `await loadHyperframeFonts(__hfFonts);\n${script}`;
  }
  if (media.enabled) {
    script = resolveScriptMedia(script);
    for (const { name, path } of media.styles ?? []) {
      script = `__hfRootElement.style.setProperty(${JSON.stringify(name)}, 'url("' + __hfAsset(${JSON.stringify(path)}) + '")');\n${script}`;
    }
    script += '\n__hfRootElement.querySelectorAll("img").forEach(image => { image.src = __hfAsset(image.getAttribute("src")); });';
  }
  script = modernizeCanvasCapture(normalizeReservedIdentifiers(script));
  const cssBody = processCSS(css);
  const cssImports = [...cssBody.matchAll(/@import\s+url\([^)]*\)\s*;?/gi)].map(match => match[0].trim());
  const cssRules = cssBody.replace(/@import\s+url\([^)]*\)\s*;?/gi, '');
  const headImports = readHeadImports(source);
  const scriptImports = [...readGsapPluginImports(source), ...runtimeImports];
  if (fontDefinitions.length) scriptImports.push(
    "import { loadHyperframeFonts, hyperframeFontSource } from '@machinal/hyperframes/assets';",
    `import __hfFonts from '@machinal/hyperframes/fonts/${entry.id}';`,
  );
  if (script.includes('uploadHyperframeElement(')) {
    scriptImports.push("import { uploadHyperframeElement } from '@machinal/hyperframes/assets';");
  }
  if (media.enabled) scriptImports.push(`import __hfAsset from '@machinal/hyperframes/media/${entry.id}';`);

  let composition = {
    entry, sourceFile, artboard, markup, script, cssRules, cssImports, headImports, scriptImports,
    background: readBackground(css),
  };
  let component = composeComponent(composition);
  if (Buffer.byteLength(component) > 64000) {
    const minified = await transform(script, { loader: 'js', minifyWhitespace: true, minifySyntax: true, target: 'es2022' });
    composition = { ...composition, script: minified.code };
    component = composeComponent(composition);
  }
  if (Buffer.byteLength(component) > 64000) {
    const minified = await transform(cssRules, { loader: 'css', minify: true, target: 'chrome120' });
    composition = { ...composition, cssRules: minified.code, minifiedCSS: true };
    component = composeComponent(composition);
  }
  if (Buffer.byteLength(component) > 64000) {
    // Large, authored demo layouts are mostly formatting whitespace. Keep a
    // single separator so adjacent inline text remains readable.
    composition = { ...composition, markup: markup.replace(/\s+/g, ' ') };
    component = composeComponent(composition);
  }
  if (Buffer.byteLength(component) > 64000) {
    const directory = new URL('../hyperframes/native/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL(`${entry.id}.mjs`, directory),
      `// Native adapter of upstream ${entry.id}, Apache-2.0; third-party notices remain in hyperframes-library.\n`
      + `import { gsap } from 'gsap';\n${scriptImports.join('\n')}\n`
      + `export async function initializeNative(__hfTimelineSlot, __hfRootElement, __hfHost, __hfScene) {\n`
      + `const __hfRegistry = new Proxy({}, { get: () => __hfTimelineSlot.get() });\n`
      + `const __hfListen = (type, listener, options = {}) => window.addEventListener(type, listener, {...options, signal:__hfScene.resources.signal});\n`
      + `${script}\n}\n`);
    component = composeComponent({
      ...composition,
      scriptImports: [...scriptImports, `import { initializeNative } from '@machinal/hyperframes/native/${entry.id}';`],
      script: 'await initializeNative(__hfTimelineSlot, __hfRootElement, __hfHost, __hfScene);',
    });
  }

  return {
    id: entry.id,
    out: `${entry.category}/${entry.upstreamName}.svelte`,
    component,
    sourceVersion: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    manifest: {
      id: entry.id,
      reviewVersion: 2,
      category: entry.category,
      upstreamName: entry.upstreamName,
      sourceFile,
      artboard: [artboard.width, artboard.height],
      mount: mount ? 'template' : 'body',
      timeline: recipe ? 'documented-recipe' : 'inline-script',
      recipe: recipe ?? undefined,
      bundledFonts: fontDefinitions,
      mediaReplacements: media.replacements,
      bytes: component.length,
    },
  };
}

function skip(reason) {
  const error = new Error(reason);
  error.code = 'SKIP';
  throw error;
}

function stripJavaScriptComments(source) {
  let result = '';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      result += character;
      continue;
    }

    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      result += '\n';
      continue;
    }

    if (character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') result += '\n';
        index += 1;
      }
      index += 1;
      result += ' ';
      continue;
    }

    result += character;
  }

  return result;
}

function supportsTimerAdaptation(id, source) {
  const adapted = stripJavaScriptComments(adaptTimerScript(id, source));
  if (!/\bset(?:Timeout|Interval)\s*\(/.test(adapted)) return true;
  if (['blocks-vfx-magnetic', 'blocks-vfx-liquid-background', 'blocks-vfx-portal', 'blocks-vfx-shatter'].includes(id)) {
    return /setTimeout\(\s*function\s*\(\)\s*\{[\s\S]*?\},\s*0\s*\)/.test(source);
  }
  if (id === 'blocks-gooey-split' || id === 'components-shutter-slam') {
    return /function registrationProxy\(container\)/.test(source)
      && /attachMotionBlur\(/.test(source)
      && /setTimeout\(\s*function\s*\(\)\s*\{\s*poll\(ticks\s*-\s*1\);\s*\},\s*POLL_MS\s*\)/.test(source);
  }
  return false;
}

function adaptTimerScript(id, source) {
  source = source.replace(/\/\* Standalone playback:[\s\S]*?\}\)\(\);/g, '');
  source = source.replace(/await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\)/g, 'await Promise.resolve()');
  source = source.replace(/setTimeout\(done,\s*100\);/g, '');
  if (id === 'components-filmed-screen') {
    source = source.replace(
      /\(function poll\(n\)[\s\S]*?\}\)\(0\);/,
      'window.addEventListener("hf-seek", event => onSeek(event.detail.time));',
    ).replace(/setTimeout\(once,\s*250\);/g, '');
  }
  if (['blocks-gooey-split', 'components-shutter-slam', 'components-motion-blur'].includes(id)) {
    source = source.replace(
      /function registrationProxy\(container\)[\s\S]*?\/\* SHUTTER_SNIPPET_END \*\//,
      '/* SHUTTER_SNIPPET_END */',
    );
  }
  return source.replace(/setTimeout\(\s*function\s*\(\)\s*\{([\s\S]*?)\},\s*0\s*\)/g, 'queueMicrotask(function () {$1})');
}

/**
 * Finds the first reference to a file the upstream page ships beside itself:
 * a `url()` in CSS, a `<link>` to a local stylesheet, or a quoted path in the
 * script. Data URIs, inline fragments and remote URLs are not dependencies.
 */
function findLocalAssetReference(source, js) {
  const css = extractStyles(source);
  const isLocal = url => url && !/^(?:data:|https?:|\/\/|#|%23|mailto:)/i.test(url);
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    if (isLocal(match[1])) return match[1];
  }
  for (const match of source.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    if (isLocal(match[1]) && /\.css(?:\?|$)/i.test(match[1])) return match[1];
  }
  const extension = /\.(?:woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|bmp|svg|mp4|webm|mov|m4v|mp3|wav|ogg|json|css)(?:[?#]|$)/i;
  for (const match of js.matchAll(/["'`]([^"'`\n]+)["'`]/g)) {
    const value = match[1];
    if (!extension.test(value) || !isLocal(value)) continue;
    if (isBundledFontReference(value)) continue;
    if (/\.json(?:[?#]|$)/i.test(value) && !/\b(?:fetch|loadAsync|assetUrl)\s*\(/.test(js)) continue;
    // A bare extension (".png") is a filename check, not a file reference.
    if (/^\.\w+$/.test(value)) continue;
    return value;
  }
  return null;
}

function extractStyles(source) {
  return sourceElements(source, 'style').map(style => style.content).join('\n');
}

/**
 * A paste-in fragment has no document wrapper; everything outside <style> and
 * <script> is the composition markup and the source comments are documentation.
 */
function pageFragment(source) {
  return stripSourceElements(source)
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}

function readVariablesHost(source, js) {
  if (/window\.__hyperframes\s*=/.test(js)) throw new Error('source assigns window.__hyperframes itself');
  const hyperframes = /\b__hyperframes\b/.test(js);
  const hfVariables = /\b__hfVariables\b/.test(js);
  if (hyperframes && hfVariables) return 'both';
  if (hyperframes) return 'hyperframes';
  if (hfVariables) return 'hfVariables';
  return 'none';
}

function readCommentedRecipe(source) {
  const comments = [...source.matchAll(/<!--([\s\S]*?)-->/g)].map(match => match[1]);
  for (const comment of comments) {
    const index = comment.search(/Timeline integration/i);
    if (index < 0) continue;
    const recipe = collectRecipe(comment.slice(index).split('\n').slice(1));
    if (recipe) return recipe;
  }
  return null;
}

/**
 * Collects the first complete GSAP statement block of a documented recipe.
 * Recipes wrap long calls over several lines and may document alternatives in
 * later paragraphs, so statements are gathered until their parentheses and
 * braces balance.
 */
function collectRecipe(lines) {
  const statements = [];
  let current = null;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const text = line.trim();
    if (!current) {
      if (!/^tl\s*\.\w+\s*\(/.test(text)) continue;
      current = [text];
      depth = balance(text);
      if (depth <= 0) { statements.push(current.join('\n')); current = null; }
      continue;
    }
    current.push(line);
    depth += balance(text);
    if (depth <= 0) {
      statements.push(current.join('\n'));
      current = null;
      // A following prose paragraph documents an alternative, not the recipe.
      break;
    }
  }
  return statements.length ? `${statements.join('\n')}` : null;
}

function balance(text) {
  let depth = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') { index += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '/' && text[index + 1] === '/') break;
    if ('([{'.includes(character)) depth += 1;
    if (')]}'.includes(character)) depth -= 1;
  }
  return depth;
}

function templateMount(source) {
  const masked = source.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
  const open = masked.match(/<template[^>]*>/i);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const end = masked.indexOf('</template>', start);
  if (end < 0) return undefined;
  const body = source.slice(start, end);
  return /data-composition-id|id=["']root["']/.test(body) ? { start, end } : undefined;
}

function templateMountMedia(source) {
  const mount = templateMount(source);
  if (!mount) return undefined;
  return { open: source.lastIndexOf('<template', mount.start), close: mount.end };
}

function extractMarkup(source, mount) {
  const strip = text => stripSourceElements(text, ['script', 'style']).replace(/<!--[\s\S]*?-->/g, '');
  if (mount) {
    const body = strip(source.slice(mount.start, mount.end));
    if (!body.trim()) throw new Error('<template> mount markup not found');
    return body;
  }
  const body = strip(sourceElements(source, 'body')[0]?.content ?? pageFragment(source));
  if (!body.trim()) throw new Error('<body> markup not found');
  return body;
}

function readArtboard(source) {
  const declared = value => Number.parseInt(value, 10);
  const tags = [source.match(/<html[^>]*>/i)?.[0], source.match(/<[^>]*data-composition-id[^>]*>/i)?.[0]];
  for (const tag of tags) {
    if (!tag) continue;
    const width = declared(tag.match(/data-width="(\d+)"/)?.[1] ?? '');
    const height = declared(tag.match(/data-height="(\d+)"/)?.[1] ?? '');
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
  }
  return { width: 1920, height: 1080 };
}

function readBackground(css) {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|,)\s*(html|body)\s*(,|$)/i.test(match[1].trim())) continue;
    const background = match[2].match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i)?.[1].trim();
    if (background) return background;
  }
  return undefined;
}

function readHeadImports(source) {
  const head = source.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  return [...head.matchAll(/<link\b[^>]*>/gi)]
    .filter(tag => /\brel\s*=\s*["']?stylesheet["']?/i.test(tag[0]))
    .map(tag => tag[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
}

function readGsapPluginImports(source) {
  const scripts = [...source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(match => match[1]);
  const imports = [];
  for (const name of ['CustomEase', 'MotionPathPlugin', 'TextPlugin']) {
    if (scripts.some(url => new RegExp(`(?:^|/)${name}(?:\\.min)?\\.js(?:$|[?#])`, 'i').test(url))
      && new RegExp(`\\b${name}\\b`).test(source)) {
      imports.push(`import { ${name} } from 'gsap/dist/${name}';`);
    }
  }
  return imports;
}

function isSupportedThreeRuntime(source) {
  return source === 'three'
    || source.startsWith('three/')
    || /(?:^|\/)three(?:\.min|\.module)?\.js(?:$|[?#])/i.test(source)
    || /\/three@\d+(?:\.\d+){1,2}\/(?:\+esm|examples\/jsm?\/.+\.js(?:\/\+esm)?)(?:$|[?#])/i.test(source);
}

function supportedLibraryImport(source) {
  if (/\/d3@7\.9\.0\/dist\/d3\.min\.js/.test(source)) return "import * as d3 from 'd3';";
  if (/\/d3-delaunay@6\.0\.4\/dist\/d3-delaunay\.min\.js/.test(source)) return "import * as d3 from 'd3-delaunay';";
  if (/\/lottie-web@5\.12\.2\/build\/player\/lottie_light\.min\.js/.test(source)) return "import lottie from 'lottie-web/build/player/lottie_light.js';";
  if (/\/clipper-lib@6\.4\.2\/clipper\.js/.test(source)) return "import ClipperLib from 'clipper-lib';";
  if (/\/topojson-client@3\.1\.0\/dist\/topojson-client\.min\.js/.test(source)) return "import * as topojson from 'topojson-client';";
  const local = {
    'shadows.js': "import { CodeSliceShadows, CodeSliceSurface } from '@machinal/hyperframes/vendor/code-slice';",
    'surface.js': "import { CodeSliceShadows, CodeSliceSurface } from '@machinal/hyperframes/vendor/code-slice';",
    'assets/baked/caveat-pen.js': "import { caveatPen } from '@machinal/hyperframes/vendor/caveat-pen';",
    'lib/liquid-glass.iife.js': "import { LiquidGlass } from '@machinal/hyperframes/vendor/liquid-glass';",
    'assets/frost.js': "import { Frost } from '@machinal/hyperframes/vendor/frost';",
    'assets/glass-main.js': "import { mountGlassShard } from '@machinal/hyperframes/vendor/glass-shard';",
  };
  if (local[source]) return local[source];
  return null;
}

function readRuntimeImports(externalScripts, inlineScripts) {
  const imports = new Set();
  const inline = inlineScripts.join('\n');
  const modulePattern = /^\s*import\s+(.+?)\s+from\s*["']([^"']+)["']\s*;?/gm;
  for (const match of inline.matchAll(modulePattern)) {
    const specifier = normalizeThreeSpecifier(match[2]);
    if (specifier) imports.add(`import ${match[1]} from '${specifier}';`);
  }
  for (const source of externalScripts) {
    const library = supportedLibraryImport(source);
    if (library) { imports.add(library); continue; }
    if (!isSupportedThreeRuntime(source)) continue;
    const specifier = normalizeThreeSpecifier(source);
    if (specifier === 'three') imports.add("import * as THREE from 'three';");
    else {
      const exportName = specifier?.match(/\/([^/]+)\.js$/)?.[1];
      if (exportName) imports.add(`import { ${exportName} } from '${specifier}';`);
    }
  }
  return [...imports];
}

function stripRuntimeModuleImports(source) {
  return source.replace(
    /^[\t ]*import[\t ]+(.+?)[\t ]+from[\t ]*["']([^"']+)["'][\t ]*;?[\t ]*(?:\r?\n)?/gm,
    (statement, _bindings, source) => normalizeThreeSpecifier(source) ? '' : statement,
  );
}

function normalizeThreeSpecifier(source) {
  if (source === 'cuboid-carousel/motion') return '@machinal/hyperframes/vendor/cuboid-motion';
  if (source === 'orbit-card/scene') return '@machinal/hyperframes/vendor/orbit-scene';
  if (source === 'three' || source.startsWith('three/')) return source;
  if (/(?:^|\/)three(?:\.min|\.module)?\.js(?:$|[?#])/i.test(source)) return 'three';
  const cdn = source.match(/\/three@\d+(?:\.\d+){1,2}\/(.+?)(?:\/\+esm)?(?:$|[?#])/i);
  if (!cdn) return null;
  if (cdn[1] === '+esm') return 'three';
  if (cdn[1].startsWith('examples/jsm/')) return `three/addons/${cdn[1].slice('examples/jsm/'.length)}`;
  if (cdn[1].startsWith('examples/js/')) return `three/addons/${cdn[1].slice('examples/js/'.length)}`;
  if (cdn[1] === 'build/three.min.js' || cdn[1] === 'build/three.module.js') return 'three';
  return null;
}

function adaptThreeScript(imports, source) {
  source = source.replace(/\.renderTargetDepth\b/g, '._renderTargetDepth').replace(/\.fsQuad\b/g, '._fsQuad');
  source = source.replace(/\bwindow\.CodeSlice(Shadows|Surface)\b/g, 'CodeSlice$1')
    .replace(/\bwindow\.__hwPenCaveat\b/g, 'caveatPen')
    .replace(/\bwindow\.LiquidGlass\b/g, 'LiquidGlass')
    .replace(/\bwindow\.Frost\b/g, 'Frost');
  if (imports.some(line => line.includes('mountGlassShard'))) {
    source += '\nconst disposeGlass = await mountGlassShard(); __hfScene.resources.signal.addEventListener("abort", disposeGlass, { once: true });';
  }
  for (const line of imports) {
    const addon = line.match(/import \{ (\w+) \} from ['"]three\/addons\//)?.[1];
    if (addon) source = source.replace(new RegExp(`\\bTHREE\\.${addon}\\b`, 'g'), addon);
  }
  if (!imports.some(line => /\bfrom\s+['"]three['"]/.test(line))) return source;
  return source
    .replace(/\b(?:var|let|const)\s+THREE\s*=\s*window\.THREE\s*;?/g, '')
    .replace(/\bwindow\.THREE\b/g, 'THREE');
}

function adaptBundledFont(id, font, source) {
  if (id !== 'blocks-extruded-logo' || !font) return source;
  const fontJSON = JSON.stringify(font);
  return source.replace(
    /await\s+new\s+FontLoader\(\)\.loadAsync\(\s*assetUrl\(["']assets\/fonts\/Geist-Bold\.typeface\.json["']\)\s*,?\s*\)/,
    `new FontLoader().parse(${fontJSON})`,
  );
}

function prepareMarkup(markup, mount, source) {
  let text = markup.replace(/<link\b[^>]*>/gi, tag => {
    const id = tag.match(/\bid=["']([^"']+)["']/)?.[1];
    const href = tag.match(/\bhref=(["'])([^"']+)\1/)?.[2];
    return id && href ? `<a hidden id="${id}" href="${href}"></a>` : '';
  });
  const htmlTag = source.match(/<html[^>]*>/i)?.[0] ?? '';
  const variables = htmlTag.match(/data-composition-variables='[\s\S]*?'/)?.[0];
  const duration = htmlTag.match(/data-composition-duration="[^"]*"/)?.[0];
  const additions = [variables, duration].filter(Boolean).join(' ');
  if (mount) {
    if (variables && /<div id="root"[^>]*data-composition-variables=/.test(text)) throw new Error('#root already declares variables');
    if (variables) text = text.replace(/<div id="root"/, `<div id="root" ${additions}`);
  } else if (additions) {
    const compositionRoot = /<[a-z][\w-]*\b[^>]*\bdata-composition-id=["'][^"']+["'][^>]*>/i;
    const target = text.match(compositionRoot)?.[0];
    if (target && !/\bdata-composition-variables=/.test(target)) {
      text = text.replace(target, target.replace(/>$/, ` ${additions}>`));
    }
  }
  return text;
}

function prepareScript({ entry, recipe, variablesHost, js, source, inlineScripts, media }) {
  const replaceOnce = (label, pattern, replacement) => {
    const next = script.replace(pattern, replacement);
    if (next === script) throw new Error(`${label} not found`);
    script = next;
  };
  let script;

  if (recipe) {
    script = `var tl = gsap.timeline({ paused: true });\nvar startTime = 0;\n${recipe}\nwindow.__timelines = window.__timelines || {};\nwindow.__timelines["${entry.upstreamName}"] = tl;`;
    // Recipes are documented snippets; `startTime` is caller-supplied and the
    // primitive's own entrance starts at zero.
    assertSyntax(script, entry.id);
  } else {
    const candidates = inlineScripts.filter(body => /\.timeline\s*\(/.test(body) || /window\.__timelines\s*\[/.test(body));
    if (!candidates.length) throw new Error('no inline timeline script');
    // Several upstream pages split one composition across scripts (a shared
    // rig first, the timeline second); the port keeps them in document order.
    script = entry.id === 'blocks-wireframe-portal-title'
      ? inlineScripts.map(body => `{\n${body}\n}`).join('\n')
      : inlineScripts.join('\n');
  }
  script = script.replace(/\b(?:var|let|const)\s+gsap\s*=\s*window\.gsap\s*;?/g, '')
    .replace(/\bwindow\.gsap\b/g, 'gsap');
  script = script.replace(/\bG\.__timelines\b/g, '__hfRegistry');

  if (variablesHost !== 'none') {
    script = script.replace(/window\.__hyperframes\b/g, '__hfHost');
    script = script.replace(/(?<![\w.$])__hyperframes\b/g, '__hfHost');
    script = script.replace(/window\.__hfVariables\b/g, '__hfHost.variables');
    script = script.replace(/(?<![\w.$])__hfVariables\b/g, '__hfHost.variables');
  }

  // `document.currentScript` exists only while the upstream page is executing
  // a script element. In the Svelte port the same initializer runs as a
  // component function, so resolve the composition root through the bound host.
  script = script.replace(
    /document\.currentScript\.closest\((["'])#root\1\)\s*\|\|\s*document\.getElementById\((["'])root\2\)/g,
    '__hfRootElement.querySelector("#root")',
  );
  script = script.replace(
    /\bdocument\.documentElement\b/g,
    '__hfRootElement.querySelector("[data-composition-id]") || __hfRootElement',
  );

  script = script.replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;/g, '');
  const publications = [...script.matchAll(/window\.__timelines\s*\[[^\]]*\]/g)];
  if (!publications.length) throw new Error('expected at least one timeline publication');
  // The registry becomes a slot the component owns. Reading it is a lookup;
  // assigning it hands the timeline over even when the page registers it later
  // (for example after fonts resolve), which a plain local variable would lose.
  script = publishTimelines(script);
  script = script.replace(/\bwindow\.addEventListener\s*\(/g, '__hfListen(');

  const code = stripJavaScriptComments(script);
  const unadapted = code.search(/__timelines|__hyperframes|__hfVariables/);
  if (unadapted >= 0) throw new Error('unadapted host global remains: ' + code.slice(Math.max(0, unadapted - 50), unadapted + 100));

  return script;
}

/**
 * Rewrites the upstream timeline registry into the component's timeline slot.
 *
 * `window.__timelines[key] = tl` becomes `__hfTimelineSlot.set(tl)` and any
 * read becomes `__hfTimelineSlot.get()`, so a timeline registered asynchronously
 * still reaches the scene controller.
 */
function publishTimelines(script) {
  const marker = 'window.__timelines';
  let output = '';
  let index = 0;
  while (true) {
    const start = script.indexOf(marker, index);
    if (start < 0) break;
    let end = start + marker.length;
    let cursor = end;
    while (cursor < script.length && script[cursor] === ' ') cursor += 1;
    if (script[cursor] === '[') {
      let depth = 0;
      for (; cursor < script.length; cursor += 1) {
        if (script[cursor] === '[') depth += 1;
        else if (script[cursor] === ']') { depth -= 1; if (depth === 0) { cursor += 1; break; } }
      }
      end = cursor;
    }
    let assignment = end;
    while (assignment < script.length && /\s/.test(script[assignment])) assignment += 1;
    if (script[assignment] === '=' && script[assignment + 1] !== '=') {
      const statementEnd = findStatementEnd(script, assignment + 1);
      const value = script.slice(assignment + 1, statementEnd - 1).trim();
      output += `${script.slice(index, start)}__hfTimelineSlot.set(${publishTimelines(value)});`;
      index = statementEnd;
      continue;
    }
    output += `${script.slice(index, start)}__hfTimelineSlot.get()`;
    index = end;
  }
  return output + script.slice(index);
}

function findStatementEnd(script, from) {
  let depth = 0;
  let quote = null;
  for (let index = from; index < script.length; index += 1) {
    const character = script[index];
    if (quote) {
      if (character === '\\') { index += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (character === ';' && depth <= 0) return index + 1;
  }
  throw new Error('unterminated timeline publication');
}

function assertSyntax(script, id) {  try {
    // eslint-disable-next-line no-new-func
    new Function('gsap', script);
  } catch (error) {
    throw new Error(`${id}: documented recipe is not valid JavaScript (${error.message})`);
  }
}

function processCSS(css) {
  return retargetDocumentSelectors(css);
}

function retargetDocumentSelectors(css) {
  return scanCSS(css, (prelude, isAtRule) => {
    if (isAtRule) return prelude;
    const prefix = prelude.match(/^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/)?.[1] ?? '';
    const suffix = prelude.match(/(\s*)$/)?.[1] ?? '';
    const selectors = prelude.slice(prefix.length, prelude.length - suffix.length);
    const mapped = selectors.split(',').flatMap(selector => retargetSelector(selector.trim()));
    return `${prefix}${[...new Set(mapped)].join(', ')}${suffix}`;
  });
}

function retargetSelector(selector) {
  if (!selector) return [];
  if (/^(html|body|:root)$/i.test(selector)) return ['.hf-port'];
  if (/^(html|body|:root)\b/i.test(selector)) return [selector.replace(/^(html|body|:root)/i, '.hf-port')];
  if (selector === '*') return ['.hf-port', '.hf-port *'];
  if (/^\*/.test(selector)) return [`.hf-port ${selector}`];
  return [selector];
}

function scanCSS(css, transformPrelude) {
  let output = '';
  let boundary = 0;
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      index += 1;
      while (index < css.length) {
        if (css[index] === '\\') { index += 2; continue; }
        if (css[index] === character) { index += 1; break; }
        index += 1;
      }
      continue;
    }
    if (character === '{') {
      const prelude = css.slice(boundary, index);
      output += `${transformPrelude(prelude, prelude.trim().startsWith('@'))}{`;
      boundary = index + 1;
      index += 1;
      continue;
    }
    if (character === '}' || character === ';') {
      output += css.slice(boundary, index) + character;
      boundary = index + 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  return output + css.slice(boundary);
}

function composeComponent({ entry, sourceFile, artboard, background, markup, script, cssRules, cssImports, headImports, scriptImports, minifiedCSS = false }) {
  const escaped = escapeBraces(markup).trim();
  const box = `position: absolute; top: 0; left: 0; width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden;`;
  const backgroundAttribute = background ? ` background="${escapeAttribute(background)}"` : '';
  const importLines = [...headImports.map(href => `@import url("${href}");`), ...cssImports];
  const formattedRules = minifiedCSS ? cssRules.trim() : indentCSS(cssRules.trim(), 2);

  return `<!-- Modified Svelte adaptation of registry/${entry.category}/${entry.upstreamName}/${sourceFile}; upstream 8ec98be29a64e88239a0c05f7e5d09f36e181493, Apache-2.0; original licence and CREDITS in hyperframes-library/.
     Subject markup, stylesheet declarations and the source animation are retained; fonts, media and initialization are localized
     as recorded in the sidecar. Host variables map to \`design\`, the timeline follows the scene clock, and document-level selectors
     (html/body/:root/*) are retargeted to \`.hf-port\` so the port cannot restyle the host page. -->
<svelte:options preserveWhitespace={true} />
<script>
  import { untrack } from 'svelte';
  import { gsap } from 'gsap';
  ${scriptImports.join('\n  ')}
  import { SceneCanvas, useScene } from '@machinal/scenes/svelte';

  let { design = {} } = $props();
  const __hfScene = useScene();
  let root = $state();
  let timeline = $state.raw();

  // Host shim: the upstream page reads its editable variables from the
  // HyperFrames host. In the port they come from the approved \`design\` prop.
  const __hfHost = { getVariables: () => (design || {}), variables: design || {}${scriptImports.some(line => line.includes('/media/')) ? ', assetUrl: path => __hfAsset(path)' : ''} };

  // The upstream page publishes its timeline into the host registry,
  // sometimes from a callback that runs after mount (once fonts are ready).
  // Pause it at time zero so the scene controller is its only clock source.
  let __hfTimelineSlot = { set() {}, get: () => undefined };

  $effect(() => {
    if (!root) return;
    let live = true;
    __hfTimelineSlot = {
      set(value) {
        if (live) {
          timeline = value;
          queueMicrotask(() => {
            if (live && timeline === value) {
              value?.pause(0);
              value?.seek(0, false);
            }
          });
        }
      },
      get() {
        return untrack(() => timeline);
      },
    };
    const context = gsap.context(() => {
      untrack(() => __hfScene.resources.track(initialize(__hfTimelineSlot, root)));
    }, root);
    return () => {
      live = false;
      timeline?.kill?.();
      context.revert();
      timeline = undefined;
    };
  });

  $effect(() => {
    const active = timeline;
    const time = __hfScene.frame.time;
    if (active) untrack(() => {
      active.seek(time, false);
      const waits = [];
      window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time, waitUntil: promise => waits.push(promise) } }));
      if (typeof window.__hf_page_composite_resolve === 'function') waits.push(window.__hf_page_composite_resolve());
      if (waits.length) __hfScene.resources.track(Promise.all(waits));
    });
  });

  async function initialize(__hfTimelineSlot, __hfRootElement) {
    const __hfRegistry = new Proxy({}, { get: () => __hfTimelineSlot.get() });
    const __hfListen = (type, listener, options = {}) => window.addEventListener(type, listener,
      { ...options, signal: __hfScene.resources.signal });
${script.trim().split('\n').map(line => (line ? `    ${line}` : line)).join('\n')}
    if (window.__hf?.buildReady) await Promise.all(Object.values(window.__hf.buildReady));
  }
</script>

<SceneCanvas${backgroundAttribute}>
  <div class="hf-port" data-hf-embedded-fonts bind:this={root}>
${escaped.split('\n').map(line => `    ${line}`).join('\n')}
  </div>
</SceneCanvas>

<style>
${importLines.length ? `${importLines.join('\n')}\n` : ''}:global {
  .hf-port {
    ${box}
  }
${formattedRules}
}
</style>
`;
}

function indentCSS(css, indentation) {
  if (!css) return '';
  const lines = css.split(/\r?\n/);
  let blockDepth = 0;
  let parenthesisDepth = 0;
  let continuation = false;
  return lines.map(line => {
    const content = line.trim();
    if (!content) return '';
    const leadingBlockClosures = content.match(/^}+/)?.[0].length ?? 0;
    const leadingParenthesisClosures = content.match(/^\)+/)?.[0].length ?? 0;
    const currentBlockDepth = Math.max(0, blockDepth - leadingBlockClosures);
    const currentParenthesisDepth = Math.max(0, parenthesisDepth - leadingParenthesisClosures);
    const continuationIndent = continuation ? 2 : 0;
    const formatted = `${' '.repeat(indentation + (currentBlockDepth + currentParenthesisDepth) * 2 + continuationIndent)}${content}`;
    const opensBlocks = (content.match(/{/g) ?? []).length;
    const closesBlocks = (content.match(/}/g) ?? []).length;
    const opensParentheses = (content.match(/\(/g) ?? []).length;
    const closesParentheses = (content.match(/\)/g) ?? []).length;
    blockDepth = Math.max(0, currentBlockDepth + opensBlocks - closesBlocks);
    parenthesisDepth = Math.max(0, currentParenthesisDepth + opensParentheses - closesParentheses);
    if (content.endsWith(':')) continuation = true;
    else if (content.endsWith(';')) continuation = false;
    return formatted;
  }).join('\n');
}

function escapeBraces(markup) {
  return markup.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
    .replace(/(["'])__HF_ASSET_([A-Za-z0-9+/=]+)__\1/g,
      (_match, _quote, encoded) => `{__hfAsset(${JSON.stringify(Buffer.from(encoded, 'base64').toString('utf8'))})}`);
}

function escapeAttribute(value) {
  return value.replace(/"/g, '&quot;');
}
