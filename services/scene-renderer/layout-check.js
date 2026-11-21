const allowedOverlap = element => element.closest('[data-layout-overlap="allow"]');

function visible(element, root) {
  let opacity = 1;
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    opacity *= Number(style.opacity);
    if (current === root) break;
  }
  return opacity >= 0.25;
}

export function inspectSceneLayout(root, config) {
  const origin = root.getBoundingClientRect();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs = [];
  const issues = [];
  const shortSide = Math.min(config.width, config.height);
  const tolerance = Math.max(2, shortSide * 0.003);
  let node;
  while ((node = walker.nextNode())) {
    const element = node.parentElement;
    const text = node.textContent.trim();
    if (!text || !element || element.closest('style,script') || !visible(element, root)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const bounds = { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top, width: rect.width, height: rect.height };
      const label = text.slice(0, 70);
      if (bounds.left < -tolerance || bounds.top < -tolerance || bounds.right > config.width + tolerance || bounds.bottom > config.height + tolerance) {
        issues.push({ code: 'text_out_of_frame', text: label, message: 'Readable text extends outside the scene canvas' });
      }
      if (bounds.height < shortSide * 0.014) issues.push({ code: 'text_too_small', text: label, message: 'Text is too small to read at this output size' });
      if (config.captionSafeBottom > 0 && bounds.bottom > config.height * (1 - config.captionSafeBottom) + tolerance) issues.push({ code: 'caption_band_collision', text: label, message: 'Scene text overlaps the reserved timeline caption band' });
      if (bounds.height > shortSide * 0.22 && !allowedOverlap(element)) issues.push({ code: 'text_too_large', text: label, message: 'Text exceeds the readable scene typography scale' });
      if (element.scrollWidth > element.clientWidth + tolerance && element.clientWidth > 0 && ['hidden', 'clip'].includes(getComputedStyle(element).overflowX)) {
        issues.push({ code: 'text_clipped', text: label, message: 'The text container clips its contents' });
      }
      runs.push({ ...bounds, element, text: label });
    }
  }
  for (let left = 0; left < runs.length; left++) {
    for (let right = left + 1; right < runs.length; right++) {
      const a = runs[left], b = runs[right];
      if (a.element === b.element || allowedOverlap(a.element) || allowedOverlap(b.element)) continue;
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width > tolerance && height > Math.min(a.height, b.height) * 0.2 && width * height > Math.min(a.width * a.height, b.width * b.height) * 0.12) {
        issues.push({ code: 'text_collision', text: `${a.text} / ${b.text}`, message: 'Independent text blocks overlap' });
      }
    }
  }
  return issues.slice(0, 12);
}
