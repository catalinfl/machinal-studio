const productionNotice = /(?:^|[^\p{L}\p{N}])(?:AI[-\s]+generated|generated\s+(?:with|by)\s+AI|AI\s+illustration|ilustra[țt]ie(?:\s+artistic[ăa])?\s+AI|generat[ăa]?\s+(?:cu|de)\s+AI|nara[țt]iune\s+sintetic[ăa])(?=$|[^\p{L}\p{N}])/iu;

export const isProductionNotice = text => productionNotice.test(text);

function visibleBounds(element, root, config) {
  const rect = element.getBoundingClientRect();
  const origin = root.getBoundingClientRect();
  const width = Math.min(rect.right, origin.left + config.width) - Math.max(rect.left, origin.left);
  const height = Math.min(rect.bottom, origin.top + config.height) - Math.max(rect.top, origin.top);
  if (width < 1 || height < 1) return false;
  let opacity = 1;
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    opacity *= Number(style.opacity);
    if (current === root) break;
  }
  return opacity >= 0.1;
}

function canvasHasArtwork(canvas) {
  if (!canvas.width || !canvas.height) return false;
  try {
    const context = canvas.getContext('2d');
    let pixels;
    if (context) {
      pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } else {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl || gl.isContextLost()) return false;
      pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    let first;
    for (let index = 0; index < pixels.length; index += 16) {
      const color = pixels.subarray(index, index + 4);
      if (!first) first = color;
      if (Math.abs(color[3] - first[3]) > 16 || color[3] > 16 && color.slice(0, 3).some((value, channel) => Math.abs(value - first[channel]) > 12)) return true;
    }
  } catch {
    // Pixel access may fail for media-backed canvases; DOM media is checked separately.
  }
  return false;
}

function hasPaint(element, root) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'canvas') return canvasHasArtwork(element);
  if (tag === 'img') return element.complete && element.naturalWidth > 0;
  if (tag === 'video') return element.readyState >= 2 && element.videoWidth > 0;
  if (['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use'].includes(tag)) return true;
  const style = getComputedStyle(element);
  if (tag === 'rect') {
    const rect = element.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    return rect.width < bounds.width * 0.95 || rect.height < bounds.height * 0.95;
  }
  if ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) return true;
  const rect = element.getBoundingClientRect();
  const bounds = root.getBoundingClientRect();
  const isBackground = rect.width >= bounds.width * 0.95 && rect.height >= bounds.height * 0.95;
  return !isBackground && (style.backgroundImage !== 'none' || !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor) || style.boxShadow !== 'none' || parseFloat(style.borderTopWidth) > 0);
}

export function inspectSceneVisibility(root, config) {
  const elements = [...root.querySelectorAll('*')].filter(element => !element.closest('script,style'));
  const visible = elements.filter(element => visibleBounds(element, root, config));
  const copy = visible.flatMap(element => [
    ...[...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()),
    ...['::before', '::after'].map(pseudo => getComputedStyle(element, pseudo).content).filter(content => !['none', 'normal', '""'].includes(content)),
  ]).filter(Boolean).join(' ');
  const issues = isProductionNotice(copy) ? [{ code: 'production_label_on_screen', text: 'Remove AI-production labels/watermarks; keep explanations and provenance outside the scene.' }] : [];
  return { hasForeground: visible.some(element => hasPaint(element, root)), issues };
}
