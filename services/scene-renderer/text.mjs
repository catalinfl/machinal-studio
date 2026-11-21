import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const families = ['roboto', 'roboto-mono', 'montserrat', 'open-sans', 'oswald', 'playfair-display', 'merriweather', 'ibm-plex-sans'];
let assets;

async function textAssets() {
  const source = process.env.TEXT_SOURCE_ROOT || resolve(import.meta.dirname, '../../client/src/lib');
  const bundle = await build({ entryPoints: [join(source, 'text-render.ts')], bundle: true, write: false, format: 'iife', globalName: 'DirectionText', minify: true });
  const stylesheets = families.flatMap(family => [
    `@fontsource-variable/${family}/index.css`,
    ...(family === 'oswald' ? [] : [`@fontsource-variable/${family}/wght-italic.css`]),
  ]);
  stylesheets.push(...['400', '700', '400-italic', '700-italic'].map(weight => `@fontsource/lato/${weight}.css`));
  const styles = await Promise.all(stylesheets.map(async (stylesheet) => {
    const file = require.resolve(stylesheet);
    const css = await readFile(file, 'utf8');
    const fonts = [...css.matchAll(/url\(([^)]+)\)/g)];
    let embedded = css;
    for (const match of fonts) {
      const bytes = await readFile(resolve(dirname(file), match[1].replace(/["']/g, '')));
      embedded = embedded.replace(match[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
    }
    return embedded;
  }));
  return { javascript: bundle.outputFiles[0].text, css: styles.join('\n') };
}

export function validateText(input) {
  if (!Array.isArray(input?.textItems) || input.textItems.length > 500) throw new Error('Invalid text item count');
  if (typeof input.textRenderKey !== 'string' || !/^[a-f0-9]{64}$/.test(input.textRenderKey)) throw new Error('Invalid text render key');
  const presets = { '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080], '2k': [2560, 1440], '4k': [3840, 2160] };
  const base = presets[input.output?.resolution];
  if (!base || !['landscape', 'portrait', 'classic'].includes(input.output?.aspect)) throw new Error('Invalid output dimensions');
  const aspect = input.output.aspect;
  if (aspect === 'portrait') return { width: base[1], height: base[0], aspect };
  if (aspect === 'classic') return { width: input.output.resolution === '4k' ? 3840 : Math.round(base[1] * 4 / 3), height: input.output.resolution === '4k' ? 2880 : base[1], aspect };
  return { width: base[0], height: base[1], aspect };
}

export async function prepareText(input, signal) {
  const dimensions = validateText(input);
  assets ??= textAssets();
  const { javascript, css } = await assets;
  const directory = await mkdtemp(join(tmpdir(), 'direction-text-'));
  const data = JSON.stringify({ items: input.textItems, key: input.textRenderKey, ...dimensions }).replace(/</g, '\\u003c');
  // Native dump-dom can finish its virtual-time budget before asynchronous toBlob callbacks.
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>${css}</style><body><script>${javascript}</script><script>
  const input = ${data};
  DirectionText.buildRenderTextOverlays(input.items, input.width, input.height, input.aspect, { synchronousPNG: true }).then(overlays => {
    const layout = input.items.map(item => {
      const fitted = DirectionText.layoutTextItem(item, input.aspect);
      return { id: item.id, text: fitted.text, fontFamily: fitted.fontFamily, fontSize: fitted.fontSize, x: fitted.x, y: fitted.y, ...DirectionText.textRasterSize(fitted) };
    });
    const result = JSON.stringify({ key: input.key, overlays, layout }).replace(/[\u007f-\uffff]/g, character => String.fromCharCode(92) + 'u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    document.body.setAttribute('data-result', btoa(result));
  }).catch(() => document.body.setAttribute('data-error', 'failed'));
  </script></body>`;
  try {
    const path = join(directory, 'text.html');
    await writeFile(path, html, { mode: 0o600 });
    const args = ['--headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', '--virtual-time-budget=60000', '--dump-dom', pathToFileURL(path).href];
    if (process.env.SCENE_NO_SANDBOX === 'true') args.unshift('--no-sandbox');
    const { stdout } = await execute(process.env.SCENE_BROWSER || 'chromium', args, { signal, timeout: 120000, maxBuffer: 192 * 1024 * 1024, windowsHide: true });
    const match = stdout.match(/<body[^>]*data-result="([A-Za-z0-9+/=]+)"/);
    if (!match) throw new Error('Text rasterization did not finish');
    const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    if (result.overlays.length > 20000) throw new Error('Too many text overlays');
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
