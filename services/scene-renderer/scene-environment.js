import fontCSS from 'scene-font-css';

export const sceneFontCSS = fontCSS;

export async function installSceneEnvironment() {
  const style = document.createElement('style');
  style.textContent = `${fontCSS}\nhtml,body,#scene{margin:0;width:100%;height:100%;overflow:hidden}html{font-size:16px}body{font-family:'Direction Sans';font-size:16px;line-height:normal}*{box-sizing:border-box}`;
  document.head.appendChild(style);
  const aliases = {
    'Direction Sans': ['Arial', 'Helvetica', 'Roboto'],
    'Direction Serif': ['Georgia', 'Times New Roman', 'Merriweather'],
    'Direction Mono': ['Courier New', 'Roboto Mono'],
  };
  const loading = [];
  for (const rule of style.sheet.cssRules) {
    if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
    const family = rule.style.fontFamily.replace(/["']/g, '');
    for (const name of [family, ...(aliases[family] ?? [])]) {
      const face = new FontFace(name, rule.style.src, {
        weight: rule.style.fontWeight, style: rule.style.fontStyle, unicodeRange: rule.style.unicodeRange,
      });
      document.fonts.add(face);
      loading.push(face.load());
    }
  }
  // Canvas text can be drawn on the first update, before DOM resource readiness.
  await Promise.all(loading);
}

function sceneFontFamily(value) {
  const names = value.toLowerCase().split(',').map(name => name.trim().replace(/["']/g, ''));
  for (const name of names) {
    if (/^lato$/.test(name)) return 'Lato';
    if (/^montserrat(?: variable)?$/.test(name)) return 'Montserrat';
    if (/^open sans(?: variable)?$/.test(name)) return 'Open Sans';
    if (/^oswald(?: variable)?$/.test(name)) return 'Oswald';
    if (/^playfair display(?: variable)?$/.test(name)) return 'Playfair Display';
    if (/^ibm plex sans(?: variable)?$/.test(name)) return 'IBM Plex Sans';
    if (/direction mono|roboto mono|courier|monospace|consolas|menlo|monaco|lucida console/.test(name)) return 'Direction Mono';
    if (/direction serif|merriweather|georgia|times|palatino|^serif$/.test(name)) return 'Direction Serif';
    if (/direction sans|roboto|arial|helvetica|system-ui|segoe|verdana|tahoma|sans-serif/.test(name)) return 'Direction Sans';
  }
  return 'Direction Sans';
}

export async function settleSceneFonts(target) {
  // OS font substitutions change glyph widths and line breaks between preview and export.
  const elements = [target, ...target.querySelectorAll('*')].filter(element => element.style);
  const families = elements.map(element => sceneFontFamily(getComputedStyle(element).fontFamily));
  for (let index = 0; index < elements.length; index++) {
    if (elements[index].closest('[data-hf-embedded-fonts]')) continue;
    const family = `'${families[index]}'`;
    if (elements[index].style.fontFamily.replace(/["']/g, '') !== families[index]) elements[index].style.fontFamily = family;
  }
  await document.fonts.ready;
}
