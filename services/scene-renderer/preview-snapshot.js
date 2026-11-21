const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

function usesFontRange(rule, characters) {
  const ranges = rule.style.unicodeRange.split(',').map(range => {
    const [start, end = start] = range.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(start.replace(/\?/g, '0'), 16), parseInt(end.replace(/\?/g, 'f'), 16)];
  });
  return !rule.style.unicodeRange || characters.some(code => ranges.some(([start, end]) => code >= start && code <= end));
}

function rasterMedia(element) {
  if (element instanceof HTMLCanvasElement) return element.toDataURL();
  const canvas = document.createElement('canvas');
  canvas.width = element.videoWidth;
  canvas.height = element.videoHeight;
  if (!canvas.width || !canvas.height) return '';
  canvas.getContext('2d').drawImage(element, 0, 0);
  return canvas.toDataURL();
}

function replaceMedia(target, clone) {
  const originals = target.querySelectorAll('canvas,video');
  const copies = clone.querySelectorAll('canvas,video');
  originals.forEach((element, index) => {
    const image = document.createElement('img');
    for (const attribute of element.attributes) image.setAttribute(attribute.name, attribute.value);
    image.removeAttribute('src');
    image.removeAttribute('srcset');
    const style = getComputedStyle(element);
    for (const property of style) image.style.setProperty(property, style.getPropertyValue(property));
    image.src = rasterMedia(element);
    copies[index].replaceWith(image);
  });
}

export class PreviewSnapshot {
  #canvas = document.createElement('canvas');
  #image = new Image();
  #serializer = new XMLSerializer();

  #sceneStyles(target) {
    const fonts = new Set();
    for (const element of [target, ...target.querySelectorAll('*')]) {
      if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
      const style = getComputedStyle(element);
      fonts.add(`${style.fontFamily.replace(/["']/g, '')}:${style.fontStyle}`);
    }
    const rules = Array.from(document.styleSheets, sheet => Array.from(sheet.cssRules)).flat();
    const characters = [...new Set(Array.from(target.textContent, letter => letter.codePointAt(0)))];
    const usedRules = rules.filter(rule => rule.type !== CSSRule.FONT_FACE_RULE
      || fonts.has(`${rule.style.fontFamily.replace(/["']/g, '')}:${rule.style.fontStyle || 'normal'}`) && usesFontRange(rule, characters));
    return usedRules.map(rule => rule.cssText).join('\n');
  }

  async capture(target, config, scale) {
    // Preserve the scene's stylesheets instead of expanding every computed
    // CSS property on every node, every frame (especially costly for particles).
    const clone = target.cloneNode(true);
    replaceMedia(target, clone);
    const width = Math.max(1, Math.round(config.width * scale));
    const height = Math.max(1, Math.round(config.height * scale));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(config.width));
    svg.setAttribute('height', String(config.height));
    const foreign = document.createElementNS(SVG_NS, 'foreignObject');
    foreign.setAttribute('width', '100%');
    foreign.setAttribute('height', '100%');
    const body = document.createElementNS(HTML_NS, 'body');
    const style = document.createElementNS(HTML_NS, 'style');
    style.textContent = this.#sceneStyles(target);
    body.append(style, clone);
    foreign.append(body);
    svg.append(foreign);
    const loaded = new Promise((resolve, reject) => {
      this.#image.onload = resolve;
      this.#image.onerror = () => reject(new Error('Could not capture the live scene.'));
    });
    this.#image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.#serializer.serializeToString(svg))}`;
    await loaded;
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;
    const context = this.#canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.drawImage(this.#image, 0, 0, width, height);
    return createImageBitmap(this.#canvas);
  }
}
