export function hyperframeFontSource(definitions, path) {
  const value = definitions.find(definition => definition.path === path)?.src;
  if (!value) throw new Error(`Missing native font: ${path}`);
  return `url("${value}")`;
}

export async function loadHyperframeFonts(definitions) {
  await Promise.all(definitions.map(async ({ family, path, src, weight = '400', style = 'normal' }) => {
    if (!src) throw new Error(`Unbundled Hyperframes font: ${path}`);
    const face = new FontFace(family, `url("${src}")`, { weight, style });
    document.fonts.add(face);
    try { await face.load(); }
    catch (error) { throw new Error(`Hyperframes font ${family} (${path}, ${weight}): ${error.message}`); }
  }));
}

export function uploadHyperframeElement(gl, target, element, resources) {
  const upload = () => gl.texElementImage2D(target, gl.RGBA8, element);
  try { upload(); }
  catch (error) {
    if (!/cached paint record/i.test(error.message)) throw error;
    const canvas = element.closest('canvas') ?? gl.canvas;
    const pending = new Promise((resolve, reject) => {
      canvas.addEventListener('paint', () => {
        try { upload(); resolve(); } catch (error) { reject(error); }
      }, { once: true, signal: resources.signal });
      canvas.requestPaint();
    });
    resources.track(pending);
  }
}
