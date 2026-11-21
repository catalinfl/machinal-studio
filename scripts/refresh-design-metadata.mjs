import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const sha256 = text => createHash('sha256').update(text).digest('hex');

function tokenBlock(document, name) {
  const frontmatter = document.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  const block = frontmatter?.match(new RegExp(`^${name}:\\r?\\n((?:[ \\t]+[^\\n]*\\n?)+)`, 'm'))?.[1];
  if (!block) throw new Error(`Missing DESIGN.md ${name} tokens`);
  return Object.fromEntries(block.trimEnd().split(/\r?\n/).map(line => {
    const match = line.match(/^  ([\w-]+):\s*(["'])(.*)\2\s*$/);
    if (!match) throw new Error(`Unsupported ${name} scalar; review DESIGN.md before refreshing`);
    return [match[1], match[3]];
  }));
}

function section(document, name) {
  return document.match(new RegExp(`^## ${name}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1].trim() ?? '';
}

function tonalRamp(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360;
  return [15, 26, 38, 50, 62, 74, 86, 95].map(lightness =>
    `oklch(${lightness}% ${Math.min(chroma, lightness < 26 || lightness > 86 ? 0.025 : 0.14).toFixed(4)} ${hue.toFixed(2)})`);
}

function sourceTokens(css) {
  const block = css.match(/\.editor-suite\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!block) throw new Error('Missing editor scope');
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

function component(name, kind, description, html, css) {
  return { name, kind, description, html, css };
}

function components() {
  const font = 'font:500 12px/1.4 var(--font-sans,"IBM Plex Sans Variable","Segoe UI",system-ui,sans-serif);';
  const focus = selector => `${selector}:focus-visible{outline:2px solid var(--ring,#7047c7);outline-offset:2px;}`;
  return [
    component('Primary Button', 'button', 'Editor Render action; lilac action ink remains distinct from the selected ribbon tab.',
      '<button class="ds-primary">Render</button>',
      `.ds-primary{min-height:36px;padding:0 14px;border:1px solid var(--action,#c6adff);border-radius:3px;background:var(--action,#c6adff);color:var(--action-ink,#262a30);cursor:pointer;${font}}.ds-primary:hover{background:var(--action-hover,#d5c2ff);}.ds-primary:active{background:var(--primary-active,#49287d);color:var(--primary-foreground,#fff);}${focus('.ds-primary')}`),
    component('Icon Button', 'button', 'Outlined SVG control with a native accessible name and themed focus.',
      '<button class="ds-icon" aria-label="Close panel"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>',
      `.ds-icon{width:36px;height:36px;display:inline-grid;place-items:center;border:0;border-radius:3px;color:var(--foreground,#262a30);background:transparent;cursor:pointer;}.ds-icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;}.ds-icon:hover{background:var(--surface-muted,#eae3f2);}.ds-icon:active{color:var(--primary,#7047c7);}${focus('.ds-icon')}`),
    component('Measured Field', 'input', 'Sans label, mono time/dimension value, recessed field and visible caret/focus.',
      '<label class="ds-field">Frame rate<input value="30" inputmode="numeric" /></label>',
      `.ds-field{display:grid;gap:8px;color:var(--muted-foreground,#62606d);${font}}.ds-field input{width:104px;min-height:36px;padding:0 12px;border:1px solid var(--border,#ccc8cf);border-radius:3px;background:var(--input,#fff);color:var(--foreground,#262a30);caret-color:var(--primary,#7047c7);font:12px/1.4 var(--font-mono,"Roboto Mono Variable",Consolas,monospace);}.ds-field input:hover{border-color:var(--border-strong,#a99eb6);}${focus('.ds-field input')}`),
    component('Tool Ribbon', 'nav', 'Current lilac ribbon; selection uses a filled purple tab, not the historical cobalt underline.',
      '<nav class="ds-tabs" aria-label="Editor tools"><button aria-pressed="true">Media</button><button aria-pressed="false">Effects</button><button aria-pressed="false">Text</button></nav>',
      `.ds-tabs{display:inline-flex;gap:3px;padding:6px 16px;background:var(--ribbon,#eee7f8);color:var(--ribbon-ink,#30233f);}.ds-tabs button{min-height:34px;padding:6px 13px;border:0;border-radius:3px;background:transparent;color:inherit;cursor:pointer;${font}}.ds-tabs button:hover{background:var(--ribbon-hover,#dfd2ef);}.ds-tabs button[aria-pressed="true"]{background:var(--ribbon-active,#7047c7);color:var(--ribbon-active-ink,#fff);}${focus('.ds-tabs button')}`),
    component('Video Framing', 'input', 'Native project-level Fit / Fill selector; this is not the former Proxy/WASM preview switch.',
      '<label class="ds-framing">Frame <select aria-label="Video framing"><option>Fit</option><option>Fill (crop)</option></select></label>',
      `.ds-framing{display:inline-flex;align-items:center;gap:8px;color:var(--foreground,#262a30);${font}}.ds-framing select{min-height:36px;padding:0 8px;border:1px solid var(--border,#ccc8cf);border-radius:3px;background:var(--input,#fff);color:inherit;font:inherit;}.ds-framing select:hover{border-color:var(--border-strong,#a99eb6);}${focus('.ds-framing select')}`),
  ];
}

export function refreshDesignMetadata(current, document, css, generatedAt = new Date().toISOString()) {
  const colors = tokenBlock(document, 'colors');
  const typography = tokenBlock(document, 'typography');
  const tokens = sourceTokens(css);
  const laptop = css.match(/@media \(min-width: 1025px\) and \(max-height: 800px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const laptopValue = name => laptop.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  const rootOverview = section(document, 'Overview');
  const rootDos = section(document, "Do's and Don'ts").split('The following sections')[0];
  const rules = [...document.matchAll(/^\*\*(The [^*]+? Rule)[:.]?\*\*\s*(.+)$/gm)]
    .map(match => {
      const heading = [...document.slice(0, match.index).matchAll(/^#{2,4} (.+)$/gm)].at(-1)?.[1];
      const section = ({ Colors: 'colors', Typography: 'typography', Layout: 'layout', 'Elevation & Depth': 'elevation', Shapes: 'shapes' })[heading] ?? 'components';
      return { name: match[1].replace(/[.:]$/, ''), body: match[2], section };
    });
  const result = structuredClone(current);
  result.generatedAt = generatedAt;
  result.title = document.match(/^# (.+)$/m)?.[1] ?? current.title;
  result.extensions.colorMeta = Object.fromEntries(Object.entries(colors).map(([name, canonical]) => [name, {
    role: name === 'datum' || name === 'index-active' ? 'primary' : 'neutral',
    displayName: name.replaceAll('-', ' '), canonical, tonalRamp: tonalRamp(canonical),
  }]));
  result.extensions.typographyMeta = Object.fromEntries(Object.keys(typography).map(name => [name, {
    displayName: name.replaceAll('-', ' '), purpose: name === 'measurement' ? 'Times, dimensions, numeric values and YAML.' : 'Declared DESIGN.md editor typography role; see sourceRefresh for implementation drift.',
  }]));
  result.extensions.shadows = ['--shadow-dialog', '--shadow-popover'].map(name => ({ name: name.slice(2), value: tokens[name], purpose: 'Detached editor surface; inherited through the editor scope.' }));
  result.extensions.motion = [{ name: 'disclosure', value: '150ms ease', purpose: 'Advanced-settings chevron; reduced-motion override suppresses the transition.' }];
  result.extensions.breakpoints = [
    { name: 'editor-compact', value: '1024px' }, { name: 'header-narrow', value: '600px' },
    { name: 'laptop', value: 'min-width:1025px and max-height:800px' },
    { name: 'tool-sheet-single-column', value: '280px container' }, { name: 'tool-sheet-three-columns', value: '480px container' },
  ];
  result.extensions.editorSuite.implementedTokens = tokens;
  result.extensions.editorSuite.implementationAuthority = 'client/src/styles/editor-suite.css; scoped implementation metadata, not a replacement for DESIGN.md frontmatter.';
  result.extensions.editorSuite.colors = { background: tokens['--background'], surface: tokens['--surface'], elevated: tokens['--surface-elevated'], foreground: tokens['--foreground'], muted: tokens['--muted-foreground'], border: tokens['--border'], primary: tokens['--primary'], primaryForeground: tokens['--primary-foreground'] };
  result.extensions.editorSuite.typography = { interface: tokens['--font-sans'], measurement: tokens['--font-mono'], panelTitle: '16px / 600', dialogTitle: '22px / 500', body: '12–13px', toolLabel: '12px / 500' };
  result.extensions.editorSuite.geometry = { control: tokens['--radius-sm'], catalog: 'Source-specific; unboxed media objects', dialog: tokens['--radius-lg'] };
  result.extensions.editorSuite.layout = { commandHeight: '60px desktop / 54px compact / 48px laptop', ribbonHeight: '48px desktop / 40px laptop', deckWidth: 'Existing resizable 560px library; see laptop section', compact: '1024px and below: horizontal ribbon and task sheets', catalog: '2 columns; 1 at <=280px container, 3 at >=480px' };
  result.extensions.editorSuite.mediaLibrary.compactControls = { documentation: 'DESIGN.md — Media bin — compact controls', source: 'client/src/styles/media-library.css', header: 'Search disclosure and Import', category: 'One menu with counts; current category remains visible', secondary: 'Options: Import to, Display, Select files and Refresh', review: '.impeccable/review/media-bin-compact-verdict.md', verification: 'Existing reported evidence only; no browser checks rerun by this metadata refresh.' };
  result.extensions.editorSuite.laptopDensity = {
    documentation: 'DESIGN.md — Laptop workspace density', minimumWidth: '1025px', maximumHeight: '800px', commandHeight: '48px', ribbonHeight: '40px',
    documented: { timeline: 'clamp(184px, 29dvh, 224px)', minimumTimelineHeight: '184px', timelineHeader: '208px', clipHeight: '48px' },
    implemented: { timeline: laptopValue('flex-basis'), minimumTimelineHeight: laptopValue('--timeline-min-height'), timelineHeader: laptopValue('--timeline-header-width'), clipHeight: laptopValue('--timeline-clip-height') },
    review: '.impeccable/review/editor-laptop-verdict.md', verification: 'Current source snapshot and historical documentation only; no physical-device certification or new visual review.',
  };
  result.extensions.editorSuite.mediaQueries = [...new Set([...css.matchAll(/@media ([^{]+)\{/g)].map(match => match[1].trim()))];
  result.extensions.sourceRefresh = {
    command: 'node scripts/refresh-design-metadata.mjs',
    sources: { 'DESIGN.md': sha256(document), 'client/src/styles/editor-suite.css': sha256(css) },
    designDocumentPreserved: true, visualInspection: false,
    conflicts: [
      'DESIGN.md root frontmatter/early prose still declares graphite, blue and Roboto. Current editor CSS and later compact-control sections use paper/plum, lilac and IBM Plex Sans. Root colorMeta follows the preserved frontmatter; implementedTokens and component examples follow the scoped CSS. Reconcile DESIGN.md separately before treating those declarations as interchangeable.',
      ...(JSON.stringify(result.extensions.editorSuite.laptopDensity.documented) === JSON.stringify(result.extensions.editorSuite.laptopDensity.implemented) ? [] : ['The documented laptop dimensions differ from the current CSS snapshot. laptopDensity keeps documented and implemented values separate; this refresh does not overwrite concurrent editor work or certify it visually.']),
    ],
    retainedHistory: 'Other scoped extensions and prior verification records remain historical evidence, not newly verified behavior.',
  };
  result.components = components();
  result.narrative = {
    northStar: rootOverview.match(/\*\*Creative North Star: "([^"]+)"\*\*/)?.[1] ?? '',
    overview: rootOverview.replace(/^\*\*Creative North Star:[^\n]+\n\n/, ''),
    keyCharacteristics: [], rules,
    dos: [...rootDos.matchAll(/^- (Do .+)$/gm)].map(match => match[1]),
    donts: [...rootDos.matchAll(/^- (Don't .+)$/gm)].map(match => match[1]),
  };
  return result;
}

async function main() {
  const [current, document, css] = await Promise.all([
    readFile(new URL('.impeccable/design.json', ROOT), 'utf8'), readFile(new URL('DESIGN.md', ROOT), 'utf8'),
    readFile(new URL('client/src/styles/editor-suite.css', ROOT), 'utf8'),
  ]);
  const previous = JSON.parse(current);
  const check = process.argv.includes('--check');
  const refreshed = refreshDesignMetadata(previous, document, css, check ? previous.generatedAt : undefined);
  if (check) {
    if (JSON.stringify(previous) !== JSON.stringify(refreshed)) throw new Error('Design metadata is stale; run node scripts/refresh-design-metadata.mjs');
    console.log('Design metadata matches source; DESIGN.md unchanged.');
    return;
  }
  await writeFile(new URL('.impeccable/design.json', ROOT), `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8');
  console.log('Refreshed .impeccable/design.json; DESIGN.md unchanged. Documentation/source conflict recorded explicitly.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
