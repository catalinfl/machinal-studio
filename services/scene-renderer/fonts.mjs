import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const families = [
  ['roboto', 'Direction Sans'],
  ['merriweather', 'Direction Serif', true, ['Georgia', 'Times New Roman', 'Palatino', 'Merriweather', 'serif']],
  ['roboto-mono', 'Direction Mono', true, ['Courier', 'Roboto Mono', 'monospace', 'Consolas', 'Menlo', 'Monaco', 'Lucida Console']],
  ['montserrat', 'Montserrat'],
  ['open-sans', 'Open Sans'],
  ['oswald', 'Oswald', false],
  ['playfair-display', 'Playfair Display'],
  ['ibm-plex-sans', 'IBM Plex Sans'],
  ['lato', 'Lato', true, [], false],
];

const embedded = new Map();
const maxFontBundles = 16;

export function selectedSceneFonts(source) {
  if (source === undefined) return families;
  const text = source.toLowerCase();
  return families.filter(([, family, , aliases = []]) => family === 'Direction Sans'
    || [family, ...aliases].some(name => name === 'serif'
      ? /(?<![-\w])serif(?![-\w])/i.test(source)
      : text.includes(name.toLowerCase())));
}

export function embeddedSceneFonts(source) {
  const selected = selectedSceneFonts(source);
  const key = selected.map(([, family]) => family).join('|');
  if (!embedded.has(key)) {
    if (embedded.size >= maxFontBundles) embedded.delete(embedded.keys().next().value);
    embedded.set(key, buildFontCSS(selected));
  }
  return embedded.get(key);
}

async function buildFontCSS(selected) {
  const rules = [];
  for (const [packageName, family, italic = true, , variable = true] of selected) {
    const directory = dirname(require.resolve(`${variable ? '@fontsource-variable' : '@fontsource'}/${packageName}/package.json`));
    const stylesheets = variable ? (italic ? ['index.css', 'wght-italic.css'] : ['index.css']) : ['400.css', '700.css', '400-italic.css', '700-italic.css'];
    for (const stylesheet of stylesheets) {
      const css = await readFile(join(directory, stylesheet), 'utf8');
      for (const [rule] of css.matchAll(/@font-face\s*\{[^}]+\}/g)) {
        const file = rule.match(/url\(\.\/(files\/[^)]+-(?:latin|latin-ext)-(?:wght|400|700)-(?:normal|italic)\.woff2)\)/)?.[1];
        if (!file) continue;
        const data = (await readFile(join(directory, file))).toString('base64');
        rules.push(rule.replace(/font-family:[^;]+;/, `font-family:'${family}';`)
          .replace(/font-display:[^;]+;/, 'font-display:block;')
          .replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${data}) format('woff2');`));
      }
    }
  }
  return rules.join('\n');
}
