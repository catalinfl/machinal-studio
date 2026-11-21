import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { sourceElements } from './hyperframes-port-support.mjs';

const mediaRoot = new URL('../hyperframes/media/', import.meta.url);
const registryRoot = new URL('../../../packages/mcp-installer/library/hyperframes-library/registry/', import.meta.url);
const require = createRequire(import.meta.url);
const mediaPattern = /\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|mp3|m4a|wav|ogg|json|ttf|glb|hdr)(?:[?#]|$)/i;
const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', json: 'application/json', ttf: 'font/ttf' };

function sampleNoisePNG(name) {
  const size = /bluenoise/.test(name) ? 64 : 128;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const noise = Math.round((Math.sin(x * 127.1 + y * 311.7) * 43758.5453 % 1 + 1) % 1 * 255);
    raw.set([noise, noise, noise, 255], offset);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const value of body) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function illustrativeAsset(name) {
  const seed = parseInt(createHash('sha256').update(name).digest('hex').slice(0, 6), 16);
  const hue = seed % 360;
  const label = /artist-|pl-/.test(name) ? `STUDIES / ${String(seed % 99).padStart(2, '0')}` : '';
  const artwork = /avatar|profile|joe-sai/.test(name)
    ? `<circle cx="320" cy="238" r="112" fill="#ffdcc1"/><path d="M85 640Q60 365 320 365T555 640" fill="hsl(${(hue + 130) % 360} 45% 24%)"/>`
    : /logo|mark/.test(name)
      ? '<path d="M160 120H280V275H485V395H280V550H160Z" fill="#faf5e9"/><circle cx="430" cy="190" r="70" fill="#faf5e9"/>'
      : `<circle cx="${180 + seed % 280}" cy="250" r="180" fill="hsl(${(hue + 55) % 360} 80% 65%)"/>
<path d="M-80 650Q200 95 720 500L720 720H-80Z" fill="hsl(${(hue + 180) % 360} 45% 23%)"/>
<path d="M-40 690Q290 210 690 600" stroke="#fff3d4" stroke-width="42" fill="none"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
<rect width="640" height="640" fill="hsl(${hue} 48% 40%)"/>${artwork}
<text x="44" y="590" fill="#fff4df" font-family="sans-serif" font-size="28" letter-spacing="4">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export async function prepareMedia(source, entry, directory) {
  const paths = new Set();
  if (entry.id === 'blocks-frost-sequence-camera-orbit') {
    paths.add('assets/textures/bluenoise64.png');
    paths.add('assets/textures/ice-inclusions-generated.png');
    paths.add('assets/shards-atlas.png');
  }
  if (entry.id === 'components-caption-texture') paths.add('compositions/components/lava.png');
  for (const tag of ['img', 'video', 'source', 'audio', 'link']) {
    for (const element of sourceElements(source, tag)) {
      for (const attribute of ['src', 'poster', 'href']) if (element.attributes[attribute]) paths.add(element.attributes[attribute]);
    }
  }
  for (const match of source.matchAll(/["'`]([^"'`\n<>]+\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|mp3|m4a|wav|ogg|json|ttf|glb|hdr)(?:[?#][^"'`\n<>]*)?)["'`]/gi)) {
    if (!/^\.\w+$/.test(match[1])) paths.add(match[1]);
  }
  for (const match of source.matchAll(/\burl\(\s*["']?([^"')]+)["']?\)/gi)) {
    if (mediaPattern.test(match[1])) paths.add(match[1]);
  }
  for (const match of source.matchAll(/(?:assetUrl|__hfAsset)\(\s*["']([^"']+\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|mp3|m4a|wav|ogg|json|ttf|glb|hdr))["']\s*\)/gi)) {
    paths.add(match[1]);
  }
  const images = sourceElements(source, 'img').length;
  if (!paths.size && !images) return { source, replacements: [], enabled: false };
  const assets = {};
  const replacements = [];
  for (const path of paths) {
    if (/^(data:|blob:|#)/.test(path) || (!mediaPattern.test(path) && !/^__[A-Z_]+__$/.test(path))) continue;
    const clean = path.split(/[?#]/)[0];
    const ext = clean.split('.').pop().toLowerCase();
    let bytes;
    if (!/^https?:/.test(clean)) {
      const assetURL = new URL(clean, directory);
      if (assetURL.href.startsWith(registryRoot.href)) {
        try { bytes = await readFile(assetURL); } catch { /* explicitly authorized substitute */ }
      }
    }
    const atlas = clean.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(us-atlas@3\.0\.1|world-atlas@2\.0\.2|es-atlas@0\.6\.0)\/([a-z0-9/_.-]+\.json)$/);
    if (atlas) bytes = await readFile(require.resolve(atlas[1].split('@')[0] + '/' + atlas[2]));
    if (!bytes && /Geist-(?:Bold|Regular|SemiBold)\.ttf$/.test(clean)) {
      bytes = await readFile(new URL('../hyperframes/source-data/Geist.ttf', import.meta.url));
    }
    if (!bytes && ext === 'glb') {
      const name = /macbook|laptop/i.test(clean) ? 'macbook' : 'iphone';
      bytes = await readFile(new URL(`../hyperframes/source-data/${name}.glb`, import.meta.url));
      replacements.push({ path, replacement: `locally authored generic ${name} model` });
    }
    if (!bytes && ext === 'hdr') {
      const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 16 +X 32\n');
      const pixels = Buffer.alloc(32 * 16 * 4);
      for (let index = 0; index < 32 * 16; index++) {
        const bright = index % 32 < 5 || index % 32 > 25 ? 245 : 25;
        pixels.set([bright, bright, bright, 129], index * 4);
      }
      bytes = Buffer.concat([header, pixels]);
      replacements.push({ path, replacement: 'locally authored studio HDR lighting environment' });
    }
    if (!bytes && /(?:bluenoise64|ice-inclusions-generated|shards-atlas)\.png$/.test(clean)) {
      bytes = sampleNoisePNG(clean);
      replacements.push({ path, replacement: 'locally authored deterministic sample noise texture' });
    }
    if (ext === 'json' && !bytes) continue;
    if (bytes) {
      assets[path] = `data:${mime[ext] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
    } else if (ext === 'mp4' || ext === 'webm' || /^__[A-Z_]+__$/.test(path)) {
      const sample = await readFile(new URL('../hyperframes/sample-motion.mp4', import.meta.url));
      assets[path] = `data:video/mp4;base64,${sample.toString('base64')}`;
      replacements.push({ path, replacement: 'locally authored silent motion sample' });
    } else if (['wav', 'm4a', 'mp3', 'ogg'].includes(ext)) {
      const wav = Buffer.alloc(44 + 16000);
      wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
      assets[path] = `data:audio/wav;base64,${wav.toString('base64')}`;
      replacements.push({ path, replacement: 'silent audio sample (missing original audio)' });
    } else {
      assets[path] = illustrativeAsset(path);
      replacements.push({ path, replacement: 'locally authored abstract illustration' });
    }
    assets[clean] = assets[path];
    assets[clean.split('/').pop()] ??= assets[path];
  }
  await mkdir(mediaRoot, { recursive: true });
  const fallback = illustrativeAsset(entry.id);
  await writeFile(new URL(`${entry.id}.mjs`, mediaRoot), `// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.\nconst assets=${JSON.stringify(assets)};\nexport default function asset(path){\nif(!path)return ${JSON.stringify(fallback)};\nconst value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;\nconst clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||${JSON.stringify(fallback)};\n}\n`);
  const styles = [];
  let html = source.replace(/\burl\(\s*["']?([^"')]+)["']?\)/gi, (match, path) => {
    if (!assets[path]) return match;
    const name = `--hf-asset-${styles.length}`;
    styles.push({ name, path });
    return `var(${name})`;
  });
  html = html.replace(/(<(?:img|video|source|audio|link)\b[^>]*?\b(?:src|poster|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix, quote, path) => assets[path] ? `${prefix}${quote}__HF_ASSET_${Buffer.from(path).toString('base64')}__${quote}` : match);
  return { source: html, replacements, styles, enabled: true };
}

export function resolveScriptMedia(script) {
  const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const replacements = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression'
      && (node.left.property?.name === 'src' || node.left.property?.value === 'src')) {
      replacements.push({ start: node.right.start, end: node.right.end });
      return;
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
      && node.callee.property?.name === 'setAttribute' && node.arguments[0]?.value === 'src'
      && node.arguments[1]) {
      replacements.push({ start: node.arguments[1].start, end: node.arguments[1].end });
      return;
    }
    if (node.type === 'CallExpression'
      && (node.callee?.name === 'fetch' || node.callee?.object?.name === 'd3' && node.callee?.property?.name === 'json'
        || /^(?:load|loadAsync)$/.test(node.callee?.property?.name ?? ''))
      && node.arguments[0]) {
      replacements.push({ start: node.arguments[0].start, end: node.arguments[0].end });
      return;
    }
    if (node.type === 'Property' && /(?:url|src|path|image|texture|logo)$/i.test(node.key?.name ?? '')
      && node.value && (node.value.type === 'Literal' && typeof node.value.value === 'string'
        && mediaPattern.test(node.value.value) || node.value.type === 'BinaryExpression'
        && /\.(?:png|jpe?g|webp|svg|ttf|woff2|glb)["']/.test(script.slice(node.value.start, node.value.end)))) {
      replacements.push({ start: node.value.start, end: node.value.end });
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  let output = script;
  for (const { start, end } of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, start) + `__hfAsset(${output.slice(start, end)})` + output.slice(end);
  }
  output = output.replace(/(["'])url\(\s*["']?\s*["']\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*["']\s*["']?\s*\)\1/g,
    (_match, _quote, variable) => `("url('" + __hfAsset(${variable}) + "')")`);
  return output;
}

export function normalizeReservedIdentifiers(script) {
  const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const positions = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Identifier' && node.name === '$') positions.add(node.start);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  for (const position of [...positions].sort((a, b) => b - a)) {
    script = script.slice(0, position) + '__hfSelect' + script.slice(position + 1);
  }
  return script;
}

export function modernizeCanvasCapture(script) {
  const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const edits = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.property?.name === 'texElementImage2D'
      && node.arguments.length === 6) {
      const argumentsText = [
        script.slice(node.callee.object.start, node.callee.object.end),
        script.slice(node.arguments[0].start, node.arguments[0].end),
        script.slice(node.arguments[5].start, node.arguments[5].end),
        '__hfScene.resources',
      ];
      edits.push({ start: node.start, end: node.end,
        value: `uploadHyperframeElement(${argumentsText.join(', ')})` });
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    script = script.slice(0, edit.start) + edit.value + script.slice(edit.end);
  }
  return script;
}
