/**
 * Ports HyperFrames reference pages to native Svelte scenes.
 *
 * Policy: the upstream markup, stylesheet and GSAP timeline are copied
 * verbatim. Only these mechanical adaptations are allowed:
 *
 *   1. `window.__timelines[...] = tl` becomes a local timeline handle.
 *   2. Host variable lookups (`window.__hfVariables`, `window.__hyperframes`)
 *      become the component's `design` prop.
 *   3. Document-level CSS selectors (`html`, `body`, `:root`, `*`) are
 *      retargeted to the port root so a mounted port cannot restyle the host
 *      page; every artboard rule is left untouched.
 *   4. The copy is wrapped in one root element that mirrors the source
 *      artboard box, and `<template>`-mounted components keep their mount
 *      contract by moving the `<html>` variable attributes onto `#root`.
 *   5. `{` and `}` inside the markup are escaped as character references
 *      because Svelte would otherwise parse them as expressions.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const reference = new URL('../../../packages/mcp-installer/library/', import.meta.url);
const registry = 'hyperframes-library/registry/';

const ports = [
  { id: 'transitions-3d', ledgerId: 'blocks-transitions-3d', group: 'blocks', out: 'blocks/transitions-3d.svelte', duration: 11, variables: 'none' },
  { id: 'ui-3d-reveal', ledgerId: 'blocks-ui-3d-reveal', group: 'blocks', out: 'blocks/ui-3d-reveal.svelte', duration: 13, variables: 'none', compact: true },
  { id: 'agent-cursor', ledgerId: 'components-agent-cursor', group: 'components', out: 'components/agent-cursor.svelte', duration: 4.8, variables: 'defaults', mount: 'template' },
  { id: 'ai-answer-rank', ledgerId: 'blocks-ai-answer-rank', group: 'blocks', out: 'blocks/ai-answer-rank.svelte', duration: 9, variables: 'host' },
  { id: 'ai-chat-reveal', ledgerId: 'blocks-ai-chat-reveal', group: 'blocks', out: 'blocks/ai-chat-reveal.svelte', duration: 19.3333333333, variables: 'host', logo: true },
  { id: 'vfx-anamorphic-flare', ledgerId: 'blocks-vfx-anamorphic-flare', group: 'blocks', out: 'blocks/vfx-anamorphic-flare.svelte', duration: 10, variables: 'V' },
  { id: 'animated-bar-chart', ledgerId: 'components-animated-bar-chart', group: 'components', out: 'components/animated-bar-chart.svelte', duration: 5, variables: 'none', sourceFile: 'demo.html' },
  { id: 'cursor-annotate', ledgerId: 'components-cursor-annotate', group: 'components', out: 'components/cursor-annotate.svelte', duration: 2.95, variables: 'defaults', mount: 'template' },
  { id: 'app-showcase', ledgerId: 'blocks-app-showcase', group: 'blocks', out: 'blocks/app-showcase.svelte', duration: 5.5, variables: 'none' },
  { id: 'apple-money-count', ledgerId: 'blocks-apple-money-count', group: 'blocks', out: 'blocks/apple-money-count.svelte', duration: 5, variables: 'none' },
];

const only = process.argv.slice(2);

for (const port of ports.filter(candidate => !only.length || only.includes(candidate.id))) {
  await writePort(port);
}

async function writePort(port) {
  const sourceFile = port.sourceFile ?? `${port.id}.html`;
  const sourceURL = new URL(`${registry}${port.group}/${port.id}/${sourceFile}`, reference);
  const source = (await readFile(sourceURL, 'utf8')).replace(/\r\n/g, '\n');

  const css = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
  const rawMarkup = extractMarkup(source, port);
  const rawScript = extractScript(source, port.id);
  const artboard = readArtboard(source, port);
  const background = readBackground(css);
  const logo = port.logo
    ? (await readFile(new URL(`${registry}${port.group}/${port.id}/assets/hyperframes-logo-white.svg`, reference))).toString('base64')
    : undefined;

  const markup = prepareMarkup(rawMarkup, port, source, logo);
  let script = prepareScript(rawScript, port);

  const cssBody = processCSS(css, { compact: port.compact });
  const cssImports = [...cssBody.matchAll(/@import\s+url\([^)]*\)\s*;?/gi)].map(match => match[0].trim());
  const cssRules = cssBody.replace(/@import\s+url\([^)]*\)\s*;?/gi, '');
  const headImports = readHeadImports(source);

  const component = composeComponent({ port, artboard, background, markup, script, cssRules, cssImports, headImports });
  if (port.compact) console.log(`${port.id}: markup ${markup.length}, script ${script.length}, css ${cssRules.length}, imports ${cssImports.length}`);
  if (component.length > 64000) throw new Error(`${port.id}: ${component.length} characters exceeds the 64000 renderer limit`);

  await writeFile(new URL(`hyperframes-native/${port.out}`, reference), component);
  console.log(`${port.id}: ${component.length} chars -> hyperframes-native/${port.out} (source sha256:${createHash('sha256').update(source).digest('hex').slice(0, 12)})`);
}

function extractMarkup(source, port) {
  if (port.mount === 'template') {
    const markup = templateBody(source);
    if (markup === undefined) throw new Error(`${port.id}: <template> mount markup not found`);
    return markup.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  }
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!body) throw new Error(`${port.id}: <body> markup not found`);
  return body[1].replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}

/**
 * Reads the real <template> body. The upstream mount contract is documented in
 * an HTML comment that itself contains the literal string "<template>", so
 * comments are masked before locating the element while the returned text keeps
 * them intact.
 */
function templateBody(source) {
  const masked = source.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
  const open = masked.match(/<template[^>]*>/i);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const end = masked.indexOf('</template>', start);
  if (end < 0) return undefined;
  return source.slice(start, end);
}

function extractScript(source, id) {
  const inline = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => !/\bsrc\s*=/.test(match[1]));
  const script = inline.map(match => match[2]).find(body => /gsap\.timeline\(/.test(body));
  if (!script) throw new Error(`${id}: no inline GSAP timeline script found`);
  return script;
}

function readArtboard(source, port) {
  const declared = value => Number.parseInt(value, 10);
  const candidates = [source.match(/<html[^>]*>/i)?.[0], source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1].match(/<[^>]*data-composition-id[^>]*>/i)?.[0]];
  for (const tag of candidates) {
    if (!tag) continue;
    const width = declared(tag.match(/data-width="(\d+)"/)?.[1] ?? '');
    const height = declared(tag.match(/data-height="(\d+)"/)?.[1] ?? '');
    if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
  }
  const width = declared(source.match(/width="(\d{2,4})"/)?.[1] ?? '');
  const height = declared(source.match(/height="(\d{2,4})"/)?.[1] ?? '');
  if (port.mount === 'template') return { width: 1920, height: 1080 };
  if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
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

/**
 * Stylesheet links declared in the upstream document head are part of the
 * source styling (ui-3d-reveal gets its Inter 700-900 faces from one). They are
 * carried over as @imports so the port resolves the same font files.
 */
function readHeadImports(source) {
  const head = source.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  return [...head.matchAll(/<link\b[^>]*>/gi)]
    .filter(tag => /\brel\s*=\s*["']?stylesheet["']?/i.test(tag[0]))
    .map(tag => tag[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
}

function prepareMarkup(rawMarkup, port, source, logo) {
  let markup = rawMarkup.replace(/<link\b[^>]*>/gi, '');

  if (port.mount === 'template') {
    const htmlTag = source.match(/<html[^>]*>/i)?.[0] ?? '';
    const variables = htmlTag.match(/data-composition-variables='[\s\S]*?'/)?.[0];
    const duration = htmlTag.match(/data-composition-duration="[^"]*"/)?.[0];
    const additions = [variables, duration].filter(Boolean).join(' ');
    if (!variables) throw new Error(`${port.id}: declared variables not found on <html>`);
    if (/<div id="root"[^>]*data-composition-variables=/.test(markup)) throw new Error(`${port.id}: #root already declares variables`);
    markup = markup.replace(/<div id="root"/, `<div id="root" ${additions}`);
  }

  if (port.logo) {
    if (!/src="assets\/hyperframes-logo-white\.svg"/.test(markup)) throw new Error(`${port.id}: logo reference not found`);
    markup = markup.replace('src="assets/hyperframes-logo-white.svg"', `src="data:image/svg+xml;base64,${logo}"`);
  }

  // Whitespace-only compaction: indentation and blank lines are removed, but
  // every newline between nodes is kept because HTML collapses it to the single
  // space the upstream page renders (dropping it glues adjacent inline text).
  if (port.compact) markup = markup.replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]+$/gm, '');

  return markup;
}

function prepareScript(rawScript, port) {
  let script = rawScript;

  const replaceOnce = (label, pattern, replacement) => {
    const next = script.replace(pattern, replacement);
    if (next === script) throw new Error(`${port.id}: ${label} not found in the upstream timeline script`);
    script = next;
  };

  if (port.variables === 'defaults') {
    replaceOnce(
      'variable scope resolution',
      /try\s*\{\s*if\s*\(window\.__hyperframes[\s\S]*?var\s+vars\s*=\s*Object\.assign\([^;]*\);/,
      'var vars = Object.assign({}, DEFAULTS, design);',
    );
    replaceOnce('documentElement variable host', /var\s+html\s*=\s*document\.documentElement;/, 'var html = document.getElementById("root");');
  }

  if (port.variables === 'host') {
    replaceOnce(
      'host variable lookup',
      /var\s+vars\s*=\s*window\.__hyperframes[\s\S]*?:\s*\{\s*\}\s*;/,
      'var vars = design;',
    );
  }

  if (port.variables === 'V') {
    replaceOnce(
      'host variable lookup',
      /var\s+V\s*=\s*\(window\.__hyperframes && window\.__hyperframes\.getVariables\(\)\) \|\| \{\};/,
      'var V = design || {};',
    );
  }

  replaceOnce('global timeline registry', /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;/, '');

  const assignments = [...script.matchAll(/window\.__timelines\s*\[[^\]]*\]\s*=\s*(tl|timeline)\s*;/g)];
  if (assignments.length !== 1) throw new Error(`${port.id}: expected exactly one timeline publication, found ${assignments.length}`);
  script = script.replace(/window\.__timelines\s*\[[^\]]*\]\s*=\s*(tl|timeline)\s*;/, '__hfTimeline = $1;');

  if (/__timelines|__hfVariables|__hyperframes/.test(script)) throw new Error(`${port.id}: unadapted host global remains in the timeline script`);

  if (port.compact) script = script.split('\n').map(line => line.replace(/^[ \t]+/, '')).join('\n');

  return script;
}

function processCSS(css, { compact }) {
  const retargeted = retargetDocumentSelectors(css);
  return compact ? collapseWhitespace(retargeted) : retargeted;
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

function collapseWhitespace(css) {
  let output = '';
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const start = index;
      index += 1;
      while (index < css.length) {
        if (css[index] === '\\') { index += 2; continue; }
        if (css[index] === character) { index += 1; break; }
        index += 1;
      }
      output += css.slice(start, index);
      continue;
    }
    if (/\s/.test(character)) {
      while (index < css.length && /\s/.test(css[index])) index += 1;
      output += ' ';
      continue;
    }
    if ('{};,'.includes(character)) {
      output = output.replace(/\s+$/, '') + character;
      index += 1;
      while (index < css.length && /\s/.test(css[index])) index += 1;
      continue;
    }
    if (character === ':') {
      output += ':';
      index += 1;
      while (index < css.length && /\s/.test(css[index])) index += 1;
      continue;
    }
    output += character;
    index += 1;
  }
  return output.trim();
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

function composeComponent({ port, artboard, background, markup, script, cssRules, cssImports, headImports }) {
  const escaped = escapeBraces(markup).trim();
  const box = `position: absolute; top: 0; left: 0; width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden;`;
  const backgroundAttribute = background ? ` background="${escapeAttribute(background)}"` : '';
  // Head <link> stylesheets load before in-document <style> blocks, so their
  // @imports are emitted first to keep the upstream cascade order.
  const importLines = [...headImports.map(href => `@import url("${href}");`), ...cssImports];
  const indent = port.compact ? '' : '    ';
  const scriptBody = script.trim().split('\n').map(line => (line ? `${indent}${line}` : line)).join('\n');
  const markupBody = escaped.split('\n').map(line => `${indent}${line}`).join('\n');

  return `<!-- Modified Svelte adaptation of registry/${port.group}/${port.id}/${port.sourceFile ?? `${port.id}.html`}; upstream 8ec98be29a64e88239a0c05f7e5d09f36e181493, Apache-2.0; original licence and CREDITS in hyperframes-library/.
     Original markup, stylesheet and GSAP timeline are copied verbatim. Adaptations: host variables map to the \`design\` prop,
     the timeline is published to the scene controller, and document-level CSS selectors (html/body/:root/*) are retargeted
     to the port root (\`.hf-port\`) so the port cannot restyle the host page. -->
<svelte:options preserveWhitespace={true} />
<script>
  import { untrack } from 'svelte';
  import { gsap } from 'gsap';
  import { SceneCanvas, useScene } from '@machinal/scenes/svelte';

  let { design = {} } = $props();
  const scene = useScene();
  let root = $state();
  let timeline = $state.raw();

  $effect(() => {
    if (!root) return;
    const context = gsap.context(() => {
      timeline = initialize();
    }, root);
    return () => {
      context.revert();
      timeline = undefined;
    };
  });

  $effect(() => {
    const active = timeline;
    const time = scene.frame.time;
    if (active) untrack(() => active.seek(time, false));
  });

  function initialize() {
    let __hfTimeline;
${scriptBody}
    return __hfTimeline;
  }
</script>

<SceneCanvas${backgroundAttribute}>
  <div class="hf-port" bind:this={root}>
${markupBody}
  </div>
</SceneCanvas>

<style>
${importLines.length ? `${importLines.join('\n')}\n` : ''}:global {
  .hf-port {
    ${box}
  }
${cssRules.trim()}
}
</style>
`;
}

function escapeBraces(markup) {
  return markup.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

function escapeAttribute(value) {
  return value.replace(/"/g, '&quot;');
}
